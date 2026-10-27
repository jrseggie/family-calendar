// Family grid: days down the side, a column per person (like the original Excel), Family entries in a strip
// across the day, location icons on the entries and ⚠ on the date when something clashes. Loaded after app.js and uses its helpers.

// the ⚠ rules live in rules.js (shared with the Sunday email and the tests); places and children come from Settings
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
// (or someone typed in, events.guest) - in a Month column just the answer and the name: "✅ Mia", "⏳ Mia", "🚫 Mia" (rules.js stayText)
const isHelperStay = (e) => !!CalendarRules.stayOf(state.data, e);
const stayClass = (e) => CalendarRules.aloneOk(e) ? "salone" : !isHelperStay(e) ? "" : e.status === "Tentative" ? "sreq" : e.status === "Unavailable" ? "sno" : "sok";
// ✏️ at the end of a pencilled-in entry (the location icon keeps the front), ✅ for 3 days once it's confirmed
const pencilMark = (e) => CalendarRules.pencilled(state.data, e) ? ` <span class="pmark" title="Pencilled in – might not happen">✏️</span>`
  : CalendarRules.justConfirmed(e) && !isHelperStay(e) ? ` <span class="pmark" title="Confirmed by ${esc(e.confirmed_by || "")}">✅</span>` : "";
// Setup type "Helper": au pair / nanny / gardener / house-sitter who can stay over with the kids or look after a house
const helpers = () => CalendarRules.helpers(state.data);
// the helpers free on `key` (not on 🌴 leave) as a pick-list for the one-tap buttons ("@" in data-quickstay / data-housesit = the picked one)
function helperPick(key, first = null, kid = "") {
  const free = CalendarRules.helpersFree(state.data, key).sort((a, b) => (b === first) - (a === first));
  return `<select class="hpick" title="Who">${free.map((h) => `<option>${esc(h)}</option>`).join("")}<option value="${OTHER}">Someone else…</option>${
    kid ? `<option value="${ALONE}">Nobody – ${esc(kid)}'s OK alone</option>` : ""}</select>`;
}
const OTHER = "__someone_else", ALONE = "__alone";
const qdates = (from, to) => `<span class="qdates"><input type="date" class="qfrom" value="${from}" aria-label="From"> – <input type="date" class="qto" value="${to}" aria-label="To (last night)"></span>`;
// the dates picked on a stay row (From / To), or the whole stretch
const rangeOf = (btn, key, to) => { const q = btn.closest(".qstay"), f = q?.querySelector(".qfrom")?.value || key, t = q?.querySelector(".qto")?.value || to;
  return { from: f, to: t < f ? f : t }; };
