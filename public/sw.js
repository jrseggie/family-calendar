// Offline copy (the phone / PC app): the site's own files and the calendar data (/api/all) are kept on the device and used
// ONLY when the network can't be reached - online, everything always comes fresh. Nothing else is kept: not the 🔒 Info
// page, not private extras (e.g. expenses), not Setup. Changes (POST/PUT/DELETE) always go to the network; new entries made
// offline wait in the page (app.js offline queue) and are sent when it's next open with a connection.
const SHELL = "cal-shell-v2", DATA = "cal-data-v1";

self.addEventListener("install", () => self.skipWaiting());
// a new copy of this file: old kept copies go, and any open window reloads onto the current version
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SHELL && k !== DATA) await caches.delete(k);
  await self.clients.claim();
  for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url).catch(() => {});
})()));

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

// 🔔 a notification from the calendar (lib/push.js): show it; several from the same person about the same list replace each
// other (same tag), so a run of additions is one notification. Tapping it opens the calendar on that list.
self.addEventListener("push", (e) => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || "Family Calendar", {
    body: m.body || "", tag: m.tag || undefined, renotify: !!m.tag, data: { url: m.url || "/", event: m.event || null }, icon: "/icon-192.png", badge: "/icon-192.png",
    actions: Array.isArray(m.actions) ? m.actions.slice(0, 2) : [] }));   // ✅ Done / 😴 15 min on a reminder (Android shows them; iPhones don't)
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  // a button on a reminder: done / snoozed straight away, without opening the app
  const ev = e.notification.data?.event;
  if (ev && (e.action === "done" || e.action === "snooze")) {
    const body = e.action === "done" ? { done: true } : { minutes: 15 };
    return e.waitUntil(fetch(`/api/events/${ev}/${e.action}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.ok ? self.registration.showNotification(e.action === "done" ? "✅ Marked as done" : "😴 Snoozed for 15 minutes", { tag: `ack-${ev}`, icon: "/icon-192.png" }) : self.clients.openWindow(`/?event=${ev}`))
      .catch(() => self.clients.openWindow(`/?event=${ev}`)));
  }
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const w = wins.find((c) => new URL(c.url).origin === self.location.origin);
    if (w) { await w.focus(); return w.navigate(url).catch(() => self.clients.openWindow(url)); }
    return self.clients.openWindow(url);
  })());
});
