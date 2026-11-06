// 🔔 Calendar reminders on the phone (lib/push.js sends them). An entry with a reminder (events.remind, the entry form's "🔔 Remind")
// gets one at its start time, 15 minutes or an hour before, or the evening before at 18:00 - to the logins of the people in Who
// ("Family" = everyone ticked "Part of the family"). Repeats are separate entries, so a weekly chore reminds every week.
// The once-a-minute job (mail/src/index.js, cron "* * * * *") calls runReminders; event_reminders keeps it to one per person.
import { notify } from "./push.js";
import { loadSettings, brand } from "./settings.js";
import { offsetIn, localParts } from "./digest-schedule.js";

// ✅ "Must confirm it's done": after the first reminder, again every NAG_MINUTES until it's marked done - never between QUIET_FROM
// and QUIET_TO (it carries on in the morning); the parents (admins not in Who) hear once if it's LATE_HOURS late, and when it's done.
// It gives up after GIVE_UP_DAYS.
export const NAG_MINUTES = 30, QUIET_FROM = 21, QUIET_TO = 7, LATE_HOURS = 2, GIVE_UP_DAYS = 14;

export const REMIND = { at: "At the time", 15: "15 minutes before", 60: "1 hour before", eve: "The evening before (18:00)" };
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const nice = (d) => { const [y, m, x] = d.split("-"); return `${x}/${m}/${y}`; };

// when an entry's reminder is due (a Date), or null (none set, or it needs a time the entry hasn't got)
export function fireAt(e, tz) {
  if (!e.remind) return null;
  const at = (date, hm) => new Date(`${date}T${hm}:00${offsetIn(tz, date)}`);
  if (e.remind === "eve") return at(addDays(e.start, -1), "18:00");
  if (!e.start_time) return null;
  const t = at(e.start, e.start_time);
  return e.remind === "at" ? t : new Date(t.getTime() - Number(e.remind) * 60000);
}

// the words on the phone: "10:00 Clean the bird cage" / "Tomorrow 10:00 …" / "In 15 minutes (10:00) …"
export function reminderText(e) {
  const when = e.start_time ? e.start_time : "All day";
  const body = e.remind === "eve" ? `Tomorrow${e.start_time ? ` ${e.start_time}` : ""}: ${e.title}` : e.remind === "at" ? `${when} ${e.title}`
    : `In ${e.remind === "60" ? "1 hour" : `${e.remind} minutes`} (${e.start_time}): ${e.title}`;
  return { title: "🔔 Reminder", body: `${body}${e.end && e.end !== e.start ? ` (until ${nice(e.end)})` : ""}`, url: `/?event=${e.id}`, tag: `event-${e.id}-${e.start}`,
    // a tap opens the card (✅ Done / 😴 Snooze); Android phones also show the two as buttons on the notification (public/sw.js)
    event: e.id, actions: [{ action: "done", title: "✅ Done" }, { action: "snooze", title: "😴 15 min" }] };
}

// the logins for the people in an entry's Who (a login's person = users.person, else its first name)
export function reminderLogins(e, users, people) {
  const family = people.filter((p) => p.family && p.active !== 0).map((p) => p.name);
  const who = new Set(String(e.who || "").split(",").map((x) => x.trim()).filter(Boolean).flatMap((p) => p === "Family" ? family : [p]));
  return users.filter((u) => u.active && who.has(u.person || u.name)).map((u) => u.id);
}

// the parents to tell about a must-be-done entry: active admins who aren't in its Who (they're not the ones doing it)
export function parentLogins(e, users, people) {
  const doing = new Set(reminderLogins(e, users, people));
  return users.filter((u) => u.active && u.role === "admin" && !doing.has(u.id)).map((u) => u.id);
}
// a reminder that's sent only once per person for a given "slot" (the time it's for)
async function once(env, e, uid, slot, now) {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO event_reminders (event_id, user_id, fire_at, sent_at) VALUES (?, ?, ?, ?)").bind(e.id, uid, slot, now.toISOString()).run();
  return (r.meta?.changes ?? r.changes) !== 0;
}

