// Dates for a repeating entry (event form "Repeat"). Pure, so tests/ can check it. Returns [[start, end], ...] or { error }.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDaysIso = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// "Repeat" on a new entry: { every: "week" | "2weeks" | "month", until: "YYYY-MM-DD", days?: [0-6] } -> [[start, end], ...]
// Weekly / every 2 weeks: on the ticked weekdays (0 = Sun … 6 = Sat; default the start's weekday), counting weeks from
// the week of the start date. Monthly: same day of the month (skips months without it, e.g. the 31st).
export const REPEAT_MAX = 104;
export function repeatDates(start, end, rep) {
  if (!rep || !["week", "2weeks", "month"].includes(rep.every)) return [[start, end]];
  if (!DATE.test(rep.until || "") || rep.until < start) return { error: "Pick the date the repeats stop" };
  const len = Math.round((new Date(end + "T00:00:00Z") - new Date(start + "T00:00:00Z")) / 864e5);
  const s0 = new Date(start + "T00:00:00Z"), out = [];
  if (rep.every === "month") {
    for (let i = 0; out.length <= REPEAT_MAX; i++) {
      const d = new Date(Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth() + i, s0.getUTCDate()));
      if (d.getUTCDate() !== s0.getUTCDate()) continue;
      const s = d.toISOString().slice(0, 10);
      if (s > rep.until) break;
      out.push([s, addDaysIso(s, len)]);
    }
  } else {
    const days = [...new Set((Array.isArray(rep.days) && rep.days.length ? rep.days : [s0.getUTCDay()]).map(Number))].filter((d) => d >= 0 && d <= 6);
    if (!days.length) return { error: "Tick at least one day" };
    const monday = s0.getTime() - ((s0.getUTCDay() + 6) % 7) * 864e5;   // weeks counted Monday to Sunday
    for (let t = s0.getTime(); out.length <= REPEAT_MAX; t += 864e5) {
      const s = new Date(t).toISOString().slice(0, 10);
      if (s > rep.until) break;
      const week = Math.floor((t - monday) / (7 * 864e5));
      if (days.includes(new Date(t).getUTCDay()) && (rep.every === "week" || week % 2 === 0)) out.push([s, addDaysIso(s, len)]);
    }
  }
  if (out.length > REPEAT_MAX) return { error: `That's more than ${REPEAT_MAX} repeats – pick an earlier end date` };
  return out;
}