// picking "Nobody – <child>'s OK alone" swaps the ⏳ / ✅ / 🚫 buttons for one "✅ Save" (there's nothing to ask or refuse); back again otherwise
document.addEventListener("change", (e) => {
  const sel = e.target.closest?.(".qstay .hpick"); if (!sel) return;
  const box = sel.closest(".qstay"), alone = sel.value === ALONE;
  box.querySelectorAll("[data-quickstay], [data-helper]").forEach((b) => { b.hidden = alone; });
  box.querySelector(".asave")?.remove();
  if (alone) {
    const kid = box.querySelector("[data-quickstay]")?.dataset.quickstay.split("|")[1] || "";
    box.insertAdjacentHTML("beforeend", `<button type="button" class="ackbtn asave" data-quickstay="${esc(box.querySelector("[data-quickstay]").dataset.quickstay.replace(/\|[^|]*$/, "|Confirmed"))}">✅ Save – ${esc(kid)}'s OK alone</button>`);
  }
});
const picked = (btn) => { const p = btn.closest(".qstay")?.querySelector(".hpick"); return p ? p.value || p.dataset.h : ""; };
const allOnLeave = (key) => helpers().length && !CalendarRules.helpersFree(state.data, key).length
  ? `<span class="qstay muted">🌴 ${helpers().length > 1 ? "All the helpers are" : `${esc(helpers()[0])} is`} on leave</span>` : "";

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

  let html = `${welcomeCard()}<p class="muted legend">Shaded = school holidays · ${activePlaces().map((p) => `${p.icon} ${esc(p.label)}`).join(" · ")} ·
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
// wide: one full-width bar with the label once (a helper house-sitting: "✅ Emma house-sitting")
function barHTML(it, key, n, person, label, repeat = 0, wide = false) {
  if (it.kind === "birthday") return `<div class="gi bday ${it.rec.type === "Memorial" ? "memorial" : ""}" data-rec="${it.rec.id}">${esc(it.text)}</div>`;
  const e = it.ev, multi = e.end !== e.start;
  const visitor = visitorOf(e), visit = !!visitor && person !== visitor;   // striped: a visitor's plan shown in a child's column
  const stay = CalendarRules.stayLike(state.data, e);
  const icon = e.location && LOC()[e.location] && e.status !== "Unavailable" && !stay ? `<span class="li">${LOC()[e.location].icon}</span>` : "";
  let title = wide ? CalendarRules.stayText(state.data, e).replace(/ the .+$/, "") : stay ? CalendarRules.stayText(state.data, e, true) : e.title;
  if (e.location && person) title = title.replace(new RegExp(`^${person}\\s+at\\s+(the\\s+)?`, "i"), "");   // "Emma at Beach House" -> "Beach House" (not "Emma with Mark")
  const pen = CalendarRules.pencilled(state.data, e);
  const cls = ["gi", stayClass(e), pen ? "pencil" : "", e.category === "Leave" ? "leave" : "", whoList(e.who).includes("Family") ? "fam" : "", e.important ? "imp" : "", !pen && !stay && ["Tentative", "Unavailable"].includes(e.status) ? "tent" : "", visit ? "visit" : "",
               multi ? "multi" : "", multi && key !== e.start ? "cont" : "", multi && key !== e.end ? "open" : "", wide ? "hsit" : ""].join(" ");
  const who = label ? `<b>${esc(label)}:</b> ` : visit && !new RegExp(`\\b${visitor}\\b`, "i").test(title) ? `${esc(visitor)}: ` : "";   // "Mark: dinner", not "Mark: Emma with Mark"
  const tm = CalendarRules.timeText(e, key);   // "10:30" in front of the title (on the first day; "until 14:00" on the last)
  const text = `${icon}${who}${tm ? `<span class="tm">${esc(tm)}</span> ` : ""}${esc(title)}${stay ? "" : pencilMark(e)}`;
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
    const phx = info.phx.map((x) => `<div class="gi phx">${x.flag} ${esc(x.name)}</div>`).join("");   // another country's holiday (information only)
    const clashes = showClashes ? clashesFor(key, wh, info) : [], maybes = showClashes ? CalendarRules.maybesFor(state.data, key) : [];
    html += `<div class="gd ${rowCls}" id="g-${key}" data-day="${key}" ${clashes.length || maybes.length ? `data-clash="${key}"` : ""}
      title="${esc(info.ph || "")}" ${strip.length || info.ph || phx ? `style="grid-row: span 2"` : ""}>
      <b>${n}</b><small>${DOW1[wd]}</small>${clashes.length ? `<span class="warn">⚠</span>` : maybes.length ? `<span class="maybe" title="Only if a pencilled-in plan goes ahead">❔</span>` : ""}</div>`;
    if (strip.length || info.ph || phx) {
      html += `<div class="gf ${rowCls}" data-day="${key}">${info.ph ? `<div class="gi across phbar" style="grid-template-columns:repeat(${cols.length},minmax(0,1fr))">${   // like Family: the name under every column
          Array(cols.length).fill(`<span>${info.phFlag} ${esc(info.ph)}</span>`).join("")}</div>` : ""}${phx}${strip.map((it) => {
        const p = it.who.filter((x) => x !== "Family");
        if (it.kind === "event" && it.who.includes("Family")) return barHTML(it, key, n, null, "", cols.length);   // Family: label in every column
        if (it.kind === "event" && CalendarRules.stayOf(state.data, it.ev) && whoList(it.ev.who).length === 1) return barHTML(it, key, n, null, "", 0, true);   // house-sitting: one bar, the name once
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
  // the time school closes on the first day ("School closes at", or "Closes 12:00" in older holidays' notes)
  const closes = (h) => CalendarRules.closesAt(h);
  const holBars = hol.map((h) => `<div class="gi shol" data-sh="${h.id}" style="--c:${COLORS[person]}" ${h.notes ? `title="${esc(h.notes)}"` : ""}>🌿 ${esc(h.name)}
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
  // ✏️ still pencilled in, starting within 2 weeks: on or not?
  const nudges = CalendarRules.pencilNudges(state.data, todayISO()).filter((e) => visible(whoList(e.who)));
  const nudgeRows = nudges.map((e) => `<div class="srow"><b>${e.start === e.end ? fmtDay(e.start) : `${fmtShort(e.start)} – ${fmtShort(e.end)}`}</b>
    <span data-ev="${e.id}" style="cursor:pointer">✏️ ${esc(whoList(e.who).join(" & "))}: ${esc(CalendarRules.plainTitle(e.title))} is still pencilled in – on or not?</span>
    ${canConfirm(e) ? `<span class="vmove"><button type="button" class="ackbtn" data-pon="${e.id}">✅ It's on</button>
      <button type="button" class="ackbtn danger" data-poff="${e.id}">🗑 Not happening</button></span>` : "<span></span>"}</div>`).join("");
  const ifs = CalendarRules.clashRuns(state.data, todayISO(), iso(addDays(new Date(), 8 * 7)), false, true);
  const ifList = ifs.length ? `<details class="noted"><summary>❔ If pencilled-in plans go ahead (${ifs.length})</summary>
    ${ifs.map((r) => `<div class="srow" data-clash="${r.start}"><b>${r.start === r.end ? fmtDay(r.start) : `${fmtShort(r.start)} – ${fmtShort(r.end)}`}</b><span>${esc(r.msg)}</span><span></span></div>`).join("")}</details>` : "";
  const when = (r) => r.start === r.end ? fmtDay(r.start) : `${fmtShort(r.start)} – ${fmtShort(r.end)}`;
  const noted = done.length ? `<details class="noted"><summary>👍 Noted (${done.length}) – still marked ⚠ on the calendar</summary>
    ${done.map((r) => `<div class="srow" data-clash="${r.start}"><b>${when(r)}</b><span>${esc(r.msg)} <small class="muted">· noted by ${esc(r.by || "")}</small></span>
      ${state.data.me.canEditAll ? `<button type="button" class="ackbtn" data-unack="${state.sortRuns.indexOf(r)}">Undo</button>` : "<span></span>"}</div>`).join("")}</details>` : "";
  if (!runs.length && !nudges.length) return `<div class="sorting ok">✅ Nothing needs sorting in the next 8 weeks${ifList}${noted}</div>`;
  return `<details class="sorting" id="sorting" ${load("sortingOpen") === false ? "" : "open"}>
    <summary>⚠ Needs sorting <span class="warn">${runs.length + nudges.length}</span> <small class="muted">next 8 weeks</small></summary>
    ${nudgeRows}${runs.map((r) => `<div class="srow" data-clash="${r.start}"><b>${when(r)}</b><span>${esc(r.msg)}</span>
      ${state.data.me.canEditAll ? `<button type="button" class="ackbtn" data-ack="${state.sortRuns.indexOf(r)}" title="Hide from this list – the ⚠ stays on the calendar">👍 OK, noted</button>` : "<span></span>"}</div>`).join("")}
    ${ifList}${noted}</details>`;
}

// ---------- ⚠ on a day in Upcoming, with one-tap "<helper> requested / confirmed" when a kid is home alone
function dayWarnings(key) {
  if (state.data.me.role === "limited" || key < todayISO()) return "";
  const saved = state.filter; state.filter = new Set();
  const info = buildDays(key, key)[key];
  state.filter = saved;
  const wh = whereIndex(key, key)[key];
  const clashes = clashesFor(key, wh, info), maybes = CalendarRules.maybesFor(state.data, key);
  if (!clashes.length) return maybes.length ? `<div class="dmaybe">${maybes.map((c) => `<div data-clash="${key}">❔ ${esc(c)}</div>`).join("")}</div>` : "";
  const alone = KIDS().filter((k) => homes().includes(wh[k]?.loc) &&
    !Object.keys(wh).some((p) => adults().includes(p) && wh[p].loc === wh[k].loc));   // nobody at all, not even requested
  const asked = (k) => state.data.events.find((e) => e.status === "Tentative" && e.location && e.start <= key && e.end >= key && whoList(e.who).includes(k)
    && whoList(e.who).some((p) => helpers().includes(p)))?.who;
  const pickFor = (k) => helperPick(key, whoList(asked(k) || "").find((p) => helpers().includes(p)), k);
  const pick = helperPick(key);
  const buttons = canAdd() ? alone.map((k) => `<span class="qstay"><button type="button" class="ackbtn" data-clash="${key}">🏠 Sort out who's with ${esc(k)}</button></span>`).join("")
    + alone.filter((k) => isSchoolDay(k, key)).map((k) => `<span class="qstay"><button type="button" data-uber="${esc(k)}|${key}">🚕 Uber to school</button></span>`).join("")
    + houseButtons(key) : "";
  return `<div class="dwarn">${clashes.map((c) => `<div data-clash="${key}">⚠ ${esc(c)}</div>`).join("")}${buttons}</div>`
    + (maybes.length ? `<div class="dmaybe">${maybes.map((c) => `<div data-clash="${key}">❔ ${esc(c)}</div>`).join("")}</div>` : "");
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

// s: { person (helper / typed name) | alone, kid | house, from, to, status, title, who, guest, location }
const stayMatch = (e, s) => e.location && e.status !== "Cancelled" && (s.alone ? !!e.alone_ok && whoList(e.who).includes(s.kid)
  : !e.alone_ok && (e.guest === s.person || whoList(e.who).includes(s.person)) && (s.kid ? whoList(e.who).includes(s.kid) : e.location === s.house));
const dayStep = (d, n) => iso(addDays(parse(d), n));
async function putStay(s) {
  const keep = (o) => ({ title: o.title, who: whoList(o.who), category: o.category, status: o.status, location: o.location, guest: o.guest, alone_ok: !!o.alone_ok,
    important: o.important, notes: o.notes });
  let reuse = null;
  for (const o of state.data.events.filter((e) => stayMatch(e, s) && e.start <= s.to && e.end >= s.from)) {
    const before = o.start < s.from, after = o.end > s.to, put = (x) => api("PUT", `events/${o.id}`, { ...o, who: whoList(o.who), ...x, loaded_at: o.updated_at || "" });
    if (!before && !after) { if (!reuse) reuse = o; else await api("DELETE", `events/${o.id}`); continue; }
    if (before) await put({ end: dayStep(s.from, -1) });
    if (after) await (before ? api("POST", "events", { ...keep(o), start: dayStep(s.to, 1), end: o.end }) : put({ start: dayStep(s.to, 1) }));
  }
  const rec = { title: s.title, start: s.from, end: s.to, who: s.who, guest: s.guest || null, alone_ok: !!s.alone, category: "Household", location: s.location, status: s.status };
  return reuse ? api("PUT", `events/${reuse.id}`, { ...reuse, ...rec, loaded_at: reuse.updated_at || "" }) : api("POST", "events", rec);
}
const rangeTxt = (r) => `${fmtShort(r.from)}${r.to !== r.from ? " – " + fmtShort(r.to) : ""}`;

// an existing stay for helper+kid (or the helper house-sitting at h) covering `key`, e.g. the ⏳ requested one
const isStayBy = (e, person) => e.location && e.status !== "Cancelled" && (e.guest === person || whoList(e.who).includes(person));
const existingStay = (helper, kid, key, h = null, to = key) => state.data.events.filter((e) => isStayBy(e, helper) && e.start <= to && e.end >= key
  && (kid ? whoList(e.who).includes(kid) : e.location === h)).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0];
const setStatus = (e, status, msg) => submit(() => api("PUT", `events/${e.id}`, { ...e, who: whoList(e.who), status, loaded_at: e.updated_at || "" }), msg);

function quickStay(helper, kid, key, status, guest = false, r = null) {
  r ||= { from: key, to: aloneUntil(kid, key) };
  const label = { Tentative: "asked", Unavailable: "can't stay" }[status] || "staying";
  // "Can't" on a school day: show the day again so the 🚕 Uber option is right there
  const next = () => { if (status === "Unavailable" && isSchoolDay(kid, key)) clashSheet(key); };
  return submit(() => putStay({ person: helper, kid, from: r.from, to: r.to, status, title: `${helper} staying with ${kid}`, who: guest ? [kid] : [kid, helper],
    guest: guest ? helper : null, location: stayPlace(kid, r.from) }), `${helper} with ${kid} ${rangeTxt(r)}: ${label}`).then(next);
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
    <div class="sheet-list">${items.map((it) => itemHTML(it, { day: key })).join("") || `<p class="muted">Nothing on.</p>`}</div>
    <div class="actions"><button type="button" id="cancel">Close</button>
      ${canAdd() && KIDS().includes(person) && CalendarRules.helpersFree(state.data, key).length ? `<button type="button" id="helperstay">🏠 ${
        helpers().length === 1 ? esc(helpers()[0]) : "Helper"} staying with ${esc(person)}</button>` : ""}
      ${canAdd() && isPerson && !holidayOn(person, key) ? `<button type="button" id="stay">🏠 Where are they staying?</button>` : ""}
      ${holidayOn(person, key) ? `<button type="button" class="go" id="plan">🗓 Plan the holiday</button>` : ""}
      ${canAdd() ? `<button class="primary" id="addp">+ Add for ${esc(person)}</button>` : ""}</div></div>`, () => {
    $("#plan")?.addEventListener("click", () => holidayPlan(holidayOn(person, key)));
    $("#cancel").onclick = closeDialog;
    $("#addp")?.addEventListener("click", () => eventForm(null, { date: key, who: person }));
    $("#stay")?.addEventListener("click", () => stayForm(person, key));
    $("#helperstay")?.addEventListener("click", () => helperForm(null, person, key, key));
  });
}

// 🏡 "Nobody – <child>'s OK alone": one entry for the stretch they'd be alone (from the picker; any of ✅ / ⏳ / 🚫 = yes, they're fine)
function aloneOk(kid, key, r = null) {
  r ||= { from: key, to: aloneUntil(kid, key) };
  submit(() => putStay({ alone: true, kid, from: r.from, to: r.to, status: "Confirmed", title: `${kid} home alone (OK)`, who: [kid], location: stayPlace(kid, r.from) }),
    `🏡 ${kid} home alone (OK) ${rangeTxt(r)}`);
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
function helperForm(helper, kid, from, to, opt = {}) {
  const free = CalendarRules.helpersFree(state.data, from);
  if (!helper && free.length === 1 && !opt.other) helper = free[0];
  openDialog(`<form class="form" id="f"><h2>🏠 ${helper ? esc(helper) : "Someone"} staying with ${esc(kid)}</h2>
    ${helper ? "" : `<label>Who<select name="helper">${free.map((h) => `<option>${esc(h)}</option>`).join("")}<option value="${OTHER}" ${opt.other ? "selected" : ""}>Someone else…</option></select></label>
      <div id="guestbox"><label>Their name<input name="guest" placeholder="e.g. Granny Chris" maxlength="60"></label>
        ${state.data.me.isAdmin ? `<div class="checks"><label><input type="checkbox" name="savehelper"> Save them as a helper for next time (Settings › Family)</label></div>` : ""}</div>`}
    <div class="two"><label>From<input type="date" name="start" value="${from}" required></label>
      <label>To (last night)<input type="date" name="end" value="${to}" required></label></div>
    <label>Note (optional)<input name="note" placeholder="e.g. parents away for the weekend"></label>
    <div class="seg seg-loc"><label><input type="radio" name="stay" value="Tentative" ${(opt.status || "Tentative") === "Tentative" ? "checked" : ""}> ⏳ Asked</label>
      <label><input type="radio" name="stay" value="Confirmed" ${opt.status === "Confirmed" ? "checked" : ""}> ✅ Staying</label>
      <label><input type="radio" name="stay" value="Unavailable" ${opt.status === "Unavailable" ? "checked" : ""}> 🚫 Can't</label></div>
    <div class="meta">Shows in ${esc(kid)}'s column as "✅ name" (staying), "⏳ name" (asked) or "🚫 name" (can't). Until it's ✅ the ⚠ stays.</div>
    <div class="err"></div>
    <div class="actions"><button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    const f = $("#f"), other = () => !helper && f.elements.helper.value === OTHER;
    const sync = () => { if ($("#guestbox")) $("#guestbox").hidden = !other(); };
    if (!helper) { f.elements.helper.onchange = sync; sync(); if (opt.other) f.elements.guest.focus(); }
    f.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(f), guest = other() ? String(fd.get("guest") || "").trim() : "", who = guest || helper || fd.get("helper");
      if (other() && !guest) { $("#f .err").textContent = "Type their name"; return; }
      const asHelper = guest && fd.get("savehelper") === "on";
      submit(async () => {
        // saved as a helper: they're a person from now on (no column, sleeps nowhere unless an entry says) and go in Who like Mia
        if (asHelper) await api("POST", "setup/people", { name: guest, type: "helper", color: "#868e96", active: true, grid_column: false });
        const start = fd.get("start"), end = fd.get("end") < start ? start : fd.get("end") || start;
        await putStay({ person: who, kid, from: start, to: end, status: fd.get("stay") || "Tentative", title: `${who} staying with ${kid}` + (fd.get("note") ? ` – ${fd.get("note")}` : ""),
          who: guest && !asHelper ? [kid] : [kid, who], guest: guest && !asHelper ? guest : null, location: stayPlace(kid, start) });
      }, asHelper ? `Saved – ${guest} is a helper now` : "Saved");
    };
  });
}


