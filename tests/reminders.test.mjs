// 🔔 Calendar reminders on the phone (lib/reminders.js): when they're due (in the calendar's time zone), who they go to (the people in
// Who, Family = everyone in the family), the words, and that the once-a-minute job sends each one once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fireAt, reminderText, reminderLogins, runReminders } from "../lib/reminders.js";
import { b64u } from "../lib/push.js";

const TZ = "Africa/Johannesburg";
const e = (o) => ({ id: 1, title: "Clean the bird cage", start: "2026-11-07", end: "2026-11-07", start_time: "10:00", who: "Leo", remind: "at", ...o });

test("when: at the time, 15 minutes / an hour before, the evening before at 18:00 - in the calendar's time zone", () => {
  assert.equal(fireAt(e(), TZ).toISOString(), "2026-11-07T08:00:00.000Z");   // 10:00 in South Africa
  assert.equal(fireAt(e({ remind: "15" }), TZ).toISOString(), "2026-11-07T07:45:00.000Z");
  assert.equal(fireAt(e({ remind: "60" }), TZ).toISOString(), "2026-11-07T07:00:00.000Z");
  assert.equal(fireAt(e({ remind: "eve" }), TZ).toISOString(), "2026-11-06T16:00:00.000Z");
  assert.equal(fireAt(e({ start_time: null, remind: "eve" }), TZ).toISOString(), "2026-11-06T16:00:00.000Z");   // all-day: the evening before works
  assert.equal(fireAt(e({ start_time: null }), TZ), null);   // "at the time" needs a time
  assert.equal(fireAt(e({ remind: null }), TZ), null);
});

test("words and who", () => {
  assert.equal(reminderText(e()).body, "10:00 Clean the bird cage");
  assert.equal(reminderText(e({ remind: "15" })).body, "In 15 minutes (10:00): Clean the bird cage");
  assert.equal(reminderText(e({ remind: "eve" })).body, "Tomorrow 10:00: Clean the bird cage");
  const users = [{ id: 1, name: "Emma", active: 1 }, { id: 2, name: "Leo Smith", person: "Leo", active: 1 }, { id: 3, name: "Nanny", active: 1 }, { id: 4, name: "Max", active: 0 }];
  const people = [{ name: "Emma", family: 1 }, { name: "Leo", family: 1 }, { name: "Max", family: 1 }, { name: "Nanny", family: 0 }];
  assert.deepEqual(reminderLogins(e(), users, people), [2]);   // a child's login goes by its person
  assert.deepEqual(reminderLogins(e({ who: "Family" }), users, people), [1, 2]);   // Family = the family (not the nanny; Max's login is off)
  assert.deepEqual(reminderLogins(e({ who: "Nanny, Emma" }), users, people), [1, 3]);
});

