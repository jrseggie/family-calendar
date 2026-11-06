// 🛒 Lists API (lib/lists.js) against a real SQLite database (node:sqlite) that behaves like D1: duplicates, order, departments,
// moving a line to another list, undo after a delete, and who may change a list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { listsApi } from "../lib/lists.js";

// the bits of D1 the API uses: prepare().bind().all() / first() / run(), and batch()
function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => db.prepare(sql).run(...args),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, role TEXT, person TEXT, active INTEGER DEFAULT 1);
           CREATE TABLE places (key TEXT, active INTEGER DEFAULT 1); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE events (id INTEGER PRIMARY KEY, start TEXT, end TEXT, who TEXT, title TEXT, category TEXT, status TEXT, important INTEGER, source TEXT, created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT);
           INSERT INTO users VALUES (1, 'Emma', 'admin', NULL, 1), (2, 'Leo', 'child', 'Leo', 1), (3, 'Nanny', 'limited', NULL, 1);
           INSERT INTO places VALUES ('town', 1), ('farm', 1);`);
  for (const f of ["0045_lists.sql", "0046_list_order_departments.sql", "0048_push_notifications.sql", "0049_list_jobs.sql", "0050_list_important.sql"]) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const env = { DB: d1(db) }, people = [{ name: "Leo", family: 1 }, { name: "Nanny", family: 0 }];
  const users = { 1: { id: 1, name: "Emma", role: "admin" }, 2: { id: 2, name: "Leo", role: "child", person: "Leo" }, 3: { id: 3, name: "Nanny", role: "limited" } };
  const call = async (who, method, path, body) => {
    const parts = path.split("/");
    const res = await listsApi({ request: { method, json: async () => body }, env, u: users[who], parts, people,
      json: (o) => ({ data: o, json: async () => o }),
      deny: (m) => { throw Object.assign(new Error(m), { status: 403 }); }, invalid: (m) => { throw Object.assign(new Error(m), { status: 400 }); } });
    return res.data;
  };
  return { db, call };
}
const open = (r) => r.items.filter((i) => !i.done).map((i) => i.text);

test("only family logins; a list is private until people are added, and only its owner can change who's on it", async () => {
  const { call } = setup();
  await assert.rejects(call(3, "GET", "lists"), /family/);
  const { id } = await call(1, "POST", "lists", { name: "Groceries", place: "town", members: [] });
  assert.equal((await call(2, "GET", "lists")).lists.length, 0);
  await call(1, "PUT", `lists/${id}`, { name: "Groceries", place: "town", members: [2] });
  assert.equal((await call(2, "GET", "lists")).lists.length, 1);
  // the list itself brings the family's logins, so "Share with" works after a refresh inside the list (Nanny isn't family)
  assert.deepEqual((await call(1, "GET", `lists/${id}`)).people.map((p) => p.name), ["Emma", "Leo"]);
  await assert.rejects(call(2, "PUT", `lists/${id}`, { name: "Groceries", place: "town", members: [] }), /Only the person who made the list/);
  await assert.rejects(call(2, "DELETE", `lists/${id}`), /Only the person who made the list/);
});

test("no duplicates: adding a completed thing again brings that one back, with the new department; capitals don't matter", async () => {
  const { call } = setup();
  const { id } = await call(1, "POST", "lists", { name: "Groceries", members: [] });
  let r = await call(1, "POST", `lists/${id}/items`, { text: "Hot Chocolate", client_id: "aaaaaaaa1" });
  const hc = r.items[0];
  await call(1, "PUT", `lists/${id}/items/${hc.id}`, { done: true });
  r = await call(1, "POST", `lists/${id}/items`, { text: "HOT chocolate", category: "Drinks", client_id: "aaaaaaaa2" });
  assert.equal(r.items.length, 1);
  assert.deepEqual([r.items[0].id, r.items[0].done, r.items[0].category, r.items[0].client_id], [hc.id, 0, "Drinks", "aaaaaaaa2"]);
  r = await call(1, "POST", `lists/${id}/items`, { text: "hot chocolate", client_id: "aaaaaaaa3" });
  assert.equal(r.duplicate, "Hot Chocolate");   // still to get: just a duplicate
  assert.equal(r.items.length, 1);
});

test("a category is remembered on its list (and same-name lists), not on other lists; new lines go to the bottom; the order can be saved", async () => {
  const { call } = setup();
  const { id } = await call(1, "POST", "lists", { name: "Groceries", members: [] });
  await call(1, "POST", `lists/${id}/items`, { text: "Coffee", category: "Pantry", client_id: "bbbbbbbb1" });
  await call(1, "POST", `lists/${id}/items`, { text: "Milk", client_id: "bbbbbbbb2" });
  let r = await call(1, "POST", `lists/${id}/items`, { text: "Bread", client_id: "bbbbbbbb3" });
  assert.deepEqual(open(r), ["Coffee", "Milk", "Bread"]);
  r = await call(1, "PUT", `lists/${id}/order`, { keys: ["c:bbbbbbbb3", "c:bbbbbbbb1", "c:bbbbbbbb2"] });
  assert.deepEqual(open(r), ["Bread", "Coffee", "Milk"]);
  const { id: twin } = await call(1, "POST", "lists", { name: " groceries", place: "farm", members: [] });   // same name: shares them
  r = await call(1, "POST", `lists/${twin}/items`, { text: "coffee", client_id: "bbbbbbbb4" });
  assert.equal(r.items[0].category, "Pantry");
  assert.deepEqual(r.departments, ["Pantry"]);
  const { id: range } = await call(1, "POST", "lists", { name: "Shooting range", members: [] });   // another list: its own
  r = await call(1, "POST", `lists/${range}/items`, { text: "Coffee", client_id: "bbbbbbbb5" });
  assert.equal(r.items[0].category, null);
  assert.deepEqual(r.departments, []);
});

test("ticking keeps one completed copy; un-ticking while it's back on the list keeps just the one", async () => {
  const { db, call } = setup();
  const { id } = await call(1, "POST", "lists", { name: "G", members: [] });
  let r = await call(1, "POST", `lists/${id}/items`, { text: "Eggs", client_id: "cccccccc1" });
  await call(1, "PUT", `lists/${id}/items/c:cccccccc1`, { done: true });
  r = await call(1, "POST", `lists/${id}/items`, { text: "Eggs", client_id: "cccccccc2" });   // comes back (same line)
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].done, 0);
  // two copies from before these rules: ticking one drops the older completed one; un-ticking a completed one that's back already drops it
  db.exec(`INSERT INTO list_items (list_id, text, done, done_at, client_id, created_at, updated_at) VALUES (${id}, 'eggs', 1, '2026-01-01T00:00:00Z', 'cccccccc3', 'x', 'x')`);
  r = await call(1, "PUT", `lists/${id}/items/c:cccccccc3`, { done: false });
  assert.deepEqual(r.items.map((i) => [i.text, i.done]), [["Eggs", 0]]);
  db.exec(`INSERT INTO list_items (list_id, text, done, done_at, client_id, created_at, updated_at) VALUES (${id}, 'EGGS', 1, '2026-01-01T00:00:00Z', 'cccccccc4', 'x', 'x')`);
  r = await call(1, "PUT", `lists/${id}/items/c:cccccccc2`, { done: true });
  assert.deepEqual(r.items.map((i) => [i.text, i.done]), [["Eggs", 1]]);
});

test("a line moves to another list; already there = no second copy; completed there = that one comes back", async () => {
  const { call } = setup();
  const { id: a } = await call(1, "POST", "lists", { name: "Town", members: [] });
  const { id: b } = await call(1, "POST", "lists", { name: "Farm", members: [] });
  await call(1, "POST", `lists/${a}/items`, { text: "Rope", category: "Hardware", client_id: "dddddddd1" });
  let r = await call(1, "PUT", `lists/${a}/items/c:dddddddd1`, { move_to: b });
  assert.deepEqual(open(r), []);
  r = await call(1, "GET", `lists/${b}`);
  assert.deepEqual(r.items.map((i) => [i.text, i.category]), [["Rope", "Hardware"]]);
  await call(1, "POST", `lists/${a}/items`, { text: "rope", client_id: "dddddddd2" });
  await call(1, "PUT", `lists/${a}/items/c:dddddddd2`, { move_to: b });
  assert.equal((await call(1, "GET", `lists/${b}`)).items.length, 1);   // it was there already
  await call(1, "PUT", `lists/${b}/items/c:dddddddd1`, { done: true });
  await call(1, "POST", `lists/${a}/items`, { text: "Rope", note: "10 m", client_id: "dddddddd3" });
  await call(1, "PUT", `lists/${a}/items/c:dddddddd3`, { move_to: b });
  r = await call(1, "GET", `lists/${b}`);
  assert.deepEqual(r.items.map((i) => [i.text, i.done, i.note]), [["Rope", 0, "10 m"]]);
  await assert.rejects(call(2, "PUT", `lists/${a}/items/c:x`, { move_to: b }), /list/);   // not shared with Leo
});

test("undo after a delete puts the line back exactly as it was", async () => {
  const { call } = setup();
  const { id } = await call(1, "POST", "lists", { name: "G", members: [] });
  await call(1, "POST", `lists/${id}/items`, { text: "Jam", category: "Pantry", client_id: "eeeeeeee1" });
  let r = await call(1, "PUT", `lists/${id}/items/c:eeeeeeee1`, { done: true });
  const was = r.items[0];
  r = await call(1, "DELETE", `lists/${id}/items/c:eeeeeeee1`);
  assert.equal(r.items.length, 0);
  r = await call(1, "POST", `lists/${id}/restore`, { item: was });
  assert.deepEqual([r.items[0].id, r.items[0].done, r.items[0].category, r.items[0].done_at], [was.id, 1, "Pantry", was.done_at]);
  r = await call(1, "POST", `lists/${id}/restore`, { item: was });   // sent twice (no signal): still one
  assert.equal(r.items.length, 1);
});
