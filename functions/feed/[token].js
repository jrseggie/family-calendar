// Phone-calendar feed: GET /feed/<token>.ics (subscribe once in Outlook / iPhone; they re-read it about hourly).
// Cloudflare Access is bypassed for /feed/* only (a separate Access "bypass" app); the long random token in the
// link is the password. It shows exactly what that login can see. Settings > "Your phone calendar" makes / resets it.
import { feedCalendar } from "../../lib/ics.js";
import { brand, loadSettings } from "../../lib/settings.js";

const split = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

// GET and HEAD (Outlook checks with HEAD first; without this Pages answered HEAD with the home page)
export async function onRequest({ request, params, env }) {
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
  const token = String(params.token || "").replace(/\.ics$/, "");
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) return new Response("Not found", { status: 404 });
  const u = await env.DB.prepare("SELECT * FROM users WHERE feed_token = ? AND active = 1").bind(token).first();
  if (!u) return new Response("Not found", { status: 404 });

  const all = u.role !== "limited", see = split(u.see);
  const fam = (await env.DB.prepare("SELECT name FROM people WHERE family = 1 AND active = 1").all()).results.map((r) => r.name);
  const visible = (who) => all || split(who).flatMap((p) => p === "Family" ? [p, ...fam] : [p]).some((p) => see.includes(p));
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const [events, recurring, school, places] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM events WHERE end >= ? ORDER BY start").bind(since),
    env.DB.prepare("SELECT * FROM recurring"),
    env.DB.prepare("SELECT * FROM school_holidays WHERE end >= ?").bind(since),
    env.DB.prepare("SELECT key, icon FROM places"),
  ]);
  const b = brand(await loadSettings(env.DB), new URL(request.url).origin);
  const body = feedCalendar({
    events: events.results.filter((e) => visible(e.who)),
    recurring: all || u.see_birthdays ? recurring.results : [],
    schoolHolidays: all || u.see_school ? school.results.filter((h) => all || see.includes(h.child)) : [],
    places: places.results,
  }, new Date(), b);
  return new Response(request.method === "HEAD" ? null : body, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=900",
    "content-disposition": `inline; filename="${(b.feed.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "calendar")}.ics"` } });
}
