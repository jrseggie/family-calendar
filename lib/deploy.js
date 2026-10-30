// Putting a packed release (tools/pack-release.mjs: manifest.json, worker.js, <hash>.b64) into a Cloudflare account -
// used by the install page (get/, in the family's browser) and by the calendar's nightly self-update (lib/self-update.js).
// No GitHub account and no build step: the files come ready-made from the release.
//   cf(method, path, body, { auth, raw })  calls https://api.cloudflare.com/client/v4<path>; auth = another bearer (asset uploads)
//   file(name)                             fetches one of the release's packed files (a Response)
// repo = "owner/name" of the public release copy (lib/version.js UPSTREAM_REPO); version null = the latest release
export const releaseFile = (repo, version, name) => `https://github.com/${repo}/releases/${version ? `download/v${version}` : "latest/download"}/${name}`;

// a Cloudflare API caller from a token (inside a Worker; the browser goes through the install page's relay instead)
export function cfApi(token, base = "https://api.cloudflare.com/client/v4") {
  return async (method, path, body, opts = {}) => {
    const form = typeof FormData !== "undefined" && body instanceof FormData;
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${opts.auth || token}`, ...(body && !form ? { "Content-Type": "application/json" } : {}) },
      body: body ? (form ? body : JSON.stringify(body)) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const e = new Error(`${method} ${path.replace(/\/accounts\/[^/]+/, "/accounts/…")}: ${(j.errors || []).map((x) => `${x.code} ${x.message}`).join("; ") || r.status}`);
      e.codes = (j.errors || []).map((x) => x.code); e.status = r.status;
      throw e;
    }
    return opts.raw ? j : j.result;
  };
}

// the statements in a migration file (no triggers in our migrations, so ";" at a line end ends a statement)
export const statements = (sql) => sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n")
  .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);

// the migrations the database hasn't had yet (wrangler's d1_migrations table, so copies made either way stay in step)
// run(sql, params?) -> rows; returns the names applied
export async function migrate(manifest, run, log = () => {}) {
  await run("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
  const done = new Set((await run("SELECT name FROM d1_migrations")).map((r) => r.name));
  const applied = [];
  for (const m of manifest.migrations) {
    if (done.has(m.name)) continue;
    log(`Database: ${m.name}`);
    for (const s of statements(m.sql)) await run(s);
    await run("INSERT INTO d1_migrations (name) VALUES (?)", [m.name]);
    applied.push(m.name);
  }
  return applied;
}

// the site files: tell Cloudflare what's in this version, upload only the ones it doesn't have yet -> a completion token
async function uploadAssets(cf, file, acc, script, manifest, log) {
  const list = Object.fromEntries(Object.entries(manifest.assets).map(([p, a]) => [p, { hash: a.hash, size: a.size }]));
  const s = await cf("POST", `/accounts/${acc}/workers/scripts/${script}/assets-upload-session`, { manifest: list });
  let jwt = s.jwt;
  const typeOf = Object.fromEntries(Object.values(manifest.assets).map((a) => [a.hash, a.type]));
  for (const bucket of s.buckets || []) {
    log(`Uploading ${bucket.length} site file${bucket.length === 1 ? "" : "s"}`);
    const form = new FormData();
    for (const h of bucket) form.append(h, new File([await (await file(`${h}.b64`)).text()], h, { type: typeOf[h] || "application/octet-stream" }));
    const r = await cf("POST", `/accounts/${acc}/workers/assets/upload?base64=true`, form, { auth: s.jwt, raw: true });
    if (r.result?.jwt) jwt = r.result.jwt;
  }
  return jwt;
}

// put the calendar's code + site files in (a new copy or an update); secrets set earlier are kept
export async function deployScript(cf, file, { acc, script, d1Id, manifest, log = () => {} }) {
  const jwt = await uploadAssets(cf, file, acc, script, manifest, log);
  log("Putting the calendar in");
  const metadata = {
    main_module: manifest.main, compatibility_date: manifest.compatibility_date,
    bindings: [{ type: "assets", name: "ASSETS" }, { type: "d1", name: "DB", id: d1Id }, { type: "send_email", name: "MAILER" }],
    assets: { jwt, config: { ...(manifest.headers ? { _headers: manifest.headers } : {}) } },
    keep_bindings: ["secret_text", "secret_key", "plain_text"],
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append(manifest.main, new File([await (await file(manifest.main)).blob()], manifest.main, { type: "application/javascript+module" }));
  await cf("PUT", `/accounts/${acc}/workers/scripts/${script}`, form);
  if (manifest.crons?.length) await cf("PUT", `/accounts/${acc}/workers/scripts/${script}/schedules`, manifest.crons.map((cron) => ({ cron })));
}

// a brand-new calendar in the family's account: database + tables, the code, its workers.dev address.
// Returns { acc, script, d1Id, url, code }. name = a short name for the address, e.g. "smith"; code = its setup password
// token = the family's Cloudflare key (kept as the calendar's secret, for sign-in and nightly updates)
// script = the name an earlier try (stopped half-way) picked - it carries on with that one; onScript(name) is told the name
export async function installCalendar(cf, file, { name, token, script: again = "", onScript = () => {}, log = () => {} }) {
  const accounts = await cf("GET", "/accounts");
  if (!accounts?.length) throw new Error("The key can't see a Cloudflare account - make it again with the button and pick your account.");
  const acc = accounts[0].id;
  const manifest = await (await file("manifest.json")).json();
  // never touch a calendar that's already there: the first free name of family-calendar, family-calendar-2, …
  const taken = new Set((await cf("GET", `/accounts/${acc}/workers/scripts`)).map((w) => w.id));
  let script = again && taken.has(again) ? again : "family-calendar";
  for (let i = 2; script !== again && taken.has(script); i++) script = `family-calendar-${i}`;
  onScript(script);
  // the account's workers.dev subdomain (a new account has none yet)
  let sub = await cf("GET", `/accounts/${acc}/workers/subdomain`).then((r) => r?.subdomain).catch(() => null);
  for (let i = 0; !sub && i < 6; i++) {
    const want = `${name}${i ? `-${Math.random().toString(36).slice(2, 6)}` : ""}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "family";
    sub = await cf("PUT", `/accounts/${acc}/workers/subdomain`, { subdomain: want }).then((r) => r.subdomain).catch(() => null);
  }
  if (!sub) throw new Error("Couldn't set up the free workers.dev address - try again in a minute.");
  // its own database, named like the calendar (one left over from an install that stopped half-way is reused)
  log("Making the database");
  const dbs = await cf("GET", `/accounts/${acc}/d1/database?name=${script}`);
  const d1Id = dbs.find((d) => d.name === script)?.uuid || (await cf("POST", `/accounts/${acc}/d1/database`, { name: script })).uuid;
  const run = async (sql, params = []) => (await cf("POST", `/accounts/${acc}/d1/database/${d1Id}/query`, { sql, params }))[0]?.results || [];
  await migrate(manifest, run, log);
  await deployScript(cf, file, { acc, script, d1Id, manifest, log });
  log("Switching on its address");
  await cf("POST", `/accounts/${acc}/workers/scripts/${script}/subdomain`, { enabled: true, previews_enabled: false });
  // the keys it needs: the setup password for the first visit, and the Cloudflare key for sign-in + nightly updates
  log("Saving its keys");
  const code = [...crypto.getRandomValues(new Uint8Array(18))].map((x) => x.toString(16).padStart(2, "0")).join("");
  for (const [n, text] of [["SETUP_CODE", code], ["CF_API_TOKEN", token], ["CF_ACCOUNT_ID", acc]])
    await cf("PUT", `/accounts/${acc}/workers/scripts/${script}/secrets`, { name: n, text, type: "secret_text" });
  for (const [k, v] of [["deploy_mode", "direct"], ["worker_name", script], ["d1_id", d1Id]])
    await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [k, v]);
  return { acc, script, d1Id, version: manifest.version, url: `https://${script}.${sub}.workers.dev`, code };
}
