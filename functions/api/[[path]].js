// Family calendar API (Cloudflare Pages Function + D1).
// Who is signed in comes from Cloudflare Access (Cf-Access-Authenticated-User-Email).
// Locally (DEMO=true in .dev.vars) the "View as" switch sends X-Demo-User instead.
// Every permission check happens here - the page only hides buttons for convenience.

import { page, warnBox, tag, esc, section, row, FONT, MUTED } from "../../mail/src/layout.js";
import { publicHolidays } from "../../mail/src/holidays.js";
import { icsText, fold, ymd, utcStamp, addDaysIso } from "../../lib/ics.js";
import { repeatDates as repeatDatesRaw } from "../../lib/repeat.js";
import { seal, open as unseal } from "../../lib/vault.js";
import "../../public/rules.js";
import { syncVaultReminders } from "../../lib/vault-reminders.js";
import { brand, loadSettings, SETTING_KEYS } from "../../lib/settings.js";
import { dumpDatabase } from "../../lib/backup.js";
import { syncEmailAddresses, canSyncEmail } from "../../lib/email-sync.js";
import { inboxConfig, sealKey, testKey, INBOX_MODELS } from "../../lib/inbox.js";
import { VERSION, UPSTREAM_REPO, UNRELEASED } from "../../lib/version.js";
import { digestSchedule, DAYS } from "../../lib/digest-schedule.js";
import { connectCloudflare, syncAccessPolicy, addAccessDomain } from "../../lib/cloudflare-setup.js";

const CATEGORIES = ["School", "Exam", "Study", "Activity", "Travel", "Transport", "Medical", "Work", "Social", "Household", "General"];
const ROLES = ["admin", "editor", "viewer", "limited"];
const PERSON_TYPES = ["household", "helper", "tracked", "group"];
const PLACE_KEY = /^[a-z0-9_-]{1,30}$/;   // events.location = a key from the places table (Setup > Places)
const PLACE_KINDS = ["home", "school", "friend", "away"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (status, msg) => json({ error: msg }, status);
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const deny = (msg = "You don't have permission to do that") => { throw new HttpError(403, msg); };
const invalid = (msg) => { throw new HttpError(400, msg); };

const now = () => new Date().toISOString();  // UTC; the browser shows it in local time
const split = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const demo = (env) => env.DEMO === "true";

// ---------- Cloudflare Access sign-in check
// Access puts a signed token (JWT) on every request it lets through. We verify the signature against the
// team's public keys and check it was issued for this app (ACCESS_AUD) - so the email can't be faked.
let certCache = { at: 0, keys: [] };
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

async function accessKeys(env) {
  if (Date.now() - certCache.at < 3600e3 && certCache.keys.length) return certCache.keys;
  const r = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  certCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  return certCache.keys;
}

async function verifiedAccessEmail(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return "";
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return "";
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const jwk = (await accessKeys(env)).find((k) => k.kid === header.kid);
  if (!jwk) return "";
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return "";
  const claims = JSON.parse(new TextDecoder().decode(b64url(p)));
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD) || claims.exp * 1000 < Date.now() || claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return "";
  return String(claims.email || "").toLowerCase();
}

// ---------- who is asking
// a brand-new install before "Switch on sign-in": no Cloudflare Access yet, so the setup password (SETUP_CODE, chosen on
// Cloudflare's deploy page) is the only way in. It stops working the moment Access is on (ACCESS_AUD set).
const setupMode = (env) => !env.ACCESS_AUD && !demo(env) && !!env.SETUP_CODE;
async function setupUser(request, env) {
  const code = request.headers.get("X-Setup-Code") || "";
  if (!setupMode(env) || code.length < 6 || code !== env.SETUP_CODE) return null;
  return (await env.DB.prepare("SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").first())
    || { id: 0, email: "", name: "Setup", role: "admin", active: 1, see: null, see_school: 1, see_birthdays: 1, can_edit: 1 };
}

async function currentUser(request, env) {
  const setup = await setupUser(request, env);
  if (setup) return { ...setup, seeList: split(setup.see), setup: true };
  // live site: only a verified Access token counts. Demo: the "View as" header. Anything else: nobody.
  const accessEmail = env.ACCESS_AUD ? await verifiedAccessEmail(request, env) : "";
  if (!env.ACCESS_AUD && !demo(env)) return null;
  let email = accessEmail;
  if (!email && demo(env)) email = (request.headers.get("X-Demo-User") || "").toLowerCase();
  let u = email ? await env.DB.prepare("SELECT * FROM users WHERE lower(email)=?").bind(email).first() : null;
  if (!u && !email && demo(env)) {   // demo with nobody picked in "View as": act as the first admin
    u = await env.DB.prepare("SELECT * FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").first();
  }
  // safety net so the first admin can never be locked out: ADMIN_EMAILS env var (comma separated)
  if (!u && accessEmail && split(env.ADMIN_EMAILS).map((e) => e.toLowerCase()).includes(accessEmail)) {
    u = { id: 0, email: accessEmail, name: accessEmail.split("@")[0], role: "admin", active: 1 };
  }
  if (!u || !u.active) return null;
  return { ...u, seeList: split(u.see) };
}

const isAdmin = (u) => u.role === "admin";
const seesAll = (u) => u.role !== "limited";
const canEditAll = (u) => u.role === "admin" || u.role === "editor";
const seesSchool = (u) => seesAll(u) || !!u.see_school;
const seesBirthdays = (u) => seesAll(u) || !!u.see_birthdays;
// fam = names ticked "Part of the family": an entry for "Family" is visible to a login that sees any of them
const eventVisible = (u, who, fam = []) => seesAll(u) || split(who).flatMap((p) => p === "Family" ? [p, ...fam] : [p]).some((p) => u.seeList.includes(p));
const familyOf = (people) => people.filter((p) => p.family && p.active).map((p) => p.name);
function canWriteEvent(u, whoNames) {
  if (canEditAll(u)) return true;
  return u.role === "limited" && !!u.can_edit && whoNames.length > 0 && whoNames.every((p) => u.seeList.includes(p));
}

async function log(env, user, action, details) {
  await env.DB.prepare("INSERT INTO change_log (at,user,action,details) VALUES (?,?,?,?)")
    .bind(now(), user.name, action, details).run();
}

async function loadPeople(env) {
  return (await env.DB.prepare("SELECT * FROM people ORDER BY sort, id").all()).results;
}

// ---------- validation
function cleanWho(who, people) {
  const list = Array.isArray(who) ? who.map((p) => String(p).trim()).filter(Boolean) : split(who);
  const out = [];
  for (const p of list) {
    const match = people.find((x) => x.name.toLowerCase() === p.toLowerCase());
    if (!match) invalid(`Unknown person: ${p}`);
    if (!out.includes(match.name)) out.push(match.name);
  }
  if (!out.length) invalid("Pick at least one person");
  // everyone ticked "Part of the family" = "Family" (one entry across the day instead of one per column)
  const fam = people.filter((p) => p.family && p.active).map((p) => p.name);
  const final = fam.length && (out.includes("Family") || fam.every((n) => out.includes(n)))
    ? [...out.filter((n) => !fam.includes(n)), ...(out.includes("Family") ? [] : ["Family"])] : out;
  return people.map((p) => p.name).filter((n) => final.includes(n)).join(", ");
}

function cleanEvent(b, people) {
  const title = String(b.title || "").trim();
  if (!title) invalid("Title is required");
  if (!DATE.test(b.start || "")) invalid("Start date is required");
  const end = b.end && DATE.test(b.end) ? b.end : b.start;
  if (end < b.start) invalid("End date is before start date");
  return {
    start: b.start, end, title, who: cleanWho(b.who, people),
    category: CATEGORIES.includes(b.category) ? b.category : "General",
    status: ["Tentative", "Unavailable"].includes(b.status) ? b.status : "Confirmed",   // Unavailable: e.g. the helper can't stay
    important: b.important ? 1 : 0,
    location: PLACE_KEY.test(b.location || "") ? b.location : null,
    house_off: PLACE_KEY.test(b.house_off || "") ? b.house_off : null,   // "nobody needed at this house" on these days
    notes: String(b.notes || "").trim() || null,
    source: String(b.source || "").trim() || null,
  };
}

