// 🔒 Info -> calendar: a "⏳ Renew" entry a month before each expiry date on an Info item (rules.js expiries()).
// The entries are ordinary calendar events whose `source` ties them to the item and date ("🔒 Info #12 2027-03-31 Licence
// expires"), so saving the item moves / renames / removes them. Only the title and expiry line label are used - never
// the numbers or other details.
import "../public/rules.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (s) => { const [y, m, d] = s.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };

// same day one month earlier (31 Mar -> 28/29 Feb)
export function monthBefore(s) {
  const [y, m, d] = s.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 2, Math.min(d, last))).toISOString().slice(0, 10);
}

export const reminderTag = (id) => `🔒 Info #${id} `;

// the reminders an item should have. Expired dates get none; if the month-before day has passed, it goes on `today`
// (kept there: an existing reminder for the same date is not moved - see syncVaultReminders).
export function vaultReminders(id, item, today, people, fallbackWho = "Family") {
  const who = item.person && people.includes(item.person) ? item.person : fallbackWho;
  return globalThis.CalendarRules.expiries(item.fields).filter((x) => x.date >= today).map((x) => {
    const what = x.k.replace(/\s*(expiry date|expiry|expires|expiring|renewal date|renewal|valid until|due date|due)\s*$/i, "").trim();
    const start = monthBefore(x.date) < today ? today : monthBefore(x.date);
    return { source: `${reminderTag(id)}${x.date} ${x.k}`.slice(0, 200), start, end: start, who,
             title: `⏳ Renew: ${item.title}${what ? ` – ${what}` : ""} (expires ${nice(x.date)})`.slice(0, 200),
             category: "Household", status: "Confirmed", important: 1 };
  });
}

// make the calendar match: add missing reminders, update titles / who, delete ones whose date or line has gone.
// `item` = null when the Info item is deleted. Returns the change_log lines.
export async function syncVaultReminders(env, user, id, item, today, people, now, fallbackWho = "Family") {
  const tag = reminderTag(id);
  const have = (await env.DB.prepare("SELECT * FROM events WHERE instr(source, ?) = 1").bind(tag).all()).results;
  const want = item ? vaultReminders(id, item, today, people, fallbackWho) : [];
  const stmts = [], notes = [];
  for (const w of want) {
    const h = have.find((e) => e.source === w.source);
    if (!h) {
      stmts.push(env.DB.prepare("INSERT INTO events (start, end, who, title, category, status, important, source, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(w.start, w.end, w.who, w.title, w.category, w.status, w.important, w.source, user.name, now, user.name, now));
      notes.push(["Added event", `${w.start} ${w.title}`]);
    } else if (h.title !== w.title || h.who !== w.who) {
      stmts.push(env.DB.prepare("UPDATE events SET title=?, who=?, updated_by=?, updated_at=? WHERE id=?").bind(w.title, w.who, user.name, now, h.id));
      notes.push(["Edited event", `${h.start} ${w.title}`]);
    }
  }
  for (const h of have.filter((e) => !want.some((w) => w.source === e.source))) {
    stmts.push(env.DB.prepare("DELETE FROM events WHERE id=?").bind(h.id));
    notes.push(["Deleted event", `${h.start} ${h.title}`]);
  }
  if (stmts.length) await env.DB.batch(stmts);
  return notes;
}
