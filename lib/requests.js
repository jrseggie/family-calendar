// 💡 Requests (ideas / bug reports from anyone with a login). Every request is also sent to the Family Calendar maker, who
// decides what's built - for everyone. The maker's status and reply come back with the daily sync. The text of a request
// goes to the maker (the form says so); the screenshot and who logged it stay on the family's own calendar.
// The maker's own calendar (binding STATS = the maker's database) also sees and answers every family's requests.
import { VERSION } from "./version.js";
import { loadSettings, brand } from "./settings.js";
import { STATS_URL, installId, usageMode } from "./usage.js";

const MAKER = STATS_URL.replace(/\/ping$/, "");
export const REQUEST_STATUS = { new: "New", discussing: "Being discussed", planned: "Planned", done: "Done", wontdo: "Won't do" };

async function toMaker(env, path, body) {
  const req = new Request(`${MAKER}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const r = env.STATS_PING ? await env.STATS_PING.fetch(req) : await fetch(req);   // the maker's own calendar: a direct link (lib/usage.js)
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.status === 204 ? {} : r.json();
}

// send one request (and any not sent yet) to the maker
export async function sendRequests(env) {
  if (env.DEMO) return 0;
  const rows = (await env.DB.prepare("SELECT id, kind, title, details, page, device FROM requests WHERE sent_at IS NULL ORDER BY id LIMIT 10").all()).results;
  if (!rows.length) return 0;
  const s = await loadSettings(env.DB), id = await installId(env), name = usageMode(s) === "named" ? brand(s).site : null;
  let n = 0;
  for (const q of rows) {
    try {
      const r = await toMaker(env, "/request", { id, version: VERSION, name, local_id: q.id, kind: q.kind, title: q.title, details: q.details, page: q.page, device: q.device });
      await env.DB.prepare("UPDATE requests SET sent_at = ?, maker_id = ? WHERE id = ?").bind(new Date().toISOString(), r.maker_id || null, q.id).run();
      n++;
    } catch { break; }   // tried again by the hourly job
  }
  return n;
}

// the maker's answers for this calendar's requests (status + reply) - hourly job, every few hours
export async function syncRequests(env, now = new Date()) {
  if (env.DEMO) return;
  await sendRequests(env).catch(() => {});
  const last = await env.DB.prepare("SELECT at FROM health WHERE key = 'requests_sync'").first().catch(() => null);
  if (last && now.getTime() - Date.parse(last.at) < 4 * 3600e3) return;
  const any = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE sent_at IS NOT NULL").first().catch(() => ({ n: 0 }));
  if (!any?.n) return;
  const r = await toMaker(env, "/request-status", { id: await installId(env) });
  const stmts = (r.requests || []).filter((x) => Number.isInteger(x.local_id) && REQUEST_STATUS[x.status]).map((x) =>
    env.DB.prepare("UPDATE requests SET maker_status = ?, maker_note = ?, maker_at = ? WHERE id = ?").bind(x.status, String(x.note || "").slice(0, 2000) || null, x.at || null, x.local_id));
  stmts.push(env.DB.prepare("INSERT INTO health (key, at, detail) VALUES ('requests_sync', ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, detail = excluded.detail").bind(now.toISOString(), `${stmts.length} statuses`));
  await env.DB.batch(stmts);
}

// a new request on this calendar: an email to its admins (except on the maker's own calendar - the maker email covers it)
export async function queueAdminEmail(env, q, by) {
  if (env.STATS) return;
  const s = await loadSettings(env.DB), b = brand(s, env.SITE);
  const to = (await env.DB.prepare(`SELECT DISTINCT d.email FROM users u JOIN digest_recipients d ON lower(d.email) = lower(u.email)
    WHERE u.role = 'admin' AND u.active = 1 AND d.active = 1 AND d.verified = 1`).all()).results.map((r) => r.email);
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const kind = q.kind === "bug" ? "🐞 Bug" : "💡 Idea", subject = `${kind}: ${q.title}`;
  const text = `${by} logged a ${q.kind === "bug" ? "bug" : "request"} on ${b.site}:\n\n${q.title}\n\n${q.details || ""}\n\nIt has also been sent to the Family Calendar maker. See it on the 💡 Requests tab${b.url ? `: ${b.url}` : ""}.`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d2330"><p><b>${esc(by)}</b> logged a ${q.kind === "bug" ? "bug" : "request"} on ${esc(b.site)}:</p>
    <p style="font-size:16px"><b>${kind}: ${esc(q.title)}</b></p><p style="white-space:pre-wrap">${esc(q.details || "")}</p>
    <p style="color:#6b7280">It has also been sent to the Family Calendar maker. See it on the 💡 Requests tab${b.url ? ` – <a href="${esc(b.url)}">${esc(b.url)}</a>` : ""}.</p></div>`;
  if (to.length) await env.DB.batch(to.map((t) => env.DB.prepare("INSERT INTO outbox (created_at, subject, text, html, to_addr) VALUES (?, ?, ?, ?, ?)").bind(new Date().toISOString(), subject, text, html, t)));
}

// ---------- the maker's view (only where the maker's database is bound: STATS)
export async function makerList(env) {
  if (!env.STATS) return null;
  return (await env.STATS.prepare(`SELECT r.*, i.name AS install_name, i.version AS install_version FROM requests r LEFT JOIN installs i ON i.id = r.install_id ORDER BY r.id DESC LIMIT 500`)
    .all().catch(() => ({ results: [] }))).results;
}
export async function makerUpdate(env, id, status, note) {
  if (!env.STATS || !REQUEST_STATUS[status]) throw new Error("Not possible here");
  await env.STATS.prepare("UPDATE requests SET status = ?, note = ?, updated_at = ? WHERE id = ?").bind(status, String(note || "").slice(0, 2000) || null, new Date().toISOString(), id).run();
}
// new requests from any family since the last email (hourly job on the maker's calendar)
export async function makerNews(env) {
  if (!env.STATS) return [];
  const rows = (await env.STATS.prepare("SELECT r.*, i.name AS install_name FROM requests r LEFT JOIN installs i ON i.id = r.install_id WHERE r.emailed_at IS NULL ORDER BY r.id LIMIT 20").all().catch(() => ({ results: [] }))).results;
  if (rows.length) await env.STATS.prepare(`UPDATE requests SET emailed_at = ? WHERE id IN (${rows.map(() => "?").join(",")})`).bind(new Date().toISOString(), ...rows.map((r) => r.id)).run();
  return rows;
}