function cleanRecurring(b) {
  const name = String(b.name || "").trim();
  const day = parseInt(b.day, 10), month = parseInt(b.month, 10);
  if (!name) invalid("Name is required");
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) invalid("Pick a valid day and month");
  const born = b.born ? parseInt(b.born, 10) : null;
  return { name, day, month, born: born || null, type: ["Anniversary", "Memorial"].includes(b.type) ? b.type : "Birthday",
           notes: String(b.notes || "").trim() || null };
}

function cleanHoliday(b, people) {
  const name = String(b.name || "").trim();
  const child = people.find((p) => p.child && p.name === b.child);
  if (!child) invalid("Pick one of the children (tick \"Child\" for them on the Setup tab)");
  if (!name) invalid("Name is required");
  if (!DATE.test(b.start || "") || !DATE.test(b.end || "")) invalid("From and To dates are required");
  if (b.end < b.start) invalid("To date is before From date");
  return { child: b.child, school: child.school || null, name, start: b.start, end: b.end,
           status: b.status === "Tentative" ? "Tentative" : "Confirmed", notes: String(b.notes || "").trim() || null };
}

function cleanPerson(b) {
  const name = String(b.name || "").trim();
  if (!name) invalid("Name is required");
  if (/[,|]/.test(name)) invalid("Names can't contain commas");
  if (["everyone", "all"].includes(name.toLowerCase())) invalid("That name is reserved");
  return { name, color: COLOR.test(b.color || "") ? b.color : "#495057",
           type: PERSON_TYPES.includes(b.type) ? b.type : "household",
           active: b.active === false || b.active === 0 || b.active === "0" ? 0 : 1,
           grid_column: b.grid_column === false || b.grid_column === 0 || b.grid_column === "0" ? 0 : 1,
           family: b.family === true || b.family === 1 || b.family === "1" || b.family === "on" ? 1 : 0,
           child: b.child === true || b.child === 1 || b.child === "1" ? 1 : 0,
           boards: (b.child === true || b.child === 1 || b.child === "1") && (b.boards === true || b.boards === 1 || b.boards === "1") ? 1 : 0,
           home: PLACE_KEY.test(b.home || "") ? b.home : null,
           school: String(b.school || "").trim().slice(0, 80) || null,
           sort: Number.isFinite(parseInt(b.sort, 10)) ? parseInt(b.sort, 10) : 99 };
}

function cleanUser(b, people) {
  const email = String(b.email || "").trim().toLowerCase();
  const name = String(b.name || "").trim();
  if (!EMAIL.test(email)) invalid("Enter a valid email address");
  if (!name) invalid("Name is required");
  const role = ROLES.includes(b.role) ? b.role : "viewer";
  const limited = role === "limited";
  const see = limited ? cleanWho(b.see || [], people) : null;
  const invite = String(b.invite_email || "").trim().toLowerCase();
  if (invite && !EMAIL.test(invite)) invalid("Pick a valid address for calendar invites");
  return { email, name, role, see, see_school: limited && b.see_school ? 1 : 0, see_birthdays: limited && b.see_birthdays ? 1 : 0,
           can_edit: limited && b.can_edit ? 1 : 0, active: b.active === false || b.active === 0 ? 0 : 1, invite_email: invite || null };
}

const describe = (e) => `${e.start}${e.end && e.end !== e.start ? " to " + e.end : ""} [${e.who || e.child || ""}] ${e.title || e.name}`;

// ---------- generic insert / update helpers
async function insert(env, table, rec) {
  const cols = Object.keys(rec);
  const r = await env.DB.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .bind(...cols.map((c) => rec[c])).run();
  return r.meta.last_row_id;
}
async function update(env, table, id, rec) {
  const cols = Object.keys(rec);
  await env.DB.prepare(`UPDATE ${table} SET ${cols.map((c) => c + "=?").join(",")} WHERE id=?`).bind(...cols.map((c) => rec[c]), id).run();
}
const byId = (env, table, id) => env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();

// ---------- handlers
async function getAll(env, u) {
  const db = env.DB;
  const [events, recurring, school, publicH, acks] = await db.batch([
    db.prepare("SELECT * FROM events ORDER BY start, id"),
    db.prepare("SELECT * FROM recurring ORDER BY month, day"),
    db.prepare("SELECT * FROM school_holidays ORDER BY start"),
    db.prepare("SELECT * FROM public_holidays ORDER BY date"),
    db.prepare("SELECT day, msg, by_user FROM acknowledged WHERE day >= date('now', '-7 days')"),
  ]);
  const allPeople = await loadPeople(env);
  let people = allPeople.filter((p) => p.active);
  if (!seesAll(u)) people = people.filter((p) => u.seeList.includes(p.name));
  return json({
    setupMode: !!u.setup, signInOn: !!env.ACCESS_AUD || demo(env),
    me: { name: u.name, email: u.email, role: u.role, isAdmin: isAdmin(u), canEditAll: canEditAll(u),
          canAddEvents: canEditAll(u) || (u.role === "limited" && !!u.can_edit),
          editablePeople: canEditAll(u) ? null : (u.can_edit ? u.seeList : []),
          seeSchool: seesSchool(u), seeBirthdays: seesBirthdays(u), seeLog: canEditAll(u), demo: demo(env) },
    people, categories: CATEGORIES, places: await loadPlaces(env), brand: brand(await loadSettings(env.DB), env.ORIGIN || ""),
    version: VERSION, unreleased: UNRELEASED, upstream: UPSTREAM_REPO, needsWizard: isAdmin(u) && !(await loadSettings(env.DB)).family_name,
    admins: (await env.DB.prepare("SELECT name FROM users WHERE role = 'admin' AND active = 1 ORDER BY id").all()).results.map((r) => r.name),
    events: events.results.filter((e) => eventVisible(u, e.who, familyOf(allPeople))),
    recurring: seesBirthdays(u) ? recurring.results : [],
    schoolHolidays: seesSchool(u) ? school.results : [],
    publicHolidays: publicHolidays(publicH.results),   // SA rules + one-off days from the table
    inviteTo: canEditAll(u) ? await inviteTargets(env) : [],
    proposals: canEditAll(u) ? await pendingProposals(env) : [],
    acks: canEditAll(u) ? acks.results : [],   // "OK, noted" warnings (Needs sorting)
    jobsRanAt: isAdmin(u) ? (await env.DB.prepare("SELECT at FROM health WHERE key = 'jobs'").first().catch(() => null))?.at || null : null,
  });
}

const repeatDates = (start, end, rep) => { const r = repeatDatesRaw(start, end, rep); if (r.error) invalid(r.error); return r; };
const REPEAT_LABEL = { week: "weekly", "2weeks": "every 2 weeks", month: "monthly" };

// deleted entries go to deleted_events (kept 90 days) so they can be restored with the same id
async function softDelete(env, u, rows) {
  const batch = crypto.randomUUID(), at = now();
  await env.DB.batch([
    ...rows.map((r) => env.DB.prepare("INSERT INTO deleted_events (batch, event_id, data, deleted_by, deleted_at) VALUES (?,?,?,?,?)")
      .bind(batch, r.id, JSON.stringify(r), u.name, at)),
    ...rows.map((r) => env.DB.prepare("DELETE FROM events WHERE id=?").bind(r.id)),
  ]);
  return batch;
}

