// 🔔 Phone notifications (lib/push.js): the encryption a phone can open, the signed note for the push service, and who hears what
// when things are added to a list (a child -> the parents on that list; anyone -> the shopper), grouped into one notification.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { encryptPush, vapidKeys, vapidAuth, groupMessage, listAdded, pushCatchUp, unb64u, b64u } from "../lib/push.js";
import { listsApi } from "../lib/lists.js";

const subtle = crypto.subtle, enc = new TextEncoder();
async function hkdf(salt, ikm, info, bytes) {
  const k = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}
// what the phone does (RFC 8291), so the test can open what the calendar sent
async function phoneOpens(body, phone, auth) {
  const salt = body.slice(0, 16), idlen = body[20], serverPub = body.slice(21, 21 + idlen), sealed = body.slice(21 + idlen);
  const pub = new Uint8Array(await subtle.exportKey("raw", phone.publicKey));
  const theirs = await subtle.importKey("raw", serverPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: theirs }, phone.privateKey, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...pub, ...serverPub]);
  const ikm = await hkdf(auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16), nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), sealed));
  assert.equal(plain[plain.length - 1], 2);   // the "last record" marker
  return new TextDecoder().decode(plain.slice(0, -1));
}
async function aPhone() {
  const phone = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { phone, auth, p256dh: b64u(await subtle.exportKey("raw", phone.publicKey)), authB64: b64u(auth) };
}

function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => db.prepare(sql).run(...args),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}
const phoneKeys = await aPhone();   // every test phone gets real keys (the message is really encrypted for it)
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, role TEXT, person TEXT, active INTEGER DEFAULT 1);
           CREATE TABLE places (key TEXT, active INTEGER DEFAULT 1); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE events (id INTEGER PRIMARY KEY, start TEXT, end TEXT, who TEXT, title TEXT, category TEXT, status TEXT, important INTEGER, source TEXT, created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT);
           INSERT INTO users VALUES (1, 'Emma', 'admin', NULL, 1), (2, 'Max', 'admin', NULL, 1), (3, 'Leo', 'child', 'Leo', 1);`);
  for (const f of ["0045_lists.sql", "0046_list_order_departments.sql", "0048_push_notifications.sql", "0049_list_jobs.sql"]) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  for (const id of [1, 2, 3]) db.prepare("INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, 'x')").run(id, `https://push.example/${id}`, phoneKeys.p256dh, phoneKeys.authB64);
  const sent = [], waits = [];
  const env = { DB: d1(db), PUSH_GROUP_MS: 30, PUSH_FETCH: async (url, init) => { sent.push({ to: url, init }); return new Response(null, { status: 201 }); } };
  const people = [{ name: "Emma", family: 1 }, { name: "Max", family: 1 }, { name: "Leo", family: 1 }, { name: "Family", type: "group" }];
  const users = { 1: { id: 1, name: "Emma", role: "admin" }, 2: { id: 2, name: "Max", role: "admin" }, 3: { id: 3, name: "Leo", role: "child", person: "Leo" } };
  const call = async (who, method, path, body) => (await listsApi({ request: { method, json: async () => body }, env, u: users[who], parts: path.split("/"), people, waitUntil: (p) => waits.push(p),
    json: (o) => ({ data: o, json: async () => o }), deny: (m) => { throw new Error(m); }, invalid: (m) => { throw new Error(m); } })).data;
  const settle = async () => { while (waits.length) await waits.shift(); };
  return { db, env, call, sent, settle, to: () => sent.map((s) => s.to.split("/").pop()).sort() };
}

test("a phone can open what the calendar sends (RFC 8291)", async () => {
  const p = await aPhone();
  const body = await encryptPush(JSON.stringify({ title: "🛒 Groceries", body: "Leo added milk" }), p.p256dh, p.authB64);
  assert.deepEqual(JSON.parse(await phoneOpens(body, p.phone, p.auth)), { title: "🛒 Groceries", body: "Leo added milk" });
});

test("the calendar makes its signing key once, and the note for the push service checks out with it", async () => {
  const { env } = setup();
  const a = await vapidKeys(env.DB), b = await vapidKeys(env.DB);
  assert.equal(a.publicKey, b.publicKey);
  const head = await vapidAuth("https://web.push.apple.com/abc", a, "mailto:x@example.com");
  const [, jwt, k] = head.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, a.publicKey);
  const [h, p, s] = jwt.split(".");
  assert.equal(JSON.parse(new TextDecoder().decode(unb64u(p))).aud, "https://web.push.apple.com");
  const pub = await subtle.importKey("raw", unb64u(a.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(s), enc.encode(`${h}.${p}`)));
});

