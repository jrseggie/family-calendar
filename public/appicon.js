// The app icon (home screen / installed app): a house whose window is the calendar, in the family's own colours (one square
// per person with a column, in their order). An admin's browser draws the PNGs when Setup opens and the colours have
// changed, and stores them in the calendar (PUT /api/setup/icon); the Worker then serves them instead of the standard ones.
const APP_ICON_DEFAULT = ["#2f6fdb", "#0f9d8a", "#e8590c", "#5f3dc4"];

// the icon as SVG: size = edge in px, pad = empty margin around it (maskable icons need a safe zone), round = rounded corners
function appIconSvg(colors = APP_ICON_DEFAULT, { size = 512, pad = 0, round = true } = {}) {
  const c = [...colors.slice(0, 6)], sq = [];
  while (c.length < 6) c.push("#ffffff");
  [[44, 64], [56, 64], [68, 64], [44, 76], [56, 76], [68, 76]].forEach(([x, y], i) => sq.push(`<rect x="${x}" y="${y}" width="8" height="8" rx="1" fill="${c[i]}"/>`));
  const k = (120 - 2 * pad) / 120;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120">
    <rect width="120" height="120" ${round ? 'rx="26"' : ""} fill="#1f3864"/>
    <g transform="translate(${pad} ${pad}) scale(${k})">
      <path d="M60 22 L98 54 L90 54 L90 96 L30 96 L30 54 L22 54 Z" fill="#ffffff"/>
      <rect x="40" y="60" width="40" height="28" rx="3" fill="#1f3864"/>${sq.join("")}
    </g></svg>`;
}

// SVG -> PNG (base64) in the browser
async function appIconPng(svg, size) {
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  cv.getContext("2d").drawImage(img, 0, 0, size, size);
  return cv.toDataURL("image/png").split(",")[1];
}

// admins, on Settings: redraw and store the icons if the people's colours changed since last time
async function syncAppIcon(people, storedKey) {
  const colors = people.filter((p) => p.active !== 0 && p.grid_column !== 0 && p.type !== "group").map((p) => p.color).filter(Boolean);
  const key = colors.join(",") || "default";
  if (key === storedKey) return;
  const use = colors.length ? colors : APP_ICON_DEFAULT;
  const icons = {
    "icon-192.png": await appIconPng(appIconSvg(use, { size: 192 }), 192),
    "icon-512.png": await appIconPng(appIconSvg(use, { size: 512 }), 512),
    "icon-maskable.png": await appIconPng(appIconSvg(use, { size: 512, pad: 14, round: false }), 512),
    "apple-touch-icon.png": await appIconPng(appIconSvg(use, { size: 180, round: false }), 180),
  };
  await api("PUT", "setup/icon", { key, icons });
}