async function restoreDeleted(request, env, u) {
  const b = await request.json();
  const rows = (await env.DB.prepare("SELECT * FROM deleted_events WHERE batch=? ORDER BY event_id").bind(String(b.batch || "")).all()).results;
  if (!rows.length) return fail(404, "Already restored, or too old to restore");
  const stmts = [], done = [];
  for (const r of rows) {
    const rec = JSON.parse(r.data);
    if (!canWriteEvent(u, split(rec.who))) deny();
    if (await byId(env, "events", rec.id)) continue;   // somehow back already
    const cols = Object.keys(rec);
    stmts.push(env.DB.prepare(`INSERT INTO events (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...cols.map((c) => rec[c])));
    done.push(rec);
  }
  stmts.push(env.DB.prepare("DELETE FROM deleted_events WHERE batch=?").bind(String(b.batch)));
  await env.DB.batch(stmts);
  await log(env, u, "Restored event", done.length === 1 ? describe(done[0]) : `${done.length} entries: ${describe(done[0])} …`);
  return json({ ok: true, restored: done.length });
}

async function recentlyDeleted(env, u) {
  if (!canEditAll(u)) deny();
  const rows = (await env.DB.prepare(`SELECT batch, max(deleted_at) AS at, max(deleted_by) AS by, count(*) AS n, min(data) AS data
    FROM deleted_events WHERE deleted_at >= ? GROUP BY batch ORDER BY at DESC LIMIT 50`).bind(new Date(Date.now() - 30 * 864e5).toISOString()).all()).results;
  return json(rows.map((r) => { const e = JSON.parse(r.data); return { batch: r.batch, at: r.at, by: r.by, n: r.n, start: e.start, end: e.end, who: e.who, title: e.title }; }));
}

async function events(request, env, u, id) {
  const people = await loadPeople(env);
  if (request.method === "POST") {
    const body = await request.json();
    const rec = cleanEvent(body, people);
    if (!canWriteEvent(u, split(rec.who))) deny(u.role === "limited" ? "You can only add entries for the people you can see" : undefined);
    Object.assign(rec, { created_by: u.name, created_at: now(), updated_by: u.name, updated_at: now() });
    const dates = repeatDates(rec.start, rec.end, body.repeat);
    if (!dates.length) invalid("None of the ticked days fall between the start and end dates");
    [rec.start, rec.end] = dates[0];   // ticked weekdays may move the first one off the start date
    const newId = await insert(env, "events", dates.length > 1 ? { ...rec, series: null } : rec);
    if (dates.length > 1) {
      await env.DB.batch([env.DB.prepare("UPDATE events SET series=? WHERE id=?").bind(newId, newId),
        ...dates.slice(1).map(([s, e]) => { const r = { ...rec, start: s, end: e, series: newId }; const cols = Object.keys(r);
          return env.DB.prepare(`INSERT INTO events (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...cols.map((c) => r[c])); })]);
      await log(env, u, "Added event", `${describe(rec)} – repeats ${REPEAT_LABEL[body.repeat.every]} until ${dates[dates.length - 1][0]} (${dates.length} times)`);
    } else await log(env, u, "Added event", describe(rec));
    return json({ ok: true, id: newId, count: dates.length }, 201);
  }
  const before = await byId(env, "events", id);
  if (!before || !eventVisible(u, before.who)) return fail(404, "Not found");
  if (!canWriteEvent(u, split(before.who))) deny();
  if (request.method === "DELETE") {
    // ?scope=later on a repeating entry: this one and the later repeats
    const later = new URL(request.url).searchParams.get("scope") === "later" && before.series;
    const rows = later ? (await env.DB.prepare("SELECT * FROM events WHERE series=? AND start>=? ORDER BY start").bind(before.series, before.start).all()).results
      .filter((r) => canWriteEvent(u, split(r.who))) : [before];
    const batch = await softDelete(env, u, rows);
    await log(env, u, "Deleted event", describe(before) + (rows.length > 1 ? ` and ${rows.length - 1} later repeat${rows.length > 2 ? "s" : ""}` : ""));
    return json({ ok: true, undo: batch, count: rows.length });
  }
  if (request.method === "PUT") {
    const body = await request.json();
    // someone else saved this entry after it was opened here: say so instead of silently overwriting
    if (!body.force && "loaded_at" in body && (before.updated_at || "") !== (body.loaded_at || "")) {
      return json({ error: `${before.updated_by || "Someone"} changed this entry while you had it open.`, conflict: { by: before.updated_by, at: before.updated_at } }, 409);
    }
    const rec = cleanEvent(body, people);
    if (!canWriteEvent(u, split(rec.who))) deny("You can only use the people you can see");
    Object.assign(rec, { updated_by: u.name, updated_at: now() });
    await update(env, "events", id, rec);
    await log(env, u, "Edited event", describe(rec) + (describe(before) !== describe(rec) ? `  (was: ${describe(before)})` : ""));
    return json({ ok: true });
  }
  return fail(405, "Method not allowed");
}

// recurring + school holidays: only admins/editors can change them
async function simpleTable(request, env, u, id, table, clean, label) {
  if (!canEditAll(u)) deny();
  if (request.method === "POST") {
    const rec = clean(await request.json(), await loadPeople(env));
    const newId = await insert(env, table, rec);
    await log(env, u, `Added ${label}`, describe(rec));
    return json({ ok: true, id: newId }, 201);
  }
  const before = await byId(env, table, id);
  if (!before) return fail(404, "Not found");
  if (request.method === "DELETE") {
    await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
    await log(env, u, `Deleted ${label}`, describe(before));
    return json({ ok: true });
  }
  if (request.method === "PUT") {
    const rec = clean(await request.json(), await loadPeople(env));
    await update(env, table, id, rec);
    await log(env, u, `Edited ${label}`, describe(rec));
    return json({ ok: true });
  }
  return fail(405, "Method not allowed");
}

// ---------- setup (admins only)
const renameIn = (list, from, to) => split(list).map((p) => (p === from ? to : p)).join(", ");
const whoHas = "',' || replace(who,', ',',') || ',' LIKE ?";

// Setup > "This calendar": the family's name and web address (lib/settings.js). uid_prefix is never changed here.
async function setupSettings(request, env, u) {
  const cur = await loadSettings(env.DB);
  if (request.method === "GET") return json({ ...Object.fromEntries(SETTING_KEYS.map((k) => [k, cur[k]])), brand: brand(cur, new URL(request.url).origin), emailSync: canSyncEmail(env) });
  if (request.method !== "PUT") return fail(405, "Method not allowed");
  const b = await request.json(), clean = (v, n) => String(v ?? "").trim().slice(0, n);
  const rec = { family_name: clean(b.family_name, 40), site_name: clean(b.site_name, 40), short_name: clean(b.short_name, 14), site_url: clean(b.site_url, 100).replace(/\/+$/, ""),
    repo_url: clean(b.repo_url, 120).replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "").replace(/\.git$|\/+$/g, "") };   // "owner/name" of the family's GitHub copy
  if (rec.repo_url && !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(rec.repo_url)) invalid("GitHub copy should look like github.com/yourname/family-calendar");
  if (rec.site_url && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(rec.site_url)) invalid("Web address should look like https://ourfamily.com");
  const stmts = Object.entries(rec).map(([k, v]) => env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v || null));
  if (!cur.uid_prefix) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('uid_prefix', ?)").bind(crypto.randomUUID().slice(0, 8)));
  await env.DB.batch(stmts);
  await log(env, u, "Edited calendar settings", `${rec.site_name || brand(rec).site}${rec.site_url ? " · " + rec.site_url : ""}`);
  if (rec.site_url && rec.site_url !== cur.site_url) {   // a new web address: let the sign-in cover it (when the calendar has its own Cloudflare key)
    const host = new URL(rec.site_url).host, added = await addAccessDomain(env, host).catch((e) => invalid(`Saved, but sign-in couldn't be added for ${host}: ${e.message}`));
    if (added?.length) await log(env, u, "Sign-in added for", added.join(", "));
  }
  return json({ ok: true });
}