test("the words: one thing, a few, many", () => {
  const l = { id: 7, name: "Groceries" };
  assert.equal(groupMessage(l, "Leo", ["milk"], "child").body, "Leo added milk");
  assert.equal(groupMessage(l, "Leo", ["milk", "bread", "eggs"], "child").body, "Leo added 3 things: milk, bread and eggs");
  assert.equal(groupMessage(l, "Leo", ["a", "b", "c", "d", "e"], "child").body, "Leo added 5 things: a, b, c and 2 more");
  assert.equal(groupMessage(l, "Max", ["eggs"], "shopping").body, "Max added eggs (while you're shopping)");
  assert.equal(groupMessage(l, "Leo", ["x"]).url, "/?list=7");
});

test("a child adding to a list the parents are on: the parents on it hear about it, once for the lot; a child's own list stays private", async () => {
  const { call, sent, settle, to } = setup();
  const { id } = await call(1, "POST", "lists", { name: "Groceries", members: [3] });   // Emma's list, shared with Leo (not Max)
  for (const [t, c] of [["Milk", "m1aaaaaa"], ["Bread", "m2aaaaaa"], ["Eggs", "m3aaaaaa"]]) await call(3, "POST", `lists/${id}/items`, { text: t, client_id: c });
  await settle();
  assert.deepEqual(to(), ["1"]);   // Emma only: Max isn't on this list, Leo is the one adding
  sent.length = 0;
  await call(1, "POST", `lists/${id}/items`, { text: "Tea", client_id: "m4aaaaaa" });   // a parent adding: nobody is told
  const { id: mine } = await call(3, "POST", "lists", { name: "Leo's things", members: [] });
  await call(3, "POST", `lists/${mine}/items`, { text: "Comics", client_id: "m5aaaaaa" });
  await settle();
  assert.equal(sent.length, 0);
});

test("going to the shop: everyone else on the list is told; for 2 hours the shopper hears about anything added", async () => {
  const { call, sent, settle, to } = setup();
  const { id } = await call(1, "POST", "lists", { name: "Groceries", members: [2, 3] });
  let r = await call(2, "POST", `lists/${id}/shopping`, { on: true });   // Max goes shopping
  await settle();
  assert.deepEqual(to(), ["1", "3"]);
  assert.equal(r.list.shopper, "Max");
  sent.length = 0;
  await call(1, "POST", `lists/${id}/items`, { text: "Eggs", client_id: "s1aaaaaa" });   // Emma adds: Max hears
  await settle();
  assert.deepEqual(to(), ["2"]);
  sent.length = 0;
  await call(3, "POST", `lists/${id}/items`, { text: "Chips", client_id: "s2aaaaaa" });   // Leo adds: Emma (parent) and Max (shopping, also a parent)
  await settle();
  assert.deepEqual(to(), ["1", "2"]);
  sent.length = 0;
  r = await call(2, "POST", `lists/${id}/shopping`, { on: false });
  await call(1, "POST", `lists/${id}/items`, { text: "Salt", client_id: "s3aaaaaa" });
  await settle();
  assert.equal(sent.length, 0);
  assert.equal(r.list.shopper, null);
});

test("the 10-minute job sends anything a cut-off request left behind, and never twice", async () => {
  const { db, env, sent } = setup();
  db.exec(`INSERT INTO lists (id, name, owner_id, created_at, updated_at) VALUES (9, 'Hardware', 1, 'x', 'x');
           INSERT INTO push_pending (recipient_id, list_id, actor_id, actor, text, why, created_at) VALUES (1, 9, 3, 'Leo', 'Rope', 'child', '2026-01-01T00:00:00Z');`);
  assert.equal(await pushCatchUp(env), 1);
  assert.equal(sent.length, 1);
  assert.equal(await pushCatchUp(env), 0);
  assert.equal(sent.length, 1);
  assert.equal(await listAdded(env, null, { id: 9, owner_id: 1 }, { id: 1, role: "admin", name: "Emma" }, "Tape"), undefined);   // the owner adding: nothing waiting
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM push_pending WHERE sent = 0").get().n, 0);
});