test("the once-a-minute job: sends a reminder that's due, once; not early; not hours late", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, person TEXT, role TEXT, active INTEGER);
           CREATE TABLE people (name TEXT, family INTEGER, active INTEGER DEFAULT 1);
           CREATE TABLE events (id INTEGER PRIMARY KEY, start TEXT, end TEXT, start_time TEXT, who TEXT, title TEXT, status TEXT);
           INSERT INTO users VALUES (2, 'Leo', 'Leo', 'child', 1); INSERT INTO people VALUES ('Leo', 1, 1);`);
  db.exec("INSERT INTO settings VALUES ('timezone', 'Africa/Johannesburg')");
  for (const f of ["0048_push_notifications.sql", "0051_event_reminders.sql", "0052_event_done.sql", "0053_event_snooze.sql"]) {
    const sql = readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8").replace(/ALTER TABLE lists[^;]*;/g, "");
    db.exec(sql);
  }
  db.exec("INSERT INTO events (id, start, end, start_time, who, title, status, remind) VALUES (5, '2026-11-07', '2026-11-07', '10:00', 'Leo', 'Clean the bird cage', 'Confirmed', 'at')");
  const phone = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  db.prepare("INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (2, 'https://push.example/2', ?, ?, 'x')").run(b64u(await crypto.subtle.exportKey("raw", phone.publicKey)), b64u(crypto.getRandomValues(new Uint8Array(16))));
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), all: async () => ({ results: db.prepare(sql).all(...args) }), first: async () => db.prepare(sql).get(...args) ?? null, run: async () => db.prepare(sql).run(...args) });
  const sent = [], env = { DB: { prepare: (s) => stmt(s), batch: async (l) => { for (const s of l) await s.run(); } }, PUSH_FETCH: async (u) => { sent.push(u); return new Response(null, { status: 201 }); } };
  await runReminders(env, new Date("2026-11-07T07:59:00Z"));   // 09:59: not yet
  assert.equal(sent.length, 0);
  await runReminders(env, new Date("2026-11-07T08:00:30Z"));   // 10:00
  assert.equal(sent.length, 1);
  await runReminders(env, new Date("2026-11-07T08:01:30Z"));   // the next minute: not again
  assert.equal(sent.length, 1);
  db.exec("INSERT INTO events (id, start, end, start_time, who, title, status, remind) VALUES (6, '2026-11-07', '2026-11-07', '06:00', 'Leo', 'Feed the dogs', 'Confirmed', 'at')");
  await runReminders(env, new Date("2026-11-07T08:02:30Z"));   // 06:00 was hours ago (the job was paused): skipped, not sent late
  assert.equal(sent.length, 1);
});

test("✅ must confirm it's done: every 30 minutes until done, quiet 21:00-07:00, the parents once at 2 hours late; done = it stops", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('timezone', 'Africa/Johannesburg');
           CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, person TEXT, role TEXT, active INTEGER);
           INSERT INTO users VALUES (1, 'Emma', NULL, 'admin', 1), (2, 'Leo', 'Leo', 'child', 1);
           CREATE TABLE people (name TEXT, family INTEGER, active INTEGER DEFAULT 1); INSERT INTO people VALUES ('Emma', 1, 1), ('Leo', 1, 1);
           CREATE TABLE events (id INTEGER PRIMARY KEY, start TEXT, end TEXT, start_time TEXT, who TEXT, title TEXT, status TEXT);`);
  for (const f of ["0048_push_notifications.sql", "0051_event_reminders.sql", "0052_event_done.sql", "0053_event_snooze.sql"]) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8").replace(/ALTER TABLE lists[^;]*;/g, ""));
  db.exec("INSERT INTO events (id, start, end, start_time, who, title, status, remind, must_done) VALUES (7, '2026-11-07', '2026-11-07', '10:00', 'Leo', 'Clean the bird cage', 'Confirmed', 'at', 1)");
  const phone = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]), key = b64u(await crypto.subtle.exportKey("raw", phone.publicKey)), auth = b64u(crypto.getRandomValues(new Uint8Array(16)));
  for (const id of [1, 2]) db.prepare("INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, 'x')").run(id, `https://push.example/${id}`, key, auth);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), all: async () => ({ results: db.prepare(sql).all(...args) }), first: async () => db.prepare(sql).get(...args) ?? null, run: async () => db.prepare(sql).run(...args) });
  const sent = [], env = { DB: { prepare: (s) => stmt(s), batch: async (l) => { for (const s of l) await s.run(); } }, PUSH_FETCH: async (u) => { sent.push(u.split("/").pop()); return new Response(null, { status: 201 }); } };
  const at = async (iso) => { sent.length = 0; await runReminders(env, new Date(iso)); return [...sent]; };
  assert.deepEqual(await at("2026-11-07T08:00:20Z"), ["2"]);   // 10:00 the reminder (Leo)
  db.exec("UPDATE events SET snooze_until = '2026-11-07T08:20:00.000Z' WHERE id = 7");   // 😴 snoozed till 10:20
  assert.deepEqual(await at("2026-11-07T08:10:00Z"), []);       // 10:10 nothing
  assert.deepEqual(await at("2026-11-07T08:20:30Z"), ["2"]);   // 10:20 the snoozed reminder
  assert.deepEqual(await at("2026-11-07T08:21:30Z"), []);       // once
  assert.deepEqual(await at("2026-11-07T08:30:10Z"), ["2"]);   // 10:30 again
  assert.deepEqual(await at("2026-11-07T08:31:10Z"), []);       // not twice in the same half hour
  assert.deepEqual(await at("2026-11-07T10:00:10Z"), ["2", "1"]);   // 12:00 again, and the parent hears it's 2 hours late
  assert.deepEqual(await at("2026-11-07T10:30:10Z"), ["2"]);   // the parent only once
  assert.deepEqual(await at("2026-11-07T19:30:10Z"), []);       // 21:30: quiet
  assert.deepEqual(await at("2026-11-08T05:00:10Z"), ["2"]);   // 07:00 the next day: again
  // a weekly chore = one entry per date: next Saturday's is its own, so marking this one done leaves that one alone
  db.exec("INSERT INTO events (id, start, end, start_time, who, title, status, remind, must_done) VALUES (8, '2026-11-14', '2026-11-14', '10:00', 'Leo', 'Clean the bird cage', 'Confirmed', 'at', 1)");
  db.exec("UPDATE events SET done_at = '2026-11-08T05:10:00Z', done_by = 'Leo' WHERE id = 7");
  assert.deepEqual(await at("2026-11-08T05:30:10Z"), []);       // done: it stops
  assert.deepEqual(await at("2026-11-14T08:00:20Z"), ["2"]);   // next Saturday 10:00: that week's reminds as normal
});
