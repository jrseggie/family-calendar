// 👋 Welcome message for a login (Settings > Who can sign in): the link to the calendar, how the email-code sign-in works,
// adding it to a phone's home screen and what they can see.
// The Worker can only email addresses confirmed with Cloudflare (Email Routing "destination addresses", which means a confusing
// "verify" email first), so the welcome normally goes from the admin themselves: "Send from my email" copies the designed email
// (welcomeMail html) to paste into a new message, "Send by WhatsApp" uses welcomeWhatsApp. "Send from the calendar" (sendWelcome)
// is only offered for addresses already confirmed. Signing in needs none of this: Cloudflare Access emails the code to anyone on
// the sign-in list. (users.welcome_wait / welcomeWaiting: welcomes asked for before 2026-10-26, when the site still asked Cloudflare to verify.)
import { page, esc, NAVY, FONT } from "../mail/src/layout.js";
import { brand, loadSettings } from "./settings.js";
import { canSyncEmail, destinations } from "./email-sync.js";

const now = () => new Date().toISOString();

// what this login can see / do, in plain words ("You can …")
const and = (l) => l.length > 1 ? `${l.slice(0, -1).join(", ")} and ${l.at(-1)}` : l[0] || "";
function access(u) {
  if (u.role === "admin") return "see and change everything, including Settings.";
  if (u.role === "editor") return "see everything and add or change entries.";
  if (u.role === "viewer") return "see the whole calendar, but not change anything.";
  if (u.role === "child") return "see the whole calendar and add entries – for yourself or anyone else (e.g. when you need a lift). " +
    "You can change or delete the ones you added. Anything that includes other people is pencilled in until a parent confirms it.";
  const who = String(u.see || "").split(",").map((s) => s.trim()).filter(Boolean);
  const extra = [u.see_school && "the school holidays", u.see_birthdays && "birthdays"].filter(Boolean);
  const edit = String(u.edit_who || "").split(",").map((s) => s.trim()).filter((p) => who.includes(p));
  return `see the entries for ${and(who) || "the people chosen for you"}${extra.length ? `, plus ${and(extra)}` : ""}` +
    (!u.can_edit ? ". You can't change anything." : edit.length && edit.length < who.length ? `. You can add and change entries for ${and(edit)} (e.g. when you're not available).` : ", and add or change them.");
}

