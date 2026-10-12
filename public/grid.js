// Family grid: days down the side, a column per person (like the original Excel), Family entries in a strip
// across the day, location icons on the entries and ⚠ on the date when something clashes. Loaded after app.js and uses its helpers.

// the ⚠ rules live in rules.js (shared with the Sunday email and the tests); places and children come from Setup
const LOC = () => CalendarRules.places(state.data);
const KIDS = () => CalendarRules.kids(state.data);
const activePlaces = () => CalendarRules.placeList(state.data).filter((p) => p.active !== 0);
const homes = () => CalendarRules.homePlaces(state.data);
// the house a child is at on `key` if it's one of the houses, else their usual one (for "X staying with Y")
const stayPlace = (kid, key) => { const w = whereIndex(key, key)[key][kid]?.loc; return homes().includes(w) ? w : CalendarRules.homeOf(state.data, kid); };
// visitors tracked on the calendar (Setup type "Tracked", e.g. an ex-partner's plans with the kids)
const visitorOf = (e) => whoList(e.who).find((p) => CalendarRules.tracked(state.data).includes(p));
const DOW1 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// person columns (Family and anyone without a column go in the strip across the top of each day)
const allColumns = () => state.data.people.filter((p) => p.active && p.grid_column !== 0 && p.type !== "group").map((p) => p.name);
const gridColumns = () => {
  const cols = allColumns();
  if (!state.filter.size) return cols;
  const f = filterSet(), picked = cols.filter((c) => f.has(c));   // "Family" = all the family members' columns
  // only people without a column picked (e.g. a helper or a tracked person): keep the family columns - only their entries show in them
  return picked.length ? picked : cols.filter((c) => CalendarRules.familyMembers(state.data).includes(c));
};
const adults = () => CalendarRules.adults(state.data);
// "<helper> staying with <child>" entries: a helper and a kid sleeping at a house - show whether it's confirmed
// (also "<helper> house-sitting": a helper at a house on their own)
const isHelperStay = (e) => e.location && whoList(e.who).some((p) => helpers().includes(p));
const stayStatus = (e) => !isHelperStay(e) ? "" : e.status === "Tentative" ? ` <span class="stay req">⏳ requested</span>`
  : e.status === "Unavailable" ? ` <span class="stay no">🚫 can't stay</span>` : ` <span class="stay ok">✅ confirmed</span>`;
// Setup type "Helper": au pair / nanny / house-sitter who can stay over with the kids or look after a house
const helpers = () => CalendarRules.helpers(state.data);

const holidayOf = (child, key) => CalendarRules.holidayOf(state.data, child, key);
const isSchoolDay = (child, key) => CalendarRules.isSchoolDay(state.data, child, key);

// where each person sleeps on each day (rules.js whereOn), by day
function whereIndex(from, to) {
  const idx = {};
  for (let d = parse(from); iso(d) <= to; d = addDays(d, 1)) idx[iso(d)] = CalendarRules.whereOn(state.data, iso(d));
  return idx;
}

const clashesFor = (key) => CalendarRules.clashesFor(state.data, key);

// ---------- rendering
function renderGrid(keepAnchor) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - state.monthsBefore, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + state.monthsAfter, 0);
  const saved = state.filter; state.filter = new Set();          // build everything (school-holiday shading stays)…
  const days = buildDays(iso(first), iso(last));
  state.filter = saved;
  // …then keep only entries for the picked names (e.g. a helper: just their entries, shown in the family columns)
  if (state.filter.size) for (const k in days) days[k].items = days[k].items.filter((it) => it.kind !== "event" || visible(it.who));
  const where = whereIndex(iso(first), iso(last));
  const cols = gridColumns();
  const clashes = state.data.me.role !== "limited";
  const anchor = keepAnchor && document.querySelector(".month-block");
  const anchorTop = anchor ? anchor.getBoundingClientRect().top : 0, anchorId = anchor?.id;

  let html = `<p class="muted legend">Shaded = school holidays · ${activePlaces().map((p) => `${p.icon} ${esc(p.label)}`).join(" · ")} ·
    ❓ not planned · <span class="warn">⚠</span> on a date = something needs sorting (tap the date)</p>
    <button class="more" id="earlier">Show earlier month</button>`;
  for (let m = new Date(first); m <= last; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    html += gridMonth(m, days, where, cols, clashes);
  }
  html += `<button class="more" id="month-end">Show more months</button>`;
  $("#main").innerHTML = html;
  $("#earlier").onclick = () => { state.monthsBefore += 1; render(); };
  $("#month-end").onclick = moreMonths;
  if (anchorId) {
    const el = document.getElementById(anchorId);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - anchorTop);
  } else if (!keepAnchor) {
    const t = document.getElementById("g-" + todayISO());
    if (t) window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - $("#bar").offsetHeight - 90);
  }
}