// Setup wizard (a new family's first visit, or Setup > "Set-up wizard" later): the family's name, its people and their roles,
// and its houses - all in one go. It only ever ADDS people / places (existing ones are left as they are) and renames the houses.
const WIZARD_ROLES = {   // role -> how the person is set up (see Setup > People for each setting)
  adult:   { type: "household", child: 0, boards: 0, family: 1, grid_column: 1, home: "house" },
  child:   { type: "household", child: 1, boards: 0, family: 1, grid_column: 1, home: "house" },
  boarder: { type: "household", child: 1, boards: 1, family: 1, grid_column: 1, home: "house" },
  helper:  { type: "helper",    child: 0, boards: 0, family: 0, grid_column: 0, home: null },
  visitor: { type: "tracked",   child: 0, boards: 0, family: 0, grid_column: 0, home: null },
};
const WIZARD_COLORS = ["#2f6fdb", "#0f9d8a", "#d9480f", "#5f3dc4", "#a0612a", "#c2255c", "#2b8a3e", "#e67700", "#1098ad", "#862e9c"];
const STARTING_PLACES = [   // same as rules.js DEFAULT_PLACES
  { key: "home", label: "Primary house", short: "Home", icon: "🏠", kind: "home", sort: 1 },
  { key: "home2", label: "Secondary house", short: "House 2", icon: "🏡", kind: "home", sort: 2 },
  { key: "school", label: "School (boarding)", short: "School", icon: "🏫", kind: "school", sort: 3 },
  { key: "friend", label: "Friend's house", short: "Friend", icon: "🛏️", kind: "friend", sort: 4 },
  { key: "other", label: "Away", short: "Away", icon: "✈️", kind: "away", sort: 5 },
];
async function setupWizard(request, env, u) {
  if (request.method !== "POST") return fail(405, "Method not allowed");
  const b = await request.json(), clean = (v, n) => String(v ?? "").trim().slice(0, n);
  const family = clean(b.family_name, 40);
  if (!family) invalid("What's the family's name?");
  const people = await loadPeople(env), stmts = [], added = [];
  const put = (k, v) => env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v);
  stmts.push(put("family_name", family), put("site_name", clean(b.site_name, 40) || null), put("short_name", clean(b.short_name, 14) || null));
  if (!(await loadSettings(env.DB)).uid_prefix) stmts.push(put("uid_prefix", crypto.randomUUID().slice(0, 8)));

  // houses: the first two "home" places are renamed (created if missing); the other starting places are added if missing
  const places = await loadPlaces(env);
  for (const p of STARTING_PLACES.filter((x) => x.kind !== "home")) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO places (key, label, short, icon, kind, sort) VALUES (?,?,?,?,?,?)").bind(p.key, p.label, p.short, p.icon, p.kind, p.sort));
  const homes = places.filter((p) => p.kind === "home");
  const houses = (Array.isArray(b.houses) ? b.houses : []).map((h) => ({ label: clean(h.label, 40), icon: clean(h.icon, 8) || "🏠", needs: clean(h.needs, 60) || null })).filter((h) => h.label).slice(0, 4);
  if (!houses.length) invalid("What do you call your house?");
  const houseKeys = [];
  houses.forEach((h, i) => {
    const key = homes[i]?.key || (i === 0 ? "home" : `home${i + 1}`);
    houseKeys.push(key);
    stmts.push(env.DB.prepare(`INSERT INTO places (key, label, short, icon, kind, sort, active, needs) VALUES (?, ?, ?, ?, 'home', ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET label = excluded.label, short = excluded.short, icon = excluded.icon, active = 1, needs = excluded.needs`)
      .bind(key, h.label, h.label.slice(0, 12), h.icon, i + 1, h.needs));
  });
  if (!people.some((p) => p.name === "Family")) stmts.push(env.DB.prepare("INSERT INTO people (name, color, type, active, sort, grid_column, family) VALUES ('Family', '#495057', 'group', 1, 99, 0, 0)"));

  // people
  const list = (Array.isArray(b.people) ? b.people : []).map((p) => ({ name: clean(p.name, 40), role: WIZARD_ROLES[p.role] ? p.role : "adult", school: clean(p.school, 80) || null }))
    .filter((p) => p.name);
  const taken = new Set(people.map((p) => p.name.toLowerCase()));
  list.forEach((p, i) => {
    if (/[,|]/.test(p.name) || ["everyone", "all", "family"].includes(p.name.toLowerCase())) invalid(`"${p.name}" can't be used as a name`);
    if (taken.has(p.name.toLowerCase())) return;   // already there - leave them as they are
    taken.add(p.name.toLowerCase());
    const r = WIZARD_ROLES[p.role];
    stmts.push(env.DB.prepare("INSERT INTO people (name, color, type, active, sort, grid_column, family, child, boards, home, school) VALUES (?,?,?,1,?,?,?,?,?,?,?)")
      .bind(p.name, WIZARD_COLORS[(people.length + i) % WIZARD_COLORS.length], r.type, people.length + i + 1, r.grid_column, r.family, r.child, r.boards,
            r.home ? houseKeys[0] : null, r.child ? p.school : null));
    added.push(p.name);
  });
  if (list.some((p) => p.role === "boarder")) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO places (key, label, short, icon, kind, sort) VALUES ('school', 'School (boarding)', 'School', '🏫', 'school', 3)"));
  await env.DB.batch(stmts);
  await log(env, u, "Set-up wizard", `${family}: ${added.length ? "added " + added.join(", ") : "no new people"}; houses ${houses.map((h) => h.label).join(", ")}`);
  return json({ ok: true, added });
}

// Setup > "📥 Smart inbox" (lib/inbox.js): the Anthropic key (stored scrambled, never sent back), model, notes, on/off
async function setupInbox(request, env, u) {
  const put = (k, v) => env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v);
  if (request.method === "GET") {
    const c = await inboxConfig(env), h = Object.fromEntries((await env.DB.prepare("SELECT key, at, detail FROM health WHERE key IN ('inbox_check','inbox_error')").all()).results.map((r) => [r.key, r]));
    // a Claude Code cloud routine (tools/fetch_inbox.py) reading the inbox instead: it stamps inbox_check too, without "(smart inbox)"
    const routine = !c.on && h.inbox_check && !/smart inbox/.test(h.inbox_check.detail || "") && Date.now() - new Date(h.inbox_check.at).getTime() < 26 * 3600e3;
    return json({ on: c.on, routine, model: c.model, notes: c.notes, keyHint: c.keyHint, models: INBOX_MODELS, lastRun: h.inbox_check?.at || null,
                  lastError: h.inbox_error && (!h.inbox_check || h.inbox_error.at > h.inbox_check.at) ? h.inbox_error : null, inbox: brand(await loadSettings(env.DB)).inbox });
  }
  if (request.method !== "PUT") return fail(405, "Method not allowed");
  if (!env.VAULT_KEY) invalid("The calendar has no VAULT_KEY to keep the key safe");
  const b = await request.json(), model = INBOX_MODELS[b.model] ? b.model : "claude-opus-5-5", key = String(b.key || "").trim();
  const stmts = [put("inbox_model", model), put("inbox_notes", String(b.notes || "").slice(0, 4000) || null)];
  if (key) {
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) invalid("That doesn't look like an Anthropic API key (it starts with sk-ant-)");
    try { await testKey(key, model); } catch (e) { invalid(`Anthropic didn't accept the key: ${String(e.message || e).slice(0, 200)}`); }
    stmts.push(put("inbox_key", await sealKey(env, key)));
  }
  const has = key || (await inboxConfig(env)).key;
  if (b.on && !has) invalid("Add an Anthropic API key first");
  stmts.push(put("inbox_on", b.on ? "1" : "0"));
  if (b.remove_key) stmts.push(env.DB.prepare("DELETE FROM settings WHERE key = 'inbox_key'"), put("inbox_on", "0"));
  await env.DB.batch(stmts);
  await log(env, u, "Edited smart inbox", `${b.on && !b.remove_key ? "on" : "off"} · ${model}${key ? " · new key" : ""}${b.remove_key ? " · key removed" : ""}`);
  return json({ ok: true });
}

// places where people sleep (Setup > Places); the key is stored on entries, so it never changes once made
const loadPlaces = async (env) => (await env.DB.prepare("SELECT * FROM places ORDER BY sort, key").all()).results;
async function setupPlaces(request, env, u, key) {
  if (request.method === "GET") return json(await loadPlaces(env));
  const b = await request.json(), label = String(b.label || "").trim().slice(0, 40);
  if (!label) invalid("Give the place a name");
  const rec = { label, short: (String(b.short || "").trim() || label).slice(0, 12), icon: String(b.icon || "").trim().slice(0, 8) || "🏠",
                kind: PLACE_KINDS.includes(b.kind) ? b.kind : "home", sort: parseInt(b.sort, 10) || 0, active: b.active === false ? 0 : 1,
                needs: b.kind === "home" ? String(b.needs || "").trim().slice(0, 60) || null : null };
  if (request.method === "POST") {
    const base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "place";
    const taken = new Set((await loadPlaces(env)).map((p) => p.key));
    let k = base; for (let i = 2; taken.has(k); i++) k = `${base}-${i}`;
    await insert(env, "places", { key: k, ...rec });
    await log(env, u, "Added place", `${rec.icon} ${label}`);
    return json({ ok: true, key: k }, 201);
  }
  if (request.method === "PUT") {
    const r = await env.DB.prepare("UPDATE places SET label=?, short=?, icon=?, kind=?, sort=?, active=?, needs=? WHERE key=?")
      .bind(rec.label, rec.short, rec.icon, rec.kind, rec.sort, rec.active, rec.needs, key).run();
    if (!r.meta.changes) return fail(404, "Not found");
    await log(env, u, "Edited place", `${rec.icon} ${label}${rec.active ? "" : " (hidden)"}`);
    return json({ ok: true });
  }
  return fail(405, "Method not allowed");
}

