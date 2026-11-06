// 🔔 Phone notifications (Web Push, the standard every phone browser speaks: RFC 8291 encryption + RFC 8292 "VAPID" sign-in).
// No outside service and no key to buy: the calendar makes its own signing key the first time (table settings, "push_vapid"),
// each phone that says yes in the 👤 menu is a row in push_subs, and the Worker posts the encrypted message to the phone's push
// service (Apple / Google / Mozilla), which wakes the phone. public/sw.js shows it. Tables: migrations/0048_push_notifications.sql.
//
// Who hears what (lib/lists.js calls listAdded / queuePush / shoppingStarted):
//  - a child login adds to a list: the admins who are on that list (owner or shared with them). A child's own private list stays private.
//  - "🛒 I'm going to the shop" on a list: everyone else on it; then for 2 hours the shopper hears about anything added to it.
//  - ⭐ a child marking a line important: the parents on that list (and the shopper, while shopping).
//  - 📌 a line made FOR someone: they hear about it (not when it's for yourself); ✅ when it's done, whoever made it for them hears.
//  Several things added in a row = ONE notification, once the person adding has stopped for GROUP_SECONDS (the 10-minute job
//  sends anything a cut-off request left behind).

const enc = new TextEncoder();
export const b64u = (buf) => { let s = ""; for (const c of new Uint8Array(buf)) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (String(s).length % 4)) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
export const GROUP_SECONDS = 20, SHOP_HOURS = 2;

// ---------- the calendar's own signing key (made once)
export async function vapidKeys(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'push_vapid'").first().catch(() => null);
  if (row?.value) return JSON.parse(row.value);
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const keys = { publicKey: b64u(await crypto.subtle.exportKey("raw", k.publicKey)), privateJwk: await crypto.subtle.exportKey("jwk", k.privateKey) };
  await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('push_vapid', ?)").bind(JSON.stringify(keys)).run();
  return JSON.parse((await db.prepare("SELECT value FROM settings WHERE key = 'push_vapid'").first()).value);   // two at once: both use the one that was saved
}

// the signed "this is the calendar" note the push service asks for (a JWT, signed ES256)
export async function vapidAuth(endpoint, keys, contact) {
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

// ---------- RFC 8291: the message is encrypted so only that phone can read it (the push service just carries it)
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}
export async function encryptPush(text, p256dh, auth) {
  const uaPublic = unb64u(p256dh), secret = unb64u(auth);
  const mine = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const myPublic = new Uint8Array(await crypto.subtle.exportKey("raw", mine.publicKey));
  const theirs = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, mine.privateKey, 256));
  const ikm = await hkdf(secret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, myPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16), nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([myPublic.length]), myPublic, sealed);
}