// one coloured bar for an entry; the location icon sits at the front, so you can see where people sleep
// repeat > 0: one bar across the whole day with the label repeated (centred) under each of `repeat` columns
function barHTML(it, key, n, person, label, repeat = 0) {
  if (it.kind === "birthday") return `<div class="gi bday ${it.rec.type === "Memorial" ? "memorial" : ""}" data-rec="${it.rec.id}">${esc(it.text)}</div>`;
  const e = it.ev, multi = e.end !== e.start;
  const visitor = visitorOf(e), visit = !!visitor && person !== visitor;   // striped: a visitor's plan shown in a child's column
  const icon = e.location && LOC()[e.location] && e.status !== "Unavailable" ? `<span class="li">${LOC()[e.location].icon}</span>` : "";
  let title = e.title;
  if (e.location && person) title = title.replace(new RegExp(`^${person}\\s+(at\\s+(the\\s+)?)?`, "i"), "");   // "Emma at Beach House" -> "Beach House"
  const cls = ["gi", whoList(e.who).includes("Family") ? "fam" : "", e.important ? "imp" : "", ["Tentative", "Unavailable"].includes(e.status) ? "tent" : "", visit ? "visit" : "",
               multi ? "multi" : "", multi && key !== e.start ? "cont" : "", multi && key !== e.end ? "open" : ""].join(" ");
  const who = label ? `<b>${esc(label)}:</b> ` : visit && !title.toLowerCase().startsWith(visitor.toLowerCase()) ? `${esc(visitor)}: ` : "";
  const text = `${icon}${who}${esc(title)}${stayStatus(e)}`;
  const body = repeat ? Array(repeat).fill(`<span>${text}</span>`).join("") : text;
  return `<div class="${cls}${repeat ? " across" : ""}" style="--c:${COLORS[visit ? visitor : person || whoList(e.who)[0]]}${repeat ? `;grid-template-columns:repeat(${repeat},minmax(0,1fr))` : ""}" data-ev="${e.id}">${body}</div>`;   // label on every day, so each square makes sense on its own
}