async function setupPeople(request, env, u, id) {
  if (request.method === "GET") return json(await loadPeople(env));
  const people = await loadPeople(env);
  if (request.method === "POST") {
    const rec = cleanPerson(await request.json());
    if (people.some((p) => p.name.toLowerCase() === rec.name.toLowerCase())) invalid("There's already someone with that name");
    const newId = await insert(env, "people", rec);
    await log(env, u, "Added person", `${rec.name} (${rec.type})`);
    return json({ ok: true, id: newId }, 201);
  }
  const before = people.find((p) => p.id === id);
  if (!before) return fail(404, "Not found");
  if (request.method === "PUT") {
    const rec = cleanPerson(await request.json());
    if (people.some((p) => p.id !== id && p.name.toLowerCase() === rec.name.toLowerCase())) invalid("There's already someone with that name");
    const stmts = [env.DB.prepare("UPDATE people SET name=?, color=?, type=?, active=?, grid_column=?, family=?, child=?, boards=?, home=?, school=?, sort=? WHERE id=?")
      .bind(rec.name, rec.color, rec.type, rec.active, rec.grid_column, rec.family, rec.child, rec.boards, rec.home, rec.school, rec.sort, id)];
    if (rec.name !== before.name) {  // carry a rename through to every entry and every login that refers to them
      const evs = (await env.DB.prepare(`SELECT id, who FROM events WHERE ${whoHas}`).bind(`%,${before.name},%`).all()).results;
      for (const e of evs) stmts.push(env.DB.prepare("UPDATE events SET who=? WHERE id=?").bind(renameIn(e.who, before.name, rec.name), e.id));
      const us = (await env.DB.prepare("SELECT id, see FROM users WHERE see IS NOT NULL").all()).results;
      for (const x of us) stmts.push(env.DB.prepare("UPDATE users SET see=? WHERE id=?").bind(renameIn(x.see, before.name, rec.name) || null, x.id));
    }
    await env.DB.batch(stmts);
    await log(env, u, "Edited person", `${before.name}${rec.name !== before.name ? " → " + rec.name : ""} (${rec.type}${rec.active ? "" : ", hidden"})`);
    return json({ ok: true });
  }
  if (request.method === "DELETE") {
    const used = await env.DB.prepare(`SELECT count(*) n FROM events WHERE ${whoHas}`).bind(`%,${before.name},%`).first();
    if (used.n) invalid(`${before.name} is on ${used.n} entr${used.n === 1 ? "y" : "ies"} – hide them instead of deleting`);
    await env.DB.prepare("DELETE FROM people WHERE id=?").bind(id).run();
    await log(env, u, "Deleted person", before.name);
    return json({ ok: true });
  }
  return fail(405, "Method not allowed");
}

async function setupUsers(request, env, u, id) {
  const all = (await env.DB.prepare("SELECT * FROM users ORDER BY role='limited', name").all()).results;
  if (request.method === "GET") return json(all);
  const people = await loadPeople(env);
  const activeAdmins = (except) => all.filter((x) => x.role === "admin" && x.active && x.id !== except).length;
  if (request.method === "POST") {
    const rec = cleanUser(await request.json(), people);
    if (all.some((x) => x.email === rec.email)) invalid("That email already has a login");
    const newId = await insert(env, "users", rec);
    await log(env, u, "Added login", `${rec.name} <${rec.email}> as ${rec.role}`);
    await syncAccessPolicy(env).catch((e) => log(env, u, "Sign-in list not updated", String(e.message || e)));
    return json({ ok: true, id: newId }, 201);
  }
  const before = all.find((x) => x.id === id);
  if (!before) return fail(404, "Not found");
  if (request.method === "PUT") {
    const rec = cleanUser(await request.json(), people);
    if (all.some((x) => x.id !== id && x.email === rec.email)) invalid("That email already has a login");
    if (before.role === "admin" && (rec.role !== "admin" || !rec.active) && !activeAdmins(id)) invalid("There must always be at least one admin");
    await update(env, "users", id, rec);
    await log(env, u, "Edited login", `${rec.name} <${rec.email}> as ${rec.role}${rec.active ? "" : " (disabled)"}`);
    await syncAccessPolicy(env).catch((e) => log(env, u, "Sign-in list not updated", String(e.message || e)));
    return json({ ok: true });
  }
  if (request.method === "DELETE") {
    if (before.role === "admin" && !activeAdmins(id)) invalid("There must always be at least one admin");
    await env.DB.prepare("DELETE FROM users WHERE id=?").bind(id).run();
    await log(env, u, "Removed login", `${before.name} <${before.email}>`);
    await syncAccessPolicy(env).catch((e) => log(env, u, "Sign-in list not updated", String(e.message || e)));
    return json({ ok: true });
  }
  return fail(405, "Method not allowed");
}

// ---------- weekly email recipients (admins). Cloudflare only delivers to verified "destination addresses":
// lib/email-sync.js (hourly, and straight after adding an address) asks Cloudflare to send new addresses their confirmation email
// and copies the verified state into digest_recipients.verified.
async function setupDigest(request, env, u, id) {
  const all = (await env.DB.prepare("SELECT * FROM digest_recipients ORDER BY id").all()).results;
  if (request.method === "GET") return json(all.map((r) => ({ ...r, status: r.verified ? "ok" : "waiting" })));
  if (request.method === "POST") {
    const b = await request.json();
    const email = String(b.email || "").trim().toLowerCase();
    if (!EMAIL.test(email)) invalid("Enter a valid email address");
    if (all.some((r) => r.email === email)) invalid("That address already gets the email");
    const newId = await insert(env, "digest_recipients", { email, name: String(b.name || "").trim() || null, active: 1 });
    await log(env, u, "Added weekly email", email);
    await syncEmailAddresses(env).catch(() => {});   // Cloudflare's "verify this address" email goes out now (if the key is set)
    return json({ ok: true, id: newId }, 201);
  }
  const before = all.find((r) => r.id === id);
  if (!before) return fail(404, "Not found");
  if (request.method === "PUT") {
    const b = await request.json();
    await env.DB.prepare("UPDATE digest_recipients SET name=?, active=? WHERE id=?")
      .bind(String(b.name || "").trim() || null, b.active === false || b.active === 0 ? 0 : 1, id).run();
    await log(env, u, "Edited weekly email", `${before.email}${b.active === false ? " (paused)" : ""}`);
    return json({ ok: true });
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM digest_recipients WHERE id=?").bind(id).run();
    await log(env, u, "Removed weekly email", before.email);
    return json({ ok: true });
  }
  return fail(405, "Method not allowed");
}

// ---------- calendar invite for one entry, emailed through the mail code (env.MAIL - see src/worker.js)
const ALARMS = {   // all-day entries start at midnight; timed ones at their time
  none: null, morning: "PT7H", evening: "-PT6H", days2: "-P1DT6H", week: "-P6DT15H",
  min15: "-PT15M", hour1: "-PT1H", day1: "-P1D",
};
// people who can be sent an invite: active non-limited logins, at their chosen invite address (or sign-in email)
// - only if that address is a confirmed weekly-email address
async function inviteTargets(env) {
  const ok = (await env.DB.prepare("SELECT lower(email) e FROM digest_recipients WHERE active = 1 AND verified = 1").all()).results.map((r) => r.e);
  const users = (await env.DB.prepare("SELECT name, email, invite_email FROM users WHERE active = 1 AND role != 'limited' ORDER BY id").all()).results;
  return users.map((x) => ({ name: x.name, login: x.email.toLowerCase(), email: (x.invite_email || x.email).toLowerCase() }))
    .filter((x) => ok.includes(x.email));
}

