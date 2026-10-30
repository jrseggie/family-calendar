// Nightly self-update for a calendar put in by the install page (settings deploy_mode = "direct"): once a day, after
// 01:00 in the calendar's time zone, it looks for a newer release, adds any new database tables, then puts the new
// version of itself in (lib/deploy.js) with the Cloudflare key it holds. Copies installed the GitHub way keep their
// GitHub update job instead. The result is kept in table `health` (key "update") for Settings.
import { VERSION, UPSTREAM_REPO } from "./version.js";
import { loadSettings } from "./settings.js";
import { cfApi, deployScript, migrate, releaseFile } from "./deploy.js";

const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const mark = (env, detail) => env.DB.prepare("INSERT INTO health (key, at, detail) VALUES ('update', ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, detail = excluded.detail")
  .bind(new Date().toISOString(), JSON.stringify(detail)).run();

export async function selfUpdate(env, now = new Date(), { force = false } = {}) {
  if (!UPSTREAM_REPO || !env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return null;
  const s = await loadSettings(env.DB);
  if (s.deploy_mode !== "direct" || !s.worker_name || !s.d1_id || s.auto_update === "off") return null;
  if (!force) {
    const hour = +new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: s.timezone || "Africa/Johannesburg" }).format(now);
    if (hour < 1 || hour > 4) return null;   // at night
    const last = await env.DB.prepare("SELECT at FROM health WHERE key = 'update'").first().catch(() => null);
    if (last && now - new Date(last.at) < 20 * 3600e3) return null;   // once a day
  }
  const manifest = await (await fetch(releaseFile(UPSTREAM_REPO, null, "manifest.json"))).json().catch(() => null);
  if (!manifest?.version) { await mark(env, { ok: false, version: VERSION, error: "Couldn't read the latest release" }); return null; }
  if (!newer(manifest.version, VERSION)) { await mark(env, { ok: true, version: VERSION, latest: manifest.version }); return null; }
  const log = [];
  try {
    const run = async (sql, params = []) => (await env.DB.prepare(sql).bind(...params).all()).results || [];
    const added = await migrate(manifest, run, (m) => log.push(m));
    const file = (name) => fetch(releaseFile(UPSTREAM_REPO, manifest.version, name)).then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r; });
    await deployScript(cfApi(env.CF_API_TOKEN), file, { acc: env.CF_ACCOUNT_ID, script: s.worker_name, d1Id: s.d1_id, manifest, log: (m) => log.push(m) });
    await mark(env, { ok: true, from: VERSION, version: manifest.version, migrations: added });
    return manifest.version;
  } catch (e) {
    await mark(env, { ok: false, version: VERSION, tried: manifest.version, error: String(e.message || e).slice(0, 400), steps: log.slice(-5) });
    throw e;
  }
}
