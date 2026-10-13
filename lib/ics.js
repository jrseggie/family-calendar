// iCalendar helpers shared by the invite email (functions/api) and the phone-calendar feed (functions/feed).
export const icsText = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
export function fold(line) {   // iCalendar lines max 75 octets
  const out = []; let cur = "", bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > 74) { out.push(cur); cur = " "; bytes = 1; }
    cur += ch; bytes += n;
  }
  return [...out, cur].join("\r\n");
}
export const ymd = (s) => s.replace(/-/g, "");
export const utcStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export const addDaysIso = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const split = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);


// The subscribed calendar (e.g. "Smith Family" in Outlook / iPhone): all-day entries, birthdays repeating yearly,
// school holidays. UIDs differ from the invite emails (<prefix>-event-<id>) so the two never merge.
// b = lib/settings.js brand(): feed name, web address, UID prefix and domain.
export function feedCalendar({ events, recurring, schoolHolidays, places = [] }, stamp = new Date(), b = { feed: "Family Calendar", full: "Family Calendar", url: "", host: "calendar", uid: "cal" }) {
  const LOC_ICON = Object.fromEntries(places.map((p) => [p.key, p.icon]));
  const dt = utcStamp(stamp);
  const ev = (uid, start, end, summary, extra = []) => ["BEGIN:VEVENT", `UID:${uid}@${b.host || "calendar"}`, `DTSTAMP:${dt}`,
    `DTSTART;VALUE=DATE:${ymd(start)}`, `DTEND;VALUE=DATE:${ymd(addDaysIso(end, 1))}`, `SUMMARY:${icsText(summary)}`,
    "TRANSP:TRANSPARENT", ...extra, "END:VEVENT"];
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${b.full}//Feed//EN`, "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(b.feed)}`, `X-WR-TIMEZONE:${b.tz || "Africa/Johannesburg"}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const e of events) {
    if (e.status === "Cancelled") continue;
    const who = split(e.who).filter((p) => p !== "Family");
    const flag = e.status === "Tentative" ? " (?)" : e.status === "Unavailable" ? " (can't)" : "";
    const summary = `${e.important ? "⭐ " : ""}${LOC_ICON[e.location] ? LOC_ICON[e.location] + " " : ""}${e.title}${flag}${who.length ? ` – ${who.join(", ")}` : ""}`;
    const desc = [`Who: ${e.who}`, e.category ? `Category: ${e.category}` : "", e.notes ? `Notes: ${e.notes}` : "", b.url].filter(Boolean).join("\n");
    lines.push(...ev(`${b.uid}-feed-${e.id}`, e.start, e.end, summary, [`DESCRIPTION:${icsText(desc)}`,
      `STATUS:${e.status === "Tentative" ? "TENTATIVE" : "CONFIRMED"}`, ...(e.category ? [`CATEGORIES:${icsText(e.category)}`] : [])]));
  }
  for (const r of recurring) {
    const y = r.born && r.born > 1900 ? r.born : 2020;
    const start = `${y}-${String(r.month).padStart(2, "0")}-${String(r.day).padStart(2, "0")}`;
    const name = r.type === "Anniversary" ? `💍 ${r.name} anniversary` : r.type === "Memorial" ? `🕊️ ${r.name} – in memory` : `🎂 ${r.name}'s birthday`;
    lines.push(...ev(`${b.uid}-feed-rec-${r.id}`, start, start, name, ["RRULE:FREQ=YEARLY"]));
  }
  for (const h of schoolHolidays) lines.push(...ev(`${b.uid}-feed-sch-${h.id}`, h.start, h.end, `🌿 ${h.child}: ${h.name}`));
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