async function invite(request, env, u, id) {
  if (!canEditAll(u)) deny();
  if (!env.MAIL) invalid("Invites can only be sent from the live site");
  const e = await byId(env, "events", id);
  if (!e || !eventVisible(u, e.who)) return fail(404, "Not found");
  const b = await request.json();
  const allowed = (await env.DB.prepare("SELECT email FROM digest_recipients WHERE active = 1 AND verified = 1").all()).results.map((r) => r.email.toLowerCase());
  const to = (b.to || []).map((x) => String(x).toLowerCase()).filter((x) => allowed.includes(x));
  if (!to.length) invalid("Pick at least one confirmed address");
  const time = /^\d{2}:\d{2}$/.test(b.time || "") ? b.time : null;
  const minutes = Math.min(Math.max(parseInt(b.minutes, 10) || 60, 15), 24 * 60);
  const alarm = ALARMS[b.alarm] === undefined ? (time ? ALARMS.hour1 : ALARMS.evening) : ALARMS[b.alarm];

  // times are South African (UTC+2, no daylight saving)
  let when, dtLines;
  if (time) {
    const start = new Date(`${e.start}T${time}:00+02:00`), end = new Date(start.getTime() + minutes * 60000);
    dtLines = [`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`, "TRANSP:OPAQUE"];
    when = `${e.start} at ${time}`;
  } else {
    dtLines = [`DTSTART;VALUE=DATE:${ymd(e.start)}`, `DTEND;VALUE=DATE:${ymd(addDaysIso(e.end, 1))}`, "TRANSP:TRANSPARENT"];
    when = e.end !== e.start ? `${e.start} to ${e.end}` : e.start;
  }
  const br = brand(await loadSettings(env.DB), new URL(request.url).origin), site = br.url;
  const desc = [`Who: ${e.who}`, e.notes ? `Notes: ${e.notes}` : "", `${br.full}: ${site}`].filter(Boolean).join("\n");
  const ics = ["BEGIN:VCALENDAR", `PRODID:-//${br.full}//EN`, "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:REQUEST",
    "BEGIN:VEVENT", `UID:${br.uid}-event-${e.id}@${br.host || "calendar"}`, `SEQUENCE:${Math.floor(Date.now() / 1000)}`,
    `DTSTAMP:${utcStamp(new Date())}`, ...dtLines, `SUMMARY:${icsText(e.title)}`, `DESCRIPTION:${icsText(desc)}`,
    `STATUS:${e.status === "Tentative" ? "TENTATIVE" : "CONFIRMED"}`,
    `ORGANIZER;CN=${icsText(br.site)}:mailto:${br.from}`,
    ...to.map((x) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${x}`),
    ...(alarm ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(e.title)}`, `TRIGGER:${alarm}`, "END:VALARM"] : []),
    "END:VEVENT", "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";

  const escH = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const F = "font-family:'Segoe UI',-apple-system,Roboto,Helvetica,Arial,sans-serif";
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f3f7"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e3e7ee">
<tr><td bgcolor="#1f3864" style="background:#1f3864;padding:18px 24px;${F}"><div style="color:#aab8d6;font-size:12px;letter-spacing:1px;text-transform:uppercase">${escH(br.full)}</div>
<div style="color:#ffffff;font-size:22px;font-weight:bold;padding-top:4px">${escH(e.title)}</div><div style="color:#d0d9ec;font-size:14px;padding-top:2px">${escH(when)}</div></td></tr>
<tr><td style="padding:18px 24px;${F};font-size:15px;color:#212529">Who: <b>${escH(e.who)}</b>${e.notes ? `<br>Notes: ${escH(e.notes)}` : ""}
<p style="color:#495057">Use <b>Add to calendar</b> / <b>Accept</b> on this email (or open the attached invite.ics) to put it in your own calendar with a reminder.</p></td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #e3e7ee;${F};font-size:12px;color:#868e96">Sent by ${escH(u.name)} from the ${escH(br.full)}.</td></tr></table></td></tr></table>`;
  const text = `${e.title}\n${when}\nWho: ${e.who}${e.notes ? "\nNotes: " + e.notes : ""}\n\nAdd it to your calendar with the attached invite.\n${site}`;

  const r = await env.MAIL.fetch("https://mail/send", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject: `📅 ${e.title} – ${when}`, text, html, ics }) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) invalid(out.error || "The invite couldn't be sent");
  await log(env, u, "Sent invite", `${describe(e)} to ${to.join(", ")}`);
  return json({ ok: true, result: out.result });
}

// ---------- inbox proposals (written by the daily cloud routine, tools/propose.py) - approve / reject on the site
async function pendingProposals(env) {
  const rows = (await env.DB.prepare(`SELECT p.*, b.source, b.summary, b.checks FROM proposals p JOIN proposal_batches b ON b.id = p.batch_id
    WHERE p.status = 'pending' ORDER BY p.batch_id, p.id`).all()).results;
  return rows.map((r) => ({ id: r.id, batch: r.batch_id, kind: r.kind, data: JSON.parse(r.data), note: r.note,
                            source: r.source, summary: r.summary, checks: JSON.parse(r.checks || "[]") }));
}

async function applyProposal(env, u, p, people) {
  const d = JSON.parse(p.data);
  if (p.kind === "event") {
    const rec = cleanEvent(d, people);
    Object.assign(rec, { created_by: `${u.name} (approved from inbox)`, created_at: now(), updated_by: u.name, updated_at: now() });
    await insert(env, "events", rec);
    return { ...rec, who: rec.who };
  }
  if (p.kind === "update") {
    const before = await byId(env, "events", d.id);
    if (!before) invalid(`The entry to update (#${d.id}) no longer exists`);
    const rec = cleanEvent({ ...before, who: split(before.who), ...d.changes }, people);
    await update(env, "events", d.id, { ...rec, updated_by: `${u.name} (approved from inbox)`, updated_at: now() });
    return { ...rec, updated: true };
  }
  if (p.kind === "school_holiday") { const rec = cleanHoliday(d, people); await insert(env, "school_holidays", rec); return { ...rec, who: rec.child, title: "🌿 " + rec.name }; }
  if (p.kind === "recurring") { const rec = cleanRecurring(d); await insert(env, "recurring", rec); return { start: `----${String(rec.month).padStart(2, "0")}`, title: `🎂 ${rec.name}`, who: "Family", recurring: rec }; }
  if (p.kind === "public_holiday") {
    if (!DATE.test(d.date || "") || !String(d.name || "").trim()) invalid("Public holiday needs a date and name");
    await env.DB.prepare("INSERT OR REPLACE INTO public_holidays (date, name) VALUES (?, ?)").bind(d.date, String(d.name).trim()).run();
    return { start: d.date, end: d.date, who: "Family", title: `Public holiday: ${d.name}` };
  }
  invalid("Unknown kind of proposal");
}

// POST acks = "OK, noted" (hide from Needs sorting), POST acks/undo = undo. Body { msg, days: [...] }
async function acknowledge(request, env, u, add) {
  if (!canEditAll(u)) deny();
  const b = await request.json();
  const days = (b.days || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 400);
  const msg = String(b.msg || "").slice(0, 500);
  if (!msg || !days.length) return json({ error: "Nothing to acknowledge" }, 400);
  await env.DB.batch(days.map((d) => add
    ? env.DB.prepare("INSERT OR REPLACE INTO acknowledged (day,msg,by_user,at) VALUES (?,?,?,?)").bind(d, msg, u.name, now())
    : env.DB.prepare("DELETE FROM acknowledged WHERE day=? AND msg=?").bind(d, msg)));
  const range = days.length > 1 ? `${days[0]} – ${days[days.length - 1]}` : days[0];
  await log(env, u, add ? "Noted" : "Un-noted", `${range}: ${msg}`);
  return json({ ok: true });
}

