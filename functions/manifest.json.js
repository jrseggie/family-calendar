// The web-app manifest (name under the icon when the calendar is added to a phone's home screen), from the settings.
import { brand, loadSettings } from "../lib/settings.js";

export async function onRequestGet({ request, env }) {
  const b = brand(await loadSettings(env.DB), new URL(request.url).origin);
  return new Response(JSON.stringify({
    name: b.full, short_name: b.short, start_url: "/", scope: "/", display: "standalone",
    background_color: "#1f3864", theme_color: "#1f3864",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, null, 2), { headers: { "content-type": "application/manifest+json", "cache-control": "no-cache" } });
}