function gridMonth(m, days, where, cols, showClashes) {
  const count = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const today = todayISO();
  const all = allColumns();
  const famOn = visible(["Family"]);   // birthdays: shown unless only people outside the family are picked
  const tpl = `grid-template-columns: var(--dcol) repeat(${cols.length}, minmax(0, 1fr))`;
  // month name + column names form one header that stays pinned while you scroll through the month
  let html = `<section class="month-block" id="m-${m.getFullYear()}-${m.getMonth()}">
    <div class="ghead"><div class="gtitle">${MONTHS[m.getMonth()]} ${m.getFullYear()}</div>
      <div class="ghrow" style="${tpl}"><div class="gh"></div>${cols.map((c) => `<div class="gh" style="--c:${COLORS[c]}">${esc(c)}</div>`).join("")}</div></div>
    <div class="fgrid" style="${tpl}">`;
  for (let n = 1; n <= count; n++) {
    const d = new Date(m.getFullYear(), m.getMonth(), n), key = iso(d), info = days[key], wh = where[key];
    const wd = d.getDay();
    const rowCls = [wd === 0 || wd === 6 ? "we" : "", info.ph ? "ph" : "", key === today ? "today" : "", key < today ? "past" : ""].join(" ");
    // Family entries, birthdays and people without a column (e.g. an au pair) go in a strip across the whole day
    const strip = famOn ? info.items.filter((it) => !it.who.some((p) => all.includes(p)) && (it.kind === "birthday" || visible(it.who))) : [];
    const clashes = showClashes ? clashesFor(key, wh, info) : [];
    html += `<div class="gd ${rowCls}" id="g-${key}" data-day="${key}" ${clashes.length ? `data-clash="${key}"` : ""}
      title="${esc(info.ph || "")}" ${strip.length || info.ph ? `style="grid-row: span 2"` : ""}>
      <b>${n}</b><small>${DOW1[wd]}</small>${clashes.length ? `<span class="warn">⚠</span>` : ""}</div>`;
    if (strip.length || info.ph) {
      html += `<div class="gf ${rowCls}" data-day="${key}">${info.ph ? `<div class="gi across phbar" style="grid-template-columns:repeat(${cols.length},minmax(0,1fr))">${   // like Family: the name under every column
          Array(cols.length).fill(`<span>🇿🇦 ${esc(info.ph)}</span>`).join("")}</div>` : ""}${strip.map((it) => {
        const p = it.who.filter((x) => x !== "Family");
        if (it.kind === "event" && it.who.includes("Family")) return barHTML(it, key, n, null, "", cols.length);   // Family: label in every column
        return barHTML(it, key, n, null, p.length && !it.who.includes("Family") ? p.join(" & ") : "");
      }).join("")}</div>`;
    }
    for (const c of cols) html += gridCell(c, key, n, info, wh, rowCls);
  }
  return html + `</div></section>`;
}

function gridCell(person, key, n, info, wh, rowCls) {
  const items = info.items.filter((it) => it.who.includes(person));
  let bg = "";
  if (KIDS().includes(person) && info.off.includes(person)) bg = `color-mix(in srgb, ${COLORS[person]} 22%, var(--card))`;
  // the school holiday itself: a labelled bar on its first day (and at the top of each month) - tap to change it
  const hol = KIDS().includes(person) ? info.offs.filter((h) => h.child === person && (h.start === key || key.endsWith("-01"))) : [];
  // the label says when they go back (the shading ends on the last day at home); the day back gets a small 🎒 marker
  const back = (h) => fmtDay(iso(addDays(parse(h.end), 1)));
  // a closing time in the holiday's notes ("Closes 12:00", "close 14:30") shows on its first day
  const closes = (h) => (String(h.notes || "").match(/\bclos(?:e|es|ing)\b\D{0,4}(\d{1,2}[:h.]\d{2})/i) || [])[1]?.replace(/[h.]/, ":");
  const holBars = hol.map((h) => `<div class="gi shol" data-sh="${h.id}" style="--c:${COLORS[person]}">🌿 ${esc(h.name)}
    <small>${h.start === key ? (closes(h) ? `closes ${closes(h)} · ` : "") : "cont. · "}back ${back(h)}</small></div>`).join("")
    // (not when a "Boarders Return" entry already says it, nor after a holiday that runs to 31 Dec because the next year isn't known)
    + (KIDS().includes(person) && !items.some((it) => /boarders return/i.test(it.ev?.title || ""))
      ? state.data.schoolHolidays.filter((h) => h.child === person && iso(addDays(parse(h.end), 1)) === key && !h.end.endsWith("-12-31"))
      .map((h) => `<div class="gi sback" data-sh="${h.id}" style="--c:${COLORS[person]}">🎒 Back to school</div>`).join("") : "");
  const max = 3;
  const lines = holBars + items.slice(0, max).map((it) => barHTML(it, key, n, person)).join("");
  const more = items.length > max ? `<div class="gmore">+${items.length - max}</div>` : "";
  // only flag the odd ones here - normal locations show on the entry itself
  const w = wh[person];
  const pin = w?.loc === "conflict" ? "⚠" : w?.loc === "unknown" ? "❓" : "";
  return `<div class="gc ${rowCls}" data-cell="${key}|${esc(person)}" style="${bg ? `background:${bg}` : ""}">
    ${pin ? `<span class="pin">${pin}</span>` : ""}${lines}${more}</div>`;
}

