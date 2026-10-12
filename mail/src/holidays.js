// South African public holidays for any year (Public Holidays Act 36 of 1994): fixed dates, Good Friday and
// Family Day from Easter, and a holiday that falls on a Sunday moves to the Monday ("observed").
// Used by the site API and the Sunday email; one-off days (elections, special days the President declares) are
// added to the public_holidays table and win over these.
const FIXED = [
  [1, 1, "New Year's Day"], [3, 21, "Human Rights Day"], [4, 27, "Freedom Day"], [5, 1, "Workers' Day"],
  [6, 16, "Youth Day"], [8, 9, "National Women's Day"], [9, 24, "Heritage Day"], [12, 16, "Day of Reconciliation"],
  [12, 25, "Christmas Day"], [12, 26, "Day of Goodwill"],
];
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function easter(y) {   // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

export function saHolidays(year) {
  const e = easter(year), add = (d, n) => new Date(d.getTime() + n * 864e5);
  const list = FIXED.map(([m, d, name]) => ({ date: iso(new Date(Date.UTC(year, m - 1, d))), name }));
  list.push({ date: iso(add(e, -2)), name: "Good Friday" }, { date: iso(add(e, 1)), name: "Family Day" });
  const taken = new Set(list.map((h) => h.date));
  for (const h of [...list]) {
    if (new Date(h.date + "T00:00:00Z").getUTCDay() !== 0) continue;
    let d = add(new Date(h.date + "T00:00:00Z"), 1);
    while (taken.has(iso(d))) d = add(d, 1);   // e.g. Christmas on a Sunday: Monday is already Day of Goodwill
    taken.add(iso(d));
    list.push({ date: iso(d), name: `${h.name} (observed)` });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

// the built-in holidays for a few years around now, with the table's extra/override days on top
export function publicHolidays(tableRows, now = new Date()) {
  const y = now.getUTCFullYear(), byDate = new Map();
  for (let year = y - 1; year <= y + 3; year++) for (const h of saHolidays(year)) byDate.set(h.date, h);
  for (const h of tableRows) byDate.set(h.date, { date: h.date, name: h.name });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