// ---------- sending
const contactOf = (env) => {
  const mail = String(env.ADMIN_EMAILS || "").split(/[,\s]+/).find((x) => x.includes("@"));
  return mail ? `mailto:${mail}` : `https://${env.SITE_HOST || "family-calendar.example"}`;
};
// one message to every phone these logins turned on. msg = { title, body, url, tag }. A phone the push service says is gone (404/410) is forgotten.
export async function notify(env, userIds, msg) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) return 0;
  const subs = (await env.DB.prepare(`SELECT * FROM push_subs WHERE user_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all().catch(() => ({ results: [] }))).results;
  if (!subs.length) return 0;
  const keys = await vapidKeys(env.DB), at = new Date().toISOString(), text = JSON.stringify(msg);
  let sent = 0;
  for (const s of subs) {
    try {
      const res = await (env.PUSH_FETCH || fetch)(s.endpoint, { method: "POST", body: await encryptPush(text, s.p256dh, s.auth),
        headers: { TTL: "86400", Urgency: "high", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: await vapidAuth(s.endpoint, keys, contactOf(env)) } });
      if (res.status === 404 || res.status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE id = ?").bind(s.id).run();
      else if (res.ok) { sent++; await env.DB.prepare("UPDATE push_subs SET last_ok = ?, fails = 0 WHERE id = ?").bind(at, s.id).run(); }
      else await env.DB.prepare("UPDATE push_subs SET fails = fails + 1 WHERE id = ?").bind(s.id).run();
    } catch { await env.DB.prepare("UPDATE push_subs SET fails = fails + 1 WHERE id = ?").bind(s.id).run().catch(() => {}); }
  }
  return sent;
}

// ---------- 👤 menu: this phone on / off / test   (/api/push/...)
export async function pushApi({ request, env, u, parts, json, invalid }) {
  const what = parts[1];
  if (what === "key" && request.method === "GET") {
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?").bind(u.id).first().catch(() => null))?.n || 0;
    return json({ publicKey: (await vapidKeys(env.DB)).publicKey, phones: n });
  }
  if (request.method !== "POST") invalid("Unknown request");
  const b = await request.json().catch(() => ({})), sub = b.subscription || {};
  if (what === "subscribe") {
    if (!/^https:\/\/[^\s]+$/.test(sub.endpoint || "") || !sub.keys?.p256dh || !sub.keys?.auth) invalid("That phone didn't give a usable address");
    await env.DB.prepare(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, device, created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, fails = 0`)
      .bind(u.id, sub.endpoint, String(sub.keys.p256dh), String(sub.keys.auth), String(b.device || "").slice(0, 120), new Date().toISOString()).run();
    return json({ ok: true });
  }
  if (what === "unsubscribe") {
    await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").bind(String(sub.endpoint || b.endpoint || ""), u.id).run();
    return json({ ok: true });
  }
  if (what === "test") {
    const n = await notify(env, [u.id], { title: "🔔 Notifications are on", body: "This is how the calendar will tell you about lists.", url: "/", tag: "test" });
    return json({ ok: true, sent: n });
  }
  invalid("Unknown request");
}

// ---------- lists
const listPeople = async (db, list) => [list.owner_id, ...(await db.prepare("SELECT user_id FROM list_members WHERE list_id = ?").bind(list.id).all()).results.map((r) => r.user_id)];
const shopping = (list, now = new Date()) => list.shopping_by && list.shopping_until && list.shopping_until > now.toISOString();

// who should hear that `u` added `text` to `list`: the parents (a child adding), the shopper (while shopping) - never the one adding
export async function listRecipients(db, list, u, now = new Date()) {
  const on = await listPeople(db, list), out = new Map();
  if (u.role === "child") {
    const admins = (await db.prepare(`SELECT id FROM users WHERE role = 'admin' AND active = 1 AND id IN (${on.map(() => "?").join(",")})`).bind(...on).all()).results;
    for (const a of admins) out.set(a.id, "child");
  }
  if (shopping(list, now) && on.includes(list.shopping_by)) out.set(list.shopping_by, out.get(list.shopping_by) || "shopping");
  out.delete(u.id);
  return out;
}

// one notification for a run of the same kind from one person on one list: added ("Leo added 3 things: milk, bread and eggs"),
// a job given to you ("Mum gave you Fix the door locks"), a job you gave finished ("Dad finished Fix the door locks")
export function groupMessage(list, actor, texts, why) {
  const n = texts.length, few = texts.slice(0, 3), more = n - few.length;
  const things = more > 0 ? `${few.join(", ")} and ${more} more` : few.length > 1 ? `${few.slice(0, -1).join(", ")} and ${few[few.length - 1]}` : few[0];
  const jobs = n > 1 ? `${n} jobs: ` : "";
  const body = why === "assigned" ? `${actor} gave you ${jobs}${things}` : why === "done" ? `${actor} finished ${jobs}${things}`
    : why === "starred" ? `${actor} marked ${n > 1 ? `${n} things` : "this"} important: ${things}`
    : `${actor} added ${n > 1 ? `${n} things: ` : ""}${things}${why === "shopping" ? " (while you're shopping)" : ""}`;
  return { title: `${why === "assigned" ? "📌" : why === "done" ? "✅" : why === "starred" ? "⭐" : "🛒"} ${list.name}`, body, url: `/?list=${list.id}`, tag: `list-${list.id}-${actor}-${kindOf(why)}` };
}
const kindOf = (why) => ["assigned", "done", "starred"].includes(why) ? why : "added";   // adds (as a child / while shopping) go together