// ---------- 🗓 Plan the holiday: where a child sleeps through a school holiday, as stretches ("Town House 27 Nov – 12 Dec,
// Beach House 13 Dec – 3 Jan …"). Each stretch is a normal entry with a location, so the grid, ⚠ rules and emails just work.
// "Same for <other child>" copies the stretches to them - only on days they're also on holiday and have nothing set yet.
const daysIn = (a, b) => { const out = []; for (let d = parse(a); iso(d) <= b; d = addDays(d, 1)) out.push(iso(d)); return out; };
const runsOf = (days) => days.reduce((r, d) => { const last = r[r.length - 1];
  if (last && iso(addDays(parse(last[1]), 1)) === d) last[1] = d; else r.push([d, d]); return r; }, []);
const stayTitle = (person, loc, note) => {
  const pl = LOC()[loc] || {};
  const where = { away: `${person} away`, school: `${person} at school (boarding)`, friend: `${person} at a friend's house` }[pl.kind] || `${person} at ${pl.label}`;
  return where + (note ? ` – ${note}` : "");
};
// where `kid` sleeps on these days from entries (not counting the usual place)
const staysOf = (kid, from, to) => state.data.events.filter((e) => e.location && !["Cancelled", "Unavailable"].includes(e.status)
  && e.start <= to && e.end >= from && CalendarRules.expandWho(state.data, e.who).includes(kid));

