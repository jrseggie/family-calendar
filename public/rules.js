// The ⚠ rules, shared by the site (public/grid.js), the Sunday email (mail/src/digest.js) and the tests (tests/).
// Plain script: in the browser it is loaded before grid.js; the worker and tests `import "../public/rules.js"`.
// Everything works on a data object { events, people, places, schoolHolidays, publicHolidays: [{date, name, flag?, main?}], acks? }
// and ISO day keys ("2026-10-14"); dates are handled in UTC so the browser and the worker agree.
// Nothing here knows the family: who the children are, who boards, where people usually sleep and which places
// are houses all come from the Settings tab (people.child / boards / home, the places table).
(function () {
  // a new family's starting places (also used when the database has none yet); they rename them in the setup wizard
  // or on Settings > Places. The keys never change, so renaming keeps every entry pointing at the right place.
  const DEFAULT_PLACES = [
    { key: "home", label: "Primary house", short: "Home", icon: "🏠", kind: "home" },
    { key: "home2", label: "Secondary house", short: "House 2", icon: "🏡", kind: "home" },
    { key: "school", label: "School (boarding)", short: "School", icon: "🏫", kind: "school" },
    { key: "friend", label: "Friend's house", short: "Friend", icon: "🛏️", kind: "friend" },
    { key: "other", label: "Away", short: "Away", icon: "✈️", kind: "away" },
  ];
  const placeList = (data) => [...(data.places?.length ? data.places : DEFAULT_PLACES)].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  // key -> { icon, label, short, kind } (hidden places too, so old entries still show their icon)
  const places = (data) => Object.fromEntries(placeList(data).map((p) => [p.key, p]));
  const homePlaces = (data) => placeList(data).filter((p) => p.kind === "home").map((p) => p.key);
  const schoolPlace = (data) => placeList(data).find((p) => p.kind === "school")?.key || "school";
  const whoList = (w) => String(w || "").split(",").map((x) => x.trim()).filter(Boolean);
  // people ticked "Part of the family" on Settings; "Family" in an entry's Who means all of them
  const familyMembers = (data) => data.people.filter((p) => p.family && p.active !== 0).map((p) => p.name);
  const expandWho = (data, w) => [...new Set(whoList(w).flatMap((p) => p === "Family" ? ["Family", ...familyMembers(data)] : [p]))];
  const parse = (s) => new Date(s + "T00:00:00Z");
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => iso(new Date(parse(s).getTime() + n * 864e5));
  const on = (e, key) => e.start <= key && e.end >= key;

  // people who sleep somewhere: the household and helpers (au pair, nanny, house-sitter - no usual place, count as adults)
  const householdPeople = (data) => data.people.filter((p) => ["household", "helper"].includes(p.type) && p.active !== 0);
  const helpers = (data) => data.people.filter((p) => p.type === "helper" && p.active !== 0).map((p) => p.name);
  // 🌴 a "Leave" entry (e.g. the gardener's annual leave): the entry if `name` is on leave on `key`
  const onLeave = (data, name, key) => data.events.find((e) => e.category === "Leave" && e.status !== "Cancelled" && on(e, key) && expandWho(data, e.who).includes(name));
  // the helpers who could stay over / house-sit on `key` (not on leave)
  const helpersFree = (data, key) => helpers(data).filter((h) => !onLeave(data, h, key));
  const kids = (data) => householdPeople(data).filter((p) => p.child).map((p) => p.name);
  const adults = (data) => householdPeople(data).filter((p) => !p.child).map((p) => p.name);
  const tracked = (data) => data.people.filter((p) => p.type === "tracked").map((p) => p.name);
  const personOf = (data, name) => data.people.find((p) => p.name === name) || {};
  // the house a child normally lives at (for "X staying with Y" entries); falls back to the first house
  const homeOf = (data, name) => { const h = personOf(data, name).home; return h && homePlaces(data).includes(h) ? h : homePlaces(data)[0] || null; };
  const holidayOf = (data, child, key) => data.schoolHolidays.find((h) => h.child === child && on(h, key));
  const publicHoliday = (data, key) => data.publicHolidays.find((h) => h.date === key && h.main !== false)?.name || null;   // extra countries: information only

  // a "Study" entry (exam study day at home) also means no school run. Only children with a school (Settings > People) have
  // school days - a toddler is never "at home on a school day"
  function isSchoolDay(data, child, key) {
    if (!String(personOf(data, child).school || "").trim()) return false;
    const wd = parse(key).getUTCDay();
    const study = data.events.some((e) => e.category === "Study" && on(e, key) && expandWho(data, e.who).includes(child));
    return wd !== 0 && wd !== 6 && !publicHoliday(data, key) && !holidayOf(data, child, key) && !study;
  }

  // where each household person sleeps on `key`: { loc: <place key>|unknown|conflict|null,
  //   set: [{loc, ev}], tentative: only Tentative entries put them there, explicit: from an entry }
  // Without an entry: boarders are at school in term and "unknown" (❓) in their holidays; everyone else at their
  // usual place (people.home), or nowhere (null) if none is set.
  function whereOn(data, key) {
    const where = {};
    for (const person of householdPeople(data)) {
      const p = person.name;
      // a helper on leave isn't at any house, whatever else says so (clashesFor flags a stay booked during their leave)
      if (person.type === "helper" && onLeave(data, p, key)) { where[p] = { loc: null, set: [], explicit: false, tentative: false, leave: true }; continue; }
      const all = data.events.filter((e) => e.location && !["Cancelled", "Unavailable"].includes(e.status) && on(e, key) && expandWho(data, e.who).includes(p));
      // a firm plan wins over a pencilled-in one (that only gives an "If … goes ahead" note, maybesFor)
      const firm = all.filter((e) => !pencilled(data, e)), evs = firm.length ? firm : all;
      const set = [];
      for (const e of evs) if (!set.some((x) => x.loc === e.location)) set.push({ loc: e.location, ev: e });
      if (set.length) { where[p] = { loc: set.length === 1 ? set[0].loc : "conflict", set, explicit: true, tentative: evs.every((e) => e.status === "Tentative") }; continue; }
      const loc = person.child && person.boards ? (holidayOf(data, p, key) ? "unknown" : schoolPlace(data)) : person.home || null;
      where[p] = { loc, set: [], explicit: false, tentative: false };
    }
    return where;
  }

  // ✏️ pencilled in (might not happen): a Tentative entry - except a helper's requested stay ("asked, not confirmed")
  const pencilled = (data, e) => e.status === "Tentative" && !(e.location && whoList(e.who).some((p) => helpers(data).includes(p)));
  const pencilsOn = (data, key) => data.events.filter((e) => on(e, key) && pencilled(data, e));
  const plainTitle = (t) => String(t || "").replace(/\s*\?+\s*$/, "");
  // ⚠ things to sort on `key` - pencilled-in entries left out (they only give "If … goes ahead" notes, maybesFor)
  function clashesFor(data, key) {
    const pen = pencilsOn(data, key);
    return baseClashes(pen.length ? { ...data, events: data.events.filter((e) => !pen.includes(e)) } : data, key);
  }
  // ❔ what WOULD need sorting if a pencilled-in entry goes ahead: "If Beach trip goes ahead: Emma is at the … with no adult there"
  function maybesFor(data, key) {
    const pen = pencilsOn(data, key);
    if (!pen.length) return [];
    const without = { ...data, events: data.events.filter((e) => !pen.includes(e)) }, now = new Set(baseClashes(without, key)), out = [];
    for (const e of pen) for (const m of baseClashes({ ...without, events: [...without.events, { ...e, status: "Confirmed" }] }, key)) {
      if (!now.has(m)) out.push(`If ${plainTitle(e.title)} goes ahead: ${m}`);
    }
    return [...new Set(out)];
  }
  // pencilled-in entries starting within `days` days of `today`: "still pencilled in – on or not?"
  const pencilNudges = (data, today, days = 14) => data.events.filter((e) => pencilled(data, e) && e.start >= today && e.start <= addDays(today, days))
    .sort((a, b) => a.start.localeCompare(b.start));
  // ---- 🖨️ the schedule printed for a "tracked" person (e.g. a co-parent, or their lawyer): only the children they share and
  // only what's theirs to know. Never in it: where anyone sleeps, the ⚠ rules, other people's plans and their details.
  // events.share per entry: "show" (the title) | "busy" ("Not available") | "hide" (left off) | null = automatic (shareMode).
  const SHARE_SAYS = { School: "School", Exam: "Exams", Study: "Exams" };
  // the children in the tracked person's entries (all the children if none yet)
  const sharedKids = (data, person) => {
    const theirs = kids(data).filter((k) => data.events.some((e) => { const w = expandWho(data, e.who); return w.includes(person) && w.includes(k); }));
    return theirs.length ? theirs : kids(data);
  };
  // the title mentions the person by name (a whole word, any case)
  const names = (title, person) => String(title || "").toLowerCase().split(/[^\p{L}\p{N}'-]+/u).includes(String(person).toLowerCase());
  // what the printout shows for entry `e`: { mode: show | label | busy | hide, auto: the automatic mode, text }
  //   automatic: their own plans in full (pencilled in = "(not confirmed)"), also the child's entries that name them
  //   ("… – Mark meets her there"); School / Exam / Study = "School" / "Exams";
  //   the child's own Social / Activity (nobody but the shared children on it) = the title; anything else = "Not available";
  //   left off: cancelled, a helper's stay (= where they sleep), lifts (Transport), leave, "nobody needed at the house"
  function shareMode(data, e, person, kidList) {
    const who = expandWho(data, e.who), theirs = who.includes(person), pen = e.status === "Tentative";
    let auto = "busy";
    if (["Cancelled", "Unavailable"].includes(e.status) || e.house_off || ["Transport", "Leave"].includes(e.category) ||
        (e.location && who.some((p) => helpers(data).includes(p)))) auto = "hide";
    else if (theirs || names(e.title, person)) auto = "show";
    else if (pen) auto = "busy";
    else if (SHARE_SAYS[e.category]) auto = "label";
    else if (["Social", "Activity"].includes(e.category) && who.every((p) => kidList.includes(p))) auto = "show";
    const mode = ["show", "busy", "hide"].includes(e.share) ? e.share : auto;
    const text = mode === "show" ? plainTitle(e.title) + (theirs && pen ? " (not confirmed)" : "") : mode === "label" ? SHARE_SAYS[e.category] : mode === "busy" ? "Not available" : "";
    return { mode, auto, text };
  }
  // the days from..to: { kids, days: [{ key, ph, cells: [{ items: [{ ev, mode, auto, text }], bday, base }] }] }
  //   base (when nothing else is on): "School holiday" / "School" on a school day (boarders too - never where they sleep)
  function sharedDays(data, person, from, to) {
    const kidList = sharedKids(data, person), days = [];
    for (let key = from; key <= to; key = addDays(key, 1)) {
      const md = key.slice(5);
      const cells = kidList.map((k) => {
        const items = [], seen = new Set();
        const todays = data.events.filter((e) => on(e, key) && expandWho(data, e.who).includes(k));
        // a day the child is with them (a confirmed plan of theirs): the child's own entries in full - they need to know
        const withThem = todays.some((e) => expandWho(data, e.who).includes(person) && e.status === "Confirmed");
        for (const e of todays) {
          const s = shareMode(data, e, person, kidList);
          if (withThem && !e.share && ["busy", "label"].includes(s.auto) && expandWho(data, e.who).every((p) => p === person || kidList.includes(p)))
            Object.assign(s, { mode: "show", auto: "show", text: plainTitle(e.title) + (e.status === "Tentative" ? " (not confirmed)" : "") });
          if (s.mode === "hide" && e.share !== "hide") continue;   // automatic "left off" isn't listed; one set by hand is (so it can be undone)
          const dupe = s.mode !== "hide" && seen.has(s.text);   // one "Not available" / "Exams" per day
          if (s.mode !== "hide") seen.add(s.text);
          items.push({ ev: e, ...s, dupe });
        }
        const bday = (data.recurring || []).some((r) => (r.type || "Birthday") === "Birthday" && r.name === k && `${String(r.month).padStart(2, "0")}-${String(r.day).padStart(2, "0")}` === md);
        const hol = holidayOf(data, k, key);
        const base = hol ? "School holiday" : isSchoolDay(data, k, key) ? "School" : "";   // weekends: nothing unless an entry says (a boarder may be out)
        return { items, bday, base };
      });
      days.push({ key, ph: publicHoliday(data, key), cells });
    }
    return { kids: kidList, days };
  }

  // ✅ confirmed in the last 3 days (shows next to the title, then drops off)
  const justConfirmed = (e, now = new Date()) => !!e.confirmed_at && e.status !== "Tentative" && now.getTime() - Date.parse(e.confirmed_at) < 3 * 864e5;

  function baseClashes(data, key) {
    const where = whereOn(data, key), grown = adults(data), children = kids(data), LOC = places(data), out = [];
    const at = (house) => Object.keys(where).filter((p) => where[p].loc === house);
    for (const house of homePlaces(data)) {
      const grownUps = at(house).filter((p) => grown.includes(p));
      const confirmed = grownUps.filter((p) => !where[p].tentative);
      for (const k of at(house).filter((p) => children.includes(p))) {
        if (!grownUps.length) {
          const cant = [...new Set(data.events.filter((e) => e.status === "Unavailable" && on(e, key) && expandWho(data, e.who).includes(k))
            .flatMap((e) => whoList(e.who).filter((p) => grown.includes(p))))];
          // a "Transport" entry (e.g. 🚕 Uber to school) means the school run is sorted
          const ride = data.events.some((e) => e.category === "Transport" && on(e, key) && expandWho(data, e.who).includes(k));
          out.push(`${k} is at the ${LOC[house].label} with no adult there${cant.length ? ` – ${cant.join(" & ")} can't stay` : ""}` +
            `${isSchoolDay(data, k, key) ? (ride ? " – 🚕 school lift booked" : " – it's a school day (lifts!)") : ""}`);
        } else if (!confirmed.length) {   // only a requested (Tentative) stay, e.g. a helper asked but not confirmed
          out.push(`${grownUps.join(" & ")} asked to stay with ${k} – not confirmed yet`);
        }
      }
    }
    // houses that need someone sleeping there (Settings > Places "needs", e.g. the dogs) - unless marked "not required"
    for (const pl of placeList(data).filter((x) => x.kind === "home" && x.needs && x.active !== 0)) {
      if (data.events.some((e) => e.house_off === pl.key && e.status !== "Cancelled" && on(e, key))) continue;
      const there = at(pl.key);
      if (!there.length) {
        const cant = [...new Set(data.events.filter((e) => e.status === "Unavailable" && e.location === pl.key && on(e, key)).flatMap((e) => whoList(e.who)))];
        out.push(`Nobody is staying at the ${pl.label} (${pl.needs})${cant.length ? ` – ${cant.join(" & ")} can't stay` : ""}`);
      } else if (there.every((p) => where[p].tentative)) {
        out.push(`${there.join(" & ")} asked to stay at the ${pl.label} – not confirmed yet`);
      }
    }
    for (const p in where) if (where[p].leave) {
      const stay = data.events.find((e) => e.location && !["Cancelled", "Unavailable"].includes(e.status) && on(e, key) && expandWho(data, e.who).includes(p));
      if (stay) out.push(`${p} is on leave but down to stay at the ${LOC[stay.location]?.label || stay.location}`);
    }
    for (const p in where) if (where[p].loc === "conflict") out.push(`${p} is down for two places: ${where[p].set.map((s) => LOC[s.loc]?.label || s.loc).join(" and ")}`);
    // "tracked" people (e.g. an ex-partner's visits): their plans shouldn't fall on a child's school day
    const visitors = tracked(data);
    for (const e of data.events) {
      const who = whoList(e.who), visitor = who.find((p) => visitors.includes(p));
      if (e.status === "Cancelled" || !on(e, key) || !visitor) continue;
      const onSchool = children.filter((c) => who.includes(c) && isSchoolDay(data, c, key));
      if (onSchool.length) out.push(`${visitor}'s plan "${e.title}" is on a school day for ${onSchool.join(" and ")}`);
    }
    for (const p of children) if (where[p]?.loc === "unknown") out.push(`${p} is on holiday – where they're staying isn't set yet`);
    return [...new Set(out)];
  }

  // houses that need someone on `key` and have nobody confirmed there (for the house-sitting buttons)
  function houseNeeds(data, key) {
    const where = whereOn(data, key);
    return placeList(data).filter((pl) => pl.kind === "home" && pl.needs && pl.active !== 0
      && !data.events.some((e) => e.house_off === pl.key && e.status !== "Cancelled" && on(e, key))
      && !Object.keys(where).some((p) => where[p].loc === pl.key && !where[p].tentative)).map((pl) => pl.key);
  }

  const isAcked = (data, key, msg) => (data.acks || []).find((a) => a.day === key && a.msg === msg);
  // true if b follows a directly or with only Sat/Sun in between
  function onlyWeekendBetween(a, b) {
    for (let d = addDays(a, 1); d < b; d = addDays(d, 1)) if (parse(d).getUTCDay() % 6 !== 0) return false;
    return true;
  }
  // every ⚠ from..to as runs { msg, start, end, days, by }; the same warning on following days (weekends may sit in
  // between) is one run. acked=false: only warnings nobody marked "OK, noted"; true: only the noted ones.
  // maybe = true: the "If … goes ahead" notes (maybesFor) instead
  function clashRuns(data, from, to, acked = false, maybe = false) {
    const runs = [], open = {};
    for (let key = from; key <= to; key = addDays(key, 1)) {
      for (const msg of (maybe ? maybesFor : clashesFor)(data, key)) {
        const ack = isAcked(data, key, msg);
        if (!!ack !== acked) continue;
        const r = open[msg];
        if (r && onlyWeekendBetween(r.end, key)) { r.end = key; r.days.push(key); }
        else runs.push(open[msg] = { msg, start: key, end: key, days: [key], by: ack?.by_user || null });
      }
    }
    return runs.sort((a, b) => a.start.localeCompare(b.start));
  }

  // ---- yearly days (Birthdays tab): Birthday 🎂, Anniversary 💍, Memorial 🕊️ (the anniversary of someone's passing)
  const REC_ICON = { Birthday: "🎂", Anniversary: "💍", Memorial: "🕊️" };
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  // the small detail for `years` (that year minus the year entered; null if no year): "turns 17" / "5th anniversary" / "5 years"
  function recDetail(r, years) {
    if (r.type === "Anniversary") return years ? `${ordinal(years)} anniversary` : "anniversary";
    if (r.type === "Memorial") return years ? `${years} year${years === 1 ? "" : "s"}` : "in memory";
    return years ? `turns ${years}` : "birthday";
  }
  // one line, e.g. "🎂 Emma turns 17", "💍 Anna & Tom – 5th anniversary", "🕊️ Grandpa Joe – 5 years"
  function recText(r, years) {
    const icon = REC_ICON[r.type] || "🎂";
    if (r.type === "Anniversary" || r.type === "Memorial") return `${icon} ${r.name} – ${recDetail(r, years)}`;
    return `${icon} ${r.name}${years ? ` turns ${years}` : "'s birthday"}`;
  }

  // 🔒 Info expiry dates: a line labelled e.g. "Licence disc expires" / "Renewal date" whose value is a date
  // (2027-03-31, 31/03/2027, 3/31/2027, 31 March 2027, March 31 2027, March 2027 = end of that month) -> "2027-03-31".
  // a/b/yyyy is day first unless that can't be (9/30/2036 = 30 Sep); the Info form's date picker saves 2027-03-31.
  const EXPIRY_LABEL = /expir|renew|valid until|due/i;
  const MON3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function expiryDate(v) {
    const mon = (w) => MON3.indexOf(String(w).slice(0, 3).toLowerCase()) + 1;
    let m, y, mo, d;
    v = String(v || "");
    if ((m = v.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) [y, mo, d] = [+m[1], +m[2], +m[3]];
    else if ((m = v.match(/\b(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})\b/))) [d, mo, y] = +m[2] > 12 ? [+m[2], +m[1], +m[3]] : [+m[1], +m[2], +m[3]];
    else if ((m = v.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\.?,?\s+(\d{4})\b/i))) [d, mo, y] = [+m[1], mon(m[2]), +m[3]];
    else if ((m = v.match(/\b([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/i))) [mo, d, y] = [mon(m[1]), +m[2], +m[3]];
    else if ((m = v.match(/\b([a-z]{3,})\.?\s+(\d{4})\b/i))) [mo, y, d] = [mon(m[1]), +m[2], 0];
    else return null;
    if (!(mo >= 1 && mo <= 12)) return null;
    const dt = new Date(d === 0 ? Date.UTC(y, mo, 0) : Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return null;   // e.g. 31/02
    return dt.toISOString().slice(0, 10);
  }
  // the expiry lines of an Info item, soonest first: [{ k, date }] (lines ticked "hide" are left out)
  const expiries = (fields) => (fields || []).filter((f) => !f.hide && EXPIRY_LABEL.test(f.k || ""))
    .map((f) => ({ k: f.k, date: expiryDate(f.v) })).filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date));

  globalThis.CalendarRules = { EXPIRY_LABEL, expiryDate, expiries, REC_ICON, ordinal, recDetail, recText, places, placeList, homePlaces, schoolPlace, kids, adults, helpers, onLeave, helpersFree, tracked, homeOf, houseNeeds, whoList, familyMembers, expandWho, holidayOf, isSchoolDay, whereOn, clashesFor, clashRuns, isAcked, pencilled, maybesFor, pencilNudges, justConfirmed, plainTitle, sharedKids, shareMode, sharedDays };
})();
