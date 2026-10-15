// Offline copy (the phone / PC app): the site's own files and the calendar data (/api/all) are kept on the device and used
// ONLY when the network can't be reached - online, everything always comes fresh. Nothing else is kept: not the 🔒 Info
// page, not private extras (e.g. expenses), not Setup. Changes (POST/PUT/DELETE) always go to the network; new entries made
// offline wait in the page (app.js offline queue) and are sent when it's next open with a connection.
const SHELL = "cal-shell-v1", DATA = "cal-data-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const keep = (res) => res && res.ok && res.type === "basic" && !res.redirected;   // never a sign-in redirect or an error page

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;   // changes and other sites: straight to the network
  if (url.pathname === "/api/all") return e.respondWith(data(req));
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/feed/") || url.pathname.startsWith("/cdn-cgi/")) return;   // never kept
  e.respondWith(shell(req));
});

// the site's files: network first; offline -> the last copy (?v= stamps ignored; any page -> the start page)
async function shell(req) {
  try {
    const res = await fetch(req);
    // one copy per file (the ?v= stamp left off, so each deploy replaces the last copy instead of adding one)
    if (keep(res)) { const c = await caches.open(SHELL), u = new URL(req.url); c.put(req.mode === "navigate" || u.pathname === "/" ? "/" : u.pathname, res.clone()); }
    return res;
  } catch (err) {
    const c = await caches.open(SHELL);
    const hit = req.mode === "navigate" ? await c.match("/") : await c.match(new URL(req.url).pathname);
    if (hit) return hit;
    throw err;
  }
}

// the calendar data: network first, a copy kept with the time it was saved; offline -> that copy, marked _offline
async function data(req) {
  try {
    const res = await fetch(req);
    if (keep(res)) {
      const body = await res.clone().text();
      const c = await caches.open(DATA);
      await c.put("/api/all", new Response(body, { headers: { "content-type": "application/json", "x-saved-at": new Date().toISOString() } }));
    }
    return res;
  } catch (err) {
    const hit = await (await caches.open(DATA)).match("/api/all");
    if (!hit) throw err;
    const d = await hit.json();
    d._offline = hit.headers.get("x-saved-at") || true;
    return new Response(JSON.stringify(d), { headers: { "content-type": "application/json" } });
  }
}