// ---------- "Needs sorting" list at the top of Upcoming: every ⚠ in the next 8 weeks, repeats joined into date ranges.
// Warnings someone marked "OK, noted" (state.data.acks) go into a separate, folded list; the ⚠ stays on the calendar.
const ackBy = (key, msg) => CalendarRules.isAcked(state.data, key, msg)?.by_user;
const needsSorting = (weeks = 8, acked = false) => CalendarRules.clashRuns(state.data, todayISO(), iso(addDays(new Date(), weeks * 7)), acked);

function sortingCard() {
  if (state.data.me.role === "limited") return "";
  const runs = needsSorting(), done = needsSorting(8, true);
  state.sortRuns = [...runs, ...done];
  const when = (r) => r.start === r.end ? fmtDay(r.start) : `${fmtShort(r.start)} – ${fmtShort(r.end)}`;
  const noted = done.length ? `<details class="noted"><summary>👍 Noted (${done.length}) – still marked ⚠ on the calendar</summary>
    ${done.map((r) => `<div class="srow" data-clash="${r.start}"><b>${when(r)}</b><span>${esc(r.msg)} <small class="muted">· noted by ${esc(r.by || "")}</small></span>
      <button type="button" class="ackbtn" data-unack="${state.sortRuns.indexOf(r)}">Undo</button></div>`).join("")}</details>` : "";
  if (!runs.length) return `<div class="sorting ok">✅ Nothing needs sorting in the next 8 weeks${noted}</div>`;
  return `<details class="sorting" id="sorting" ${load("sortingOpen") === false ? "" : "open"}>
    <summary>⚠ Needs sorting <span class="warn">${runs.length}</span> <small class="muted">next 8 weeks</small></summary>
    ${runs.map((r) => `<div class="srow" data-clash="${r.start}"><b>${when(r)}</b><span>${esc(r.msg)}</span>
      <button type="button" class="ackbtn" data-ack="${state.sortRuns.indexOf(r)}" title="Hide from this list – the ⚠ stays on the calendar">👍 OK, noted</button></div>`).join("")}
    ${noted}</details>`;
}

// ---------- ⚠ on a day in Upcoming, with one-tap "<helper> requested / confirmed" when a kid is home alone
function dayWarnings(key) {
  if (state.data.me.role === "limited" || key < todayISO()) return "";
  const saved = state.filter; state.filter = new Set();
  const info = buildDays(key, key)[key];
  state.filter = saved;
  const wh = whereIndex(key, key)[key];
  const clashes = clashesFor(key, wh, info);
  if (!clashes.length) return "";
  const alone = KIDS().filter((k) => homes().includes(wh[k]?.loc) &&
    !Object.keys(wh).some((p) => adults().includes(p) && wh[p].loc === wh[k].loc));   // nobody at all, not even requested
  const buttons = canAdd() ? alone.flatMap((k) => helpers().map((h) =>
    `<span class="qstay">${esc(h)} with ${esc(k)}:
      <button type="button" data-quickstay="${esc(h)}|${esc(k)}|${key}|Tentative">⏳ Requested</button>
      <button type="button" data-quickstay="${esc(h)}|${esc(k)}|${key}|Confirmed">✅ Confirmed</button>
      <button type="button" data-quickstay="${esc(h)}|${esc(k)}|${key}|Unavailable">🚫 Can't</button></span>`)).join("")
    + alone.filter((k) => isSchoolDay(k, key)).map((k) => `<span class="qstay"><button type="button" data-uber="${esc(k)}|${key}">🚕 Uber to school</button></span>`).join("")
    + houseButtons(key) : "";
  return `<div class="dwarn">${clashes.map((c) => `<div data-clash="${key}">⚠ ${esc(c)}</div>`).join("")}${buttons}</div>`;
}