// a list's name as people see it, place first: "Town House – Groceries" (the same name can be at more than one house)
export async function listLabel(db, list) {
  const place = list.place === "other" ? list.place_name : list.place ? (await db.prepare("SELECT label FROM places WHERE key = ?").bind(list.place).first().catch(() => null))?.label : null;
  return place ? `${place} – ${list.name}` : list.name;
}
const KIND_SQL = "CASE WHEN why IN ('assigned', 'done', 'starred') THEN why ELSE 'added' END";
async function sendGroup(env, recipient, listId, actorId, kind = "added") {
  // taking the rows and marking them sent in one go: the delayed send and the 10-minute job can never both send them
  const rows = (await env.DB.prepare(`UPDATE push_pending SET sent = 1 WHERE recipient_id = ? AND list_id = ? AND actor_id = ? AND sent = 0 AND ${KIND_SQL} = ? RETURNING text, actor, why`)
    .bind(recipient, listId, actorId, kind).all()).results;
  if (!rows.length) return;
  const list = await env.DB.prepare("SELECT * FROM lists WHERE id = ?").bind(listId).first();
  if (!list) return;
  await notify(env, [recipient], groupMessage({ ...list, name: await listLabel(env.DB, list) }, rows[0].actor, [...new Set(rows.map((r) => r.text))], rows.some((r) => r.why === "child") ? "child" : rows[0].why));
}

// queue one notification per recipient (Map id -> why) and send each run once the person has stopped for a moment
export async function queuePush(env, waitUntil, list, u, who, text) {
  if (!who.size) return;
  const at = new Date().toISOString();
  await env.DB.batch([...who].map(([rid, why]) => env.DB.prepare("INSERT INTO push_pending (recipient_id, list_id, actor_id, actor, text, why, created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(rid, list.id, u.id, u.name, text, why, at)));
  // only the last of a run finds nothing newer, and that one sends the lot
  waitUntil?.((async () => {
    await new Promise((r) => setTimeout(r, env.PUSH_GROUP_MS ?? GROUP_SECONDS * 1000));   // (tests use a shorter wait)
    for (const [rid, why] of who) {
      const kind = kindOf(why);
      const newer = await env.DB.prepare(`SELECT 1 FROM push_pending WHERE recipient_id = ? AND list_id = ? AND actor_id = ? AND sent = 0 AND ${KIND_SQL} = ? AND created_at > ?`).bind(rid, list.id, u.id, kind, at).first();
      if (!newer) await sendGroup(env, rid, list.id, u.id, kind);
    }
  })().catch((e) => console.log("push:", String(e))));
}

// called by the Lists API after something is added (POST items, or a completed thing brought back)
export async function listAdded(env, waitUntil, list, u, text) {
  await queuePush(env, waitUntil, list, u, await listRecipients(env.DB, list, u).catch(() => new Map()), text);
}

// the 10-minute job: anything a cut-off request left behind; old sent rows go after a week
export async function pushCatchUp(env, now = new Date()) {
  const before = new Date(now.getTime() - 60000).toISOString();
  const groups = (await env.DB.prepare(`SELECT recipient_id, list_id, actor_id, ${KIND_SQL} AS kind FROM push_pending WHERE sent = 0 GROUP BY recipient_id, list_id, actor_id, kind HAVING MAX(created_at) < ?`).bind(before).all().catch(() => ({ results: [] }))).results;
  for (const g of groups) await sendGroup(env, g.recipient_id, g.list_id, g.actor_id, g.kind);
  await env.DB.prepare("DELETE FROM push_pending WHERE sent = 1 AND created_at < ?").bind(new Date(now.getTime() - 7 * 864e5).toISOString()).run().catch(() => {});
  return groups.length;
}

// "🛒 I'm going to the shop": everyone else on the list
export async function shoppingStarted(env, list, u) {
  const on = (await listPeople(env.DB, list)).filter((id) => id !== u.id), name = await listLabel(env.DB, list);
  return notify(env, on, { title: `🛒 ${name}`, body: `${u.name} is going to the shop. Add anything you need to ${list.name} now.`, url: `/?list=${list.id}`, tag: `shop-${list.id}` });
}