function holidayPlan(h) {
  const kid = h.child, nights = daysIn(h.start, h.end), places = activePlaces();
  const usual = CalendarRules.homeOf(state.data, kid) || places[0]?.key;
  // the planner's own stretches ("<kid> at <place>[ – note]", for this child alone) can be changed here; anything else
  // (a school camp, a trip with others) shows as a fixed row and is never renamed
  const mine = (e) => whoList(e.who).length === 1 && whoList(e.who)[0] === kid && !e.series
    && (e.title === stayTitle(kid, e.location, "") || e.title.startsWith(stayTitle(kid, e.location, "") + " – "));
  const existing = staysOf(kid, h.start, h.end).sort((a, b) => a.start.localeCompare(b.start));
  const others = KIDS().filter((k) => k !== kid && state.data.schoolHolidays.some((x) => x.child === k && x.start <= h.end && x.end >= h.start));
  const can = canAdd();
  const placeSel = (cur) => `<select data-p>${places.map((p) => `<option value="${esc(p.key)}" ${p.key === cur ? "selected" : ""}>${p.icon} ${esc(p.label)}</option>`).join("")}</select>`;
  const row = (r) => r.fixed
    ? `<div class="vline prow fixed" data-fixed="${r.id}"><span>${LOC()[r.location]?.icon || ""} ${esc(r.title)}</span>
        <small class="muted">${fmtShort(r.start)} – ${fmtShort(r.end)}${whoList(r.who).length > 1 ? ` · with ${esc(whoList(r.who).filter((p) => p !== kid).join(", "))}` : ""} – change it on the entry</small></div>`
    : `<div class="vline prow" ${r.id ? `data-id="${r.id}"` : ""}>${placeSel(r.location)}
        <label>from<input type="date" data-f value="${r.start}"></label><label>to<input type="date" data-t value="${r.end}"></label>
        <span class="vmove"><label title="Pencilled in – might not happen"><input type="checkbox" data-pen ${r.status === "Tentative" ? "checked" : ""}> ✏️</label>
          <button type="button" class="ackbtn" data-x title="Remove">✕</button></span>
        <input data-n placeholder="Note (optional), e.g. with Granny" value="${esc(r.note || "")}"></div>`;
  const noteOf = (e) => { const t = stayTitle(kid, e.location, ""); return e.title.startsWith(t + " – ") ? e.title.slice(t.length + 3) : ""; };
  const start = existing.length ? existing.map((e) => ({ ...e, fixed: !mine(e), note: noteOf(e) }))
    : [{ location: usual, start: h.start, end: h.end, status: "Confirmed" }];
  openDialog(`<form class="form" id="f"><h2>🗓 ${esc(kid)} · ${esc(h.name)}</h2>
    <div class="meta">${fmtDay(h.start)}${CalendarRules.closesAt(h) ? ` (school closes ${esc(CalendarRules.closesAt(h))})` : ""} – ${fmtDay(h.end)} (${nights.length} night${nights.length === 1 ? "" : "s"}) · back at school ${fmtDay(iso(addDays(parse(h.end), 1)))}</div>
    ${state.data.me.canEditAll ? `<label class="pcloses">School closes at <small class="muted">(optional – if they finish early on ${esc(fmtDay(h.start))})</small>
      <input type="time" name="closes_at" value="${esc(CalendarRules.closesAt(h))}"></label>` : ""}
    ${h.notes ? `<div class="hnote">📝 ${esc(h.notes)}</div>` : ""}
    <div class="lbl">Where ${esc(kid)} sleeps</div>
    <div id="prows">${start.map(row).join("")}</div>
    ${can ? `<button type="button" class="ackbtn" id="padd" style="margin-top:6px">+ Add a stretch</button>` : ""}
    <div class="meta" id="pcover"></div>
    ${can && others.length ? `<div class="checks">${others.map((k) => `<label><input type="checkbox" name="same" value="${esc(k)}"> Same for ${esc(k)}
      <small class="muted">(the days ${esc(k)}'s also on holiday and has nothing planned)</small></label>`).join("")}</div>` : ""}
    <div class="err"></div>
    <div class="actions">${state.data.me.canEditAll ? `<button type="button" id="hdates">✏️ Holiday dates</button>` : ""}
      <button type="button" id="cancel">Cancel</button>${can ? `<button class="primary">Save</button>` : ""}</div></form>`, () => {
    const f = $("#f"), rows = () => [...f.querySelectorAll(".prow:not(.fixed)")];
    const read = (r) => ({ id: +r.dataset.id || 0, location: r.querySelector("[data-p]").value, start: r.querySelector("[data-f]").value,
      end: r.querySelector("[data-t]").value, status: r.querySelector("[data-pen]").checked ? "Tentative" : "Confirmed", note: r.querySelector("[data-n]").value.trim() });
    const fixedDays = existing.filter((e) => !mine(e)).flatMap((e) => daysIn(e.start < h.start ? h.start : e.start, e.end > h.end ? h.end : e.end));
    const covered = () => new Set([...fixedDays, ...rows().map(read).filter((r) => r.start && r.end && r.start <= r.end).flatMap((r) => daysIn(r.start, r.end))]);
    const cover = () => {
      const c = covered(), gaps = runsOf(nights.filter((d) => !c.has(d))), n = nights.filter((d) => c.has(d)).length;
      $("#pcover").innerHTML = gaps.length ? `<b>${n} of ${nights.length} nights planned</b> · ❓ not planned: ${gaps.map(([a, b]) => a === b ? fmtShort(a) : `${fmtShort(a)} – ${fmtShort(b)}`).join(", ")}`
        : `✅ <b>All ${nights.length} nights planned</b>`;
    };
    cover();
    f.addEventListener("input", cover); f.addEventListener("change", cover);
    $("#prows").onclick = (e) => { if (e.target.closest("[data-x]")) { e.target.closest(".prow").remove(); cover(); } };
    // + Add a stretch: from the first night not planned yet, to the end of that gap
    $("#padd")?.addEventListener("click", () => {
      const c = covered(), gap = runsOf(nights.filter((d) => !c.has(d)))[0] || [h.end, h.end];
      $("#prows").insertAdjacentHTML("beforeend", row({ location: usual, start: gap[0], end: gap[1], status: "Confirmed" }));
      cover();
    });
    $("#hdates")?.addEventListener("click", () => holidayForm(h));
    $("#cancel").onclick = closeDialog;
    if (!can) return lockForm("Holiday plan");
    f.onsubmit = (x) => {
      x.preventDefault();
      const want = rows().map(read);
      const bad = want.find((r) => !r.start || !r.end || r.end < r.start);
      if (bad) return void ($("#f .err").textContent = "Each stretch needs a from and a to date (to on or after from).");
      const seen = new Map(fixedDays.map((d) => [d, "fixed"]));
      for (const r of want) for (const d of daysIn(r.start, r.end)) {
        if (seen.get(d) === "fixed") return void ($("#f .err").textContent = `${fmtDay(d)} is already covered by another entry (shown above) – change the stretch or that entry.`);
        if (seen.has(d)) return void ($("#f .err").textContent = `Two stretches both cover ${fmtDay(d)} – change one of them.`);
        seen.set(d, r);
      }
      const body = (r, who) => ({ title: stayTitle(who, r.location, r.note), start: r.start, end: r.end, who: [who], category: "Travel", location: r.location, status: r.status });
      submit(async () => {
        // the closing time belongs to the holiday itself (the same box as on ✏️ Holiday dates)
        const closes = f.elements.closes_at ? f.elements.closes_at.value || null : undefined;
        if (closes !== undefined && closes !== (h.closes_at || null) && !(closes === null && !h.closes_at))
          await api("PUT", `school-holidays/${h.id}`, { ...h, closes_at: closes });
        const keep = new Set(want.filter((r) => r.id).map((r) => r.id));
        for (const e of existing.filter((e) => mine(e) && !keep.has(e.id))) await api("DELETE", `events/${e.id}`);
        for (const r of want) {
          const before = existing.find((e) => e.id === r.id), b = body(r, kid);
          if (!r.id) await api("POST", "events", b);
          else if (["title", "start", "end", "location", "status"].some((k) => b[k] !== before[k])) await api("PUT", `events/${r.id}`, { ...before, ...b, loaded_at: before.updated_at || "" });
        }
        // Same for <other child>: their own holiday days that have nothing planned yet
        let copied = 0;
        for (const k of new FormData(f).getAll("same")) {
          const hol = new Set(state.data.schoolHolidays.filter((x) => x.child === k).flatMap((x) => daysIn(x.start, x.end)));
          const taken = new Set(staysOf(k, h.start, h.end).flatMap((e) => daysIn(e.start, e.end)));
          for (const r of want) for (const [a, b] of runsOf(daysIn(r.start, r.end).filter((d) => hol.has(d) && !taken.has(d)))) {
            await api("POST", "events", body({ ...r, start: a, end: b }, k)); copied++;
          }
        }
        submit.msg = `Saved ${kid}'s ${h.name}${copied ? ` (+ ${copied} for ${new FormData(f).getAll("same").join(" & ")})` : ""}`;
      }, () => submit.msg);
    };
  });
}
// the school holiday `kid` is on on `key` (to open the planner from a square or a ⚠)
const holidayOn = (kid, key) => state.data.schoolHolidays.find((x) => x.child === kid && x.start <= key && x.end >= key);

