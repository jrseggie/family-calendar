// "Switch on sign-in" (set-up wizard, a new family's first visit): with one Cloudflare key pasted by the family, the calendar
// sets itself up in their own Cloudflare account - nothing for them to click through in the Cloudflare dashboard:
//   - Cloudflare Access (Zero Trust) "Email code" login, allowing only the family's logins (policy kept in step with Setup > logins)
//   - a "bypass" app for /feed/* so phone calendars can subscribe (the long private link is the password there)
//   - the Worker's secrets: ACCESS_AUD + ACCESS_TEAM_DOMAIN (the site then checks every request's login), VAULT_KEY (🔒 Info,
//     generated here and shown ONCE as a recovery copy), CF_API_TOKEN + CF_ACCOUNT_ID (later jobs: logins, email addresses)
// The key needs (Account): Access: Apps and Policies Edit · Access: Organizations, Identity Providers, and Groups Edit ·
// Workers Scripts Edit · Email Routing Addresses Edit  (+ Account Settings Read). See docs/HELP.md.
const API = "https://api.cloudflare.com/client/v4";

export function cf(token) {
  return async (method, path, body) => {
    const r = await fetch(API + path, { method, body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    const d = await r.json().catch(() => ({}));
    if (!d.success) {
      const e = new Error(`Cloudflare (${method} ${path.replace(/\/accounts\/[0-9a-f]+/, "/accounts/…")}): ${(d.errors || []).map((x) => x.message).join("; ") || r.status}`);
      e.status = r.status; e.errors = d.errors || [];
      throw e;
    }
    return d.result;
  };
}

const randomKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "family";

// emails allowed to sign in = the active logins (users table) - called after every change on Setup > logins too
export async function syncAccessPolicy(env, token = env.CF_API_TOKEN) {
  const s = Object.fromEntries((await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('access_policy_id')").all()).results.map((r) => [r.key, r.value]));
  if (!token || !env.CF_ACCOUNT_ID || !s.access_policy_id) return null;
  const emails = (await env.DB.prepare("SELECT email FROM users WHERE active = 1").all()).results.map((r) => r.email.toLowerCase());
  const call = cf(token);
  const p = await call("GET", `/accounts/${env.CF_ACCOUNT_ID}/access/policies/${s.access_policy_id}`);
  await call("PUT", `/accounts/${env.CF_ACCOUNT_ID}/access/policies/${s.access_policy_id}`,
    { name: p.name, decision: "allow", include: emails.map((email) => ({ email: { email } })), exclude: [], require: [], session_duration: p.session_duration || "720h" });
  return emails;
}

// a new web address (Setup > This calendar): the sign-in and the phone-feed bypass must cover it too, else it won't open
export async function addAccessDomain(env, host) {
  const s = Object.fromEntries((await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('access_app_id','access_feed_app_id')").all()).results.map((r) => [r.key, r.value]));
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !s.access_app_id) return null;
  const call = cf(env.CF_API_TOKEN), A = `/accounts/${env.CF_ACCOUNT_ID}`, done = [];
  for (const [id, path] of [[s.access_app_id, ""], [s.access_feed_app_id, "/feed"]]) {
    if (!id) continue;
    const app = await call("GET", `${A}/access/apps/${id}`), want = host + path;
    const domains = app.self_hosted_domains || [app.domain];
    if (domains.includes(want)) continue;
    const keep = ["name", "domain", "type", "session_duration", "allowed_idps", "auto_redirect_to_identity", "app_launcher_visible", "policies"];
    const body = Object.fromEntries(keep.filter((k) => k in app).map((k) => [k, app[k]]));
    body.policies = (app.policies || []).map((p, i) => ({ id: p.id, precedence: p.precedence || i + 1 }));
    body.self_hosted_domains = [...domains, want];
    await call("PUT", `${A}/access/apps/${id}`, body);
    done.push(want);
  }
  return done;
}

// the whole set-up. host = the address the site is open on (e.g. smith-calendar.smith.workers.dev); worker = the Worker's name
export async function connectCloudflare(env, { token, email, name, host, worker, family }) {
  const call = cf(token), steps = [];
  await call("GET", "/user/tokens/verify");
  const accounts = await call("GET", "/accounts");
  if (!accounts.length) throw new Error("This key can't see a Cloudflare account");
  const acc = accounts[0].id, A = `/accounts/${acc}`;

  // Zero Trust organisation (the "team" whose login page sends the email codes)
  let org = await call("GET", `${A}/access/organizations`).catch((e) => { if (e.status === 404 || /not found|does not exist/i.test(e.message)) return null; throw e; });
  if (!org || !org.auth_domain) {
    const team = `${slug(family)}-${crypto.randomUUID().slice(0, 6)}`;
    org = await call("POST", `${A}/access/organizations`, { name: `${family || "Family"} Calendar`, auth_domain: `${team}.cloudflareaccess.com` });
    steps.push(`Created the Cloudflare Zero Trust team ${org.auth_domain}`);
  }
  const team = org.auth_domain;

  // "Email code" login
  const idps = await call("GET", `${A}/access/identity_providers`);
  let otp = idps.find((i) => i.type === "onetimepin");
  if (!otp) { otp = await call("POST", `${A}/access/identity_providers`, { type: "onetimepin", name: "Email code", config: {} }); steps.push("Turned on email-code sign-in"); }

  // who may sign in (kept in step with Setup > logins), the app for the site, and the phone-feed bypass
  const policy = await call("POST", `${A}/access/policies`, { name: `${family || "Family"} calendar logins`, decision: "allow",
    include: [{ email: { email: email.toLowerCase() } }], exclude: [], require: [], session_duration: "720h" });
  const app = await call("POST", `${A}/access/apps`, { name: `${family || "Family"} Calendar`, domain: host, type: "self_hosted",
    session_duration: "720h", allowed_idps: [otp.id], auto_redirect_to_identity: true, app_launcher_visible: false, policies: [{ id: policy.id, precedence: 1 }] });
  const bypass = await call("POST", `${A}/access/policies`, { name: `${family || "Family"} calendar feed (link is the password)`, decision: "bypass",
    include: [{ everyone: {} }], exclude: [], require: [] });
  const feedApp = await call("POST", `${A}/access/apps`, { name: `${family || "Family"} Calendar – phone feed`, domain: `${host}/feed`, type: "self_hosted",
    session_duration: "24h", app_launcher_visible: false, policies: [{ id: bypass.id, precedence: 1 }] });
  steps.push(`Sign-in switched on for ${host} (only ${email} so far – add more people on Setup)`);

  // remember the IDs (the site keeps the login list in step later), add the first admin login
  const put = (k, v) => env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v);
  await env.DB.batch([put("access_app_id", app.id), put("access_feed_app_id", feedApp.id), put("access_policy_id", policy.id), put("site_url", `https://${host}`),
    env.DB.prepare("INSERT INTO users (email, name, role, see_school, see_birthdays, can_edit, active) VALUES (?, ?, 'admin', 1, 1, 1, 1) ON CONFLICT(email) DO UPDATE SET role = 'admin', active = 1")
      .bind(email.toLowerCase(), name || email.split("@")[0])]);

  // the Worker's secrets - the last step: once ACCESS_AUD is set, every request needs the email-code login
  const vaultKey = env.VAULT_KEY || randomKey();
  const secret = (n, text) => call("PUT", `${A}/workers/scripts/${worker}/secrets`, { name: n, text, type: "secret_text" });
  if (!env.VAULT_KEY) await secret("VAULT_KEY", vaultKey);
  await secret("CF_ACCOUNT_ID", acc);
  await secret("CF_API_TOKEN", token);
  await secret("ADMIN_EMAILS", email.toLowerCase());
  await secret("ACCESS_TEAM_DOMAIN", team);
  await secret("ACCESS_AUD", app.aud);
  steps.push("Saved the calendar's keys in Cloudflare");
  return { steps, team, vaultKey: env.VAULT_KEY ? null : vaultKey };
}