test("📌 jobs: whoever it's for hears about it, whoever gave it hears when it's done; it's on their For me list and on the calendar", async () => {
  const { db, call, sent, settle, to } = setup();
  const { id } = await call(1, "POST", "lists", { name: "DIY", members: [2] });   // Emma's DIY list, shared with Max
  await call(1, "POST", `lists/${id}/items`, { text: "Fix the door locks", client_id: "j1aaaaaa" });
  let r = await call(1, "PUT", `lists/${id}/items/c:j1aaaaaa`, { for: [2, 3], due: "2026-11-13" });   // Leo isn't on the list: dropped
  await settle();
  assert.deepEqual(to(), ["2"]);
  assert.equal(r.items[0].for_ids, ",2,");
  let ev = db.prepare("SELECT start, who, title FROM events WHERE source LIKE '🛒 List item #%'").all();
  assert.deepEqual(ev.map((e) => [e.start, e.who, e.title]), [["2026-11-13", "Max", "📌 Fix the door locks (DIY)"]]);
  assert.deepEqual((await call(2, "GET", "lists")).mine.map((m) => [m.text, m.list, m.due]), [["Fix the door locks", "DIY", "2026-11-13"]]);
  assert.equal((await call(1, "GET", "lists")).mine.length, 0);
  sent.length = 0;
  await call(1, "PUT", `lists/${id}/items/c:j1aaaaaa`, { for: [2], due: "2026-11-20" });   // a new date: the entry moves, nobody new is told
  await settle();
  assert.equal(sent.length, 0);
  assert.equal(db.prepare("SELECT start FROM events WHERE source LIKE '🛒 List item #%'").get().start, "2026-11-20");
  await call(2, "PUT", `lists/${id}/items/c:j1aaaaaa`, { done: true });   // Max does it: Emma hears, the entry goes, it leaves his For me
  await settle();
  assert.deepEqual(to(), ["1"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 0);
  assert.equal((await call(2, "GET", "lists")).mine.length, 0);
  // taken off Completed "as it was": still for Max, the entry is back; "as a new line" / typed again: who and date go
  let it = (await call(1, "PUT", `lists/${id}/items/c:j1aaaaaa`, { done: false })).items.find((i) => i.text === "Fix the door locks");
  assert.deepEqual([it.done, it.for_ids, it.due], [0, ",2,", "2026-11-20"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1);
  await call(1, "PUT", `lists/${id}/items/c:j1aaaaaa`, { done: true });
  it = (await call(1, "PUT", `lists/${id}/items/c:j1aaaaaa`, { done: false, fresh: true })).items.find((i) => i.text === "Fix the door locks");
  assert.deepEqual([it.done, it.for_ids, it.due], [0, null, null]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 0);
  await call(1, "PUT", `lists/${id}/items/c:j1aaaaaa`, { for: [2], due: "2026-11-27" });
  await call(1, "PUT", `lists/${id}/items/c:j1aaaaaa`, { done: true });
  it = (await call(1, "POST", `lists/${id}/items`, { text: "fix the door locks", client_id: "j9aaaaaa" })).items.find((i) => /door/i.test(i.text));
  assert.deepEqual([it.done, it.for_ids, it.due], [0, null, null]);
  // nobody on it any more: the date and the calendar entry go too
  await call(1, "PUT", `lists/${id}/items/c:j9aaaaaa`, { for: [2], due: "2026-11-27" });   // (typed again: it goes by its new phone id)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1);
  it = (await call(1, "PUT", `lists/${id}/items/c:j9aaaaaa`, { for: [], due: "2026-11-27" })).items.find((i) => /door/i.test(i.text));
  assert.deepEqual([it.for_ids, it.due], [null, null]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 0);
  await settle();
  sent.length = 0;
  await call(1, "POST", `lists/${id}/items`, { text: "Paint", client_id: "j2aaaaaa" });
  await call(1, "PUT", `lists/${id}/items/c:j2aaaaaa`, { for: [1], due: "2026-12-01" });   // for yourself: no notification; on the calendar under your own name
  await settle();
  assert.equal(sent.length, 0);
  assert.equal(db.prepare("SELECT who FROM events").get().who, "Emma");
  await call(1, "DELETE", `lists/${id}/items/c:j2aaaaaa`);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 0);
});
