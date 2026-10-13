// mail worker (the calendar's emails; names and addresses from the settings table - lib/settings.js)
//  - scheduled (Sundays 18:00 SAST): emails "the week ahead" to the addresses on Setup > Weekly email
//  - scheduled (every 10 min): sends anything queued in the outbox table (e.g. "added from the inbox" summaries)
//  - email: messages to inbox@<domain> from a family login or weekly-email address are stored in the database for Claude
//    to pick up (tools/fetch_inbox.py); anything from other senders is rejected.
//  - hourly (first 10-minute run of each hour): delete stored mail older than 30 days; email ALERT_TO if a job stopped (health.js)
import { page, esc } from "./layout.js";
import { EmailMessage } from "cloudflare:email";
import { buildDigest } from "./digest.js";
import { digestSchedule, digestDue, digestRange, DAYS } from "../../lib/digest-schedule.js";
import { publicHolidays as saPublicHolidays } from "./holidays.js";
import { purge, healthCheck, markHealthy } from "./health.js";
import { brand, loadSettings } from "../../lib/settings.js";
import { dumpDatabase, gzip } from "../../lib/backup.js";
import { syncEmailAddresses } from "../../lib/email-sync.js";
import { processInbox } from "../../lib/inbox.js";
import { sendUsage } from "../../lib/usage.js";

const MAX_SIZE = 20 * 1024 * 1024;
const CHUNK = 512 * 1024;

export default {
  // Only reachable from the website through its service binding (the worker has no public URL or route).
  // POST /send {to: [...], subject, text, html, ics?} - recipients must be active, verified weekly-email addresses.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/send") return new Response("Not found", { status: 404 });
    const b = await request.json();
    const ok = await recipients(env);
    const to = [...new Set((b.to || []).map((e) => String(e).toLowerCase()))].filter((e) => ok.map((x) => x.toLowerCase()).includes(e));
    if (!to.length) return Response.json({ error: "No confirmed addresses to send to" }, { status: 400 });
    const result = await sendTo(env, to, String(b.subject || "Calendar"), String(b.text || ""), String(b.html || ""), b.ics ? String(b.ics) : null);
    return Response.json({ result });
  },

  async scheduled(event, env, ctx) {
    // "last job run" stamp: the site warns admins (Upcoming) when the scheduled jobs haven't run for 30 minutes
    ctx.waitUntil(markHealthy(env, "jobs", event.cron));
    if (event.cron !== "*/10 * * * *") return;   // only the 10-minute job does anything (an old Sunday-only trigger is ignored)
    ctx.waitUntil((async () => {
      // the weekly email: on the day and hour chosen on Setup > Weekly email (in the family's time zone), once
      await maybeDigest(env, new Date(event.scheduledTime)).catch((e) => console.log("weekly email:", String(e)));
      // smart inbox (only when switched on in Setup): one new email -> proposals + approval email in the outbox
      await processInbox(env).then((r) => r && console.log("inbox:", r))
        .catch((e) => { console.log("inbox error:", String(e)); return markHealthy(env, "inbox_error", String(e.message || e).slice(0, 500)); });
      await sendOutbox(env);
      // once a day: "this calendar is in use" to the Family Calendar maker (Setup > This calendar; lib/usage.js)
      await sendUsage(env, new Date(event.scheduledTime)).catch((e) => console.log("usage check-in:", String(e)));
      if (new Date(event.scheduledTime).getUTCMinutes() < 10) await hourly(env, new Date(event.scheduledTime));
    })());
  },

  async email(message, env) {
    const from = String(message.from || "").toLowerCase();
    // family logins and the weekly-email addresses (e.g. a work address) may send things in
    const allowed = (await env.DB.prepare("SELECT lower(email) AS e FROM users WHERE active = 1 UNION SELECT lower(email) FROM digest_recipients WHERE active = 1")
      .all()).results.map((r) => r.e);
    if (!allowed.includes(from)) {
      message.setReject("This address only accepts mail from the family's calendar logins.");
      return;
    }
    if (message.rawSize > MAX_SIZE) {
      message.setReject("Too big - please send attachments under 20 MB.");
      return;
    }
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const subject = message.headers.get("subject") || "(no subject)";
    const row = await env.DB.prepare("INSERT INTO inbox_mail (received_at, from_addr, subject, size) VALUES (?, ?, ?, ?) RETURNING id")
      .bind(new Date().toISOString(), from, subject, raw.length).first();
    const parts = [];
    for (let i = 0, seq = 0; i < raw.length; i += CHUNK, seq++) {
      parts.push(env.DB.prepare("INSERT INTO inbox_parts (mail_id, seq, data) VALUES (?, ?, ?)").bind(row.id, seq, raw.slice(i, i + CHUNK)));
    }
    parts.push(env.DB.prepare("INSERT INTO change_log (at, user, action, details) VALUES (?, ?, 'Email received', ?)")
      .bind(new Date().toISOString(), from, `Inbox: ${subject}`));
    await env.DB.batch(parts);
  },
};

