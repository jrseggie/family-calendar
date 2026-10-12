// When the weekly "week ahead" email goes out (Setup > Weekly email > day and time), in the family's own time zone.
// The 10-minute job asks digestDue() every run; the email covers the 7 days from tomorrow when it's sent in the
// afternoon/evening (e.g. Sunday 18:00 -> Mon-Sun) and from today when it's sent in the morning (e.g. Monday 07:00 -> Mon-Sun).
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DEFAULT_TZ = "Africa/Johannesburg";

const validTz = (tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };

// from the settings table (digest_day 0-6 = Sunday-Saturday, digest_hour 0-23, timezone); Sunday 18:00 South Africa by default
export function digestSchedule(s = {}) {
  const day = /^[0-6]$/.test(String(s.digest_day ?? "")) ? +s.digest_day : 0;
  const hour = /^([0-9]|1[0-9]|2[0-3])$/.test(String(s.digest_hour ?? "")) ? +s.digest_hour : 18;
  const tz = s.timezone && validTz(s.timezone) ? s.timezone : DEFAULT_TZ;
  return { day, hour, tz, label: `${DAYS[day]}s ${String(hour).padStart(2, "0")}:00` };
}

// the date, weekday and hour at `date` in time zone `tz`
export function localParts(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), hour: +p.hour };
}

const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// is it the chosen day and hour there, and hasn't it gone out today already? (the job runs every 10 minutes)
export function digestDue(now, sched, lastSentAt) {
  const here = localParts(now, sched.tz);
  if (here.weekday !== sched.day || here.hour !== sched.hour) return false;
  return !lastSentAt || localParts(new Date(lastSentAt), sched.tz).date !== here.date;
}

// the 7 days the email covers, and the day it's sent on (for "expires in N days")
export function digestRange(now, sched) {
  const sentOn = localParts(now, sched.tz).date, from = sched.hour >= 12 ? addDays(sentOn, 1) : sentOn;
  return { sentOn, from, to: addDays(from, 6) };
}