async function decideProposals(request, env, u) {
  if (!canEditAll(u)) deny();
  const b = await request.json();
  const people = await loadPeople(env);
  const touched = new Set(), done = [];
  for (const [ids, decision] of [[b.approve || [], "approved"], [b.reject || [], "rejected"]]) {
    for (const id of ids.map(Number)) {
      const p = await byId(env, "proposals", id);
      if (!p || p.status !== "pending") continue;
      const edit = decision === "approved" && p.kind === "event" && b.edits?.[id];
      if (edit) {   // "✏️ Edit" on the site: approve the changed version (and keep it for the summary email)
        p.data = JSON.stringify({ ...JSON.parse(p.data), ...edit });
        await env.DB.prepare("UPDATE proposals SET data=? WHERE id=?").bind(p.data, id).run();
      }
      const applied = decision === "approved" ? await applyProposal(env, u, p, people) : null;
      await env.DB.prepare("UPDATE proposals SET status=?, decided_by=?, decided_at=? WHERE id=?").bind(decision, u.name, now(), id).run();
      touched.add(p.batch_id);
      done.push(`${decision === "approved" ? "Approved" : "Rejected"}: ${applied ? describe(applied) : JSON.parse(p.data).title || p.kind}`);
    }
  }
  if (done.length) await log(env, u, "Inbox items", done.join("; "));
  // a batch with nothing left pending: email the "Calendar updated" summary (once)
  const emailed = [];
  for (const batchId of touched) {
    const left = await env.DB.prepare("SELECT count(*) n FROM proposals WHERE batch_id=? AND status='pending'").bind(batchId).first();
    const batch = await byId(env, "proposal_batches", batchId);
    if (left.n || batch.emailed_at) continue;
    const items = (await env.DB.prepare("SELECT * FROM proposals WHERE batch_id=? ORDER BY id").bind(batchId).all()).results;
    if (!items.some((x) => x.status === "approved")) { await env.DB.prepare("UPDATE proposal_batches SET emailed_at=? WHERE id=?").bind("nothing approved", batchId).run(); continue; }
    if (env.MAIL) {
      const mail = batchEmail(batch, items, u, Object.fromEntries(people.map((x) => [x.name, x.color])), brand(await loadSettings(env.DB), new URL(request.url).origin));
      const to = (await env.DB.prepare("SELECT email FROM digest_recipients WHERE active=1 AND verified=1").all()).results.map((r) => r.email);
      const r = await env.MAIL.fetch("https://mail/send", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, ...mail }) });
      if (r.ok) { await env.DB.prepare("UPDATE proposal_batches SET emailed_at=? WHERE id=?").bind(now(), batchId).run(); emailed.push(batch.summary); }
    }
  }
  return json({ ok: true, decided: done.length, emailed });
}

// the "Calendar updated" email for a finished batch (same look as tools/email_layout.py, via mail/src/layout.js)
function batchEmail(batch, items, u, colors = {}, br = brand({})) {
  const nice = (s) => { const d = new Date(s + "T00:00:00Z"); return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); };
  const entry = (x) => { const d = JSON.parse(x.data); return x.kind === "update" ? { ...d.before, ...d.changes, title: (d.changes.title || d.before?.title || "") + " (updated)" }
    : x.kind === "school_holiday" ? { start: d.start, end: d.end, who: d.child, title: "🌿 " + d.name }
    : x.kind === "public_holiday" ? { start: d.date, end: d.date, who: "Family", title: "Public holiday: " + d.name }
    : x.kind === "recurring" ? { start: null, who: "Family", title: `🎂 ${d.name} (${d.day}/${d.month})` } : d; };
  const rowsFor = (list) => list.map((x) => {
    const e = entry(x), who = Array.isArray(e.who) ? e.who : split(e.who);
    const when = !e.start ? "Every year" : e.end && e.end !== e.start ? `${nice(e.start)} – ${nice(e.end)}` : nice(e.start);
    return row(when, who.map((p) => tag(p, colors[p] || "#495057")).join(" "), `${e.important ? "⭐ " : ""}${esc(e.title)}`, !!e.important, true);
  }).join("");
  const approved = items.filter((x) => x.status === "approved"), rejected = items.filter((x) => x.status === "rejected");
  const checks = JSON.parse(batch.checks || "[]");
  let body = checks.length ? warnBox("Please check", checks.map(esc)) : "";
  body += section("Added", rowsFor(approved), approved.length);
  if (rejected.length) body += section("Not added (rejected)", rowsFor(rejected), rejected.length);
  body += `<div style="${FONT};font-size:13px;color:${MUTED};padding-bottom:6px">From: ${esc(batch.source)} · approved by ${esc(u.name)}</div>`;
  const text = `${batch.summary}\nFrom: ${batch.source}\n\nADDED\n` + approved.map((x) => { const e = entry(x); return `  ${e.start || "yearly"}  ${Array.isArray(e.who) ? e.who.join(", ") : e.who}: ${e.title}`; }).join("\n")
    + (checks.length ? "\n\nPLEASE CHECK\n" + checks.map((c) => "  - " + c).join("\n") : "") + `\n\n${br.url}\n`;
  return { subject: `Calendar updated: ${batch.summary} (${approved.length} entr${approved.length === 1 ? "y" : "ies"})`, text,
           html: page("Calendar updated", batch.summary, body, `Sent by the ${br.full} after approving items from ${br.inbox}.`, br.url, br.full) };
}

// ---------- 🔒 Info page (admins only; encrypted with VAULT_KEY - see lib/vault.js). Never part of /all, the feed or search.
// Exception (agreed when this was built): the soonest expiry date + "title – line label" are kept plain (expires_on / expiry_label)
// so the Sunday email can say what runs out within 30 days. Numbers and other details stay encrypted.
const VAULT_SECTIONS = ["Medical", "Contacts", "School", "Insurance", "Vehicles", "Documents", "Firearm licences", "Other"];
const vaultExpiry = (item) => { const x = globalThis.CalendarRules.expiries(item.fields)[0];
  return x ? [x.date, `${item.title} – ${x.k}`.slice(0, 200)] : [null, null]; };
// "⏳ Renew" calendar entries a month before each expiry (lib/vault-reminders.js); today = SA date
async function vaultReminders(env, u, id, item, people) {
  const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  // an item without a person: the reminder goes to the admins who are in the calendar (else Family)
  const names = people.map((p) => p.name), admins = (await env.DB.prepare("SELECT name FROM users WHERE role = 'admin' AND active = 1 ORDER BY id").all()).results
    .map((r) => r.name).filter((n) => names.includes(n));
  for (const [action, details] of await syncVaultReminders(env, u, id, item, today, names, now(), admins.join(", ") || "Family"))
    await log(env, u, action, details);
}
function cleanVault(b, people) {
  const title = String(b.title || "").trim().slice(0, 120);
  if (!title) invalid("Give it a title, e.g. Medical aid");
  const person = b.person && people.some((p) => p.name === b.person) ? b.person : null;
  const fields = (Array.isArray(b.fields) ? b.fields : []).slice(0, 40)
    .map((f) => ({ k: String(f.k || "").trim().slice(0, 80), v: String(f.v || "").trim().slice(0, 500), hide: !!f.hide }))
    .filter((f) => f.k || f.v);
  return { section: VAULT_SECTIONS.includes(b.section) ? b.section : "Other", sort: parseInt(b.sort, 10) || 0,
           item: { title, person, fields, notes: String(b.notes || "").trim().slice(0, 4000) } };
}
async function vault(request, env, u, id) {
  if (!isAdmin(u)) deny("Only the calendar's admins can see this page");
  if (!env.VAULT_KEY) invalid("The info page isn't set up yet (no VAULT_KEY)");
  if (request.method === "GET") {
    const rows = (await env.DB.prepare("SELECT * FROM vault_items ORDER BY section, sort, id").all()).results;
    const items = [];
    let people;
    for (const r of rows) {
      try {
        const item = await unseal(env.VAULT_KEY, r.data), [on, label] = vaultExpiry(item);
        if (on !== r.expires_on || label !== r.expiry_label) {   // keep the plain copy + reminders in step (e.g. after a date-reading fix)
          await env.DB.prepare("UPDATE vault_items SET expires_on=?, expiry_label=? WHERE id=?").bind(on, label, r.id).run();
          await vaultReminders(env, u, r.id, item, people ||= await loadPeople(env));
        }
        items.push({ id: r.id, section: r.section, sort: r.sort, updated_by: r.updated_by, updated_at: r.updated_at, ...item });
      }
      catch { items.push({ id: r.id, section: r.section, title: "(can't be read – wrong key?)", fields: [], broken: true }); }
    }
    await log(env, u, "Opened 🔒 Info", `${items.length} item${items.length === 1 ? "" : "s"}`);
    return json({ sections: VAULT_SECTIONS, items });
  }
  const people = await loadPeople(env);
  if (request.method === "POST" || request.method === "PUT") {
    const { section, sort, item } = cleanVault(await request.json(), people);
    const data = await seal(env.VAULT_KEY, item), [on, label] = vaultExpiry(item);
    if (request.method === "POST") {
      const r = await env.DB.prepare("INSERT INTO vault_items (section, sort, data, expires_on, expiry_label, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(section, sort, data, on, label, u.name, now(), u.name, now()).run();
      await log(env, u, "Added to 🔒 Info", `${section}: ${item.title}`);   // titles only - never the details
      await vaultReminders(env, u, r.meta.last_row_id, item, people);
      return json({ ok: true, id: r.meta.last_row_id }, 201);
    }
    await env.DB.prepare("UPDATE vault_items SET section=?, sort=?, data=?, expires_on=?, expiry_label=?, updated_by=?, updated_at=? WHERE id=?")
      .bind(section, sort, data, on, label, u.name, now(), id).run();
    await log(env, u, "Edited 🔒 Info", `${section}: ${item.title}`);
    await vaultReminders(env, u, id, item, people);
    return json({ ok: true });
  }
  if (request.method === "DELETE") {
    const r = await env.DB.prepare("SELECT section FROM vault_items WHERE id=?").bind(id).first();
    await env.DB.prepare("DELETE FROM vault_items WHERE id=?").bind(id).run();
    await log(env, u, "Deleted from 🔒 Info", `${r?.section || ""} item #${id}`);
    await vaultReminders(env, u, id, null, people);
    return json({ ok: true });
  }
  return fail(405, "Method not allowed");
}

// ---------- "Your phone calendar": a private feed link for the signed-in login (GET = show, creating it if needed;
// POST me/feed/reset = new link, the old one stops working)
async function myFeed(request, env, u, reset) {
  if (!u.id) invalid("This login can't have a calendar link");
  let token = reset ? null : (await env.DB.prepare("SELECT feed_token FROM users WHERE id=?").bind(u.id).first())?.feed_token;
  if (!token) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await env.DB.prepare("UPDATE users SET feed_token=? WHERE id=?").bind(token, u.id).run();
    if (reset) await log(env, u, "Reset calendar link", u.name);
  }
  const origin = demo(env) ? new URL(request.url).origin : brand(await loadSettings(env.DB), new URL(request.url).origin).url;
  return json({ url: `${origin}/feed/${token}.ics` });
}