// quick "where are they staying from … to …" - creates a normal entry with a location
function stayForm(person, key) {
  // "To" starts at the end of the run of ❓ days from here (or the same day)
  let until = key;
  if (whereIndex(key, key)[key][person]?.loc === "unknown") {
    const idx = whereIndex(key, iso(addDays(parse(key), 60)));
    for (let d = addDays(parse(key), 1); idx[iso(d)]?.[person]?.loc === "unknown"; d = addDays(d, 1)) until = iso(d);
  }
  openDialog(`<form class="form" id="f"><h2>Where is ${esc(person)} staying?</h2>
    <div class="seg seg-loc">${activePlaces().map((v, i) =>
      `<label><input type="radio" name="loc" value="${esc(v.key)}" ${i === 0 ? "checked" : ""}> ${v.icon} ${esc(v.label)}</label>`).join("")}</div>
    <div class="two"><label>From<input type="date" name="start" value="${key}" required></label>
      <label>To<input type="date" name="end" value="${until}" required></label></div>
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

// ---------- houses that need someone (Settings > Places "needs", e.g. the dogs): house-sitting or "not required"
function houseButtons(key) {
  return CalendarRules.houseNeeds(state.data, key).map((h) => {
    const pl = LOC()[h];
    const pick = helperPick(key);
    return (pick ? `<span class="qstay">${pick} house-sitting ${esc(pl.label)} ${qdates(key, emptyUntil(h, key))}
        <button type="button" data-housesit="@|${esc(h)}|${key}|Tentative">⏳ Asked</button>
        <button type="button" data-housesit="@|${esc(h)}|${key}|Confirmed">✅ House-sitting</button>
        <button type="button" data-housesit="@|${esc(h)}|${key}|Unavailable">🚫 Can't</button></span>` : allOnLeave(key))
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
function houseSit(helper, h, key, status, r = null) {
  r ||= { from: key, to: emptyUntil(h, key) };
  const pl = LOC()[h], label = { Tentative: "asked", Unavailable: "can't" }[status] || "house-sitting";
  submit(() => putStay({ person: helper, house: h, from: r.from, to: r.to, status, title: `${helper} house-sitting`, who: [helper], location: h }),
    `${helper} at the ${pl.label} ${rangeTxt(r)}: ${label}`);
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
  const sort = canAdd() && alone.length;
  openDialog(`<form class="form" id="f"><h2>${parse(key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h2>
    ${clashes.length ? `<div class="clashes">${clashes.map((c) => `<div>⚠ ${esc(c)}${ackBy(key, c) ? ` <small class="muted">· 👍 noted by ${esc(ackBy(key, c))}</small>` : ""}</div>`).join("")}</div>` : `<p class="muted">No clashes 👍</p>`}
    ${CalendarRules.maybesFor(state.data, key).map((c) => `<div class="dmaybe">❔ ${esc(c)}</div>`).join("")}
    <div class="meta">${placesTxt}</div>
    ${canAdd() && alone.length ? stayFields(key, alone) : ""}
    ${canAdd() && !sort ? alone.filter((k) => isSchoolDay(k, key)).map((k) => `<div class="qstay">${esc(k)} to school:
        <button type="button" data-uber="${esc(k)}|${key}">🚕 Uber to school</button></div>`).join("") : ""}
    ${canAdd() && CalendarRules.houseNeeds(state.data, key).length ? `<div class="dwarn" style="border-radius:10px;border:0">${houseButtons(key)}</div>` : ""}
    ${KIDS().filter((k) => wh[k]?.loc === "unknown" && holidayOn(k, key)).map((k) =>
      `<div class="qstay"><button type="button" class="go" data-plan="${esc(k)}|${key}">🗓 Plan ${esc(k)}'s ${esc(holidayOn(k, key).name)}</button></div>`).join("")}
    <div class="err"></div>
    <div class="actions"><button type="button" id="cancel">Close</button>
      <button type="button" id="seeday" ${sort ? "" : 'class="primary"'}>See the day</button>${sort ? `<button class="primary">Save</button>` : ""}</div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#seeday").onclick = () => daySheet(key);
    if (sort) wireStayFields(key);
    $("#f").onsubmit = (e) => { e.preventDefault(); if (sort) saveStayFields(key); };
  });
}

// "Who's with <child>?" on the ⚠ sheet: one line per night of the stretch they'd be without a parent, each with its own answer
// (✅ / ⏳ / 🚫 a helper or someone typed in, 🏡 OK alone, or not sorted), starting from what's on the calendar now;
// "Set all nights to" fills every line; one Save. Nights with the same answer are kept together as one entry.
const parents = () => state.data.people.filter((p) => p.type === "household" && !p.child && p.active).map((p) => p.name);
// the nights around `key` that `kid` is at the same house with no parent there (helpers / OK-alone don't end it), at most 3 weeks
function nightsOf(kid, key) {
  const house = stayPlace(kid, key), from = iso(addDays(parse(key), -21)), to = iso(addDays(parse(key), 21)), idx = whereIndex(from, to);
  const open = (d) => idx[d]?.[kid]?.loc === house && !parents().some((p) => idx[d][p]?.loc === house && !idx[d][p].tentative);
  let a = key, b = key;
  while (a > from && open(dayStep(a, -1))) a = dayStep(a, -1);
  while (b < to && open(dayStep(b, 1))) b = dayStep(b, 1);
  const out = []; for (let d = a; d <= b; d = dayStep(d, 1)) out.push(d);
  return out;
}
// what's on the calendar for `kid` on night `d`: "alone", "<status>|<name>" (the latest stay), or ""
function nightAnswer(kid, d) {
  const on = state.data.events.filter((e) => e.location && e.status !== "Cancelled" && e.start <= d && e.end >= d && whoList(e.who).includes(kid)
    && (e.alone_ok || CalendarRules.stayOf(state.data, e))).sort((x, y) => (y.updated_at || "").localeCompare(x.updated_at || "") || y.id - x.id);
  const e = on[0];
  return !e ? "" : e.alone_ok ? ALONE : `${e.status}|${CalendarRules.stayOf(state.data, e)}`;
}
const ANS = { Confirmed: "✅", Tentative: "⏳", Unavailable: "🚫" };
const answerLabel = (v) => !v ? "— not sorted" : v === ALONE ? "🏡 OK alone" : (([st, n]) => `${ANS[st]} ${n}${st === "Tentative" ? " asked" : st === "Unavailable" ? " can't" : ""}`)(v.split("|"));
// 🚕 the Uber-to-school entries for `kid` on day `d` (Transport, made by the 🚕 tick box / "Uber to school")
const ubersOn = (kid, d) => state.data.events.filter((e) => e.category === "Transport" && e.start <= d && e.end >= d && whoList(e.who).includes(kid) && /uber/i.test(e.title));
const uberOn = (kid, d) => ubersOn(kid, d).length > 0;
function nightOptions(names, value, blank = "— not sorted") {
  const vals = [...names.flatMap((n) => ["Confirmed", "Tentative", "Unavailable"].map((st) => `${st}|${n}`)), ALONE];
  if (value && !vals.includes(value)) vals.unshift(value);
  return `<option value="">${blank}</option>${vals.map((v) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(answerLabel(v))}</option>`).join("")}`;
}
function stayFields(key, alone) {
  const kid = alone[0];
  return `<div class="sortbox" id="sortbox" data-kid="${esc(kid)}">${alone.length > 1 ? `<label>Child<select name="kid">${alone.map((k) => `<option>${esc(k)}</option>`).join("")}</select></label>` : ""}<div id="nights"></div></div>`;
}
function drawNights(key, kid) {
  const nights = nightsOf(kid, key), now = Object.fromEntries(nights.map((d) => [d, nightAnswer(kid, d)]));
  const typed = [...new Set(Object.values(now).filter((v) => v && v !== ALONE).map((v) => v.split("|")[1]))];
  const names = [...new Set([...CalendarRules.helpersFree(state.data, key), ...typed, ...(drawNights.extra || [])])];
  const box = $("#nights");
  box.dataset.kid = kid;
  box.innerHTML = `<h3>🏠 Who's with ${esc(kid)}?</h3>
    <div class="nset"><span>Set all nights to</span><select id="nall">${nightOptions(names, "", "– choose –")}</select></div>
    <div class="nlist">${nights.map((d) => { const school = isSchoolDay(kid, d), uber = uberOn(kid, d);
      return `<div class="nrow ${d === key ? "today" : ""}"><span>${esc(fmtDay(d))}${school ? `<small class="nschool">school</small>` : ""}</span>
      <select data-night="${d}" data-was="${esc(now[d])}" aria-label="${esc(fmtDay(d))}">${nightOptions(names, now[d])}</select>
      ${school ? `<span class="nuber"><input type="checkbox" id="u${d}" data-uber="${d}" data-was="${uber ? 1 : ""}" ${uber ? "checked" : ""}><label for="u${d}">🚕 Uber</label></span>` : "<span></span>"}</div>`; }).join("")}</div>
    <div class="nadd"><input id="nname" maxlength="60" placeholder="Someone else? Type their name"><button type="button" class="ackbtn" id="naddb">+ Add</button>
      ${state.data.me.isAdmin ? `<span class="nhelper"><input type="checkbox" id="nsave"><label for="nsave">save as a helper</label></span>` : ""}</div>
    <p class="meta" style="margin:6px 0 0">✅ someone staying or 🏡 OK alone clears the ⚠ for that night; ⏳ asked and 🚫 can't keep it.</p>`;
  $("#nall").onchange = (e) => { if (e.target.value) box.querySelectorAll("[data-night]").forEach((s) => { s.value = e.target.value; }); e.target.value = ""; };
  $("#naddb").onclick = () => {
    const n = $("#nname").value.trim(); if (!n) return;
    (drawNights.extra ||= []).push(n); drawNights.save = $("#nsave")?.checked ? [...(drawNights.save || []), n] : drawNights.save;
    const keep = Object.fromEntries([...box.querySelectorAll("[data-night]")].map((s) => [s.dataset.night, s.value]));
    const ticks = Object.fromEntries([...box.querySelectorAll("[data-uber]")].map((c) => [c.dataset.uber, c.checked]));
    drawNights(key, kid);
    box.querySelectorAll("[data-night]").forEach((s) => { if (keep[s.dataset.night] !== undefined) s.value = keep[s.dataset.night]; });
    box.querySelectorAll("[data-uber]").forEach((c) => { if (ticks[c.dataset.uber] !== undefined) c.checked = ticks[c.dataset.uber]; });
    toast(`${n} added – pick them for the nights they're there`);
  };
}
function wireStayFields(key) {
  drawNights.extra = []; drawNights.save = [];
  const f = $("#f");
  drawNights(key, f.elements.kid?.value || $("#sortbox").dataset.kid);
  if (f.elements.kid) f.elements.kid.onchange = () => drawNights(key, f.elements.kid.value);
}
// every stay-like entry for `kid` (helpers / someone typed in / OK alone) cut back so it doesn't cover from..to
async function clearNights(kid, from, to) {
  const keep = (o) => ({ title: o.title, who: whoList(o.who), category: o.category, status: o.status, location: o.location, guest: o.guest, alone_ok: !!o.alone_ok,
    important: o.important, notes: o.notes });
  for (const o of state.data.events.filter((e) => e.location && e.status !== "Cancelled" && whoList(e.who).includes(kid) && (e.alone_ok || CalendarRules.stayOf(state.data, e))
    && e.start <= to && e.end >= from)) {
    const before = o.start < from, after = o.end > to, put = (x) => api("PUT", `events/${o.id}`, { ...o, who: whoList(o.who), ...x, loaded_at: o.updated_at || "" });
    if (!before && !after) { await api("DELETE", `events/${o.id}`); continue; }
    if (before) await put({ end: dayStep(from, -1) });
    if (after) await (before ? api("POST", "events", { ...keep(o), start: dayStep(to, 1), end: o.end }) : put({ start: dayStep(to, 1) }));
  }
}
async function saveStayFields(key) {
  const box = $("#nights"), kid = box.dataset.kid, rows = [...box.querySelectorAll("[data-night]")].map((s) => ({ d: s.dataset.night, v: s.value, was: s.dataset.was }));
  const changed = rows.filter((r) => r.v !== r.was);
  const ubers = [...box.querySelectorAll("[data-uber]")].map((c) => ({ d: c.dataset.uber, on: c.checked, was: !!c.dataset.was })).filter((u) => u.on !== u.was);
  if (!changed.length && !ubers.length) return closeDialog();
  // the changed nights, in runs of consecutive nights with the same new answer
  const runs = [];
  for (const r of changed) { const last = runs.at(-1); if (last && last.v === r.v && dayStep(last.to, 1) === r.d) last.to = r.d; else runs.push({ v: r.v, from: r.d, to: r.d }); }
  const helpersNow = helpers(), house = stayPlace(kid, key);
  submit(async () => {
    for (const n of drawNights.save || []) if (!helpersNow.includes(n)) await api("POST", "setup/people", { name: n, type: "helper", color: "#868e96", active: true, grid_column: false });
    const isHelper = (n) => helpersNow.includes(n) || (drawNights.save || []).includes(n);
    for (const r of runs) {
      await clearNights(kid, r.from, r.to); await refresh();
      if (!r.v) continue;
      if (r.v === ALONE) { await api("POST", "events", { title: `${kid} home alone (OK)`, start: r.from, end: r.to, who: [kid], category: "Household", location: house, alone_ok: true, status: "Confirmed" }); continue; }
      const [status, name] = r.v.split("|"), helper = isHelper(name);
      await api("POST", "events", { title: `${name} staying with ${kid}`, start: r.from, end: r.to, who: helper ? [kid, name] : [kid], guest: helper ? null : name,
        category: "Household", location: house, status });
    }
    // 🚕 ticked: an "Uber to school" entry that day; unticked: that day's Uber entry goes (a longer one is cut around the day)
    for (const u of ubers) {
      if (u.on) { await api("POST", "events", { title: "🚕 Uber to school 🚕", who: [kid], start: u.d, end: u.d, category: "Transport", notes: "Uber to and from school" }); continue; }
      for (const o of ubersOn(kid, u.d)) {
        if (o.start === o.end) { await api("DELETE", `events/${o.id}`); continue; }
        const put = (x) => api("PUT", `events/${o.id}`, { ...o, who: whoList(o.who), ...x, loaded_at: o.updated_at || "" });
        if (o.start === u.d) await put({ start: dayStep(u.d, 1) }); else if (o.end === u.d) await put({ end: dayStep(u.d, -1) });
        else { await put({ end: dayStep(u.d, -1) }); await api("POST", "events", { title: o.title, who: whoList(o.who), start: dayStep(u.d, 1), end: o.end, category: o.category, notes: o.notes }); }
      }
    }
  }, `${kid}'s nights saved` + (runs.length ? ` – ${runs.map((r) => `${answerLabel(r.v)} ${fmtShort(r.from)}${r.to !== r.from ? "–" + fmtShort(r.to) : ""}`).join(", ")}` : "")
    + (ubers.length ? ` · 🚕 ${[ubers.some((u) => u.on) && `Uber booked ${ubers.filter((u) => u.on).map((u) => fmtShort(u.d)).join(", ")}`,
      ubers.some((u) => !u.on) && `Uber off ${ubers.filter((u) => !u.on).map((u) => fmtShort(u.d)).join(", ")}`].filter(Boolean).join(" · ")}` : ""));
}

