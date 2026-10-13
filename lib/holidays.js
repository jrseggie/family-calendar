// Public holidays for the calendar's country (Setup > This calendar), from the date-holidays library (~200 countries and
// their states/provinces; holiday data © date-holidays contributors, CC BY 3.0). The main country's holidays shade the
// calendar and count as "no school" in the ⚠ rules; extra countries are shown for information only (main: false).
// One-off days in the public_holidays table (e.g. an election day) are added to the main country and win over it.
import Holidays from "date-holidays";

export const DEFAULT_COUNTRY = "ZA";
export const flagOf = (cc) => String(cc || "").toUpperCase().replace(/[A-Z]/g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
const split = (v) => String(v || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);

let COUNTRIES = null;
// [{ code, name, timezones }] for the Setup / wizard pick-lists
export function countryList() {
  if (!COUNTRIES) {
    const names = new Holidays().getCountries("en") || {};
    COUNTRIES = Object.entries(names).map(([code, name]) => ({ code, name, timezones: new Holidays(code).getTimezones() || [] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return COUNTRIES;
}
export const validCountry = (cc) => countryList().some((c) => c.code === cc);
// states / provinces whose holidays differ ({ code: name }), or {} if the country has none
export const regionsOf = (cc) => (validCountry(cc) && new Holidays().getStates(cc, "en")) || {};

// the calendar's countries from the settings: { country, region, extras }
export function calendarCountries(s = {}) {
  const country = validCountry(String(s.country || "").toUpperCase()) ? String(s.country).toUpperCase() : DEFAULT_COUNTRY;
  const region = s.region && regionsOf(country)[s.region] ? s.region : null;
  return { country, region, extras: split(s.extra_countries).filter((c) => c !== country && validCountry(c)) };
}

// one country's public holidays for years from..to as [{ date, name }]; a holiday moved off a Sunday is named "<holiday> (observed)"
function holidaysOf(cc, region, from, to) {
  const hd = region ? new Holidays(cc, region) : new Holidays(cc), out = [];
  for (let year = from; year <= to; year++) {
    const list = (hd.getHolidays(year, "en") || []).filter((h) => h.type === "public");
    for (const h of list) {
      const date = h.date.slice(0, 10), moved = /substitutes (\d{2}-\d{2})/.exec(h.rule || "")?.[1];
      const orig = moved && list.find((x) => x.date.slice(5, 10) === moved && x !== h);
      out.push({ date, name: orig && (!h.name || /^public holiday$/i.test(h.name)) ? `${orig.name} (observed)` : h.name });
    }
    // South Africa: a Sunday holiday whose Monday is already a holiday (Christmas on a Sunday) moves to the next free day -
    // declared that way every time (e.g. Tue 27 Dec 2022); the library doesn't know it
    if (cc === "ZA") {
      const taken = new Set(out.map((h) => h.date)), day = (d) => new Date(d + "T00:00:00Z"), next = (d) => new Date(day(d).getTime() + 864e5).toISOString().slice(0, 10);
      for (const h of out.filter((x) => x.date.startsWith(String(year)) && day(x.date).getUTCDay() === 0 && !/\(observed\)/.test(x.name))) {
        if (!taken.has(next(h.date)) || out.some((x) => x.name === `${h.name} (observed)`)) continue;
        let d = next(h.date);
        while (taken.has(d)) d = next(d);
        taken.add(d); out.push({ date: d, name: `${h.name} (observed)` });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// everything the site / emails show, a few years around now: [{ date, name, flag, country, main }]
export function publicHolidays(settings = {}, tableRows = [], now = new Date()) {
  const { country, region, extras } = calendarCountries(settings), y = now.getUTCFullYear(), byDate = new Map(), out = [];
  for (const h of holidaysOf(country, region, y - 1, y + 3)) {
    const was = byDate.get(h.date);   // two on one day: "A / B"
    byDate.set(h.date, { date: h.date, name: was && was.name !== h.name ? `${was.name} / ${h.name}` : h.name, flag: flagOf(country), country, main: true });
  }
  for (const r of tableRows) byDate.set(r.date, { date: r.date, name: r.name, flag: flagOf(country), country, main: true });
  for (const cc of extras) for (const h of holidaysOf(cc, null, y - 1, y + 3)) out.push({ ...h, flag: flagOf(cc), country: cc, main: false });
  return [...byDate.values(), ...out].sort((a, b) => a.date.localeCompare(b.date) || (b.main - a.main));
}