// ---------- router
export async function onRequest({ request, env, params }) {
  const parts = params.path || [];
  try {
    // demo only: the list of logins for the "View as" switch
    if (parts[0] === "demo-users") {
      if (!demo(env)) return fail(404, "Not found");
      return json((await env.DB.prepare("SELECT email, name, role FROM users WHERE active=1 ORDER BY role='limited', name").all()).results);
    }
    const u = await currentUser(request, env);
    if (!u && setupMode(env)) return json({ error: "Enter the setup password you chose when installing", setup: true }, 401);
    if (!u) return fail(403, "Your email hasn't been given access to this calendar yet – ask whoever runs this calendar.");
    const last = parts[parts.length - 1];
    const id = last && /^\d+$/.test(last) ? parseInt(last, 10) : null;
    const byKey = parts[0] === "setup" && ["places", "settings", "backup", "email-sync", "inbox", "wizard", "cloudflare", "digest-time"].includes(parts[1]);   // addressed by key / no id
    if (["PUT", "DELETE"].includes(request.method) && !id && !byKey) return fail(400, "Missing id");

    if (parts[0] === "all" && request.method === "GET") return await getAll(env, u);
    if (parts[0] === "log" && request.method === "GET") {
      if (!canEditAll(u)) deny();
      return json((await env.DB.prepare("SELECT * FROM change_log ORDER BY id DESC LIMIT 200").all()).results);
    }
    if (parts[0] === "events" && parts[1] === "restore" && request.method === "POST") return await restoreDeleted(request, env, u);
    if (parts[0] === "events" && request.method !== "GET") return await events(request, env, u, id);
    if (parts[0] === "deleted" && request.method === "GET") return await recentlyDeleted(env, u);
    if (parts[0] === "vault") return await vault(request, env, u, id);
    if (parts[0] === "me" && parts[1] === "feed") return await myFeed(request, env, u, request.method === "POST" && parts[2] === "reset");
    if (parts[0] === "invite" && request.method === "POST" && id) return await invite(request, env, u, id);
    if (parts[0] === "proposals" && parts[1] === "decide" && request.method === "POST") return await decideProposals(request, env, u);
    if (parts[0] === "acks" && request.method === "POST") return await acknowledge(request, env, u, parts[1] !== "undo");
    if (parts[0] === "recurring" && request.method !== "GET") return await simpleTable(request, env, u, id, "recurring", cleanRecurring, "birthday");
    if (parts[0] === "school-holidays" && request.method !== "GET") return await simpleTable(request, env, u, id, "school_holidays", cleanHoliday, "school holiday");
    if (parts[0] === "setup") {
      if (!isAdmin(u)) deny("Only admins can change the setup");
      if (parts[1] === "people") return await setupPeople(request, env, u, id);
      if (parts[1] === "places") return await setupPlaces(request, env, u, decodeURIComponent(parts[2] || ""));
      if (parts[1] === "settings") return await setupSettings(request, env, u);
      if (parts[1] === "digest-time" && request.method === "PUT") {   // Setup > Weekly email > day and time
        const b = await request.json(), s = digestSchedule({ digest_day: b.day, digest_hour: b.hour, timezone: b.timezone });
        if (String(b.timezone || "") && s.tz !== b.timezone) invalid("Unknown time zone");
        const put = (k, v) => env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, String(v));
        await env.DB.batch([put("digest_day", s.day), put("digest_hour", s.hour), put("timezone", s.tz)]);
        await log(env, u, "Weekly email time", `${DAYS[s.day]} ${String(s.hour).padStart(2, "0")}:00 (${s.tz})`);
        return json({ ok: true, ...s });
      }
      if (parts[1] === "inbox") return await setupInbox(request, env, u);
      if (parts[1] === "wizard") return await setupWizard(request, env, u);
      if (parts[1] === "cloudflare" && request.method === "POST") {   // wizard: "Switch on sign-in" (lib/cloudflare-setup.js)
        if (env.ACCESS_AUD) invalid("Sign-in is already switched on");
        const b = await request.json(), email = String(b.email || "").trim().toLowerCase(), token = String(b.token || "").trim();
        if (!EMAIL.test(email)) invalid("Enter the email address you'll sign in with");
        if (token.length < 30) invalid("Paste the Cloudflare key (it's about 40 characters long)");
        const url = new URL(request.url), worker = url.hostname.endsWith(".workers.dev") ? url.hostname.split(".")[0] : String(b.worker || "");
        if (!worker) invalid("Open the calendar on its workers.dev address for this step");
        try {
          const r = await connectCloudflare(env, { token, email, name: String(b.name || "").trim(), host: url.hostname, worker, family: (await loadSettings(env.DB)).family_name });
          await log(env, u, "Switched on sign-in", `${url.hostname} for ${email}`);
          return json({ ok: true, ...r });
        } catch (e) { invalid(String(e.message || e)); }
      }
      if (parts[1] === "email-sync" && request.method === "POST") {   // Setup > Weekly email > "Check confirmations now"
        if (!canSyncEmail(env)) invalid("The calendar has no Cloudflare key for this yet");
        try { return json({ changes: await syncEmailAddresses(env) }); } catch (e) { invalid(String(e.message || e)); }
      }
      if (parts[1] === "backup" && request.method === "GET") {   // Setup > "Download a backup"
        const sql = await dumpDatabase(env.DB), day = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
        await log(env, u, "Downloaded a backup", `${Math.round(sql.length / 1024)} KB`);
        return new Response(sql, { headers: { "content-type": "application/sql; charset=utf-8", "cache-control": "no-store",
          "content-disposition": `attachment; filename="calendar-backup-${day}.sql"` } });
      }
      if (parts[1] === "users") return await setupUsers(request, env, u, id);
      if (parts[1] === "digest") return await setupDigest(request, env, u, id);
    }
    return fail(404, "Not found");
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message);
    if (e instanceof SyntaxError) return fail(400, "Bad request");
    return fail(500, e.message || "Server error");
  }
}