export async function runReminders(env, now = new Date()) {
  const tz = brand(await loadSettings(env.DB)).tz, today = now.toISOString().slice(0, 10);
  // entries a reminder could be due for now: starting yesterday to the day after tomorrow (the evening-before ones too)
  const events = (await env.DB.prepare(`SELECT * FROM events WHERE remind IS NOT NULL AND status != 'Cancelled' AND (start BETWEEN ? AND ?
    OR (must_done = 1 AND done_at IS NULL AND start BETWEEN ? AND ?) OR snooze_until IS NOT NULL)`).bind(addDays(today, -1), addDays(today, 2), addDays(today, -GIVE_UP_DAYS), addDays(today, 2)).all().catch(() => ({ results: [] }))).results;
  if (!events.length) return 0;
  const users = (await env.DB.prepare("SELECT id, name, person, role, active FROM users").all()).results, people = (await env.DB.prepare("SELECT name, family, active FROM people").all()).results;
  let sent = 0;
  const quiet = (() => { const h = localParts(now, tz).hour; return h >= QUIET_FROM || h < QUIET_TO; })();
  for (const e of events) {
    const fire = fireAt(e, tz);
    // 😴 snoozed: nothing until then; then the reminder once more (and the nagging carries on from there)
    if (e.snooze_until && !(e.must_done && e.done_at)) {
      if (e.snooze_until > now.toISOString()) continue;
      if (now - new Date(e.snooze_until) <= 30 * 60000) {
        let again = false;
        for (const uid of reminderLogins(e, users, people)) if (await once(env, e, uid, `snooze:${e.snooze_until}`, now)) { again = true; sent += await notify(env, [uid], { ...reminderText(e), title: "🔔 Reminder (snoozed)" }); }
        if (again) continue;   // this minute it was the snoozed one; the 30-minute ones carry on after
      }
    }
    if (!fire || fire > now) continue;
    // ✅ not done yet: every 30 minutes after the first one (the slot it's for = fire + n × 30 min), the parents once at 2 hours late
    if (e.must_done && !e.done_at && now - fire >= NAG_MINUTES * 60000) {
      if (quiet || now - fire > GIVE_UP_DAYS * 864e5) continue;
      const slot = new Date(fire.getTime() + Math.floor((now - fire) / (NAG_MINUTES * 60000)) * NAG_MINUTES * 60000).toISOString();
      for (const uid of reminderLogins(e, users, people)) if (await once(env, e, uid, slot, now)) sent += await notify(env, [uid], { ...reminderText(e), title: "🔔 Still to do", body: `${e.title} – tap to mark it done` });
      if (now - fire >= LATE_HOURS * 3600e3) {
        const names = reminderLogins(e, users, people).map((id) => users.find((u) => u.id === id)?.name).filter(Boolean).join(", ");
        for (const uid of parentLogins(e, users, people)) if (await once(env, e, uid, "late", now)) sent += await notify(env, [uid], { title: "⏳ Not done yet", body: `${names || "Nobody"} hasn't done ${e.title} yet`, url: `/?event=${e.id}`, tag: `late-${e.id}` });
      }
      continue;
    }
    if (now - fire > 30 * 60000) continue;   // the first reminder more than half an hour late (e.g. the job was paused): skip
    if (e.must_done && e.done_at) continue;   // done already (e.g. early)
    for (const uid of reminderLogins(e, users, people)) if (await once(env, e, uid, fire.toISOString(), now)) sent += await notify(env, [uid], e.must_done ? { ...reminderText(e), body: `${reminderText(e).body} – tap to mark it done` } : reminderText(e));
  }
  // tidy: sent reminders older than 60 days
  await env.DB.prepare("DELETE FROM event_reminders WHERE sent_at < ?").bind(new Date(now.getTime() - 60 * 864e5).toISOString()).run().catch(() => {});
  return sent;
}

// ✅ marked done (POST /api/events/<id>/done): the parents who aren't in Who hear who did it
export async function doneNotice(env, e, by) {
  const users = (await env.DB.prepare("SELECT id, name, person, role, active FROM users").all()).results, people = (await env.DB.prepare("SELECT name, family, active FROM people").all()).results;
  const tell = parentLogins(e, users, people).filter((id) => id !== by.id);
  return notify(env, tell, { title: "✅ Done", body: `${by.name} did ${e.title}`, url: `/?event=${e.id}`, tag: `done-${e.id}` });
}