// one tap: "<helper> staying with <child>" for the whole stretch they'd be alone from this day
// 🚕 Uber to school: one "Transport" entry per school day (Mon–Fri) from..to; prefilled for as long as the kid is home alone
function uberForm(kid, key) {
  openDialog(`<form class="form" id="f"><h2>🚕 ${esc(kid)}: Uber to school</h2>
    <div class="two"><label>From<input type="date" name="start" value="${key}" required></label>
      <label>To<input type="date" name="end" value="${aloneUntil(kid, key)}" required></label></div>
    <label>Note<input name="notes" value="Uber to and from school" placeholder="e.g. pick-up 7:00, home 15:00"></label>
    <div class="meta">Adds "🚕 Uber to school 🚕" on each school day (Mon–Fri) in ${esc(kid)}'s column. The ⚠ then says the lift is booked.</div>
    <div class="err"></div>
    <div class="actions"><button type="button" id="cancel">Cancel</button><button class="primary">Add</button></div></form>`, () => {
    const f = $("#f");
    $("#cancel").onclick = closeDialog;
    f.onsubmit = (x) => {
      x.preventDefault();
      const start = f.elements.start.value, end = f.elements.end.value < start ? start : f.elements.end.value;
      const body = { title: "🚕 Uber to school 🚕", who: [kid], start, end: start, category: "Transport", notes: f.elements.notes.value };
      if (end > start) body.repeat = { every: "week", days: [1, 2, 3, 4, 5], until: end };
      submit(async () => { const r = await api("POST", "events", body); submit.msg = r.count > 1 ? `🚕 Uber added for ${r.count} school days` : "🚕 Uber added"; },
        () => submit.msg);
    };
  });
}

function quickStay(helper, kid, key, status) {
  const end = aloneUntil(kid, key);
  // "Can't" on a school day: show the day again so the 🚕 Uber option is right there
  const next = () => { if (status === "Unavailable" && isSchoolDay(kid, key)) clashSheet(key); };
  submit(() => api("POST", "events", { title: `${helper} staying with ${kid}`, start: key, end, who: [kid, helper],
    category: "Household", location: stayPlace(kid, key), status }),
    `${helper} staying with ${kid} ${fmtShort(key)}${end !== key ? " – " + fmtShort(end) : ""} (${{ Tentative: "requested", Unavailable: "can't stay" }[status] || "confirmed"})`).then(next);
}

