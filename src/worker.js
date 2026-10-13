// The whole calendar as ONE Cloudflare Worker (RELEASE-PLAN.md step 2): the website (static files in public/ via the
// ASSETS binding), its API, the phone feed and the web-app manifest, plus the email jobs that used to be the separate
// separate mail worker - Sunday "week ahead" email, 10-minute outbox, hourly housekeeping and inbox@ mail.
// The handlers themselves are unchanged: functions/* (written as Pages Functions) and mail/src/index.js.
import { onRequest as api } from "../functions/api/[[path]].js";
import { onRequest as feed } from "../functions/feed/[token].js";
import { onRequestGet as manifest } from "../functions/manifest.json.js";
import mail from "../mail/src/index.js";

// the API sends calendar invites with env.MAIL.fetch("https://…/send") - now a direct call into the mail code
const withMail = (env) => ({ ...env, MAIL: { fetch: (url, init) => mail.fetch(new Request(url, init), env) } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/api" || path.startsWith("/api/")) {
      return api({ request, env: withMail(env), params: { path: path.slice(5).split("/").filter(Boolean) }, waitUntil: (p) => ctx.waitUntil(p) });
    }
    const f = path.match(/^\/feed\/([^/]+)$/);
    if (f) return feed({ request, env, params: { token: f[1] } });
    if (path === "/manifest.json") return manifest({ request, env });
    // the family's own app icons (drawn on Setup, public/appicon.js), else the standard ones from public/
    if (/^\/(icon-192|icon-512|icon-maskable|apple-touch-icon)\.png$/.test(path)) {
      const row = await env.DB.prepare("SELECT png FROM app_icons WHERE name = ?").bind(path.slice(1)).first().catch(() => null);
      if (row?.png) return new Response(new Uint8Array(row.png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
      return env.ASSETS.fetch(new Request(new URL(`/icons${path}`, url), request));   // the standard icons live in public/icons/
    }
    return env.ASSETS.fetch(request);   // everything else: the site's files (index.html, app.js, icons …)
  },
  scheduled: (event, env, ctx) => mail.scheduled(event, env, ctx),
  email: (message, env, ctx) => mail.email(message, env, ctx),
};