document.addEventListener("click", (e) => {
  if (!state.data) return;
  const ev = e.target.closest("[data-ev]");
  const cell = e.target.closest("[data-cell]");
  const ack = e.target.closest("[data-ack],[data-unack]");
  if (ack) { e.stopPropagation(); return ackRun(ack); }
  const plan = e.target.closest("[data-plan]");
  if (plan) { e.stopPropagation(); const [k, key] = plan.dataset.plan.split("|"); return holidayPlan(holidayOn(k, key)); }
  const pon = e.target.closest("[data-pon]"), poff = e.target.closest("[data-poff]");
  if (pon || poff) { e.stopPropagation(); const ev = state.data.events.find((x) => x.id == (pon || poff).dataset[pon ? "pon" : "poff"]); return pon ? confirmEvent(ev) : deleteEvent(ev); }
  const ub = e.target.closest("[data-uber]");
  if (ub) { e.stopPropagation(); const [k, key] = ub.dataset.uber.split("|"); return uberForm(k, key); }
  const hs = e.target.closest("[data-housesit]"), hn = e.target.closest("[data-housenot]");
  if (hs) { e.stopPropagation(); const [x, h, key, st] = hs.dataset.housesit.split("|"), who = x === "@" ? picked(hs) : x;
    // someone else house-sitting: a house-sit has no child to go with, so they're added as a helper first (admins), then booked
    if (who === OTHER) {
      const name = prompt("Who's house-sitting? (their name)")?.trim(); if (!name) return;
      if (!state.data.me.isAdmin) return toast("Ask an admin to add them as a helper on Settings › Family first");
      if (!confirm(`Add ${name} as a helper (Settings › Family), so they can house-sit?`)) return;
      return api("POST", "setup/people", { name, type: "helper", color: "#868e96", active: true, grid_column: false })
        .then(() => refresh()).then(() => houseSit(name, h, key, st, rangeOf(hs, key, emptyUntil(h, key)))).catch((x) => toast(x.message));
    }
    return houseSit(who, h, key, st, rangeOf(hs, key, emptyUntil(h, key))); }
  if (hn) { e.stopPropagation(); const [h, key] = hn.dataset.housenot.split("|"); return houseNotForm(h, key); }
  const qs = e.target.closest("[data-quickstay]");
  if (qs) { e.stopPropagation(); const [h, k, key, st] = qs.dataset.quickstay.split("|"), who = h === "@" ? picked(qs) : h, r = rangeOf(qs, key, aloneUntil(k, key));
    return who === ALONE ? aloneOk(k, key, r) : who === OTHER ? helperForm(null, k, r.from, r.to, { other: true, status: st }) : quickStay(who, k, key, st, false, r); }
  const clash = e.target.closest("[data-clash]");
  if (cell && !ev && !e.target.closest("[data-sh]")) { e.stopPropagation(); const [k, p] = cell.dataset.cell.split("|"); cellSheet(k, p); }
  else if (clash) { e.stopPropagation(); clashSheet(clash.dataset.clash); }
}, true);