async function hourly(env, now = new Date()) {
  await purge(env);
  await syncEmailAddresses(env).catch((e) => markHealthy(env, "email_sync_error", String(e.message || e).slice(0, 500)));   // only if the Cloudflare key is set
  await monthlyBackup(env, now).catch((e) => console.log("backup email:", String(e)));
  const alert = await healthCheck(env);
  if (alert) {   // ALERT_TO if set (e.g. one person's address), else every admin whose address is confirmed for email
    const to = env.ALERT_TO ? [env.ALERT_TO] : (await env.DB.prepare(`SELECT DISTINCT u.email FROM users u JOIN digest_recipients d ON lower(d.email) = lower(u.email)
      WHERE u.role = 'admin' AND u.active = 1 AND d.verified = 1`).all()).results.map((r) => r.email);
    if (to.length) await sendTo(env, to, alert.subject, alert.text, alert.html);
  }
}

// on the 1st-3rd of each month (South African date), email the admins a full backup of the database (.sql.gz), so there
// is always a recent copy outside Cloudflare. Cloudflare itself also keeps 30 days of restore points.
async function monthlyBackup(env, now = new Date()) {
  const sa = new Date(now.getTime() + 2 * 3600e3), month = sa.toISOString().slice(0, 7);
  if (sa.getUTCDate() > 3 || sa.getUTCHours() < 7) return;
  const last = await env.DB.prepare("SELECT at FROM health WHERE key = 'backup_email'").first();
  if (last && new Date(new Date(last.at).getTime() + 2 * 3600e3).toISOString().slice(0, 7) === month) return;
  const to = (await env.DB.prepare(`SELECT DISTINCT u.email FROM users u JOIN digest_recipients d ON lower(d.email) = lower(u.email)
    WHERE u.role = 'admin' AND u.active = 1 AND d.verified = 1`).all()).results.map((r) => r.email);
  if (!to.length) return;
  const b = brand(await loadSettings(env.DB), env.SITE), day = sa.toISOString().slice(0, 10);
  const file = { name: `calendar-backup-${day}.sql.gz`, type: "application/gzip", bytes: await gzip(await dumpDatabase(env.DB, now)) };
  const text = `A full backup of the ${b.full}, ${day} (attached). Keep the email - you won't normally need it.\n` +
    `Cloudflare also keeps 30 days of restore points. Admins can download a fresh backup any time on the Setup tab.\n\n${b.url}\n`;
  const html = page("Monthly backup", day, `<p>A full backup of the calendar is attached (<b>${esc(file.name)}</b>). Just keep this email –
    you won't normally need it. 🔒 Info items are in it scrambled, exactly as stored.</p><p style="color:#495057">Cloudflare also keeps 30 days
    of restore points, and admins can download a fresh backup any time on the ⚙ Setup tab.</p>`, "Sent on the 1st of every month to the calendar's admins.", b.url, b.full);
  const result = await sendTo(env, to, `🗄️ ${b.site} backup – ${day}`, text, html, null, file);
  if (!result.includes("FAILED")) await markHealthy(env, "backup_email", `${file.name}, ${file.bytes.length} bytes: ${result}`);
}

const recipients = async (env) => env.ONLY_TO ? [env.ONLY_TO]
  : (await env.DB.prepare("SELECT email FROM digest_recipients WHERE active = 1 AND verified = 1").all()).results.map((r) => r.email);

async function sendTo(env, emails, subject, text, html, ics = null, file = null) {
  // sender: FROM if set, else calendar@<the calendar's domain> (Setup > This calendar > web address)
  const b = brand(await loadSettings(env.DB), env.SITE), results = [], name = b.site, from = env.FROM || b.from;   // name e.g. "Smith Calendar"
  if (!from) return "FAILED: no web address set yet (Setup > This calendar), so there's no address to send from";
  for (const email of emails) {
    try {
      await env.MAILER.send(new EmailMessage(from, email, mime(from, email, subject, text, html, ics, name, file)));
      results.push(`${email} ok`);
    } catch (err) {
      results.push(`${email} FAILED ${err}`);   // e.g. address not verified in Email Routing yet
    }
  }
  console.log(subject, results.join("; "));
  return results.join("; ");
}

// queued emails: claim each row first so two runs can't send it twice
export async function sendOutbox(env) {
  const rows = (await env.DB.prepare("SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 5").all()).results;
  if (!rows.length) return;
  const to = await recipients(env);
  for (const r of rows) {
    const claim = await env.DB.prepare("UPDATE outbox SET sent_at = ? WHERE id = ? AND sent_at IS NULL").bind(new Date().toISOString(), r.id).run();
    if (!claim.meta.changes) continue;
    const result = await sendTo(env, r.to_addr ? [r.to_addr] : to, r.subject, r.text, r.html);
    await env.DB.prepare("UPDATE outbox SET result = ? WHERE id = ?").bind(result, r.id).run();
  }
}

