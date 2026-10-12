// Hourly housekeeping (from the 10-minute cron): clear out old stored mail, and email the admin (ALERT_TO) if a background job
// has stopped working. Jobs report in to the `health` table:
//   digest      - this worker, after the Sunday email
//   inbox_check - tools/fetch_inbox.py (the cloud routine, every 2 h 07:00-23:00 SAST)
//   backup      - tools/backup.sh on a PC, if someone runs one (optional)
//   email_sync  - lib/email-sync.js (hourly, when the Cloudflare key is set) or a PC task
import { brand, loadSettings } from "../../lib/settings.js";
import { canSyncEmail } from "../../lib/email-sync.js";
import { page, warnBox, esc } from "./layout.js";

const DAY = 864e5;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// stored emails, sent emails and deleted entries are kept 30 days
export async function purge(env) {
  const cut = ago(30 * DAY);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM inbox_parts WHERE mail_id IN (SELECT id FROM inbox_mail WHERE received_at < ?)").bind(cut),
    env.DB.prepare("DELETE FROM inbox_mail WHERE received_at < ?").bind(cut),
    env.DB.prepare("DELETE FROM outbox WHERE sent_at IS NOT NULL AND sent_at < ?").bind(cut),
    env.DB.prepare("DELETE FROM deleted_events WHERE deleted_at < ?").bind(cut),
    env.DB.prepare("DELETE FROM acknowledged WHERE day < ?").bind(ago(60 * DAY).slice(0, 10)),
  ]);
}

export const markHealthy = (env, key, detail = null) =>
  env.DB.prepare("INSERT OR REPLACE INTO health (key, at, detail) VALUES (?, ?, ?)").bind(key, new Date().toISOString(), detail).run();

const when = (s) => s ? new Date(s).toLocaleString("en-GB", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" }) : "never";

export async function problems(env, now = new Date()) {
  const h = Object.fromEntries((await env.DB.prepare("SELECT key, at FROM health").all()).results.map((r) => [r.key, r.at]));
  const older = (key, ms) => !h[key] || new Date(h[key]).getTime() < now.getTime() - ms;
  const sastHour = (now.getUTCHours() + 2) % 24;
  const out = [];
  // the routine runs 07:00-23:00 every 2 hours; only judge it in the daytime so the overnight gap doesn't count
  if (h.inbox_check !== undefined && sastHour >= 10 && sastHour <= 23 && older("inbox_check", 5 * 3600e3)) out.push(`The inbox check (cloud routine) last ran ${when(h.inbox_check)} – emails to inbox@ aren't being picked up.`);
  const waiting = await env.DB.prepare("SELECT count(*) n, min(received_at) t FROM inbox_mail WHERE status = 'new' AND received_at < ?").bind(ago(6 * 3600e3)).first();
  if (waiting.n && !(sastHour < 10)) out.push(`${waiting.n} email(s) sent to inbox@ since ${when(waiting.t)} are still waiting to be processed.`);
  const stuck = await env.DB.prepare("SELECT count(*) n FROM outbox WHERE sent_at IS NULL AND created_at < ?").bind(ago(3600e3)).first();
  if (stuck.n) out.push(`${stuck.n} queued email(s) haven't been sent for over an hour.`);
  const failed = await env.DB.prepare("SELECT subject, result FROM outbox WHERE sent_at > ? AND result LIKE '%FAILED%' ORDER BY id DESC LIMIT 3").bind(ago(DAY)).all();
  for (const f of failed.results) out.push(`Sending "${f.subject}" failed: ${String(f.result).slice(0, 200)}`);
  if (h.digest !== undefined && older("digest", 8 * DAY)) out.push(`The Sunday "week ahead" email last went out ${when(h.digest)}.`);
  // jobs that only some calendars have: judged once they've run at least once (or, for the email sync, once its key is set)
  if (h.backup !== undefined && older("backup", 9 * DAY)) out.push(`The weekly PC backup (tools/backup.sh) last ran ${when(h.backup)} – is that PC off?`);
  if (h.backup_email !== undefined && older("backup_email", 40 * DAY)) out.push(`The monthly backup email last went out ${when(h.backup_email)}.`);
  if ((h.email_sync !== undefined || canSyncEmail(env)) && older("email_sync", 3 * DAY))
    out.push(`The hourly email-address sync last ran ${when(h.email_sync)}. (Only matters for new weekly-email addresses.)`);
  return out;
}

// email the admin at most once a day per set of problems
export async function healthCheck(env) {
  const list = await problems(env);
  if (!list.length) return null;
  const sig = list.map((p) => p.replace(/\d/g, "")).sort().join("|");   // same problems, ignoring changing dates/counts
  const last = await env.DB.prepare("SELECT at, detail FROM health WHERE key = 'alert'").first();
  if (last && last.detail === sig && new Date(last.at).getTime() > Date.now() - DAY) return null;
  await markHealthy(env, "alert", sig);
  const b = brand(await loadSettings(env.DB), env.SITE);
  const html = page("Something needs a look", `${b.site} health check`, warnBox("Not working as expected", list.map(esc)) +
    `<p style="font-family:Arial,sans-serif;font-size:14px;color:#495057">Ask Claude to look at it (CLAUDE.md has the details of each job).</p>`,
    "Sent at most once a day while the problem lasts.", b.url, b.full);
  return { subject: `⚠ ${b.site}: something needs a look`, text: list.map((p) => "- " + p).join("\n"), html };
}
