// Builds the "week ahead" email from the calendar data. Pure functions (no Cloudflare APIs) so it can be
// previewed locally: node mail/preview.mjs
// The ⚠ rules are public/rules.js - the same file the site uses.

import { page, warnBox, noteBox, tag, dayBlock, esc } from "./layout.js";
import "../../public/rules.js";

const clashRules = globalThis.CalendarRules;

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s) => new Date(s + "T00:00:00Z");
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const nice = (s) => { const d = parse(s); return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const short = (s) => { const d = parse(s); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const whoList = (w) => String(w || "").split(",").map((x) => x.trim()).filter(Boolean);

// Monday..Sunday of the week after `now` (sent on Sunday evening, so this is "next week")
export function weekAfter(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const toMon = (8 - d.getUTCDay()) % 7 || 7;
  const mon = addDays(d, toMon);
  return { from: iso(mon), to: iso(addDays(mon, 6)) };
}

// "Needs sorting": the shared rules (public/rules.js); warnings marked "OK, noted" on the site are left out
const clashRuns = (data, from, to) => clashRules.clashRuns(data, from, to);

// 🔒 Info items whose expiry date is within 30 days of the day the email goes out (or already past)
const VAULT_ICON = { Vehicles: "🚗", Documents: "🪪", "Firearm licences": "🎯", Insurance: "🛡️", Medical: "🩺" };
export function expiringSoon(data, from, sentOn = iso(addDays(parse(from), -1))) {
  const sunday = sentOn, until = iso(addDays(parse(sunday), 30));
  return (data.expiring || []).filter((x) => x.expires_on <= until).sort((a, b) => a.expires_on.localeCompare(b.expires_on)).map((x) => {
    const n = Math.round((parse(x.expires_on) - parse(sunday)) / 864e5);
    const when = n < 0 ? `expired ${short(x.expires_on)}` : n === 0 ? "expires today" : `${nice(x.expires_on)} (${n} day${n === 1 ? "" : "s"})`;
    return `${VAULT_ICON[x.section] || "📌"} ${x.expiry_label}: ${when}`;
  });
}

// data.brand = lib/settings.js brand() (names); site = the calendar's web address
// opts.sentOn = the day it goes out (default: the day before `from`), opts.when = e.g. "every Sunday at 18:00"
export function buildDigest(data, from, to, site, opts = {}) {
  const label = data.brand?.full || "Family Calendar";
  const expiring = expiringSoon(data, from, opts.sentOn), LOC = clashRules.places(data);
  const color = Object.fromEntries(data.people.map((p) => [p.name, p.color]));
  const days = [];
  for (let d = parse(from); iso(d) <= to; d = addDays(d, 1)) {
    const key = iso(d);
    const ph = data.publicHolidays.find((h) => h.date === key)?.name;
    const breaks = data.schoolHolidays.filter((h) => h.start === key || (key === from && h.start < key && h.end >= key));
    const backs = data.schoolHolidays.filter((h) => iso(addDays(parse(h.end), 1)) === key);
    const bdays = data.recurring.filter((r) => r.month === d.getUTCMonth() + 1 && r.day === d.getUTCDate()).map((r) => {
      const age = r.born ? d.getUTCFullYear() - r.born : null;
      return { text: clashRules.recText(r, age), type: r.type };
    });
    // trips show on their first day (or Monday if they started earlier), with the end date
    const evs = data.events.filter((e) => e.status !== "Cancelled" && (e.start === key || (key === from && e.start < key && e.end >= key)))
      .sort((a, b) => b.important - a.important);
    days.push({ key, ph, breaks, backs, bdays, evs });
  }
  const runs = clashRuns(data, from, to);
  // 🌴 who's on leave at some point that week
  const leave = data.events.filter((e) => e.category === "Leave" && e.status !== "Cancelled" && e.start <= to && e.end >= from)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((e) => ({ who: whoList(e.who).join(" & "), when: e.start <= from ? `until ${nice(e.end)}` : `${nice(e.start)} – ${nice(e.end)}` }));

  const line = (e) => {
    const who = whoList(e.who);
    const loc = e.location && LOC[e.location] ? LOC[e.location].icon + " " : "";
    const range = e.end !== e.start ? ` (${e.start < from ? "since " + short(e.start) + ", " : ""}to ${short(e.end)})` : "";
    return { text: `${e.important ? "⭐ " : ""}${who.join(" & ")}: ${loc}${e.title}${e.status === "Tentative" ? " (not confirmed)" : ""}${range}`,
             html: `<span style="color:${color[who[0]] || "#495057"};font-weight:700">${esc(who.join(" & "))}</span> ${loc}${esc(e.title)}`
               + `${e.status === "Tentative" ? ' <i style="color:#868e96">(not confirmed)</i>' : ""}<span style="color:#868e96">${esc(range)}</span>`,
             important: !!e.important };
  };

  // ---- plain text
  let text = `The week ahead: ${short(from)} – ${short(to)}\n\n`;
  if (runs.length) {
    text += "⚠ NEEDS SORTING\n" + runs.map((r) => `- ${r.start === r.end ? nice(r.start) : short(r.start) + " – " + short(r.end)}: ${r.msg}`).join("\n") + "\n\n";
  }
  if (expiring.length) text += "⏳ RENEW SOON\n" + expiring.map((x) => `- ${x}`).join("\n") + "\n\n";
  if (leave.length) text += "🌴 ON LEAVE\n" + leave.map((l) => `- ${l.who}: ${l.when}`).join("\n") + "\n\n";
  for (const d of days) {
    const rows = [
      ...(d.ph ? [`🇿🇦 ${d.ph}`] : []),
      ...d.breaks.map((h) => `🌿 ${h.child}: ${h.name} starts (to ${short(h.end)})`),
      ...d.backs.map((h) => `🎒 ${h.child} back at school`),
      ...d.bdays.map((b) => b.text), ...d.evs.map((e) => line(e).text)];
    text += `${nice(d.key).toUpperCase()}\n${rows.length ? rows.map((r) => "  " + r).join("\n") : "  –"}\n\n`;
  }
  text += `Open the calendar: ${site}\n`;

  // ---- html (Outlook-safe tables, see layout.js)
  const tags = (who) => whoList(who).map((p) => tag(p, color[p] || "#495057")).join(" ");
  const grey = (s) => `<span style="color:#868e96">${esc(s)}</span>`;
  let body = runs.length ? warnBox("Needs sorting", runs.map((r) =>
    `<b>${r.start === r.end ? nice(r.start) : short(r.start) + " – " + short(r.end)}</b> · ${esc(r.msg)}`)) : "";
  if (expiring.length) body += warnBox("Renew soon", expiring.map(esc));
  if (leave.length) body += noteBox("🌴 On leave", leave.map((l) => `<b>${esc(l.who)}</b> · ${esc(l.when)}`));
  for (const d of days) {
    const wd = parse(d.key).getUTCDay();
    const rows = [
      ...(d.ph ? [{ who: tag("Public holiday", "#7048a8"), text: esc(d.ph) }] : []),
      ...d.breaks.map((h) => ({ who: tag(h.child, color[h.child] || "#495057"), text: `🌿 ${esc(h.name)} starts ${grey(`(to ${short(h.end)})`)}` })),
      ...d.backs.map((h) => ({ who: tag(h.child, color[h.child] || "#495057"), text: "🎒 Back at school" })),
      ...d.bdays.map((b) => ({ who: b.type === "Memorial" ? tag("In memory", "#868e96") : b.type === "Anniversary" ? tag("Anniversary", "#c2255c") : tag("Birthday", "#c2255c"),
        text: `<b>${esc(b.text)}</b>` })),
      ...d.evs.map((e) => {
        const loc = e.location && LOC[e.location] ? LOC[e.location].icon + " " : "";
        const range = e.end !== e.start ? ` (${e.start < from ? "since " + short(e.start) + ", " : ""}to ${short(e.end)})` : "";
        return { who: tags(e.who), important: !!e.important,
                 text: `${e.important ? "⭐ " : ""}${loc}${esc(e.title)}${e.status === "Tentative" ? " " + grey("(not confirmed)") : e.status === "Unavailable" ? " " + grey("(can't)") : ""}${range ? " " + grey(range.trim()) : ""}` };
      })];
    body += dayBlock(nice(d.key), wd === 0 || wd === 6, rows);
  }
  const html = page("The week ahead", `${short(from)} – ${short(to)}`, body, `Sent ${opts.when || "every Sunday evening"} by the ${label}.`, site, label);

  const subject = `Week ahead ${short(from)} – ${short(to)}${runs.length ? ` · ⚠ ${runs.length} to sort` : ""}${expiring.length ? ` · ⏳ ${expiring.length} to renew` : ""}`;
  return { subject, text, html };
}
