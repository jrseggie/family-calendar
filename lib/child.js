// 🧒 "Child" logins (Settings > Who can sign in): see the whole calendar and add entries for anyone, but only change or delete
// the entries they added themselves (events.created_login). An entry that includes anyone besides the child (users.person)
// goes on ✏️ pencilled in until a parent taps "✅ It's on"; the parents (admins) get an email about it, and about every delete.
import { page, esc } from "../mail/src/layout.js";
import { brand, loadSettings } from "./settings.js";

const split = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

// the people an entry names, with "Family" opened up into everyone ticked "Part of the family"
export function involvesOthers(who, person, family = []) {
  const all = split(who).flatMap((p) => p === "Family" ? family : [p]);
  return all.some((p) => p !== person);
}

// an entry this login may change or delete: its own (older entries without created_login: by the name it was added under)
export const ownEntry = (u, ev) => ev.created_login ? ev.created_login === u.id : ev.created_by === u.name;

// "Emma deleted / added / changed …" to the calendar's admins (verified Weekly email addresses), through the outbox
export async function tellParents(env, u, action, ev, note = "") {
  const b = brand(await loadSettings(env.DB), env.SITE);
  const to = (await env.DB.prepare(`SELECT DISTINCT d.email FROM users x JOIN digest_recipients d ON lower(d.email) = lower(x.email)
    WHERE x.role = 'admin' AND x.active = 1 AND d.active = 1 AND d.verified = 1`).all()).results.map((r) => r.email);
  if (!to.length) return;
  const first = String(u.name || "").split(" ")[0];
  const when = `${ev.start}${ev.end && ev.end !== ev.start ? ` to ${ev.end}` : ""}${ev.start_time ? ` ${ev.start_time}` : ""}`;
  const subject = `${first} ${action}: ${ev.title}`;
  const text = `${u.name} ${action} an entry on ${b.site}:\n\n${ev.title}\n${when} · ${ev.who}${note ? `\n\n${note}` : ""}\n\n${b.url || ""}`;
  const html = page(`${first} ${action} an entry`, b.site,
    `<p style="margin:0 0 8px;font-size:17px"><b>${esc(ev.title)}</b></p>
<p style="margin:0 0 12px;color:#6b7280">${esc(when)} · ${esc(ev.who)}</p>${note ? `<p style="margin:0 0 12px">${esc(note)}</p>` : ""}`,
    `${u.name} has a Child login: they can add entries, and change or delete only their own.`, b.url || "#", b.full);
  const at = new Date().toISOString();
  await env.DB.batch(to.map((t) => env.DB.prepare("INSERT INTO outbox (created_at, subject, text, html, to_addr) VALUES (?, ?, ?, ?, ?)").bind(at, subject, text, html, t)));
}