async function loadData(env) {
  const q = (sql) => env.DB.prepare(sql).all().then((r) => r.results);
  const [events, recurring, schoolHolidays, publicHolidays, people] = await Promise.all([
    q("SELECT * FROM events"), q("SELECT * FROM recurring"), q("SELECT * FROM school_holidays"),
    q("SELECT * FROM public_holidays"), q("SELECT * FROM people")]);
  const acks = await q("SELECT day, msg FROM acknowledged").catch(() => []);
  const settings = await loadSettings(env.DB);
  // 🔒 Info: only the plain expiry copy (date + "title – label"), never the encrypted details
  const expiring = await q("SELECT section, expires_on, expiry_label FROM vault_items WHERE expires_on IS NOT NULL").catch(() => []);
  const places = await q("SELECT * FROM places ORDER BY sort, key").catch(() => []);
  return { events, recurring, schoolHolidays, publicHolidays: saPublicHolidays(publicHolidays), people, places, acks, expiring, brand: brand(settings, env.SITE) };
}

async function maybeDigest(env, now) {
  const sched = digestSchedule(await loadSettings(env.DB));
  const last = await env.DB.prepare("SELECT at FROM health WHERE key = 'digest'").first();
  if (digestDue(now, sched, last?.at)) await sendDigest(env, now);
}

export async function sendDigest(env, now) {
  const data = await loadData(env);
  const sched = digestSchedule(await loadSettings(env.DB)), { from, to, sentOn } = digestRange(now, sched);
  const { subject, text, html } = buildDigest(data, from, to, data.brand.url || env.SITE,
    { sentOn, when: `every ${DAYS[sched.day]} at ${String(sched.hour).padStart(2, "0")}:00` });
  const result = await sendTo(env, await recipients(env), subject, text, html);   // ONLY_TO (--var when testing) = just that address
  if (!env.ONLY_TO && !result.includes("FAILED")) await markHealthy(env, "digest", result);
}

// ---------- calendar invite: mixed { alternative { text, html, text/calendar;method=REQUEST }, invite.ics }
function inviteMime(from, to, subject, text, html, ics, name) {
  const mixed = "m" + crypto.randomUUID().replace(/-/g, ""), alt = "a" + crypto.randomUUID().replace(/-/g, "");
  const part = (type, body) => [`Content-Type: ${type}`, "Content-Transfer-Encoding: base64", "", b64(body)];
  return [
    `From: "${String(name).replace(/["\\\r\n]/g, "")}" <${from}>`, `To: ${to}`, `Subject: ${encWord(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split("@")[1]}>`, "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`, "",
    `--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "",
    `--${alt}`, ...part("text/plain; charset=UTF-8", text),
    `--${alt}`, ...part("text/html; charset=UTF-8", `<!doctype html><html><body style="margin:0;padding:0;background:#f1f3f7">${html}</body></html>`),
    `--${alt}`, ...part('text/calendar; charset=UTF-8; method=REQUEST', ics),
    `--${alt}--`,
    `--${mixed}`, 'Content-Type: application/ics; name="invite.ics"', 'Content-Disposition: attachment; filename="invite.ics"',
    "Content-Transfer-Encoding: base64", "", b64(ics),
    `--${mixed}--`, "",
  ].join("\r\n");
}

// text + html with one attached file { name, type, bytes } (the monthly backup)
function fileMime(from, to, subject, text, html, name, file) {
  const mixed = "m" + crypto.randomUUID().replace(/-/g, ""), alt = "a" + crypto.randomUUID().replace(/-/g, "");
  let bin = ""; for (const x of file.bytes) bin += String.fromCharCode(x);
  const fname = String(file.name).replace(/["\\\r\n]/g, "");
  return [
    `From: "${String(name).replace(/["\\\r\n]/g, "")}" <${from}>`, `To: ${to}`, `Subject: ${encWord(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split("@")[1]}>`, "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`, "",
    `--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "",
    `--${alt}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(text),
    `--${alt}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    b64(`<!doctype html><html><body style="margin:0;padding:16px;background:#f4f6f9">${html}</body></html>`),
    `--${alt}--`,
    `--${mixed}`, `Content-Type: ${file.type}; name="${fname}"`, `Content-Disposition: attachment; filename="${fname}"`,
    "Content-Transfer-Encoding: base64", "", btoa(bin).replace(/.{76}/g, "$&\r\n"),
    `--${mixed}--`, "",
  ].join("\r\n");
}

// ---------- a small MIME builder (text + html, UTF-8, base64)
const b64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/.{76}/g, "$&\r\n");
};
const encWord = (s) => `=?UTF-8?B?${b64(s).replace(/\r\n/g, "")}?=`;

function mime(from, to, subject, text, html, ics = null, name = "Family Calendar", file = null) {
  const boundary = "b" + crypto.randomUUID().replace(/-/g, "");
  if (ics) return inviteMime(from, to, subject, text, html, ics, name);
  if (file) return fileMime(from, to, subject, text, html, name, file);
  return [
    `From: "${String(name).replace(/["\\\r\n]/g, "")}" <${from}>`,
    `To: ${to}`,
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split("@")[1]}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(`<!doctype html><html><body style="margin:0;padding:16px;background:#f4f6f9">${html}</body></html>`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