export function welcomeMail(b, u, by) {
  const first = String(u.name || "").split(" ")[0] || "there";
  const subject = `Your login for the ${b.site} calendar`;
  const steps = [
    `Open the calendar: ${b.url || "(the calendar's web address)"}`,
    `Type this email address (${u.email}) and tap "Send me a code".`,
    `Cloudflare (the sign-in service) emails you a 6-digit code - check your spam folder if it doesn't arrive in a minute. Type the code in.`,
    `That's it: you stay signed in on that phone or computer for about 6 months.`,
  ];
  const phone = [
    `iPhone: open the calendar in Safari, tap the Share button (the square with the arrow) and choose "Add to Home Screen".`,
    `Android: open it in Chrome, tap the ⋮ menu and choose "Add to Home screen" (or "Install app").`,
  ];
  const text = [`Hi ${first},`, "",
    `${by ? `${by} has` : "You've been"} given you a login for the ${b.site} calendar. You can ${access(u)}`, "",
    "How to sign in:", ...steps.map((s, i) => `${i + 1}. ${s}`), "",
    "Put it on your phone's home screen (it then opens like an app):", ...phone.map((s) => `- ${s}`), "",
    `Any problems${by ? `? Just ask ${by}` : "? Ask whoever added you"}.`].join("\n");
  // Outlook-safe: tables + inline styles only (mail/src/layout.js)
  const url = b.url || "#", INK = "#212529", MUTED = "#6b7280";
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:6px auto 4px"><tr>
<td bgcolor="${NAVY}" style="background:${NAVY};border-radius:8px;padding:14px 34px"><a href="${esc(url)}" style="color:#ffffff;text-decoration:none;font-weight:bold;font-size:17px;${FONT}">Open the calendar &rarr;</a></td></tr></table>
<div style="text-align:center;${FONT};font-size:13px;color:${MUTED};padding-bottom:6px">${esc(b.url || "")}</div>`;
  const box = (bg, edge, title, inner) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 6px">
<tr><td bgcolor="${bg}" style="background:${bg};border-left:4px solid ${edge};padding:12px 16px;${FONT};font-size:15px;color:${INK}">
<div style="font-weight:bold;padding-bottom:4px">${title}</div>${inner}</td></tr></table>`;
  const step = (n, head, hint) => `<tr><td width="40" valign="top" style="padding:8px 0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="28" height="28" align="center" bgcolor="${NAVY}" style="background:${NAVY};border-radius:14px;color:#ffffff;font-weight:bold;font-size:14px;${FONT}">${n}</td></tr></table></td>
<td valign="top" style="padding:10px 0 8px;${FONT};font-size:15px;color:${INK}">${head}${hint ? `<div style="font-size:13px;color:${MUTED};padding-top:2px">${hint}</div>` : ""}</td></tr>`;
  const phoneCell = (title, how) => `<td width="50%" valign="top" bgcolor="#f1f3f5" style="background:#f1f3f5;padding:12px 14px;${FONT};font-size:14px;color:${INK}"><b>${title}</b><div style="padding-top:4px">${how}</div></td>`;
  const html = page(`Welcome, ${first} 👋`, `Your login for the ${b.site} calendar`,
    `<p style="margin:0 0 14px;font-size:16px">${by ? `${esc(by)} has` : "You've been"} given you a login for our family calendar – everything that's coming up, in one place, on your phone or computer.</p>
${button}
${box("#e7f0ff", NAVY, "👀 What you can see", `You can ${esc(access(u))}`)}
<div style="font-weight:bold;font-size:17px;padding:18px 0 2px">🔑 How to sign in</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${step(1, `Open the calendar (the button above).`)}
${step(2, `Type <b>${esc(u.email)}</b> and tap <b>Send me a code</b>.`, "No password to remember – a code is emailed to you instead.")}
${step(3, `Type in the <b>6-digit code</b> from the email.`, "It comes from Cloudflare (the sign-in service) – check your spam folder if it hasn't arrived after a minute.")}
${step(4, `You're in!`, "You stay signed in on that phone or computer for about 6 months.")}
</table>
<div style="font-weight:bold;font-size:17px;padding:18px 0 8px">📱 Put it on your phone's home screen</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${phoneCell("iPhone", `In <b>Safari</b>, tap Share <span style="color:${MUTED}">(the square with the arrow)</span>, then <b>Add to Home Screen</b>.`)}
<td width="10" style="font-size:1px">&nbsp;</td>
${phoneCell("Android", `In <b>Chrome</b>, tap the <b>⋮</b> menu, then <b>Add to Home screen</b> <span style="color:${MUTED}">(or Install app)</span>.`)}
</tr></table>
<p style="margin:18px 0 0;color:${MUTED};font-size:14px">It then opens like an app. Any problems? ${by ? `Just ask ${esc(by)}.` : "Ask whoever added you."}</p>`,
    `You're getting this because ${by || "someone"} added you on ${b.site}.`, url, b.full);
  return { subject, text, html };
}

// the same message for WhatsApp: *bold*, emoji, one link at the end (WhatsApp turns it into a preview card)
export function welcomeWhatsApp(b, u, by) {
  const first = String(u.name || "").split(" ")[0] || "there";
  return [`👋 *Welcome to the ${b.site} calendar, ${first}!*`, "",
    `You can ${access(u)}`, "",
    "🔑 *How to sign in*",
    "1️⃣ Open the link at the bottom",
    `2️⃣ Type your email address (${u.email}) and tap *Send me a code*`,
    "3️⃣ Type in the 6-digit code that Cloudflare (the sign-in service) emails you – check spam if it hasn't come after a minute",
    "4️⃣ You're in – and you stay signed in for about 6 months", "",
    "📱 *Put it on your home screen* (it then opens like an app)",
    "iPhone: in Safari tap Share ⬆ › *Add to Home Screen*",
    "Android: in Chrome tap ⋮ › *Add to Home screen*", "",
    `Any problems? ${by ? `Just ask ${by}.` : "Ask whoever added you."}`, "",
    `👉 ${b.url || ""}`].join("\n");
}

// can the calendar itself email this address? (own web address + the address is confirmed with Cloudflare)
export async function canSendDirect(env, b, email) {
  if (!b.from) return false;
  if (!canSyncEmail(env)) return true;   // can't check: let it try
  return (await destinations(env).catch(() => ({})))[email.toLowerCase()] === true;
}

// "sent from my email / WhatsApp": noted so Settings shows it was done
export async function markWelcome(env, u, via, by) {
  await env.DB.prepare("UPDATE users SET welcome_at = ?, welcome_via = ?, welcome_by = ?, welcome_wait = NULL WHERE id = ?").bind(now(), via, by || null, u.id).run();
}

async function queue(env, b, u, by) {
  const m = welcomeMail(b, u, by);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO outbox (created_at, subject, text, html, to_addr) VALUES (?, ?, ?, ?, ?)").bind(now(), m.subject, m.text, m.html, u.email),
    env.DB.prepare("UPDATE users SET welcome_at = ?, welcome_via = 'calendar', welcome_wait = NULL WHERE id = ?").bind(now(), u.id)]);
}

// "Send from the calendar": queued, goes out within 10 minutes - only for an address Cloudflare already lets the site email
//   sent | notconfirmed (never asks Cloudflare to send its "verify" email) | noemail (the calendar has no own web address yet)
export async function sendWelcome(env, u, by) {
  const b = brand(await loadSettings(env.DB), env.SITE);
  if (!b.from) return { state: "noemail" };
  if (!(await canSendDirect(env, b, u.email))) return { state: "notconfirmed" };
  await env.DB.prepare("UPDATE users SET welcome_by = ? WHERE id = ?").bind(by || null, u.id).run();
  await queue(env, b, u, by);
  return { state: "sent" };
}

// 10-minute job: welcomes waiting for an address to be confirmed go out as soon as Cloudflare says it is
export async function welcomeWaiting(env) {
  const rows = (await env.DB.prepare("SELECT * FROM users WHERE welcome_wait IS NOT NULL AND active = 1").all().catch(() => ({ results: [] }))).results;
  if (!rows.length || !canSyncEmail(env)) return;
  const dest = await destinations(env), b = brand(await loadSettings(env.DB), env.SITE);
  for (const u of rows) if (dest[u.email.toLowerCase()] === true) await queue(env, b, u, u.welcome_by);
}