// ---------- taps
function cellSheet(key, person) {
  const saved = state.filter; state.filter = new Set();
  const info = buildDays(key, key)[key];
  state.filter = saved;
  const wh = whereIndex(key, key)[key][person];
  const items = info.items.filter((it) => it.who.includes(person));
  const title = `${person} · ${parse(key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`;
  const pl = wh && LOC()[wh.loc];
  const whereTxt = !wh || !wh.loc ? "" : wh.loc === "unknown" ? "❓ Holiday – not planned yet" : wh.loc === "conflict" ? "⚠ Down for two places"
    : !pl ? wh.loc : pl.kind === "school" ? `${pl.icon} At school (boarding)` : `${pl.icon} ${esc(pl.label)}${wh.explicit ? "" : " (usual)"}`;
  const isPerson = state.data.people.some((p) => p.name === person && ["household", "helper"].includes(p.type));
  openDialog(`<div class="form"><h2>${esc(title)}</h2>
    ${whereTxt ? `<div class="meta">Sleeping: <b>${whereTxt}</b></div>` : ""}
    <div class="sheet-list">${items.map((it) => itemHTML(it)).join("") || `<p class="muted">Nothing on.</p>`}</div>
    <div class="actions"><button type="button" id="cancel">Close</button>
      ${canAdd() && KIDS().includes(person) ? helpers().map((h) => `<button type="button" data-helper="${esc(h)}">🏠 ${esc(h)} staying with ${esc(person)}</button>`).join("") : ""}
      ${canAdd() && isPerson ? `<button type="button" id="stay">🏠 Where are they staying?</button>` : ""}
      ${canAdd() ? `<button class="primary" id="addp">+ Add for ${esc(person)}</button>` : ""}</div></div>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#addp")?.addEventListener("click", () => eventForm(null, { date: key, who: person }));
    $("#stay")?.addEventListener("click", () => stayForm(person, key));
    document.querySelectorAll("#dlg [data-helper]").forEach((b) => b.onclick = () => helperForm(b.dataset.helper, person, key, key));
  });
}

// the run of days from `key` on which `kid` is at the same house with no confirmed adult (to prefill the dates)
function aloneUntil(kid, key) {
  const house = stayPlace(kid, key);
  const to = iso(addDays(parse(key), 30));
  const idx = whereIndex(key, to);
  let end = key;
  for (let d = addDays(parse(key), 1); iso(d) <= to; d = addDays(d, 1)) {
    const w = idx[iso(d)];
    if (w[kid]?.loc !== house || Object.keys(w).some((p) => adults().includes(p) && w[p].loc === house && !w[p].tentative)) break;
    end = iso(d);
  }
  return end;
}

// "<helper> staying with <child>": an entry for both of them at the child's house (Tentative = asked, not confirmed yet)
function helperForm(helper, kid, from, to) {
  openDialog(`<form class="form" id="f"><h2>${esc(helper)} staying with ${esc(kid)}</h2>
    <div class="two"><label>From<input type="date" name="start" value="${from}" required></label>
      <label>To (last night)<input type="date" name="end" value="${to}" required></label></div>
    <label>Note (optional)<input name="note" placeholder="e.g. parents away for the weekend"></label>
    <div class="seg seg-loc"><label><input type="radio" name="stay" value="Tentative" checked> ⏳ Requested</label>
      <label><input type="radio" name="stay" value="Confirmed"> ✅ Confirmed</label>
      <label><input type="radio" name="stay" value="Unavailable"> 🚫 Can't stay</label></div>
    <div class="meta">Shows in ${esc(kid)}'s column as ${LOC()[stayPlace(kid, from)]?.icon || "🏠"} ${esc(helper)} staying with ${esc(kid)}. Until it's confirmed the ⚠ stays.</div>
    <div class="err"></div>
    <div class="actions"><button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData($("#f"));
      submit(() => api("POST", "events", { title: `${helper} staying with ${kid}` + (fd.get("note") ? ` – ${fd.get("note")}` : ""),
        start: fd.get("start"), end: fd.get("end") || fd.get("start"), who: [kid, helper], category: "Household", location: stayPlace(kid, from),
        status: fd.get("stay") || "Tentative" }), "Saved");
    };
  });
}

// quick "where are they staying from … to …" - creates a normal entry with a location
function stayForm(person, key) {
  openDialog(`<form class="form" id="f"><h2>Where is ${esc(person)} staying?</h2>
    <div class="seg seg-loc">${activePlaces().map((v, i) =>
      `<label><input type="radio" name="loc" value="${esc(v.key)}" ${i === 0 ? "checked" : ""}> ${v.icon} ${esc(v.label)}</label>`).join("")}</div>
    <div class="two"><label>From<input type="date" name="start" value="${key}" required></label>
      <label>To<input type="date" name="end" value="${key}" required></label></div>
    <label>Note (optional)<input name="note" placeholder="e.g. at Emma's / with Granny Chris"></label>
    <div class="checks"><label><input type="checkbox" name="tentative"> Not confirmed yet (e.g. requested)</label></div>
    <div class="err"></div>
    <div class="actions"><button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData($("#f")), loc = fd.get("loc"), pl = LOC()[loc];
      const where = { away: `${person} away`, school: `${person} at school (boarding)`, friend: `${person} at a friend's house` }[pl.kind] || `${person} at ${pl.label}`;
      const title = where + (fd.get("note") ? ` – ${fd.get("note")}` : "");
      submit(() => api("POST", "events", { title, start: fd.get("start"), end: fd.get("end") || fd.get("start"), who: [person],
        category: "Travel", location: loc, status: fd.get("tentative") === "on" ? "Tentative" : "Confirmed" }), "Saved");
    };
  });
}

