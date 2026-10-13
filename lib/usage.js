// Usage check-in: once a day each calendar tells the Family Calendar maker it's in use (RELEASE-PLAN.md).
// Setup > This calendar > "Let the Family Calendar maker know you use it" (settings.usage_share):
//   anonymous (default) - a random install number, the version, how many logins it has, how many were used in the
//                         last 30 days and how many changes were made in the last 30 days
//   named               - the same + the calendar's name (only when the family ticked the box)
//   off                 - nothing is sent
// Never sent: entries, people, email addresses, the web address.
import { VERSION } from "./version.js";
import { loadSettings, brand } from "./settings.js";

export const STATS_URL = "https://family-calendar-stats.jrseggie.workers.dev/ping";
export const USAGE_SHARE = {
  named: "Yes – with our calendar's name",
  anonymous: "Anonymously (just a count)",
  off: "Off – send nothing",
};
export const usageMode = (s) => USAGE_SHARE[s.usage_share] ? s.usage_share : "anonymous";

// what would be sent (null = nothing): also shown to admins on Setup so they can see exactly what goes out
export async function usagePayload(env, now = new Date()) {
  const s = await loadSettings(env.DB), mode = usageMode(s);
  if (mode === "off") return null;
  let id = s.install_id;
  if (!id) {
    id = crypto.randomUUID();
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('install_id', ?)").bind(id).run();
    id = (await loadSettings(env.DB)).install_id || id;
  }
  const since = new Date(now.getTime() - 30 * 864e5).toISOString().slice(0, 10);
  const count = async (sql, ...args) => { try { return (await env.DB.prepare(sql).bind(...args).first())?.n ?? null; } catch { return null; } };
  return {
    id, version: VERSION,
    logins: await count("SELECT COUNT(*) AS n FROM users WHERE active = 1"),
    active_logins: await count("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND last_seen >= ?", since),
    changes_30d: await count("SELECT COUNT(*) AS n FROM change_log WHERE at >= ?", since),
    ...(mode === "named" ? { name: brand(s).site } : {}),
  };
}

// the daily check-in (the 10-minute job calls this; it only sends once every ~day)
export async function sendUsage(env, now = new Date()) {
  if (env.DEMO) return null;   // the local demo isn't a real calendar
  // after a check-in that went through: again in ~a day; after one that didn't: try again in an hour
  const last = await env.DB.prepare("SELECT at, detail FROM health WHERE key = 'usage_ping'").first().catch(() => null);
  if (last && now.getTime() - Date.parse(last.at) < (/^HTTP 2/.test(last.detail || "") ? 20 : 1) * 3600e3) return null;
  const body = await usagePayload(env, now);
  if (!body) return null;
  const req = new Request(STATS_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  // the maker's own calendar is on the counter's Cloudflare account, which can't reach it by its public address: a direct link (STATS_PING)
  const r = env.STATS_PING ? await env.STATS_PING.fetch(req) : await fetch(req);
  await env.DB.prepare("INSERT INTO health (key, at, detail) VALUES ('usage_ping', ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, detail = excluded.detail")
    .bind(now.toISOString(), `HTTP ${r.status}`).run();
  return r.status;
}
