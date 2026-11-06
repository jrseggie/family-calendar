// 🛒 Lists API (/api/lists): shopping lists and the like, for the family's own logins only. A list is private to its owner
// unless people are added to it. Nobody else sees it, admins included. UI: public/lists.js. Tables: migrations/0045_lists.sql.

import { listAdded, queuePush, shoppingStarted, SHOP_HOURS } from "./push.js";   // 🔔 the parents hear about children adding; "I'm going to the shop"

const text = (v, n = 200) => String(v ?? "").trim().slice(0, n);

export function cleanList(b, invalid, placeKeys) {
  const name = text(b?.name, 80);
  if (!name) invalid("Give the list a name");
  let place = b.place ? String(b.place) : null, place_name = null;
  if (place === "other") { place_name = text(b.place_name, 60); if (!place_name) invalid("Which place?"); }
  else if (place && !placeKeys.includes(place)) invalid("Which place?");
  const members = [...new Set((Array.isArray(b.members) ? b.members : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  return { name, place, place_name, members };
}

export function cleanItem(b, invalid) {
  const t = text(b?.text, 120);
  if (!t) invalid("What should go on the list?");
  const client_id = /^[A-Za-z0-9_-]{8,64}$/.test(b.client_id || "") ? b.client_id : null;
  return { text: t, note: text(b.note, 200) || null, category: text(b.category, 40) || null, client_id };
}

// the same thing already on the list and not ticked yet (case and extra spaces don't matter)
export const norm = (t) => String(t || "").trim().toLowerCase().replace(/\s+/g, " ");
export const sameItem = (items, t) => items.find((i) => !i.done && norm(i.text) === norm(t));
// the same thing among the completed ones (HOT CHOCOLATE = Hot Chocolate = hot chocolate): adding it again brings that one back
export const doneTwin = (items, t) => items.find((i) => i.done && norm(i.text) === norm(t));

// family logins: admins, and logins whose person is "part of the family" (Settings > Family). Helpers and tracked people never.
export function isFamilyLogin(u, people) {
  if (u.role === "admin") return true;
  return !!people.find((p) => p.name === u.person && p.family);
}

// 📌 jobs: "for" = logins on the list (",3,7,"); due = YYYY-MM-DD. Both optional.
export const forIds = (v) => String(v || "").split(",").map(Number).filter((n) => n > 0);
export function cleanFor(v, allowed) { const ids = [...new Set((Array.isArray(v) ? v : []).map(Number))].filter((n) => allowed.includes(n)); return ids.length ? `,${ids.join(",")},` : null; }
export const cleanDue = (v) => /^\d{4}-\d\d-\d\d$/.test(v || "") ? v : null;
export const jobTag = (id) => `🛒 List item #${id}`;

// a job with a due date = a calendar entry "📌 Fix the door locks (DIY)" on that day, for the people it's for (their calendar person;
// none = the calendar's group, e.g. Family). Done, removed or no date = no entry. Tied by events.source, like the Info reminders.
export async function syncJobEntry(db, user, item, list, people) {
  const tag = jobTag(item.id), have = await db.prepare("SELECT * FROM events WHERE source = ?").bind(tag).first().catch(() => null), now = new Date().toISOString();
  if (!item.due || item.done || item.gone) { if (have) await db.prepare("DELETE FROM events WHERE id = ?").bind(have.id).run(); return; }
  const ids = forIds(item.for_ids), us = ids.length ? (await db.prepare(`SELECT id, name, person FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results : [];
  const names = [...new Set(us.map((x) => x.person || x.name).filter((n) => people.some((p) => p.name === n)))];
  const who = names.length ? names.join(", ") : people.find((p) => p.type === "group")?.name || people[0]?.name || "Family";
  const title = `📌 ${item.text} (${list.name})`.slice(0, 200);
  if (!have) await db.prepare("INSERT INTO events (start, end, who, title, category, status, important, source, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(item.due, item.due, who, title, "Household", "Confirmed", 0, tag, user.name, now, user.name, now).run();
  else if (have.start !== item.due || have.who !== who || have.title !== title) await db.prepare("UPDATE events SET start = ?, end = ?, who = ?, title = ?, updated_by = ?, updated_at = ? WHERE id = ?").bind(item.due, item.due, who, title, user.name, now, have.id).run();
}

export async function listsApi({ request, env, u, parts, json, deny, invalid, people, waitUntil }) {
  if (!isFamilyLogin(u, people)) deny("Lists are for the family's own logins");
  const db = env.DB, at = new Date().toISOString(), id = /^\d+$/.test(parts[1] || "") ? +parts[1] : null;
  const family = async () => (await db.prepare("SELECT id, name, role, person FROM users WHERE active = 1 ORDER BY name").all()).results.filter((x) => isFamilyLogin(x, people)).map((x) => ({ id: x.id, name: x.name }));
  const visible = async () => (await db.prepare(`SELECT l.*, (SELECT name FROM users WHERE id = l.owner_id) AS owner, (SELECT name FROM users WHERE id = l.shopping_by) AS shopper FROM lists l
    WHERE l.owner_id = ? OR l.id IN (SELECT list_id FROM list_members WHERE user_id = ?) ORDER BY l.name`).bind(u.id, u.id).all()).results;
  const placeKeys = (await db.prepare("SELECT key FROM places WHERE active = 1").all()).results.map((p) => p.key);
  const one = async (lid) => { const l = (await visible()).find((x) => x.id === lid); if (!l) invalid("That list has gone, or isn't shared with you"); return l; };
  const membersOf = async (lid) => (await db.prepare("SELECT m.user_id AS id, u.name FROM list_members m JOIN users u ON u.id = m.user_id WHERE m.list_id = ? ORDER BY u.name").bind(lid).all()).results;
  const items = async (lid) => (await db.prepare("SELECT * FROM list_items WHERE list_id = ? ORDER BY done, CASE WHEN done = 1 THEN done_at END DESC, COALESCE(sort, id), id").bind(lid).all()).results;
  // categories belong to a list: the one each thing was last put in, on this list and on lists with the same name this login sees
  // (two "Groceries" lists share them; a "Shooting Range" list has its own): { "coffee": "Pantry" }
  const departments = async (lids) => {
    if (!lids.length) return {};
    const r = (await db.prepare(`SELECT lower(trim(text)) AS t, category FROM list_items WHERE category IS NOT NULL AND list_id IN (${lids.map(() => "?").join(",")}) ORDER BY updated_at`).bind(...lids).all()).results;
    return Object.fromEntries(r.map((x) => [x.t, x.category]));
  };
  const related = async (lid) => { const all = await visible(), me = all.find((x) => x.id === lid), name = String(me?.name || "").trim().toLowerCase();
    return all.filter((x) => x.id === lid || String(x.name).trim().toLowerCase() === name).map((x) => x.id); };
  const onList = async (l) => [l.owner_id, ...(await membersOf(l.id)).map((m) => m.id)];
  const job = async (lid, itemId) => { const it = await db.prepare("SELECT * FROM list_items WHERE id = ?").bind(itemId).first(); const l = await db.prepare("SELECT * FROM lists WHERE id = ?").bind(lid).first();
    if (it && l) await syncJobEntry(db, u, it, l, people).catch((e) => console.log("job entry:", String(e))); };
  const touch = (lid) => db.prepare("UPDATE lists SET updated_at = ? WHERE id = ?").bind(at, lid);
  const full = async (lid) => {
    const l = await one(lid), lids = (await visible()).map((x) => x.id);
    const rows = lids.length ? (await db.prepare(`SELECT text, MAX(created_at) AS last FROM list_items WHERE list_id IN (${lids.map(() => "?").join(",")}) GROUP BY lower(text) ORDER BY last DESC LIMIT 300`).bind(...lids).all()).results : [];
    const deps = await departments(await related(lid));
    return json({ list: { ...l, members: await membersOf(lid) }, items: await items(lid), suggestions: rows.map((r) => r.text), departments: [...new Set(Object.values(deps))].sort(), dept: deps, people: await family(), me: u.id });   // people: for ✎ "Share with" after a refresh inside a list
  };
  const saveMembers = async (lid, members) => {
    const ok = (await family()).map((f) => f.id), keep = members.filter((m) => ok.includes(m) && m !== u.id);
    await db.batch([db.prepare("DELETE FROM list_members WHERE list_id = ?").bind(lid), ...keep.map((m) => db.prepare("INSERT INTO list_members (list_id, user_id) VALUES (?, ?)").bind(lid, m))]);
  };
  // an item by its id, or "c:<client id>" (an item added with no signal that the phone only knows by its own id)
  const itemOf = async (lid, key) => { const r = key?.startsWith("c:") ? await db.prepare("SELECT * FROM list_items WHERE list_id = ? AND client_id = ?").bind(lid, key.slice(2)).first()
    : await db.prepare("SELECT * FROM list_items WHERE list_id = ? AND id = ?").bind(lid, +key).first(); return r; };

  if (!id) {
    if (request.method === "GET") {
      const lists = await visible(), counts = lists.length ? (await db.prepare(`SELECT list_id, SUM(done = 0) AS open, SUM(done = 1) AS ticked FROM list_items WHERE list_id IN (${lists.map(() => "?").join(",")}) GROUP BY list_id`).bind(...lists.map((l) => l.id)).all()).results : [];
      const out = await Promise.all(lists.map(async (l) => { const c = counts.find((x) => x.list_id === l.id) || {}; return { ...l, members: await membersOf(l.id), open: c.open || 0, ticked: c.ticked || 0 }; }));
      // 📌 For me: everything still to do that's for this login, on any list they see
      const mine = lists.length ? (await db.prepare(`SELECT i.id, i.list_id, i.text, i.note, i.due, i.client_id, l.name AS list FROM list_items i JOIN lists l ON l.id = i.list_id
        WHERE i.done = 0 AND i.for_ids LIKE ? AND i.list_id IN (${lists.map(() => "?").join(",")}) ORDER BY i.due IS NULL, i.due, i.id`).bind(`%,${u.id},%`, ...lists.map((l) => l.id)).all()).results : [];
      return json({ lists: out, people: await family(), mine, me: u.id });
    }
    if (request.method === "POST") {
      const b = cleanList(await request.json(), invalid, placeKeys);
      const r = await db.prepare("INSERT INTO lists (name, place, place_name, owner_id, created_at, updated_at) VALUES (?,?,?,?,?,?) RETURNING id").bind(b.name, b.place, b.place_name, u.id, at, at).first();
      await saveMembers(r.id, b.members);
      return json({ ok: true, id: r.id });
    }
  }
  if (id && !parts[2]) {
    if (request.method === "GET") return full(id);
    const l = await one(id);
    if (l.owner_id !== u.id) deny("Only the person who made the list can change or remove it");
    if (request.method === "PUT") {
      const b = cleanList(await request.json(), invalid, placeKeys);
      await db.prepare("UPDATE lists SET name = ?, place = ?, place_name = ?, updated_at = ? WHERE id = ?").bind(b.name, b.place, b.place_name, at, id).run();
      await saveMembers(id, b.members);
      return full(id);
    }
    if (request.method === "DELETE") {
      await db.batch([db.prepare("DELETE FROM list_items WHERE list_id = ?").bind(id), db.prepare("DELETE FROM list_members WHERE list_id = ?").bind(id), db.prepare("DELETE FROM lists WHERE id = ?").bind(id)]);
      return json({ ok: true });
    }
  }
  // ↩ Undo after a delete: the line comes back as it was (same id, order, department, ticked or not)
  if (id && parts[2] === "restore" && request.method === "POST") {
    await one(id);
    const r = (await request.json())?.item || {}, c = cleanItem(r, invalid), num = (v) => Number.isFinite(+v) ? +v : null;
    if (!(c.client_id && await itemOf(id, `c:${c.client_id}`)) && !(num(r.id) > 0 && await itemOf(id, String(r.id)))) {
      const isoOr = (v) => /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v || "") ? v : null, done = r.done ? 1 : 0;
      const free = async (col, v) => v && !(await db.prepare(`SELECT 1 FROM list_items WHERE ${col} = ?`).bind(v).first()) ? v : null;   // never clash with another line
      await db.batch([db.prepare("INSERT INTO list_items (id, list_id, text, note, category, sort, done, added_by, done_by, done_at, client_id, created_at, updated_at, for_ids, assigned_by, due) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(await free("id", num(r.id) > 0 ? num(r.id) : null), id, c.text, c.note, c.category, num(r.sort), done, text(r.added_by, 60) || u.name, done ? text(r.done_by, 60) || u.name : null, done ? isoOr(r.done_at) || at : null, await free("client_id", c.client_id), isoOr(r.created_at) || at, at,
          cleanFor(forIds(r.for_ids), await onList(await one(id))), num(r.assigned_by), cleanDue(r.due)), touch(id)]);
      const back = c.client_id ? await itemOf(id, `c:${c.client_id}`) : null;
      if (back?.due) await job(id, back.id);
    }
    return full(id);
  }
  // 🛒 "I'm going to the shop" (on: true) / "Done shopping" (on: false). Anyone on the list; everyone else on it is told.
  if (id && parts[2] === "shopping" && request.method === "POST") {
    const l = await one(id), on = !!(await request.json().catch(() => ({})))?.on;
    if (on) {
      await db.prepare("UPDATE lists SET shopping_by = ?, shopping_until = ? WHERE id = ?").bind(u.id, new Date(Date.now() + SHOP_HOURS * 3600e3).toISOString(), id).run();
      const tell = shoppingStarted(env, l, u).catch((e) => console.log("push:", String(e)));
      if (waitUntil) waitUntil(tell); else await tell;
    } else await db.prepare("UPDATE lists SET shopping_by = NULL, shopping_until = NULL WHERE id = ?").bind(id).run();
    return full(id);
  }
  if (id && parts[2] === "items") {
    const theList = await one(id);
    if (request.method === "POST" && !parts[3]) {
      const b = cleanItem(await request.json(), invalid);
      if (b.client_id && await itemOf(id, `c:${b.client_id}`)) return full(id);   // sent twice (no signal, then again): it's there already
      const twin = sameItem(await items(id), b.text);
      if (twin) { const r = await full(id); const d = await r.json(); return json({ ...d, duplicate: twin.text }); }
      // goes to the bottom of the list; no category given = the one it was last put in (on this list or a same-name one)
      const last = await db.prepare("SELECT MAX(COALESCE(sort, id)) AS m FROM list_items WHERE list_id = ? AND done = 0").bind(id).first();
      const cat = b.category ?? (await departments(await related(id)))[b.text.trim().toLowerCase()] ?? null;
      // already completed on this list: that one comes back (no second copy); a department or note given now replaces the old one
      const back = doneTwin(await items(id), b.text);
      if (back) {
        // typed again = a new line: who it was for and the date don't come back with it
        await db.batch([db.prepare("UPDATE list_items SET done = 0, done_by = NULL, done_at = NULL, for_ids = NULL, assigned_by = NULL, due = NULL, note = COALESCE(?, note), category = ?, sort = ?, added_by = ?, client_id = COALESCE(?, client_id), updated_at = ? WHERE id = ?")
          .bind(b.note, cat ?? back.category, (last?.m || 0) + 1, u.name, b.client_id, at, back.id), touch(id)]);
        await listAdded(env, waitUntil, theList, u, back.text).catch(() => {});
        if (back.due) await job(id, back.id);
        return full(id);
      }
      await db.batch([db.prepare("INSERT INTO list_items (list_id, text, note, category, sort, added_by, client_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, b.text, b.note, cat, (last?.m || 0) + 1, u.name, b.client_id, at, at), touch(id)]);
      await listAdded(env, waitUntil, theList, u, b.text).catch(() => {});
      return full(id);
    }
    const it = await itemOf(id, parts[3]);
    if (!it) return full(id);   // already gone (removed on another phone): nothing to do
    if (request.method === "PUT") {
      const b = await request.json();
      // ✎ "List": to another list this login sees. Already on that list (still to get) = this copy just goes; completed there = that one
      // comes back with this one's note and department; otherwise the line itself moves, to the bottom.
      if (b.move_to !== undefined && +b.move_to !== id) {
        const to = await one(+b.move_to), there = await items(to.id), twin = sameItem(there, it.text), back = doneTwin(there, it.text);
        const last = await db.prepare("SELECT MAX(COALESCE(sort, id)) AS m FROM list_items WHERE list_id = ? AND done = 0").bind(to.id).first();
        const gone = db.prepare("DELETE FROM list_items WHERE id = ?").bind(it.id);
        const noEntry = db.prepare("DELETE FROM events WHERE source = ?").bind(jobTag(it.id));
        if (twin) await db.batch([gone, noEntry, touch(id), touch(to.id)]);
        else if (back) await db.batch([db.prepare("UPDATE list_items SET done = 0, done_by = NULL, done_at = NULL, note = COALESCE(?, note), category = COALESCE(?, category), sort = ?, updated_at = ? WHERE id = ?").bind(it.note, it.category, (last?.m || 0) + 1, at, back.id), gone, noEntry, touch(id), touch(to.id)]);
        else await db.batch([db.prepare("UPDATE list_items SET list_id = ?, done = 0, done_by = NULL, done_at = NULL, sort = ?, updated_at = ? WHERE id = ?").bind(to.id, (last?.m || 0) + 1, at, it.id), touch(id), touch(to.id)]);
        if (it.due) await job(to.id, it.id);
        return full(id);
      }
      // completed while an older completed copy is there: keep just this one
      // un-ticked while the same thing is already back on the list: just the one stays
      if (b.done !== undefined && !b.done && it.done && sameItem((await items(id)).filter((x) => x.id !== it.id), it.text)) { await db.batch([db.prepare("DELETE FROM list_items WHERE id = ?").bind(it.id), db.prepare("DELETE FROM events WHERE source = ?").bind(jobTag(it.id)), touch(id)]); return full(id); }
      // 📌 who it's for / when it's due (the ✎ box): the people newly given it hear about it (not when it's for yourself)
      if (b.for !== undefined || b.due !== undefined) {
        const l = await one(id), allowed = await onList(l), was = forIds(it.for_ids);
        const fids = b.for !== undefined ? cleanFor(b.for, allowed) : it.for_ids, due = b.due !== undefined ? cleanDue(b.due) : it.due;
        const added = forIds(fids).filter((x) => !was.includes(x) && x !== u.id);
        await db.batch([db.prepare("UPDATE list_items SET for_ids = ?, assigned_by = ?, due = ?, updated_at = ? WHERE id = ?").bind(fids, fids ? (added.length || !it.assigned_by ? u.id : it.assigned_by) : null, due, at, it.id), touch(id)]);
        await queuePush(env, waitUntil, l, u, new Map(added.map((x) => [x, "assigned"])), it.text).catch(() => {});
        await job(id, it.id);
        if (b.done === undefined && b.text === undefined) return full(id);
      }
      // 📌 a completed job back "as a new line": who it was for and the date go (it gets given again through ✎ if needed)
      if (b.done !== undefined && !b.done && it.done && b.fresh) { await db.prepare("UPDATE list_items SET for_ids = NULL, assigned_by = NULL, due = NULL WHERE id = ?").bind(it.id).run(); it.due = null; it.for_ids = null; }
      // ✅ a job ticked off by someone other than whoever gave it: they hear about it
      if (b.done && !it.done && it.for_ids && it.assigned_by && it.assigned_by !== u.id)
        await queuePush(env, waitUntil, await one(id), u, new Map([[it.assigned_by, "done"]]), it.text).catch(() => {});
      if (b.done && !it.done) for (const t of (await items(id)).filter((x) => x.done && x.id !== it.id && norm(x.text) === norm(it.text))) await db.prepare("DELETE FROM list_items WHERE id = ?").bind(t.id).run();
      const done = b.done === undefined ? it.done : b.done ? 1 : 0, c = b.text === undefined ? { text: it.text, note: it.note, category: it.category } : cleanItem(b, invalid);
      await db.batch([db.prepare("UPDATE list_items SET text = ?, note = ?, category = ?, done = ?, done_by = ?, done_at = ?, updated_at = ? WHERE id = ?").bind(c.text, c.note, c.category, done, done ? (it.done ? it.done_by : u.name) : null, done ? (it.done ? it.done_at : at) : null, at, it.id), touch(id)]);
      if (it.due) await job(id, it.id);   // 📌 the calendar entry follows (ticked = gone, renamed = renamed)
      return full(id);
    }
    if (request.method === "DELETE") { await db.batch([db.prepare("DELETE FROM list_items WHERE id = ?").bind(it.id), db.prepare("DELETE FROM events WHERE source = ?").bind(jobTag(it.id)), touch(id)]); return full(id); }
  }
  // the order of the things still to get: { keys: [id or "c:<client id>", ...] } top to bottom. Anyone on the list may do it.
  if (id && parts[2] === "order" && request.method === "PUT") {
    await one(id);
    const keys = ((await request.json()).keys || []).slice(0, 500).map(String);
    const all = await items(id), find = (k) => all.find((i) => k.startsWith("c:") ? i.client_id === k.slice(2) : String(i.id) === k);
    const st = keys.map(find).filter(Boolean).map((i, n) => db.prepare("UPDATE list_items SET sort = ? WHERE id = ?").bind(n + 1, i.id));
    if (st.length) await db.batch([...st, touch(id)]);
    return full(id);
  }
  if (id && parts[2] === "clear" && request.method === "POST") {
    await one(id);
    await db.batch([db.prepare("DELETE FROM list_items WHERE list_id = ? AND done = 1").bind(id), touch(id)]);
    return full(id);
  }
  invalid("Unknown request");
}
