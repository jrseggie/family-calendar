// The web-app manifest (name under the icon when the calendar is added to a phone's home screen), from the settings.
import { brand, loadSettings } from "../lib/settings.js";

export async function onRequestGet({ request, env }) {
  const b = brand(await loadSettings(env.DB), new URL(request.url).origin);
  const row = await env.DB.prepare("SELECT updated_at FROM app_icons WHERE name = 'icon-512.png'").first().catch(() => null);
  const v = row ? row.updated_at.replace(/\D/g, "").slice(0, 14) : "1";
  return new Response(JSON.stringify({
    name: b.site, short_name: b.short, start_url: "/", scope: "/", display: "standalone",   // e.g. "Smith Calendar" (fits under a desktop icon)
    background_color: "#1f3864", theme_color: "#1f3864",
    icons: [   // ?v= changes when the family's icon is redrawn, so phones / PCs pick up the new one
      { src: `icon-192.png?v=${v}`, sizes: "192x192", type: "image/png" },
      { src: `icon-512.png?v=${v}`, sizes: "512x512", type: "image/png" },
      { src: `icon-maskable.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, null, 2), { headers: { "content-type": "application/manifest+json", "cache-control": "no-cache" } });
}