// ---------- houses that need someone (Setup > Places "needs", e.g. the dogs): house-sitting or "not required"
function houseButtons(key) {
  return CalendarRules.houseNeeds(state.data, key).map((h) => {
    const pl = LOC()[h];
    return helpers().map((x) => `<span class="qstay">${esc(x)} house-sitting ${esc(pl.label)}:
        <button type="button" data-housesit="${esc(x)}|${esc(h)}|${key}|Tentative">⏳ Requested</button>
        <button type="button" data-housesit="${esc(x)}|${esc(h)}|${key}|Confirmed">✅ Confirmed</button>
        <button type="button" data-housesit="${esc(x)}|${esc(h)}|${key}|Unavailable">🚫 Can't</button></span>`).join("")
      + `<span class="qstay"><button type="button" data-housenot="${esc(h)}|${key}" title="Nobody needs to be there these days (e.g. ${esc(pl.needs)} with you)">👌 ${esc(pl.label)}: not required</button></span>`;
  }).join("");
}
// the run of days from `key` on which house `h` still needs someone (to prefill the dates)
function emptyUntil(h, key) {
  let end = key;
  for (let d = addDays(parse(key), 1), i = 0; i < 30; d = addDays(d, 1), i++) {
    if (!CalendarRules.houseNeeds(state.data, iso(d)).includes(h)) break;
    end = iso(d);
  }
  return end;
}
function houseSit(helper, h, key, status) {
  const end = emptyUntil(h, key), pl = LOC()[h];
  submit(() => api("POST", "events", { title: `${helper} house-sitting`, start: key, end, who: [helper], category: "Household", location: h, status }),
    `${helper} house-sitting ${pl.label} ${fmtShort(key)}${end !== key ? " – " + fmtShort(end) : ""} (${{ Tentative: "requested", Unavailable: "can't" }[status] || "confirmed"})`);
}
// "not required": an entry across the family strip saying the house can stay empty those days; deleting it brings the ⚠ back
function houseNotForm(h, key) {
  const pl = LOC()[h];
  openDialog(`<form class="form" id="f"><h2>${pl.icon} ${esc(pl.label)}: nobody needed</h2>
    <div class="two"><label>From<input type="date" name="start" value="${key}" required></label>
      <label>To (last night)<input type="date" name="end" value="${emptyUntil(h, key)}" required></label></div>
    <label>Why (optional)<input name="note" placeholder="e.g. ${esc(pl.needs)} with us"></label>
    <div class="meta">Adds an entry for those days and the ⚠ goes away. Delete the entry if plans change.</div>
    <div class="err"></div>
    <div class="actions"><button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData($("#f"));
      submit(() => api("POST", "events", { title: `👌 Nobody needed at ${pl.label}` + (fd.get("note") ? ` – ${fd.get("note")}` : ""),
        start: fd.get("start"), end: fd.get("end") < fd.get("start") ? fd.get("start") : fd.get("end"), who: ["Family"], category: "Household", house_off: h }), "Saved");
    };
  });
}

async function ackRun(btn) {
  const add = "ack" in btn.dataset, r = state.sortRuns?.[+(add ? btn.dataset.ack : btn.dataset.unack)];
  if (!r) return;
  btn.disabled = true;
  try {
    await api("POST", add ? "acks" : "acks/undo", { msg: r.msg, days: r.days });
    toast(add ? "Noted – hidden from Needs sorting" : "Back on the list");
    await refresh();
  } catch (err) { btn.disabled = false; toast(err.message); }
}

function clashSheet(key) {
  const saved = state.filter; state.filter = new Set();
  const info = buildDays(key, key)[key];
  state.filter = saved;
  const wh = whereIndex(key, key)[key];
  const clashes = clashesFor(key, wh, info);
  const list = (h) => Object.keys(wh).filter((p) => wh[p].loc === h).join(", ") || "nobody";
  // kids at a house without a confirmed adult - offer "<helper> staying with ..."
  const alone = KIDS().filter((k) => homes().includes(wh[k]?.loc) &&
    !Object.keys(wh).some((p) => adults().includes(p) && wh[p].loc === wh[k].loc && !wh[p].tentative));
  // houses and "away" always listed; school / friend's only when someone is there
  const placesTxt = activePlaces().filter((p) => p.kind === "home" || p.kind === "away" || list(p.key) !== "nobody")
    .map((p) => `${p.icon} ${p.kind === "school" ? "At school" : p.kind === "friend" ? "At a friend's" : p.kind === "away" ? "Away" : esc(p.label)}: <b>${esc(list(p.key))}</b>`).join("<br>");
  openDialog(`<div class="form"><h2>${parse(key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h2>
    ${clashes.length ? `<div class="clashes">${clashes.map((c) => `<div>⚠ ${esc(c)}${ackBy(key, c) ? ` <small class="muted">· 👍 noted by ${esc(ackBy(key, c))}</small>` : ""}</div>`).join("")}</div>` : `<p class="muted">No clashes 👍</p>`}
    <div class="meta">${placesTxt}</div>
    ${canAdd() && alone.length ? `<div class="dwarn" style="border-radius:10px;border:0">${alone.flatMap((k) => helpers().map((h) =>
      `<span class="qstay">${esc(h)} with ${esc(k)}:
        <button type="button" data-quickstay="${esc(h)}|${esc(k)}|${key}|Tentative">⏳ Requested</button>
        <button type="button" data-quickstay="${esc(h)}|${esc(k)}|${key}|Confirmed">✅ Confirmed</button>
        <button type="button" data-quickstay="${esc(h)}|${esc(k)}|${key}|Unavailable">🚫 Can't</button>
        <button type="button" data-helper="${esc(h)}" data-kid="${esc(k)}">Other dates…</button></span>`)).join("")}
      ${alone.filter((k) => isSchoolDay(k, key)).map((k) => `<span class="qstay">${esc(k)} to school:
        <button type="button" data-uber="${esc(k)}|${key}">🚕 Uber to school</button></span>`).join("")}</div>` : ""}
    ${canAdd() && CalendarRules.houseNeeds(state.data, key).length ? `<div class="dwarn" style="border-radius:10px;border:0">${houseButtons(key)}</div>` : ""}
    <div class="actions"><button type="button" id="cancel">Close</button>
      <button class="primary" id="seeday">See the day</button></div></div>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#seeday").onclick = () => daySheet(key);
    document.querySelectorAll("#dlg [data-helper]").forEach((b) => b.onclick = () =>
      helperForm(b.dataset.helper, b.dataset.kid, key, aloneUntil(b.dataset.kid, key)));
  });
}

document.addEventListener("click", (e) => {
  if (!state.data) return;
  const ev = e.target.closest("[data-ev]");
  const cell = e.target.closest("[data-cell]");
  const ack = e.target.closest("[data-ack],[data-unack]");
  if (ack) { e.stopPropagation(); return ackRun(ack); }
  const ub = e.target.closest("[data-uber]");
  if (ub) { e.stopPropagation(); const [k, key] = ub.dataset.uber.split("|"); return uberForm(k, key); }
  const hs = e.target.closest("[data-housesit]"), hn = e.target.closest("[data-housenot]");
  if (hs) { e.stopPropagation(); const [x, h, key, st] = hs.dataset.housesit.split("|"); return houseSit(x, h, key, st); }
  if (hn) { e.stopPropagation(); const [h, key] = hn.dataset.housenot.split("|"); return houseNotForm(h, key); }
  const qs = e.target.closest("[data-quickstay]");
  if (qs) { e.stopPropagation(); const [h, k, key, st] = qs.dataset.quickstay.split("|"); return quickStay(h, k, key, st); }
  const clash = e.target.closest("[data-clash]");
  if (cell && !ev && !e.target.closest("[data-sh]")) { e.stopPropagation(); const [k, p] = cell.dataset.cell.split("|"); cellSheet(k, p); }
  else if (clash) { e.stopPropagation(); clashSheet(clash.dataset.clash); }
}, true);
