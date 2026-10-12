// Family calendar - front end (no build step, plain JS)
// person colours come from the Setup > People list (grey for anyone unknown/hidden)
const colorMap = {};
const COLORS = new Proxy(colorMap, { get: (t, k) => t[k] || "#868e96" });
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// opening the site starts on Month; a refresh (F5) in the same tab stays on the tab you were on
function lastTab() {
  try { return ["month", "upcoming", "birthdays", "school", "log", "info", "setup"].find((v) => v === sessionStorage.getItem("cal.view")) || "month"; }
  catch { return "month"; }
}
const state = {
  data: null, view: lastTab(), weeks: 6, monthsBefore: 0, monthsAfter: 4, loadingMonths: false,
  filter: new Set(load("filter") || []),   // empty = everyone
};

// ---------- small helpers
function load(k) { try { return JSON.parse(localStorage.getItem("cal." + k)); } catch { return null; } }
function save(k, v) { try { localStorage.setItem("cal." + k, JSON.stringify(v)); } catch {} }
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayISO = () => iso(new Date());
const fmtDay = (s) => parse(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtShort = (s) => parse(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtLong = (s) => parse(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
const whoList = (w) => String(w || "").split(",").map((x) => x.trim()).filter(Boolean);
const pchips = (people) => people.map((p) => `<span class="p" style="--c:${COLORS[p]}">${esc(p)}</span>`).join("");

function toast(msg, action) {   // action = { label, run }: e.g. "Undo" after a delete (stays up longer)
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  t.classList.toggle("act", !!action);
  if (action) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = action.label;
    b.onclick = () => { t.classList.remove("show"); action.run(); };
    t.append(" ", b);
  }
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), action ? 8000 : 2200);
}

async function api(method, path, body) {
  const headers = { "content-type": "application/json" };
  const as = load("viewAs");                       // demo only: "View as" another login
  if (as) headers["X-Demo-User"] = as;
  let code = null; try { code = sessionStorage.getItem("setupCode"); } catch { /* private mode */ }
  if (code) headers["X-Setup-Code"] = code;        // a new install before sign-in is switched on
  const r = await fetch("/api/" + path, { method, headers,
                                          body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && data.setup) { setupLogin(!!code); throw new Error("setup"); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// ---------- a brand-new install: the setup password (chosen on Cloudflare's deploy page) until sign-in is switched on
function setupLogin(wrong) {
  try { sessionStorage.removeItem("setupCode"); } catch { /* */ }
  $("#main").innerHTML = `<div class="card pad" style="max-width:460px;margin:30px auto"><h3 style="margin-top:0">👋 Welcome to your family calendar</h3>
    <p class="muted">Enter the <b>setup password</b> you chose when you installed it. You only need it until sign-in is switched on (a few minutes from now).</p>
    <form id="sf" class="form"><input type="password" id="sc" placeholder="Setup password" autocomplete="current-password" required>
      ${wrong ? `<div class="err">That isn't it – try again.</div>` : ""}<button class="primary">Continue</button></form></div>`;
  $("#sf").onsubmit = (e) => {
    e.preventDefault();
    try { sessionStorage.setItem("setupCode", $("#sc").value); } catch { /* */ }
    refresh().then(approvalLink).catch(() => {});
  };
}

// wizard step 2 (new install): one Cloudflare key -> email-code sign-in, phone-feed link, the 🔒 Info key (lib/cloudflare-setup.js)
function connectForm() {
  openDialog(`<form class="form" id="f" autocomplete="off"><h2>🔐 Switch on sign-in</h2>
    <p class="muted" style="margin-top:0">Until now only the setup password protects the calendar. This step makes Cloudflare ask for an
      <b>email code</b> instead, and only the people you add can sign in.</p>
    <div class="two"><label>Your name<input name="name" required></label><label>Your email (you'll sign in with it)<input name="email" type="email" required></label></div>
    <details open><summary>Get the Cloudflare key (about 2 minutes)</summary><ol class="meta" style="margin:6px 0 0 18px;padding:0">
      <li>Once: Cloudflare dashboard → <b>Zero Trust</b> in the menu → any team name → <b>Free</b> plan (it asks for a card; Free isn't charged).</li>
      <li>Cloudflare dashboard → <b>person icon</b> (top right) → <b>Profile</b> → <b>API Tokens</b> → <b>Create Token</b> → <b>Create Custom Token</b> → <b>Get started</b>.</li>
      <li>Name: <i>Family calendar</i>. Permissions – add these rows (all <b>Account</b>, all <b>Edit</b>):<br>
        <b>Access: Apps and Policies</b> · <b>Access: Organizations, Identity Providers, and Groups</b> · <b>Workers Scripts</b> ·
        <b>Email Routing Addresses</b>, and one more: <b>Account Settings</b> – <b>Read</b>.</li>
      <li><b>Continue to summary</b> → <b>Create Token</b> → <b>Copy</b>, and paste it here.</li></ol></details>
    <label>Cloudflare key<input name="token" type="password" required autocomplete="new-password"></label>
    <div class="err"></div>
    <div class="actions"><button type="button" id="cancel">Not now</button><button class="primary" id="go">Switch on sign-in</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#f").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData($("#f")), btn = $("#go");
      btn.disabled = true; btn.textContent = "Setting up… (about 30 seconds)";
      try {
        const r = await api("POST", "setup/cloudflare", { name: fd.get("name"), email: fd.get("email"), token: fd.get("token") });
        recoveryScreen(r, fd.get("email"));
      } catch (err) { btn.disabled = false; btn.textContent = "Switch on sign-in"; $("#f .err").textContent = err.message; }
    };
  });
}
function recoveryScreen(r, email) {
  const day = new Date().toISOString().slice(0, 10), text = r.vaultKey ? `${state.data.brand?.full || "Family Calendar"} – recovery key for the 🔒 Info page\n` +
    `Made ${day}. Keep this somewhere safe (a password manager, or printed in a drawer).\nWithout it, the Info page can't be unlocked if the calendar ever has to be reinstalled.\n\n${r.vaultKey}\n` : "";
  openDialog(`<div class="form"><h2>✅ Sign-in is on</h2><div class="meta">${r.steps.map(esc).join("<br>")}</div>
    ${r.vaultKey ? `<div class="card pad" style="border:2px solid var(--brand)"><b>Keep this recovery key safe</b> – it unlocks the 🔒 Info page if the
      calendar ever has to be reinstalled. It is shown only now.<pre style="white-space:pre-wrap;word-break:break-all;user-select:all">${esc(r.vaultKey)}</pre>
      <a class="btn" download="calendar-recovery-key.txt" href="data:text/plain;charset=utf-8,${encodeURIComponent(text)}">⬇️ Download</a>
      <button type="button" onclick="window.print()">🖨️ Print</button></div>` : ""}
    <p>Next: the calendar will reload and Cloudflare will send a code to <b>${esc(email)}</b> to sign in. Add the rest of the family's logins on ⚙ Setup.</p>
    <div class="actions"><button class="primary" id="signin">Sign in now</button></div></div>`, () => {
    $("#signin").onclick = () => { try { sessionStorage.removeItem("setupCode"); } catch { /* */ } setTimeout(() => location.reload(), 1500); };
  });
}

// the calendar's name (Setup > This calendar) in the header, tab title, phone home-screen name and the little icon
function applyBrand(b) {
  if (!b) return;
  document.title = b.site;
  $(".top h1").textContent = b.site;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", b.short);
  const letter = esc((b.family || b.site || "C")[0].toUpperCase());
  document.querySelector('link[rel="icon"]')?.setAttribute("href", `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%231f3864'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='Arial' font-weight='bold'>${letter}</text></svg>`);
}

async function refresh() {
  state.data = await api("GET", "all");
  applyBrand(state.data.brand);
  for (const k of Object.keys(colorMap)) delete colorMap[k];
  for (const p of state.data.people) colorMap[p.name] = p.color;
  const me = state.data.me;
  const ROLE = { admin: "Admin", editor: "Editor", viewer: "Viewer", limited: "Limited" };
  $("#me").innerHTML = me.demo
    ? `<button class="theme-btn" id="viewas">👁 ${esc(me.name)} · ${ROLE[me.role]} ▾</button>`
    : `${esc(me.name)}`;
  if (me.demo) $("#viewas").onclick = viewAsPicker;
  // only show what this login is allowed to use
  const tabOk = { birthdays: me.seeBirthdays, school: me.seeSchool, log: me.seeLog, info: me.isAdmin, setup: me.isAdmin };
  document.querySelectorAll("#tabs button").forEach((b) => { b.hidden = tabOk[b.dataset.view] === false; });
  if (tabOk[state.view] === false) state.view = "month";
  for (const f of [...state.filter]) if (!names().includes(f)) state.filter.delete(f);
  render();
}

// ---------- people + permissions helpers
const names = () => state.data.people.map((p) => p.name);
const typeOf = (name) => state.data.people.find((p) => p.name === name)?.type || "household";
const canAdd = () => state.data.me.canAddEvents;
function canEditEvent(ev) {
  const me = state.data.me;
  if (me.canEditAll) return true;
  return !!me.editablePeople?.length && whoList(ev.who).every((p) => me.editablePeople.includes(p));
}

// ---------- what's on each day
// the filter with "Family" turned into the people ticked "Part of the family" (Setup)
function filterSet() {
  const f = new Set(state.filter);
  if (f.has("Family")) CalendarRules.familyMembers(state.data).forEach((p) => f.add(p));
  return f;
}
// an entry for "Family" (and birthdays) counts for every family member; picking only a tracked person shows only their entries
function visible(people) {
  if (!state.filter.size) return true;
  const f = filterSet();
  return CalendarRules.expandWho(state.data, people.join(",")).some((p) => f.has(p));
}

function buildDays(from, to) {
  const days = {};
  for (let d = parse(from); iso(d) <= to; d = addDays(d, 1)) days[iso(d)] = { ph: null, off: [], offs: [], breaks: [], items: [] };
  const { events, recurring, schoolHolidays, publicHolidays } = state.data;
  for (const h of publicHolidays) if (days[h.date]) days[h.date].ph = h.name;
  for (const h of schoolHolidays) {
    if (!visible([h.child])) continue;   // school holidays follow the name filter too
    for (let d = parse(h.start > from ? h.start : from); iso(d) <= h.end && iso(d) <= to; d = addDays(d, 1)) {
      days[iso(d)].off.push(h.child);
      days[iso(d)].offs.push(h);
    }
    if (days[h.start]) days[h.start].breaks.push(h);
  }
  for (const e of events) {
    if (e.end < from || e.start > to) continue;
    const who = whoList(e.who);
    if (!visible(who)) continue;
    for (let d = parse(e.start > from ? e.start : from); iso(d) <= e.end && iso(d) <= to; d = addDays(d, 1)) {
      days[iso(d)].items.push({ kind: "event", ev: e, who, first: iso(d) === e.start });
    }
  }
  const y0 = parse(from).getFullYear(), y1 = parse(to).getFullYear();
  for (const r of recurring) {
    for (let y = y0; y <= y1; y++) {
      const key = iso(new Date(y, r.month - 1, r.day));
      if (!days[key] || !visible(["Family"])) continue;
      const age = r.born ? y - r.born : null;
      const text = CalendarRules.recText(r, age);
      days[key].items.push({ kind: "birthday", rec: r, who: ["Family"], text });
    }
  }
  for (const k in days) days[k].items.sort((a, b) => (b.kind === "birthday") - (a.kind === "birthday") ||
    (b.ev?.important || 0) - (a.ev?.important || 0));
  return days;
}

function itemHTML(it, opts = {}) {
  if (it.kind === "birthday") {
    return `<div class="item birthday" data-rec="${it.rec.id}"><div class="who">${pchips(["Family"])}</div>
            <div class="title">${esc(it.text)}</div></div>`;
  }
  const e = it.ev;
  const cls = ["item", e.important ? "important" : "", e.status === "Tentative" ? "tentative" : ""].join(" ");
  const range = e.end !== e.start ? `<span class="range">${fmtShort(e.start)} – ${fmtShort(e.end)}</span>` : "";
  const pl = e.location && LOC()[e.location];
  const loc = pl && e.status !== "Unavailable" ? ` <span class="badge loc">${pl.icon} ${pl.kind === "away" ? "Away" : esc(pl.label)}</span>` : "";
  return `<div class="${cls}" data-ev="${e.id}"><div class="who">${pchips(it.who)}</div>
          <div class="title">${e.important ? "⭐ " : ""}${esc(e.title)}${typeof isHelperStay === "function" && isHelperStay(e) ? stayStatus(e) : e.status === "Tentative" && !e.title.includes("?") ? " (?)" : ""}${loc}</div>
          ${opts.range === false ? "" : range}</div>`;
}

function dayHeader(key, info) {
  const badges = [];
  if (info.ph) badges.push(`<span class="badge ph">${esc(info.ph)}</span>`);
  for (const c of KIDS()) if (info.off.includes(c)) badges.push(`<span class="badge off">${esc(c)} off school</span>`);
  return `<div class="day-h"><span class="date">${fmtDay(key)}</span>${badges.join("")}<button class="day-add" data-add="${key}" aria-label="Add on ${fmtDay(key)}">+</button></div>`;
}

// ---------- "Waiting for approval": things the daily inbox check found (proposals), approve / reject per item or per batch
function proposalView(p) {
  const d = p.data;
  if (p.kind === "update") return { when: d.before?.start || "", who: whoList(d.before?.who), title: `${d.before?.title || "entry"} → ${Object.entries(d.changes).map(([k, v]) => `${k}: ${v}`).join(", ")}`, tag: "Change" };
  if (p.kind === "school_holiday") return { when: d.start, end: d.end, who: [d.child], title: `🌿 ${d.name}`, tag: "School holiday" };
  if (p.kind === "public_holiday") return { when: d.date, who: ["Family"], title: d.name, tag: "Public holiday" };
  if (p.kind === "recurring") return { when: null, who: ["Family"], title: `🎂 ${d.name} – ${d.day}/${d.month}`, tag: d.type || "Birthday" };
  return { when: d.start, end: d.end, who: Array.isArray(d.who) ? d.who : whoList(d.who), title: d.title, important: d.important,
           loc: d.location, tentative: d.status === "Tentative" };
}

// a new family's first visit: point the admin at the set-up wizard
function welcomeCard() {
  if (state.data.setupMode && !state.data.needsWizard) return `<div class="card pad"><h3 style="margin-top:0">🔐 Last step: switch on sign-in</h3>
    <p class="muted">Right now only the setup password protects the calendar. Switch on the email-code sign-in so only your family can open it.</p>
    <button class="go" onclick="connectForm()">🔐 Switch on sign-in</button></div>`;
  if (!state.data.needsWizard) return "";
  return `<div class="card pad"><h3 style="margin-top:0">👋 Welcome – set up your calendar</h3>
    <p class="muted">Tell the calendar who's in your family, what you call your house and who needs looking after. It takes about two minutes
      and you can change everything later on the ⚙ Setup tab.</p><button class="go" onclick="wizardForm()">👋 Start</button></div>`;
}

// ---------- set-up wizard: family name, people + roles, houses (POST setup/wizard; only adds, never removes)
// house / place icons to pick from (a select, so nobody has to type an emoji)
const PLACE_ICONS = ["🏠", "🏡", "🏘️", "🏢", "🏖️", "🌊", "🏔️", "🏕️", "🌳", "🌾", "🏝️", "⛵", "🏫", "🛏️", "✈️", "🚗", "👵", "❤️"];
const iconSelect = (attr, cur) => `<select ${attr} title="Icon" style="font-size:18px">${[...new Set([cur, ...PLACE_ICONS].filter(Boolean))]
  .map((i) => `<option ${i === cur ? "selected" : ""}>${i}</option>`).join("")}</select>`;
const WIZARD_ROLE_LABELS = { adult: "Parent / adult", child: "Child", boarder: "Child who boards at school", helper: "Helper (au pair, nanny, house-sitter)",
  visitor: "Visits with the children (e.g. an ex-partner)" };
function wizardForm() {
  const b = state.data.brand || {}, homes = (state.data.places || []).filter((p) => p.kind === "home");
  const known = state.data.people.filter((p) => p.type !== "group").map((p) => p.name);
  const personRow = (p = {}) => `<div class="vline wrow"><input placeholder="Name" value="${esc(p.name || "")}" data-n>
    <select data-r>${Object.entries(WIZARD_ROLE_LABELS).map(([k, v]) => `<option value="${k}" ${p.role === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    <input placeholder="School (children)" data-s value="${esc(p.school || "")}"><span class="vmove"><button type="button" class="ackbtn" data-wdel title="Remove">✕</button></span></div>`;
  const houseRow = (h = {}, i = 0) => `<div class="vline hrow"><input placeholder="${i ? "e.g. Beach House (leave empty if none)" : "e.g. Home, Town House"}" value="${esc(h.label || "")}" data-l>
    ${iconSelect("data-i", h.icon || (i ? "🏡" : "🏠"))}
    <input placeholder="Someone must sleep here because of… (e.g. the dogs)" value="${esc(h.needs || "")}" data-x></div>`;
  openDialog(`<form class="form" id="f" autocomplete="off"><h2>👋 Set up your calendar</h2>
    <div class="two"><label>Family name<input name="family_name" value="${esc(b.family || "")}" placeholder="e.g. Smith" required></label>
      <label>Calendar name <small class="muted">(optional)</small><input name="site_name" placeholder="${esc(b.family ? b.family + " Calendar" : "Smith Calendar")}"></label></div>
    <div><div class="lbl">Who's in the calendar?${known.length ? ` <small class="muted">(already there: ${esc(known.join(", "))} – add anyone else)</small>` : ""}</div>
      <div id="wpeople">${known.length ? personRow() : personRow({ role: "adult" }) + personRow({ role: "adult" }) + personRow({ role: "child" })}</div>
      <button type="button" class="ackbtn" id="wadd" style="margin-top:6px">+ Add a person</button></div>
    <div><div class="lbl">Your houses <small class="muted">(a child at a house needs an adult there)</small></div>
      <div id="whouses">${houseRow(homes[0] || {}, 0)}${houseRow(homes[1] || {}, 1)}</div></div>
    <div class="meta">Children who board sleep at school in term time; helpers only count at a house when an entry says they're staying.
      You can change all of this later under ⚙ Setup.</div>
    <div class="err"></div>
    <div class="actions"><button type="button" id="cancel">Not now</button><button class="primary">Save</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#wadd").onclick = () => $("#wpeople").insertAdjacentHTML("beforeend", personRow());
    $("#wpeople").onclick = (e) => { if (e.target.closest("[data-wdel]")) e.target.closest(".wrow").remove(); };
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const f = $("#f");
      const body = { family_name: f.elements.family_name.value, site_name: f.elements.site_name.value,
        people: [...f.querySelectorAll(".wrow")].map((r) => ({ name: r.querySelector("[data-n]").value, role: r.querySelector("[data-r]").value, school: r.querySelector("[data-s]").value })),
        houses: [...f.querySelectorAll(".hrow")].map((r) => ({ label: r.querySelector("[data-l]").value, icon: r.querySelector("[data-i]").value, needs: r.querySelector("[data-x]").value })) };
      submit(async () => { const r = await api("POST", "setup/wizard", body); submit.msg = r.added.length ? `Added ${r.added.join(", ")}` : "Saved"; }, () => submit.msg);
    };
  });
}

// admins: the scheduled jobs (Sunday email, outbox, inbox clean-up, health alerts) stamp the database every 10 minutes;
// if that stops for 30 minutes nothing else can say so, so the site does
function jobsCard() {
  const at = state.data.jobsRanAt;
  if (!state.data.me.isAdmin || state.data.me.demo || (at && Date.now() - new Date(at).getTime() < 30 * 60000)) return "";
  return `<div class="sorting"><b>⚠ The calendar's background jobs haven't run ${at ? `since ${esc(new Date(at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}` : "yet"}</b>
    <div class="muted" style="font-size:13px">These send the Sunday email and queued emails. Ask Claude to look at the Worker's cron triggers.</div></div>`;
}

function approvalCard() {
  const ps = state.data.proposals || [];
  if (!ps.length) return "";
  const batches = [...new Set(ps.map((p) => p.batch))];
  return `<div class="approvals" id="approvals"><div class="ap-h">📥 Waiting for approval <span class="warn" style="background:#1f6feb">${ps.length}</span>
      <small class="muted">found in ${esc(state.data.brand?.inbox || "the inbox")}</small></div>
    ${batches.map((b) => {
      const items = ps.filter((p) => p.batch === b), first = items[0];
      return `<div class="ap-batch"><div class="ap-src"><b>${esc(first.summary)}</b><br><small class="muted">From: ${esc(first.source)}</small></div>
        ${first.checks.length ? `<div class="dwarn">${first.checks.map((c) => `<div>⚠ ${esc(c)}</div>`).join("")}</div>` : ""}
        ${items.map((p) => {
          const v = proposalView(p);
          const when = !v.when ? "Every year" : v.end && v.end !== v.when ? `${fmtShort(v.when)} – ${fmtShort(v.end)}` : fmtDay(v.when);
          return `<div class="ap-row ${v.important ? "important" : ""}"><span class="ap-when">${when}</span>
            <span class="ap-what">${pchips(v.who)} ${v.tag ? `<span class="badge loc">${esc(v.tag)}</span> ` : ""}${v.important ? "⭐ " : ""}${esc(v.title)}${v.tentative ? " (?)" : ""}
              ${v.loc && LOC()[v.loc] ? `<span class="badge loc">${LOC()[v.loc].icon} ${LOC()[v.loc].kind === "away" ? "Away" : esc(LOC()[v.loc].label)}</span>` : ""}
              ${p.note ? `<br><small class="muted">${esc(p.note)}</small>` : ""}</span>
            <span class="ap-btns">${p.kind === "event" ? `<button type="button" data-editp="${p.id}" title="Change it, then add it">✏️</button>` : ""}
              <button type="button" data-approve="${p.id}" title="Add to the calendar">✅</button>
              <button type="button" data-reject="${p.id}" title="Don't add">❌</button></span></div>`;
        }).join("")}
        <div class="ap-all"><button type="button" class="primary" data-approve-batch="${b}">✅ Approve all ${items.length}</button>
          <button type="button" data-reject-batch="${b}">Reject all</button></div></div>`;
    }).join("")}</div>`;
}

// Links in the "items to approve" email open the site with ?p=<id>&do=approve (or ?batch=<id>). They never act on
// their own (mail scanners such as Outlook Safe Links open every link) - they show the item(s) and wait for Confirm.
function approvalLink() {
  const q = new URLSearchParams(location.search);
  const act = q.get("do"), pid = +q.get("p"), bid = +q.get("batch");
  if (!act || !(pid || bid)) return;
  history.replaceState(null, "", location.pathname);   // a refresh mustn't ask again
  const ps = state.data.proposals || [];
  const items = pid ? ps.filter((p) => p.id === pid) : ps.filter((p) => p.batch === bid);
  const approve = act === "approve";
  if (!items.length) {
    return openDialog(`<div class="form"><h2>Already done 👍</h2><p class="muted">${pid ? "This item has" : "These items have"} already been approved or rejected (maybe by someone else).</p>
      <div class="actions"><button class="primary" id="ok">OK</button></div></div>`, () => { $("#ok").onclick = closeDialog; });
  }
  openDialog(`<div class="form"><h2>${approve ? "✅ Add to the calendar?" : "❌ Don't add?"}</h2>
    <div class="meta">From: ${esc(items[0].source)}</div>
    <div class="sheet-list">${items.map((p) => { const v = proposalView(p);
      const when = !v.when ? "Every year" : v.end && v.end !== v.when ? `${fmtShort(v.when)} – ${fmtShort(v.end)}` : fmtDay(v.when);
      return `<div class="ap-row ${v.important ? "important" : ""}" style="grid-template-columns:110px 1fr"><span class="ap-when">${when}</span>
        <span>${pchips(v.who)} ${v.important ? "⭐ " : ""}${esc(v.title)}${p.note ? `<br><small class="muted">${esc(p.note)}</small>` : ""}</span></div>`; }).join("")}</div>
    <div class="actions"><button type="button" id="cancel">Not now</button>
      <button class="primary" id="go">${approve ? `✅ Confirm – add ${items.length > 1 ? "all " + items.length : "it"}` : `❌ Confirm – don't add${items.length > 1 ? " any" : ""}`}</button></div></div>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#go").onclick = async () => { closeDialog(); const ids = items.map((p) => p.id); await (approve ? decide(ids, []) : decide([], ids)); };
  });
}

async function decide(approve, reject, edits) {
  try {
    const r = await api("POST", "proposals/decide", { approve, reject, edits });
    toast(r.emailed?.length ? `Done – summary emailed (${r.emailed.join(", ")})` : `${r.decided} done`);
    await refresh();
  } catch (e) { toast(e.message); }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-approve],[data-reject],[data-approve-batch],[data-reject-batch],[data-editp]");
  if (!t || !state.data) return;
  e.stopPropagation();
  const ids = (b) => state.data.proposals.filter((p) => p.batch === +b).map((p) => p.id);
  if (t.dataset.editp) {   // open the proposal in the normal form; Save = approve this changed version
    const p = state.data.proposals.find((x) => x.id === +t.dataset.editp), d = p.data;
    eventForm(null, { copy: { ...d, who: Array.isArray(d.who) ? d.who.join(", ") : d.who, end: d.end || d.start },
      title: "Change, then add", onSave: (body) => decide([p.id], [], { [p.id]: body }).then(closeDialog) });
  }
  else if (t.dataset.approve) decide([+t.dataset.approve], []);
  else if (t.dataset.reject) decide([], [+t.dataset.reject]);
  else if (t.dataset.approveBatch) decide(ids(t.dataset.approveBatch), []);
  else if (t.dataset.rejectBatch && confirm("Reject all of these?")) decide([], ids(t.dataset.rejectBatch));
}, true);

// ---------- views
function renderUpcoming() {
  const start = mondayOf(new Date());
  const from = iso(start), to = iso(addDays(start, state.weeks * 7 - 1));
  const days = buildDays(from, to);
  const today = todayISO();
  let html = welcomeCard() + jobsCard() + approvalCard() + sortingCard();
  for (let w = 0; w < state.weeks; w++) {
    const mon = addDays(start, w * 7), sun = addDays(mon, 6);
    let body = "";
    const off = Object.fromEntries(KIDS().map((c) => [c, []]));
    for (let i = 0; i < 7; i++) {
      const key = iso(addDays(mon, i)), info = days[key], isToday = key === today;
      for (const c of info.off) (off[c] ||= []).push(key);
      // multi-day events get a full row on their first day (and on the first day of the view);
      // on the days after that they appear in a slim "Still on" line so the day doesn't look free
      const items = info.items.filter((it) => it.kind !== "event" || it.first || key === from);
      const ongoing = info.items.filter((it) => it.kind === "event" && !it.first && key !== from);
      const breakItems = info.breaks.map((b) => `<div class="item" data-sh="${b.id}"><div class="who">${pchips([b.child])}</div>
        <div class="title">🌿 ${esc(b.name)} starts${b.status === "Tentative" ? " (?)" : ""}</div>
        <span class="range">${fmtShort(b.start)} – ${fmtShort(b.end)}</span></div>`);
      const stillOn = ongoing.length ? `<div class="still">Still on: ${ongoing.map((it) =>
        `<span data-ev="${it.ev.id}"><b style="color:${COLORS[it.who[0]]}">${esc(it.who.join(" & "))}</b> ${it.ev.location && LOC()[it.ev.location] ? LOC()[it.ev.location].icon + " " : ""}${esc(it.ev.title)} <small>(to ${fmtShort(it.ev.end)})</small></span>`).join(" · ")}</div>` : "";
      const dow = parse(key).getDay();
      const cls = ["day", isToday ? "today" : "", dow === 0 || dow === 6 ? "weekend" : "", key < today ? "past" : ""].join(" ");
      const warn = dayWarnings(key);   // ⚠ things to sort that day (grid.js)
      if (!items.length && !breakItems.length && !warn) {   // free day: slim row
        body += `<div class="${cls} free" id="d-${key}" data-add="${key}"><div class="free-row"><span class="date">${fmtDay(key)}</span>
                 ${info.ph ? `<span class="badge ph">${esc(info.ph)}</span>` : ""}<span class="free-txt">${ongoing.length ? "" : "Free"}</span>
                 <span class="free-add">+</span></div>${stillOn}</div>`;
        continue;
      }
      body += `<div class="${cls}" id="d-${key}">${dayHeader(key, info)}${warn}${breakItems.join("")}${items.map((it) => itemHTML(it)).join("")}${stillOn}</div>`;
    }
    const label = w === 0 ? "This week" : w === 1 ? "Next week" : `Week of ${fmtShort(iso(mon))}`;
    const range = mon.getMonth() === sun.getMonth()
      ? `${mon.getDate()} – ${sun.getDate()} ${MONTHS[sun.getMonth()].slice(0, 3)}`
      : `${fmtShort(iso(mon))} – ${fmtShort(iso(sun))}`;
    const offBadges = Object.keys(off).filter((c) => off[c].length).map((c) => {
      const d = off[c], all = d.length === 7;
      const span = all ? "all week" : d.length === 1 ? fmtDay(d[0]).split(" ")[0] : `${fmtDay(d[0]).split(" ")[0]}–${fmtDay(d[d.length - 1]).split(" ")[0]}`;
      return `<span class="badge off">${esc(c)} off ${span}</span>`;
    }).join("");
    html += `<section class="wk ${w === 0 ? "current" : ""}">
      <div class="wk-h"><div><span class="wk-label">${label}</span><span class="wk-range">${range}</span></div>
        <div class="wk-badges">${offBadges}</div></div>
      ${body || `<div class="day quiet" data-add="${iso(mon)}"><div class="item muted">Quiet week – nothing planned yet</div></div>`}
    </section>`;
  }
  html += `<button class="more" id="more">Show 6 more weeks</button>`;
  $("#main").innerHTML = html;
  $("#more").onclick = () => { state.weeks += 6; renderUpcoming(); };
  $("#sorting")?.addEventListener("toggle", (e) => save("sortingOpen", e.target.open));
  const t = document.getElementById("d-" + todayISO());
  if (t && !renderUpcoming.scrolled) { renderUpcoming.scrolled = true; t.scrollIntoView({ block: "center" }); }
}

// Month tab = the Family grid (grid.js); more months load automatically as you scroll.
const renderMonth = (keepAnchor) => renderGrid(keepAnchor);
function moreMonths() { state.monthsAfter += 3; state.lastView = state.view; render(); }

// load more months automatically when you get near the bottom of the month view
window.addEventListener("scroll", () => {
  if (state.view !== "month" || state.loadingMonths) return;
  const end = document.getElementById("month-end");
  if (end && end.getBoundingClientRect().top < innerHeight + 600) {
    state.loadingMonths = true;
    setTimeout(() => { moreMonths(); state.loadingMonths = false; }, 0);
  }
}, { passive: true });

function nextOccurrence(r) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  let d = new Date(t.getFullYear(), r.month - 1, r.day);
  if (d < t) d = new Date(t.getFullYear() + 1, r.month - 1, r.day);
  return d;
}

const MONTH_HUE = ["#4dabf7", "#f783ac", "#69db7c", "#ffd43b", "#b197fc", "#ffa94d", "#38d9a9", "#ff8787", "#74c0fc", "#e599f7", "#a9e34b", "#ffa8a8"];
function renderBirthdays() {
  const list = [...state.data.recurring].sort((a, b) => nextOccurrence(a) - nextOccurrence(b));
  const today = new Date().setHours(0, 0, 0, 0);
  let html = state.data.me.canEditAll ? `<button class="btn-add" id="add-rec">+ Add birthday / anniversary</button>` : "";
  let month = null;
  for (const r of list) {
    const n = nextOccurrence(r), age = r.born ? n.getFullYear() - r.born : null;
    const key = `${n.getFullYear()}-${n.getMonth()}`;
    if (key !== month) {
      if (month) html += `</div>`;
      const thisMonth = n.getMonth() === new Date().getMonth() && n.getFullYear() === new Date().getFullYear();
      html += `<div class="card bmonth ${thisMonth ? "current" : ""}" style="--mc:${MONTH_HUE[n.getMonth()]}"><h3>${MONTHS[n.getMonth()]} ${n.getFullYear()}${thisMonth ? ` <small class="muted">· this month</small>` : ""}</h3>`;
      month = key;
    }
    const days = Math.round((n - today) / 864e5);
    const when = days === 0 ? "today! 🎉" : days === 1 ? "tomorrow" : `in ${days} days`;
    // countdown bar: fills up over the last 60 days; orange within a month, pink within a week
    const fill = Math.max(4, Math.min(100, Math.round((60 - days) / 60 * 100)));
    const level = days <= 7 ? "soon" : days <= 30 ? "near" : "far";
    html += `<div class="row brow" data-rec="${r.id}">
      <span class="bday-date"><b>${n.getDate()}</b><small>${n.toLocaleDateString("en-GB", { weekday: "short" })}</small></span>
      <span class="bday-name">${CalendarRules.REC_ICON[r.type] || "🎂"} <b>${esc(r.name)}</b>
        ${age || r.type === "Memorial" ? `<small>${CalendarRules.recDetail(r, age)}</small>` : ""}</span>
      <span class="countdown ${level}" title="${when}"><small>${when}</small><i><b style="width:${fill}%"></b></i></span></div>`;
  }
  if (month) html += `</div>`;
  $("#main").innerHTML = html || `<p class="muted pad">No birthdays yet.</p>`;
  $("#add-rec")?.addEventListener("click", () => recurringForm());
}

// School tab: per child, holidays by start date - now / coming up first, past ones folded away at the bottom
function renderSchool() {
  const today = todayISO();
  const row = (h, tag) => {
    const days = Math.round((parse(h.end) - parse(h.start)) / 864e5) + 1;
    const until = Math.round((parse(h.start) - parse(today)) / 864e5);
    const badge = tag === "now" ? `<span class="sbadge now">on holiday now</span>`
      : tag === "next" ? `<span class="sbadge next">next · ${until === 1 ? "tomorrow" : `in ${until} days`}</span>` : "";
    return `<div class="row ${tag === "past" ? "past" : ""}" data-sh="${h.id}"><span><b>${esc(h.name)}</b> ${badge}
            ${h.status === "Tentative" ? "<small>(tentative)</small>" : ""}<br><small>${fmtDay(h.start)} – ${fmtDay(h.end)} · back ${fmtDay(iso(addDays(parse(h.end), 1)))}</small></span>
            <small>${days} day${days > 1 ? "s" : ""}</small></div>`;
  };
  const card = (child) => {
    const list = state.data.schoolHolidays.filter((h) => h.child === child).sort((x, y) => x.start.localeCompare(y.start));
    const past = list.filter((h) => h.end < today), now = list.filter((h) => h.start <= today && h.end >= today);
    const ahead = list.filter((h) => h.start > today);
    let year = today.slice(0, 4);   // a heading whenever the list moves into the next year
    const yearHead = (h) => h.start.slice(0, 4) !== year ? `<div class="syear">${year = h.start.slice(0, 4)}</div>` : "";
    const rows = now.map((h) => row(h, "now")).join("") + ahead.map((h, i) => yearHead(h) + row(h, i === 0 && !now.length ? "next" : "")).join("")
      + (past.length ? `<details class="spast"><summary>Earlier (${past.length})</summary>${past.reverse().map((h) => row(h, "past")).join("")}</details>` : "");
    const school = state.data.people.find((p) => p.name === child)?.school || "";
    return `<div class="card"><h3><span class="p" style="--c:${COLORS[child]}">${esc(child)}</span> ${esc(school)}</h3>${rows || `<p class="muted pad">None yet.</p>`}</div>`;
  };
  $("#main").innerHTML = `${state.data.me.canEditAll ? `<button class="btn-add" id="add-sh">+ Add school holiday</button>` : ""}${KIDS().map(card).join("") || `<div class="card pad"><p class="muted">No children set up yet – tick "Child" for them on the ⚙ Setup tab.</p></div>`}
    <p class="muted" style="font-size:12px">The dates are the days at home: from the day school closes to the last day before going back.</p>`;
  $("#add-sh")?.addEventListener("click", () => holidayForm());
}

async function renderLog() {
  $("#main").innerHTML = `<p class="muted pad">Loading…</p>`;
  const [rows, gone] = await Promise.all([api("GET", "log"), api("GET", "deleted")]);
  const when = (s) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const deleted = gone.length ? `<div class="card log"><h3>🗑 Recently deleted <small class="muted">(can be restored for 30 days)</small></h3>${gone.map((g) =>
    `<div class="row del-row"><span><small>${esc(when(g.at))} · ${esc(g.by || "")}</small><br><b>${esc(g.title)}</b> ${pchips(whoList(g.who))}
      <small class="muted">${fmtShort(g.start)}${g.end !== g.start ? " – " + fmtShort(g.end) : ""}${g.n > 1 ? ` + ${g.n - 1} more repeat${g.n > 2 ? "s" : ""}` : ""}</small></span>
      <button type="button" class="ackbtn" data-restore="${esc(g.batch)}">↩ Restore</button></div>`).join("")}</div>` : "";
  $("#main").innerHTML = deleted + `<div class="card log"><h3>Recent changes</h3>${rows.map((r) =>
    `<div class="row"><small>${esc(new Date(r.at.endsWith("Z") ? r.at : r.at + "Z").toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))} · ${esc(r.user)}</small><br>
     <b>${esc(r.action)}</b> ${esc(r.details || "")}</div>`).join("")}</div>`;
}

function renderFilters() {
  const people = names();
  $("#filters").innerHTML = `<button class="chip ${state.filter.size ? "" : "on"}" data-f="">Everyone</button>` +
    people.map((p) => `<button class="chip ${state.filter.has(p) ? "on" : ""}" style="--c:${COLORS[p]}" data-f="${p}">${p}</button>`).join("");
  $("#filters").style.display = ["upcoming", "month"].includes(state.view) ? "" : "none";
}

function render() {
  try { sessionStorage.setItem("cal.view", state.view); } catch {}   // F5 / refresh comes back to this tab
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
  renderFilters();
  setBarH();
  const stay = state.lastView === state.view;   // re-render after a save/filter: keep scroll position
  state.lastView = state.view;
  fabFor(state.view);
  if (state.view === "month") return renderMonth(stay);
  if (state.view !== "info") state.vault = null;   // don't keep the details in memory once you leave the page
  ({ upcoming: renderUpcoming, birthdays: renderBirthdays, school: renderSchool, log: renderLog, info: renderInfo, setup: renderSetup })[state.view]();
}

// ---------- light / dark
const THEMES = ["auto", "light", "dark"];
function applyTheme(t) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  $("#theme").textContent = { auto: "◐ Auto", light: "☀ Light", dark: "☾ Dark" }[t];
  $("#theme").title = "Theme: " + t + " (tap to change)";
}
applyTheme(load("theme") || "auto");
$("#theme").onclick = () => {
  const next = THEMES[(THEMES.indexOf(load("theme") || "auto") + 1) % THEMES.length];
  save("theme", next); applyTheme(next);
};

// ---------- forms
function openDialog(html, onReady) {
  $("#dlg-body").innerHTML = html;
  const dlg = $("#dlg");
  if (!dlg.open) dlg.showModal();
  onReady?.(dlg);
}
const closeDialog = () => $("#dlg").close();

// view-only version of a form, for logins that can see but not change something
function lockForm(title) {
  const f = $("#f");
  f.querySelectorAll("input, select, textarea, [data-who], .seg label").forEach((e) => { e.disabled = true; e.style.pointerEvents = "none"; });
  f.querySelector(".primary")?.remove(); $("#del")?.remove();
  $("#cancel").textContent = "Close";
  if (title) f.querySelector("h2").textContent = title;
  f.onsubmit = (e) => e.preventDefault();
}

async function submit(fn, okMsg) {
  try { await fn(); closeDialog(); toast(typeof okMsg === "function" ? okMsg() : okMsg); await refresh(); }
  catch (e) { const el = document.querySelector("#dlg .err"); if (el) el.textContent = e.message; }
}

// preset: { date, who } for a new entry; { copy: entry } = new entry pre-filled (Duplicate, or an inbox proposal
// with onSave(body) + title); ev = edit an existing entry
function eventForm(ev, preset = {}) {
  const e = ev || (preset.copy ? { ...preset.copy } : { start: preset.date || todayISO(), end: "", who: preset.who || "", title: "", category: "General",
                    status: "Confirmed", important: 0, notes: "" });
  const who = new Set(whoList(e.who));
  const cats = state.data.categories.map((c) => `<option ${c === e.category ? "selected" : ""}>${c}</option>`).join("")
    + (!ev && state.data.me.canEditAll ? `<option value="__holiday">🌿 School holiday (shades the column)</option>` : "");
  openDialog(`<form class="form" id="f" autocomplete="off">
    <h2>${preset.title || (ev ? "Edit event" : preset.copy ? "Add a copy" : "Add event")}</h2>
    <label>What<input name="title" value="${esc(e.title)}" placeholder="e.g. Dentist 10am" required></label>
    <div class="two"><label>From<input type="date" name="start" value="${e.start}" required></label>
      <label>To (optional)<input type="date" name="end" value="${e.end !== e.start ? e.end || "" : ""}"></label></div>
    <label>Who<div class="whos">${(state.data.me.editablePeople || names()).map((p) =>
      `<button type="button" class="chip ${who.has(p) ? "on" : ""}" style="--c:${COLORS[p]}" data-who="${p}">${p}</button>`).join("")}</div></label>
    <label>Where are they sleeping?<select name="location">
      <option value="">– doesn't change (day trip, appointment…)</option>
      ${CalendarRules.placeList(state.data).filter((v) => v.active !== 0 || e.location === v.key).map((v) => `<option value="${esc(v.key)}" ${e.location === v.key ? "selected" : ""}>${v.icon} ${esc(v.label)}</option>`).join("")}
    </select></label>
    ${CalendarRules.tracked(state.data).length ? `<div class="meta" style="margin-top:-6px">For ${esc(CalendarRules.tracked(state.data).join(" / "))}'s plans, also tick the child they're for.</div>` : ""}
    ${ev && isHelperStay(e) ? `<div class="seg"><label><input type="radio" name="stay" value="Tentative" ${e.status === "Tentative" ? "checked" : ""}> ⏳ Requested</label>
      <label><input type="radio" name="stay" value="Confirmed" ${!["Tentative", "Unavailable"].includes(e.status) ? "checked" : ""}> ✅ Confirmed</label>
      <label><input type="radio" name="stay" value="Unavailable" ${e.status === "Unavailable" ? "checked" : ""}> 🚫 Can't stay</label></div>` : ""}
    <div class="checks"><label><input type="checkbox" name="important" ${e.important ? "checked" : ""}> ⭐ Important</label>
      ${ev && isHelperStay(e) ? "" : `<label><input type="checkbox" name="tentative" ${e.status === "Tentative" ? "checked" : ""}> Not confirmed yet</label>`}</div>
    <label>Category<select name="category">${cats}</select></label>
    <label>Notes<textarea name="notes" rows="2">${esc(e.notes || "")}</textarea></label>
    ${!ev && !preset.onSave ? `<div class="two"><label>Repeat<select name="repeat">
        <option value="">Doesn't repeat</option><option value="week">Every week</option>
        <option value="2weeks">Every 2 weeks</option><option value="month">Every month</option></select></label>
      <label class="until" hidden>Until<input type="date" name="until"></label></div>
      <div class="rdays" hidden>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) =>
        `<label><input type="checkbox" name="rday" value="${(i + 1) % 7}"> ${d}</label>`).join("")}</div>` : ""}
    ${ev?.series ? `<div class="meta">🔁 Part of a repeat – changes here are for this one only.</div>` : ""}
    ${ev ? `<div class="meta">${ev.source ? `From: ${esc(ev.source)} · ` : ""}${ev.updated_by ? `Last changed by ${esc(ev.updated_by)} ${esc((ev.updated_at || "").slice(0, 10))}` : `Added by ${esc(ev.created_by || "")}`}</div>` : ""}
    <div class="err"></div>
    <div class="actions">${ev ? `<button type="button" class="danger" id="del">Delete</button>` : ""}
      ${ev && canAdd() ? `<button type="button" id="dup" title="A new entry with the same details">⧉ Duplicate</button>` : ""}
      ${ev && state.data.inviteTo?.length ? `<button type="button" id="invite">📅 Send invite</button>` : ""}
      <button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    const f = $("#f");
    $("#invite")?.addEventListener("click", () => inviteForm(ev));
    const fam = CalendarRules.familyMembers(state.data);
    const paint = () => f.querySelectorAll("[data-who]").forEach((c) => c.classList.toggle("on", who.has(c.dataset.who)));
    if (who.has("Family")) fam.forEach((p) => who.add(p));   // a Family entry shows all four ticked
    paint();
    f.querySelectorAll("[data-who]").forEach((b) => b.onclick = () => {
      const p = b.dataset.who, on = !who.has(p);
      if (p === "Family") [p, ...fam].forEach((x) => on ? who.add(x) : who.delete(x));   // Family = all four
      else {
        on ? who.add(p) : who.delete(p);
        if (fam.includes(p)) fam.every((x) => who.has(x)) ? who.add("Family") : who.delete("Family");
      }
      paint();
    });
    $("#cancel").onclick = closeDialog;
    $("#dup")?.addEventListener("click", () => eventForm(null, { copy: { ...ev, id: undefined, series: undefined } }));
    if (ev) $("#del").onclick = () => deleteEvent(ev);
    f.elements.category.addEventListener("change", () => {
      if (f.elements.category.value !== "__holiday") return;
      const kid = [...who].find((p) => KIDS().includes(p)) || KIDS()[0];
      holidayForm(null, { child: kid, name: f.elements.title.value, start: f.elements.start.value, end: f.elements.end.value || f.elements.start.value });
    });
    f.elements.repeat?.addEventListener("change", () => {
      const v = f.elements.repeat.value, on = !!v, weekly = v === "week" || v === "2weeks";
      f.querySelector(".until").hidden = !on; f.elements.until.required = on;
      f.querySelector(".rdays").hidden = !weekly;
      // tick the start date's weekday if nothing is ticked yet
      const boxes = [...f.querySelectorAll("[name=rday]")];
      if (weekly && !boxes.some((b) => b.checked)) boxes.find((b) => +b.value === parse(f.elements.start.value || todayISO()).getDay()).checked = true;
    });
    f.onsubmit = (x) => {
      x.preventDefault();
      const fd = new FormData(f);
      const body = { title: fd.get("title"), start: fd.get("start"), end: fd.get("end") || fd.get("start"),
                     who: [...who], category: fd.get("category"), notes: fd.get("notes"), location: fd.get("location") || null,
                     important: fd.get("important") === "on", status: fd.get("stay") || (fd.get("tentative") === "on" ? "Tentative" : "Confirmed"),
                     source: ev?.source ?? e.source, house_off: ev?.house_off ?? e.house_off ?? null };
      if (preset.onSave) return preset.onSave(body);
      if (fd.get("repeat")) body.repeat = { every: fd.get("repeat"), until: fd.get("until"), days: fd.getAll("rday").map(Number) };
      if (!ev) return submit(async () => { const r = await api("POST", "events", body); submit.msg = r.count > 1 ? `Added ${r.count} entries` : "Added"; }, () => submit.msg);
      saveEdit(ev, { ...body, loaded_at: ev.updated_at || "" });
    };
    if (!ev) f.elements.title.focus();
    else if (!canEditEvent(ev)) lockForm("Details");
  });
}

// save an edit; if someone else saved the entry since it was opened, ask before overwriting their change
async function saveEdit(ev, body) {
  try { await api("PUT", `events/${ev.id}`, body); closeDialog(); toast("Saved"); await refresh(); }
  catch (err) {
    if (!/while you had it open/.test(err.message)) { const el = document.querySelector("#dlg .err"); if (el) el.textContent = err.message; return; }
    const el = document.querySelector("#dlg .err");
    el.innerHTML = `${esc(err.message)} <button type="button" id="mine">Save mine anyway</button> <button type="button" id="theirs">Show their version</button>`;
    $("#mine").onclick = () => saveEdit(ev, { ...body, force: true });
    $("#theirs").onclick = async () => { await refresh(); const now = state.data.events.find((x) => x.id === ev.id); now ? eventForm(now) : closeDialog(); };
  }
}

// delete (a repeat asks: just this one, or this and the later ones); the toast offers Undo
function deleteEvent(ev) {
  const go = async (scope) => {
    try {
      const r = await api("DELETE", `events/${ev.id}${scope ? "?scope=" + scope : ""}`);
      closeDialog(); await refresh();
      toast(r.count > 1 ? `Deleted ${r.count} entries` : "Deleted", { label: "↩ Undo", run: () => restoreDeleted(r.undo) });
    } catch (err) { toast(err.message); }
  };
  if (!ev.series) return confirm(`Delete "${ev.title}"?`) && go();
  openDialog(`<div class="form"><h2>Delete a repeating entry</h2><p>"${esc(ev.title)}" on ${fmtDay(ev.start)} is part of a repeat.</p>
    <div class="actions"><button type="button" id="cancel">Cancel</button><button type="button" class="danger" id="one">Just this one</button>
      <button type="button" class="danger" id="later">This and later ones</button></div></div>`, () => {
    $("#cancel").onclick = () => eventForm(ev);
    $("#one").onclick = () => go();
    $("#later").onclick = () => go("later");
  });
}
async function restoreDeleted(batch) {
  try { const r = await api("POST", "events/restore", { batch }); toast(r.restored > 1 ? `Restored ${r.restored} entries` : "Restored"); await refresh(); }
  catch (err) { toast(err.message); }
}

// 🔍 search every entry (title, who, notes, category, where it came from)
function searchSheet() {
  openDialog(`<div class="form"><h2>🔍 Search</h2><input id="q" type="search" placeholder="e.g. dentist, birthday, exam" autocomplete="off">
    <div id="hits" class="sheet-list"></div><div class="actions"><button type="button" id="cancel">Close</button></div></div>`, () => {
    $("#cancel").onclick = closeDialog;
    const q = $("#q"), today = todayISO();
    const run = () => {
      const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) { $("#hits").innerHTML = `<p class="muted">Type to search all entries, past and future.</p>`; return; }
      const hit = (e) => { const s = `${e.title} ${e.who} ${e.notes || ""} ${e.category} ${e.source || ""}`.toLowerCase(); return words.every((w) => s.includes(w)); };
      const evs = state.data.events.filter(hit);
      const next = evs.filter((e) => e.end >= today).sort((a, b) => a.start.localeCompare(b.start));
      const past = evs.filter((e) => e.end < today).sort((a, b) => b.start.localeCompare(a.start));
      const row = (e) => `<div class="srow hit" data-ev="${e.id}"><b>${fmtDay(e.start)}${e.end !== e.start ? " – " + fmtShort(e.end) : ""}</b>
        <span>${pchips(whoList(e.who))} ${e.important ? "⭐ " : ""}${esc(e.title)}${e.series ? " 🔁" : ""}</span></div>`;
      $("#hits").innerHTML = !evs.length ? `<p class="muted">Nothing found.</p>`
        : (next.length ? `<h4>Coming up (${next.length})</h4>${next.slice(0, 60).map(row).join("")}` : "")
        + (past.length ? `<h4>Earlier (${past.length})</h4>${past.slice(0, 40).map(row).join("")}` : "");
    };
    q.oninput = run; run(); q.focus();
  });
}

// email a calendar invite for an entry (all day, or at a time), with a reminder
function inviteForm(ev) {
  const me = state.data.me;
  const mine = (r) => r.login === (me.email || "").toLowerCase();
  const range = ev.end !== ev.start ? `${fmtDay(ev.start)} – ${fmtDay(ev.end)}` : fmtDay(ev.start);
  openDialog(`<form class="form" id="inv"><h2>📅 Send invite</h2>
    <div class="meta"><b>${esc(ev.title)}</b><br>${range}</div>
    <label>Send to</label><div class="checks">${state.data.inviteTo.map((r) =>
      `<label><input type="checkbox" name="to" value="${esc(r.email)}" ${mine(r) ? "checked" : ""}> ${esc(r.name)}${mine(r) ? " (me)" : ""} <small class="muted">${esc(r.email)}</small></label>`).join("")}</div>
    <div class="meta" style="margin-top:-6px">Each person's invite address is set on ⚙ Setup → their login.</div>
    <div class="two"><label>Time (optional)<input type="time" name="time" ${ev.end !== ev.start ? "disabled" : ""}></label>
      <label>Length<select name="minutes"><option value="30">30 min</option><option value="60" selected>1 hour</option>
        <option value="120">2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option></select></label></div>
    <label>Reminder<select name="alarm"></select></label>
    <div class="meta">Leave the time empty for an all-day entry. The email has an invite your phone, Outlook or Gmail can add to your calendar; sending it again updates the same calendar entry.</div>
    <div class="err"></div>
    <div class="actions"><button type="button" id="icancel">Cancel</button><button class="primary">Send</button></div></form>`, () => {
    const f = $("#inv");
    const alarms = () => {
      const timed = !!f.elements.time.value;
      const opts = timed ? [["min15", "15 min before"], ["hour1", "1 hour before"], ["day1", "1 day before"], ["none", "No reminder"]]
        : [["evening", "Day before, 18:00"], ["morning", "Morning of, 07:00"], ["days2", "2 days before, 18:00"], ["week", "A week before"], ["none", "No reminder"]];
      f.elements.alarm.innerHTML = opts.map(([k, v], i) => `<option value="${k}" ${i === (timed ? 1 : 0) ? "selected" : ""}>${v}</option>`).join("");
      f.elements.minutes.disabled = !timed;
    };
    alarms();
    f.elements.time.oninput = alarms;
    $("#icancel").onclick = () => eventForm(ev);
    f.onsubmit = async (x) => {
      x.preventDefault();
      const fd = new FormData(f);
      try {
        const r = await api("POST", `invite/${ev.id}`, { to: fd.getAll("to"), time: fd.get("time") || null, minutes: fd.get("minutes"), alarm: fd.get("alarm") });
        closeDialog();
        toast(/FAILED/.test(r.result || "") ? `Some invites failed: ${r.result}` : "Invite sent 📅");
      } catch (err) { f.querySelector(".err").textContent = err.message; }
    };
  });
}

function recurringForm(r) {
  const x = r || { name: "", day: "", month: "", born: "", type: "Birthday", notes: "" };
  const LABELS = {
    Birthday: { title: "birthday", name: "Whose birthday?", ph: "e.g. Granny Chris", date: "Birthday", year: "Year born" },
    Anniversary: { title: "anniversary", name: "What's the anniversary?", ph: "e.g. Mum & Dad's wedding",
                   date: "Anniversary date", year: "Year it started" },
    Memorial: { title: "day of remembrance", name: "Who are we remembering?", ph: "Their name",
                date: "Date they passed away", year: "Year they passed away" },
  };
  openDialog(`<form class="form" id="f"><h2 id="rf-title"></h2>
    <div class="seg">${[["Birthday", "Birthday"], ["Anniversary", "Anniversary"], ["Memorial", "In memory"]].map(([t, label]) =>
      `<label><input type="radio" name="type" value="${t}" ${x.type === t ? "checked" : ""}> ${CalendarRules.REC_ICON[t]} ${label}</label>`).join("")}</div>
    <label><span id="rf-name"></span><input name="name" value="${esc(x.name)}" required></label>
    <div><div class="lbl" id="rf-date"></div>
      <div class="two"><label>Day<input type="number" name="day" min="1" max="31" value="${x.day}" required></label>
      <label>Month<select name="month">${MONTHS.map((mn, i) => `<option value="${i + 1}" ${x.month == i + 1 ? "selected" : ""}>${mn}</option>`).join("")}</select></label></div></div>
    <label><span id="rf-year"></span><input type="number" name="born" min="1900" max="2100" value="${x.born || ""}" placeholder="optional – shows the age / years"></label>
    <div class="err"></div>
    <div class="actions">${r ? `<button type="button" class="danger" id="del">Delete</button>` : ""}
      <button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    const relabel = () => {
      const L = LABELS[$("#f").elements.type.value || "Birthday"];
      $("#rf-title").textContent = `${r ? "Edit" : "Add"} ${L.title}`;
      $("#rf-name").textContent = L.name; $("#f").elements.name.placeholder = L.ph;
      $("#rf-date").textContent = L.date; $("#rf-year").textContent = L.year;
    };
    $("#f").querySelectorAll("input[name=type]").forEach((i) => i.onchange = relabel);
    relabel();
    if (!state.data.me.canEditAll) lockForm("Details");
    $("#cancel").onclick = closeDialog;
    if (r) $("#del").onclick = () => confirm(`Delete ${r.name}?`) && submit(() => api("DELETE", `recurring/${r.id}`), "Deleted");
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData($("#f")));
      submit(() => r ? api("PUT", `recurring/${r.id}`, body) : api("POST", "recurring", body), "Saved");
    };
  });
}

function holidayForm(h, preset = {}) {
  const x = h || { child: KIDS()[0], name: "", start: "", end: "", status: "Confirmed", notes: "", ...preset };
  openDialog(`<form class="form" id="f"><h2>${h ? "Edit" : "Add"} school holiday</h2>
    <label>Child<select name="child">${KIDS().map((c) => `<option ${x.child === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
    <label>Name<input name="name" value="${esc(x.name)}" placeholder="e.g. Term 2 half term" required></label>
    <div class="two"><label>From (school closes)<input type="date" name="start" value="${x.start}" required></label>
      <label>To (last day home)<input type="date" name="end" value="${x.end}" required></label></div>
    <div class="checks"><label><input type="checkbox" name="tentative" ${x.status === "Tentative" ? "checked" : ""}> Not confirmed yet</label></div>
    <label>Notes<textarea name="notes" rows="2" placeholder="e.g. Closes 12:00">${esc(x.notes || "")}</textarea></label>
    <div class="meta">A closing time in the notes (e.g. "Closes 12:00") shows on the calendar on the first day.</div>
    <div class="err"></div>
    <div class="actions">${h ? `<button type="button" class="danger" id="del">Delete</button>` : ""}
      <button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    if (h) $("#del").onclick = () => confirm(`Delete ${h.name}?`) && submit(() => api("DELETE", `school-holidays/${h.id}`), "Deleted");
    if (!state.data.me.canEditAll) lockForm("School holiday");
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData($("#f"));
      const body = { child: fd.get("child"), name: fd.get("name"), start: fd.get("start"), end: fd.get("end"),
                     notes: fd.get("notes"), status: fd.get("tentative") === "on" ? "Tentative" : "Confirmed" };
      submit(() => h ? api("PUT", `school-holidays/${h.id}`, body) : api("POST", "school-holidays", body), "Saved");
    };
  });
}

function daySheet(key) {
  const info = buildDays(key, key)[key];
  openDialog(`<div class="form"><h2>${parse(key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2>
    <div>${info.ph ? `<span class="badge ph">${esc(info.ph)}</span> ` : ""}${info.off.map((c) => `<span class="badge off">${c} off school</span>`).join(" ")}</div>
    <div class="sheet-list">${info.items.map((it) => itemHTML(it)).join("") || `<p class="muted">Nothing planned.</p>`}</div>
    <div class="actions"><button type="button" id="cancel">Close</button><button class="primary" id="addday">+ Add on this day</button></div></div>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#addday").onclick = () => eventForm(null, { date: key });
  });
}

// ---------- setup (admins only): people + logins
const TYPE_INFO = {
  household: ["Household", "lives there; family items and birthdays show alongside their own"],
  helper: ["Helper", "au pair, nanny or house-sitter – no column; counts as the adult when staying over"],
  tracked: ["Tracked", "someone outside the household whose plans with the children you track (e.g. an ex-partner) – their plans on a school day get a ⚠"],
  group: ["Group", "a shared column such as Family"],
};
const ROLE_INFO = {
  admin: ["Admin", "sees and edits everything, and can use Setup"],
  editor: ["Editor", "sees and edits everything, no Setup"],
  viewer: ["Viewer", "sees everything, can't change anything"],
  limited: ["Limited", "only sees the people you pick"],
};

async function renderSetup() {
  $("#main").innerHTML = `<p class="muted pad">Loading…</p>`;
  const [people, users, digest, places, settings, inbox] = await Promise.all([api("GET", "setup/people"), api("GET", "setup/users"), api("GET", "setup/digest"),
    api("GET", "setup/places"), api("GET", "setup/settings"), api("GET", "setup/inbox")]);
  state.setup = { people, users, digest, places, settings, inbox };
  const pRows = people.map((p) => `<div class="row" data-person="${p.id}">
      <span><span class="swatch" style="background:${p.color}"></span><b>${esc(p.name)}</b>
        ${p.active ? "" : `<small>(hidden)</small>`}${personNote(p) ? `<br><small class="muted">${esc(personNote(p))}</small>` : ""}</span><small>${TYPE_INFO[p.type][0]}</small></div>`).join("");
  const uRows = users.map((u) => {
    const extra = u.role === "limited"
      ? `sees ${esc(u.see || "nobody")}${u.see_school ? " + school holidays" : ""}${u.see_birthdays ? " + birthdays" : ""}${u.can_edit ? " · can add/edit" : " · view only"}`
      : "";
    return `<div class="row" data-user="${u.id}"><span><b>${esc(u.name)}</b>${u.active ? "" : " <small>(disabled)</small>"}<br>
      <small>${esc(u.email)}${u.invite_email ? `<br>📅 invites → ${esc(u.invite_email)}` : ""}${extra ? "<br>" + extra : ""}</small></span><small class="role ${u.role}">${ROLE_INFO[u.role][0]}</small></div>`;
  }).join("");
  const sb = settings.brand;
  $("#main").innerHTML = `
    <div class="card"><h3>This calendar</h3><div class="row" id="site-settings"><span><b>${esc(sb.site)}</b><br>
      <small class="muted">${esc(sb.url || "no web address set")} · phone icon name "${esc(sb.short)}"${sb.inbox ? ` · inbox ${esc(sb.inbox)}` : ""}</small></span><small>Edit</small></div>
      <div class="row"><span>Family Calendar <b>${esc(state.data.version || "")}</b>${state.data.unreleased ? ` <span class="muted">+ changes not released yet</span>` : ""}
        <br><small id="update-note" class="muted"></small></span><span class="vacts" id="version-actions"></span></div>
      <div class="row"><span><small class="muted">Change the family name, people or houses step by step</small></span>
        <span><button type="button" class="ackbtn" onclick="wizardForm()">👋 Set-up wizard</button></span></div></div>
    <div class="card"><h3>People in the calendar</h3>${pRows}</div>
    <button class="btn-add" id="add-person">+ Add person</button>
    <div class="card"><h3>Places <small class="muted">where people sleep – a child at a house needs an adult there</small></h3>${places.map((p) =>
      `<div class="row" data-place="${esc(p.key)}"><span>${p.icon} <b>${esc(p.label)}</b>${p.active ? "" : " <small>(hidden)</small>"}${p.needs ? `<br><small class="muted">needs someone there: ${esc(p.needs)}</small>` : ""}</span><small>${PLACE_KINDS[p.kind] || p.kind}</small></div>`).join("")}</div>
    <button class="btn-add" id="add-place">+ Add place</button>
    <div class="card"><h3>Who can sign in</h3>${uRows}</div>
    <button class="btn-add" id="add-user">+ Add login</button>
    <div class="card"><h3>Weekly email <small class="muted">${esc(digestWhen(settings))} – the week ahead + ⚠ things to sort</small>
      <button type="button" class="ackbtn" id="digest-time" style="float:right">🕖 Change day & time</button></h3>${digest.map((r) =>
      `<div class="row" data-digest="${r.id}"><span><b>${esc(r.name || r.email)}</b><br><small>${esc(r.email)}</small></span>
        <span class="dbadges">${digestBadges(r)}</span></div>`).join("") || `<p class="muted pad">Nobody yet.</p>`}</div>
    <button class="btn-add" id="add-digest">+ Add email address</button>${settings.emailSync ? ` <button class="btn-add" id="sync-digest" title="Send Cloudflare's confirmation email to new addresses and check which are confirmed">🔄 Check confirmations now</button>` : ""}
    <div class="card"><h3>📥 Smart inbox ${inbox.on || inbox.routine ? `<span class="dbadge ok hstate">● On</span>` : `<span class="dbadge off hstate">○ Off</span>`}</h3><div class="row" id="inbox-settings"><span>
      ${inbox.routine ? `Emails forwarded to <b>${esc(inbox.inbox || "the inbox address")}</b> are read by your <b>Claude Code inbox routine</b>
        and the dates show under <b>Waiting for approval</b>.<br><small class="muted">Last check ${esc(new Date(inbox.lastRun).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}
        · the calendar's own built-in reader stays off, so the two don't both pick up the same emails</small>` : ""}
      ${inbox.routine ? "" : inbox.on ? `Emails forwarded to <b>${esc(inbox.inbox || "the inbox address")}</b> are read by ${esc(inbox.models[inbox.model].split(" –")[0])} and the dates
        show under <b>Waiting for approval</b>.<br><small class="muted">Key ${esc(inbox.keyHint)} · last checked ${inbox.lastRun ? esc(new Date(inbox.lastRun).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })) : "not yet"}</small>`
      : `Optional: forward school letters, invitations and bookings to ${esc(inbox.inbox || "the inbox address")} and Claude proposes the dates for you to approve.
        Needs your own Anthropic API key (pay-as-you-go, roughly R1–2 per email).`}
      ${inbox.lastError ? `<br><small style="color:#c92a2a">⚠ Last problem: ${esc(inbox.lastError.detail)}</small>` : ""}</span><small style="white-space:nowrap">${inbox.on ? "Edit" : inbox.routine ? "Built-in reader" : "Set up"}</small></div></div>
    <div class="card"><h3>🗄️ Backups</h3><p class="muted" style="margin:0 0 8px">Cloudflare keeps 30 days of restore points
      automatically, and on the 1st of each month a full backup is emailed to the admins. You can also download one now
      (🔒 Info items stay scrambled in it).</p><a class="btn" href="/api/setup/backup" download>⬇️ Download a backup</a></div>
    <div class="card" id="feed"><h3>📅 Your phone calendar</h3>
      <p class="muted" style="margin:0 0 8px">Subscribe once and the family calendar shows in Outlook / your iPhone next to your own
        (read-only; it updates itself about every hour). The link is private to you – don't share it.</p>
      <button type="button" class="btn-add" id="feed-show" style="margin:0">Show my link</button><div id="feed-box"></div></div>
    <p class="muted" style="font-size:12px">Logins use the person's email address: they sign in
      with a one-time code sent to that email. Limited logins only ever receive the entries they're allowed to see.</p>`;
  $("#add-person").onclick = () => personForm();
  $("#add-place").onclick = () => placeForm();
  $("#site-settings").onclick = () => settingsForm();
  $("#inbox-settings").onclick = () => inboxForm();
  checkForUpdate();
  document.querySelectorAll("[data-place]").forEach((el) => el.onclick = () => placeForm(state.setup.places.find((p) => p.key === el.dataset.place)));
  $("#add-user").onclick = () => userForm();
  $("#add-digest").onclick = () => digestForm();
  $("#digest-time").onclick = () => digestTimeForm();
  $("#sync-digest")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { const r = await api("POST", "setup/email-sync"); toast(r.changes.length ? r.changes.join(" · ") : "All up to date"); renderSetup(); }
    catch (err) { e.target.disabled = false; toast(err.message); }
  });
  document.querySelectorAll("[data-digest]").forEach((el) =>
    el.onclick = () => digestForm(state.setup.digest.find((r) => r.id === +el.dataset.digest)));
}

// receive = gets the Sunday email (needs Cloudflare verification); send = may email things to the inbox address
function digestBadges(r) {
  const receive = !r.active ? `<span class="dbadge off" title="Paused – tap to turn back on">⏸ Weekly email paused</span>`
    : r.status === "ok" ? `<span class="dbadge ok" title="Verified – gets the Sunday email">✅ Receives weekly email</span>`
    : `<span class="dbadge wait" title="Click the Cloudflare confirmation link in that mailbox">✉️ Not verified yet</span>`;
  const send = r.active ? `<span class="dbadge ok" title="Can forward things to ${esc(state.data.brand?.inbox || "the inbox")}">📥 Can send to inbox</span>`
    : `<span class="dbadge off" title="Paused addresses can't send to the inbox">📥 Can't send to inbox</span>`;
  return receive + send;
}

// weekly email address: Cloudflare sends a one-off "confirm this address" email before it will deliver to it
function digestForm(r) {
  openDialog(`<form class="form" id="f"><h2>${r ? "Weekly email" : "Add an address for the weekly email"}</h2>
    <label>Email<input type="email" name="email" value="${esc(r?.email || "")}" ${r ? "disabled" : "required"}></label>
    <label>Name (optional)<input name="name" value="${esc(r?.name || "")}" placeholder="e.g. Dad (work)"></label>
    ${r ? `<div class="checks"><label><input type="checkbox" name="active" ${r.active ? "checked" : ""}> Send the weekly email here</label></div>
      ${r.status === "waiting" ? `<div class="meta">✉️ Waiting for the confirmation link (from Cloudflare) to be clicked in that mailbox. The link is sent within about an hour of adding the address.</div>` : ""}`
      : `<div class="meta">Within about an hour Cloudflare sends a one-off "verify this address" email to it – click the link in it, or the weekly email can't be delivered there.</div>`}
    <div class="err"></div>
    <div class="actions">${r ? `<button type="button" class="danger" id="del">Remove</button>` : ""}
      <button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    if (r) $("#del").onclick = () => confirm(`Stop sending the weekly email to ${r.email}?`) && submit(() => api("DELETE", `setup/digest/${r.id}`), "Removed");
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData($("#f"));
      submit(() => r ? api("PUT", `setup/digest/${r.id}`, { name: fd.get("name"), active: fd.get("active") === "on" })
                     : api("POST", "setup/digest", { email: fd.get("email"), name: fd.get("name") }),
             r ? "Saved" : "Added – a confirmation email will arrive there within the hour");
    };
  });
}

function personForm(p) {
  const x = p || { name: "", color: "#868e96", type: "household", active: 1, sort: state.setup.people.length + 1 };
  openDialog(`<form class="form" id="f"><h2>${p ? "Edit" : "Add"} person</h2>
    <label>Name<input name="name" value="${esc(x.name)}" required></label>
    <div class="two"><label>Colour<input type="color" name="color" value="${x.color}"></label>
      <label>Order in lists<input type="number" name="sort" value="${x.sort}"></label></div>
    <label>Type<select name="type">${Object.entries(TYPE_INFO).map(([k, [lbl, help]]) =>
      `<option value="${k}" ${x.type === k ? "selected" : ""}>${lbl} – ${help}</option>`).join("")}</select></label>
    <div class="checks"><label><input type="checkbox" name="active" ${x.active ? "checked" : ""}> Show in the calendar</label>
      <label><input type="checkbox" name="grid_column" ${x.grid_column !== 0 ? "checked" : ""}> Own column in the Family grid</label>
      <label><input type="checkbox" name="family" ${x.family ? "checked" : ""}> Part of the family (entries for "Family" count for them)</label>
      <label><input type="checkbox" name="child" ${x.child ? "checked" : ""}> Child (needs an adult at home; school days and holidays apply)</label>
      <label class="kidonly"><input type="checkbox" name="boards" ${x.boards ? "checked" : ""}> Boards at school in term time</label></div>
    <div class="two"><label>Usually sleeps at<select name="home"><option value="">– nowhere unless an entry says (e.g. au pair)</option>${state.setup.places.filter((pl) => pl.kind === "home" && (pl.active || pl.key === x.home)).map((pl) =>
        `<option value="${esc(pl.key)}" ${x.home === pl.key ? "selected" : ""}>${pl.icon} ${esc(pl.label)}</option>`).join("")}</select></label>
      <label class="kidonly">School<input name="school" value="${esc(x.school || "")}" placeholder="e.g. Greenside High"></label></div>
    ${p ? `<div class="meta">Renaming updates every entry that mentions them. To remove someone who has entries, untick "Show in the calendar".</div>` : ""}
    <div class="err"></div>
    <div class="actions">${p ? `<button type="button" class="danger" id="del">Delete</button>` : ""}
      <button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    const kidOnly = () => $("#f").querySelectorAll(".kidonly").forEach((el) => el.hidden = !$("#f").elements.child.checked);
    $("#f").elements.child.onchange = kidOnly; kidOnly();
    if (p) $("#del").onclick = () => confirm(`Delete ${p.name}?`) && submit(() => api("DELETE", `setup/people/${p.id}`), "Deleted");
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData($("#f"));
      const body = { name: fd.get("name"), color: fd.get("color"), type: fd.get("type"), sort: fd.get("sort"), active: fd.get("active") === "on",
                     grid_column: fd.get("grid_column") === "on", family: fd.get("family") === "on", child: fd.get("child") === "on",
                     boards: fd.get("boards") === "on", home: fd.get("home"), school: fd.get("school") };
      submit(() => p ? api("PUT", `setup/people/${p.id}`, body) : api("POST", "setup/people", body), "Saved");
    };
  });
}

// short line under a person on Setup: "Child · boards · usually Home · Hilton College"
function personNote(p) {
  const pl = state.setup.places.find((x) => x.key === p.home);
  return [p.child ? "Child" : "", p.child && p.boards ? "boards" : "", pl ? `usually ${pl.label}` : "", p.child ? p.school || "" : ""].filter(Boolean).join(" · ");
}

// newer release on the public repository? (only once it's published: lib/version.js UPSTREAM_REPO)
async function checkForUpdate() {
  const repo = state.data.upstream, note = $("#update-note");
  if (!repo || !note) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`).then((x) => x.ok ? x.json() : null);
    const latest = String(r?.tag_name || "").replace(/^v/, ""), cmp = (a, b) => a.split(".").map(Number).reduce((d, x, i) => d || x - (b.split(".").map(Number)[i] || 0), 0);
    const mine = state.setup?.settings?.repo_url;
    const newer = latest && cmp(latest, state.data.version) > 0;
    const owner = mine ? mine.split("/")[0] : "";
    note.innerHTML = !newer ? `Up to date${mine ? " · new versions install themselves overnight" : ""}`
      : `Update available: <b>${esc(latest)}</b> · <a href="${esc(r.html_url)}" target="_blank" rel="noopener">what's new</a>` + (mine
        ? `<br>Installs itself tonight – or now: the green button opens GitHub (signed in as <b>${esc(owner)}</b>), click <b>Run workflow</b>.`
        : "");
    // the one thing to press: GitHub's update page (the first time: This calendar → Edit, to say where the GitHub copy is)
    if (newer) $("#version-actions").innerHTML = mine
      ? `<a class="btn go" href="https://github.com/${esc(mine)}/actions/workflows/update.yml" target="_blank" rel="noopener"
          title="Opens GitHub – click Run workflow">⬆️ Update to ${esc(latest)}</a>`
      : `<button type="button" class="go" id="update-setup">⬆️ Update to ${esc(latest)}</button>`;
    $("#update-setup")?.addEventListener("click", () => settingsForm(true));
  } catch { /* offline or GitHub busy - try again next time */ }
}

// "owner/name" from whatever was typed (github.com/owner/name, a full https address, …)
const repoPath = (v) => String(v || "").trim().replace(/^https?:\/\//, "").replace(/^(www\.)?github\.com\//, "").replace(/(\.git)?\/*$/, "");

// once per family: GitHub's "new file" page with the update job filled in - they only click Commit
async function addUpdater(mine) {
  const wf = ".github/workflows/update.yml", w = window.open("", "_blank");   // opened now so the browser doesn't block it
  const yml = await fetch(`https://raw.githubusercontent.com/${state.data.upstream}/main/${wf}`).then((x) => x.text());
  w.opener = null;
  w.location = `https://github.com/${mine}/new/main?filename=${encodeURIComponent(wf)}&value=${encodeURIComponent(yml)}`;
}

function inboxForm() {
  const x = state.setup.inbox;
  openDialog(`<form class="form" id="f" autocomplete="off"><h2>📥 Smart inbox</h2>
    <details ${x.keyHint ? "" : "open"}><summary>How to get an Anthropic API key (once, about 5 minutes)</summary><ol class="meta" style="margin:6px 0 0 18px;padding:0">
      <li>Go to <b>platform.claude.com</b> and sign up (separate from any Claude chat subscription).</li>
      <li><b>Billing</b> → add some credit, e.g. $10. Set a <b>monthly spend limit</b> (e.g. $10) so it can never cost more.</li>
      <li><b>API keys</b> → <b>Create key</b> → copy it (starts with <code>sk-ant-</code>) and paste it below.</li></ol></details>
    <label>Anthropic API key<input name="key" type="password" placeholder="${x.keyHint ? `saved (${esc(x.keyHint)}) – paste a new one to replace it` : "sk-ant-…"}" autocomplete="new-password"></label>
    <label>Model<select name="model">${Object.entries(x.models).map(([k, v]) => `<option value="${k}" ${x.model === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
    <label>Notes for the inbox reader <small class="muted">(optional – things only the family knows)</small><textarea name="notes" rows="4"
      placeholder="e.g. Emma is in Grade 10 (class 10B) and takes Maths, not Maths Lit. Mark exams as important.">${esc(x.notes || "")}</textarea></label>
    <div class="checks"><label><input type="checkbox" name="on" ${x.on || !x.keyHint ? "checked" : ""}> Turned on</label></div>
    <div class="meta">Nothing is added to the calendar until someone approves it. The key is stored scrambled and is never shown again.
      Email contents are treated as information only – the reader can't take any actions.</div>
    <div class="err"></div>
    <div class="actions">${x.keyHint ? `<button type="button" class="danger" id="rmkey">Remove key</button>` : ""}
      <button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#rmkey")?.addEventListener("click", () => confirm("Remove the key and turn the smart inbox off?") &&
      submit(() => api("PUT", "setup/inbox", { remove_key: true, model: x.model, notes: x.notes }), "Key removed"));
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData($("#f"));
      submit(() => api("PUT", "setup/inbox", { key: fd.get("key"), model: fd.get("model"), notes: fd.get("notes"), on: fd.get("on") === "on" }),
        fd.get("key") ? "Key checked and saved" : "Saved");
    };
  });
}

// Setup > Weekly email: which day and hour it goes out, in which time zone
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const digestWhen = (s) => {
  const day = /^[0-6]$/.test(String(s.digest_day ?? "")) ? +s.digest_day : 0, hour = s.digest_hour != null && s.digest_hour !== "" ? +s.digest_hour : 18;
  return `${WEEKDAYS[day]}s ${String(hour).padStart(2, "0")}:00${s.timezone && s.timezone !== "Africa/Johannesburg" ? ` (${s.timezone.split("/").pop().replace(/_/g, " ")} time)` : ""}`;
};
function digestTimeForm() {
  const s = state.setup.settings, day = s.digest_day != null && s.digest_day !== "" ? +s.digest_day : 0, hour = s.digest_hour != null && s.digest_hour !== "" ? +s.digest_hour : 18;
  const mine = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
  const zones = [...new Set([s.timezone || "Africa/Johannesburg", "Africa/Johannesburg", mine, "Europe/London", "Europe/Amsterdam", "Asia/Dubai",
    "Australia/Sydney", "Australia/Perth", "Pacific/Auckland", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Toronto"].filter(Boolean))];
  openDialog(`<form class="form" id="f"><h2>🕖 When the weekly email goes out</h2>
    <div class="two"><label>Day<select name="day">${WEEKDAYS.map((d, i) => `<option value="${i}" ${i === day ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      <label>Time<select name="hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === hour ? "selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("")}</select></label></div>
    <label>Time zone<select name="timezone">${zones.map((z) => `<option ${z === (s.timezone || "Africa/Johannesburg") ? "selected" : ""}>${esc(z)}</option>`).join("")}</select></label>
    <div class="meta">Sent in the evening, it covers the 7 days from the next day (e.g. Sunday 18:00 → Monday to Sunday).
      Sent in the morning, it covers the 7 days from that day (e.g. Monday 07:00 → Monday to Sunday).</div>
    <div class="err"></div>
    <div class="actions"><button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData($("#f"));
      submit(async () => { const r = await api("PUT", "setup/digest-time", { day: +fd.get("day"), hour: +fd.get("hour"), timezone: fd.get("timezone") });
        submit.msg = `Weekly email: ${r.label}`; }, () => submit.msg);
    };
  });
}

function settingsForm(forUpdate = false) {
  const s = state.setup.settings, b = s.brand;
  openDialog(`<form class="form" id="f"><h2>This calendar</h2>
    <label>Family name<input name="family_name" value="${esc(s.family_name || "")}" placeholder="e.g. Smith"></label>
    <div class="two"><label>Calendar name<input name="site_name" value="${esc(s.site_name || "")}" placeholder="${esc(b.family ? b.family + " Calendar" : "Family Calendar")}"></label>
      <label>Name under the phone icon<input name="short_name" value="${esc(s.short_name || "")}" maxlength="14" placeholder="${esc(b.family ? b.family + "s" : "Calendar")}"></label></div>
    <label>Web address<input name="site_url" value="${esc(s.site_url || "")}" placeholder="https://ourfamily.com"></label>
    ${state.data.upstream ? `<label>Your GitHub copy <small class="muted">(for updates – the address of the copy Cloudflare made when you installed)</small>
      <input name="repo_url" value="${esc(s.repo_url ? "github.com/" + s.repo_url : "")}" placeholder="github.com/yourname/family-calendar"></label>
      <div class="meta">Once, after filling this in: <a href="#" id="add-updater">add the update job to your GitHub copy</a> (GitHub opens –
        sign in to GitHub first if it says "404" – then click <b>Commit changes</b>). From then on new versions install themselves overnight.</div>` : ""}
    <div class="meta">The name shows at the top of the site, on the emails, invites and the phone calendar. The web address is used in
      emails and invites, and the inbox address is inbox@ that domain.</div>
    <div class="err"></div>
    <div class="actions"><button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    $("#cancel").onclick = closeDialog;
    if (forUpdate) { const i = $("#f [name=repo_url]"); i?.focus(); i?.closest("label")?.classList.add("hl"); }
    $("#add-updater")?.addEventListener("click", (e) => {
      e.preventDefault();
      const mine = repoPath($("#f [name=repo_url]").value);
      if (!/^[\w.-]+\/[\w.-]+$/.test(mine)) { $("#f .err").textContent = "Fill in your GitHub copy first (e.g. github.com/yourname/family-calendar)."; return; }
      addUpdater(mine);
    });
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData($("#f")));
      submit(async () => { await api("PUT", "setup/settings", body); location.reload(); }, "Saved");
    };
  });
}

const PLACE_KINDS = { home: "House – a child here needs an adult", school: "School (boarding)", friend: "Friend's / sleepover", away: "Away (holiday, travel)" };
function placeForm(pl) {
  const x = pl || { key: "", label: "", short: "", icon: "🏠", kind: "home", sort: state.setup.places.length + 1, active: 1 };
  openDialog(`<form class="form" id="f"><h2>${pl ? "Edit" : "Add"} place</h2>
    <div class="two"><label>Name<input name="label" value="${esc(x.label)}" placeholder="e.g. Beach House" required></label>
      <label>Icon${iconSelect('name="icon"', x.icon)}</label></div>
    <div class="two"><label>Short name (for small screens)<input name="short" value="${esc(x.short)}" placeholder="e.g. Beach" maxlength="12"></label>
      <label>Order in lists<input type="number" name="sort" value="${x.sort}"></label></div>
    <label>Kind<select name="kind">${Object.entries(PLACE_KINDS).map(([k, v]) => `<option value="${k}" ${x.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="houseonly">Someone needs to sleep here because of<input name="needs" value="${esc(x.needs || "")}" placeholder="e.g. the dogs (leave empty if it can stay empty)"></label>
    <div class="checks"><label><input type="checkbox" name="active" ${x.active ? "checked" : ""}> Show in the lists</label></div>
    <div class="err"></div>
    <div class="actions"><button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    const houseOnly = () => $("#f").querySelectorAll(".houseonly").forEach((el) => el.hidden = $("#f").elements.kind.value !== "home");
    $("#f").elements.kind.onchange = houseOnly; houseOnly();
    $("#cancel").onclick = closeDialog;
    $("#f").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData($("#f"));
      const body = { label: fd.get("label"), short: fd.get("short"), icon: fd.get("icon"), kind: fd.get("kind"), sort: fd.get("sort"), active: fd.get("active") === "on",
                     needs: fd.get("kind") === "home" ? fd.get("needs") : "" };
      submit(() => pl ? api("PUT", `setup/places/${encodeURIComponent(pl.key)}`, body) : api("POST", "setup/places", body), "Saved");
    };
  });
}

function userForm(u) {
  const x = u || { email: "", name: "", role: "viewer", see: "", see_school: 1, see_birthdays: 0, can_edit: 0, active: 1 };
  const see = new Set(whoList(x.see));
  openDialog(`<form class="form" id="f"><h2>${u ? "Edit" : "Add"} login</h2>
    <label>Name<input name="name" value="${esc(x.name)}" required></label>
    <label>Email they sign in with<input type="email" name="email" value="${esc(x.email)}" required></label>
    <label>Access<select name="role">${Object.entries(ROLE_INFO).map(([k, [lbl, help]]) =>
      `<option value="${k}" ${x.role === k ? "selected" : ""}>${lbl} – ${help}</option>`).join("")}</select></label>
    <div id="limited-box">
      <div class="lbl">Can see entries for</div>
      <div class="whos">${state.setup.people.filter((p) => p.active).map((p) =>
        `<button type="button" class="chip ${see.has(p.name) ? "on" : ""}" style="--c:${p.color}" data-see="${esc(p.name)}">${esc(p.name)}</button>`).join("")}</div>
      <div class="checks" style="margin-top:10px">
        <label><input type="checkbox" name="see_school" ${x.see_school ? "checked" : ""}> School holidays</label>
        <label><input type="checkbox" name="see_birthdays" ${x.see_birthdays ? "checked" : ""}> Birthdays</label>
        <label><input type="checkbox" name="can_edit" ${x.can_edit ? "checked" : ""}> Can add / edit entries for these people</label></div>
    </div>
    <label>Calendar invites go to<select name="invite_email">
      <option value="">Their sign-in email${x.email ? ` (${esc(x.email)})` : ""}</option>
      ${(state.setup.digest || []).filter((r) => r.email !== x.email).map((r) =>
        `<option value="${esc(r.email)}" ${x.invite_email === r.email ? "selected" : ""}>${esc(r.name || r.email)} – ${esc(r.email)}${r.status === "ok" ? "" : " (not confirmed yet)"}</option>`).join("")}
    </select></label>
    <div class="meta" style="margin-top:-6px">Used by 📅 Send invite. Addresses come from the Weekly email list below.</div>
    <div class="checks"><label><input type="checkbox" name="active" ${x.active ? "checked" : ""}> Login enabled</label></div>
    <div class="err"></div>
    <div class="actions">${u ? `<button type="button" class="danger" id="del">Remove</button>` : ""}
      <button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    const f = $("#f");
    const sync = () => { $("#limited-box").hidden = f.elements.role.value !== "limited"; };
    f.elements.role.onchange = sync; sync();
    f.querySelectorAll("[data-see]").forEach((b) => b.onclick = () => {
      see.has(b.dataset.see) ? see.delete(b.dataset.see) : see.add(b.dataset.see); b.classList.toggle("on");
    });
    $("#cancel").onclick = closeDialog;
    if (u) $("#del").onclick = () => confirm(`Remove ${u.name}'s login?`) && submit(() => api("DELETE", `setup/users/${u.id}`), "Removed");
    f.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const body = { name: fd.get("name"), email: fd.get("email"), role: fd.get("role"), see: [...see],
                     see_school: fd.get("see_school") === "on", see_birthdays: fd.get("see_birthdays") === "on",
                     can_edit: fd.get("can_edit") === "on", active: fd.get("active") === "on", invite_email: fd.get("invite_email") || null };
      submit(() => u ? api("PUT", `setup/users/${u.id}`, body) : api("POST", "setup/users", body), "Saved");
    };
  });
}

// demo only: see the calendar exactly as another login would
async function viewAsPicker() {
  const users = await api("GET", "demo-users");
  const cur = load("viewAs") || "";
  openDialog(`<div class="form"><h2>View the calendar as…</h2>
    <p class="muted" style="margin:0;font-size:13px">Demo only – shows exactly what each login would see and be allowed to do.</p>
    <div class="sheet-list">${users.map((u, i) => `<div class="item ${(cur ? cur === u.email : i === 0) ? "important" : ""}" data-viewas="${esc(u.email)}">
      <div class="title"><b>${esc(u.name)}</b> <small class="muted">${esc(u.email)}</small></div>
      <span class="range">${ROLE_INFO[u.role][0]}</span></div>`).join("")}</div>
    <div class="actions"><button type="button" id="cancel">Close</button></div></div>`, () => {
    $("#cancel").onclick = closeDialog;
    document.querySelectorAll("[data-viewas]").forEach((el) => el.onclick = async () => {
      save("viewAs", el.dataset.viewas); closeDialog(); state.filter.clear(); save("filter", []);
      await refresh(); toast(`Now viewing as ${el.querySelector("b").textContent}`);
    });
  });
}

// ---------- events (delegated)
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-view],[data-f],[data-ev],[data-rec],[data-sh],[data-day],[data-add],[data-person],[data-user]");
  if (!t || !state.data) return;
  const d = t.dataset;
  if (d.view) { state.view = d.view; window.scrollTo(0, 0); render(); }
  else if (d.f !== undefined) {
    if (!d.f) state.filter.clear(); else state.filter.has(d.f) ? state.filter.delete(d.f) : state.filter.add(d.f);
    save("filter", [...state.filter]); render();
  }
  else if (d.ev) eventForm(state.data.events.find((x) => x.id == d.ev));
  else if (d.rec) recurringForm(state.data.recurring.find((x) => x.id == d.rec));
  else if (d.sh) holidayForm(state.data.schoolHolidays.find((x) => x.id == d.sh));
  else if (d.day) daySheet(d.day);
  else if (d.add) canAdd() && eventForm(null, { date: d.add });
  else if (d.person) personForm(state.setup.people.find((x) => x.id == d.person));
  else if (d.user) userForm(state.setup.users.find((x) => x.id == d.user));
});
// the round + adds what fits the tab: an entry, a birthday / anniversary, or a school holiday (hidden on Changes / Setup)
const FAB = {
  upcoming: ["Add event", () => canAdd(), () => eventForm(null)],
  month: ["Add event", () => canAdd(), () => eventForm(null)],
  birthdays: ["Add birthday or anniversary", () => state.data.me.canEditAll, () => recurringForm()],
  school: ["Add school holiday", () => state.data.me.canEditAll, () => holidayForm()],
  info: ["Add to Info", () => state.data.me.isAdmin, () => vaultForm()],
};
function fabFor(view) {
  const f = FAB[view];
  $("#fab").hidden = !f || !f[1]();
  if (f) $("#fab").setAttribute("aria-label", f[0]), $("#fab").title = f[0];
}
$("#fab").onclick = () => state.data && FAB[state.view]?.[2]();
// "Today" in the top bar: back to today's row on Month / Upcoming (other tabs open Upcoming)
$("#today").onclick = () => {
  if (!state.data) return;
  if (!["month", "upcoming"].includes(state.view)) { state.view = "month"; render(); }
  const el = document.getElementById((state.view === "month" ? "g-" : "d-") + todayISO());
  if (!el) { state.monthsBefore = 0; render(); return; }
  const top = el.getBoundingClientRect().top + window.scrollY - $("#bar").offsetHeight - (state.view === "month" ? 90 : 20);
  window.scrollTo(0, top);
};
$("#dlg").addEventListener("click", (e) => { if (e.target.id === "dlg") closeDialog(); });  // tap outside to close

// keep sticky week/month headings just below the pinned top bar (its height changes with the filters row)
const setBarH = () => document.documentElement.style.setProperty("--bar-h", $("#bar").offsetHeight + "px");
new ResizeObserver(setBarH).observe($("#bar"));
window.addEventListener("resize", setBarH);

const adminNames = () => { const n = state.data.admins || []; return n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0] || "admins"; };
// ---------- 🔒 Info (admins only). The server decrypts it for this page only; nothing is saved in the browser.
const VAULT_ICON = { Medical: "🩺", Contacts: "📇", School: "🏫", Insurance: "🛡️", Vehicles: "🚗", Documents: "🪪", "Firearm licences": "🎯", Other: "📌" };
const VAULT_TEMPLATE = {   // suggested lines for a new item (hide = shown as •••• until "Show")
  Medical: [["Medical aid", ""], ["Plan", ""], ["Member number", "", 1], ["Main member", ""], ["Emergency number", ""], ["Doctor", ""]],
  Contacts: [["Name", ""], ["Phone", ""], ["Email", ""]],
  School: [["Contact", ""], ["Phone", ""], ["Email", ""]],
  Insurance: [["Insurer", ""], ["Policy number", "", 1], ["Claims phone", ""]],
  Vehicles: [["Registration", ""], ["Licence disc expires", ""], ["VIN", "", 1]],
  Documents: [["ID number", "", 1], ["Passport number", "", 1], ["Passport expires", ""]],
  "Firearm licences": [["Firearm (make, model, calibre)", ""], ["Serial number", "", 1], ["Licence number", "", 1], ["Licence expires", ""],
    ["Competency certificate number", "", 1], ["Competency expires", ""]],
  Other: [["", ""]],
};
// expiry countdown: a line labelled e.g. "Licence disc expires" / "Renewal date" whose value is a date
// (2027-03-31, 31/03/2027, 31 March 2027, March 2027 = end of that month - see rules.js) gets "🟢 245 days left"
function expiryBadge(f) {
  const x = CalendarRules.expiries([f])[0];
  if (!x) return null;
  const dt = parse(x.date);
  const today = parse(todayISO()), n = Math.round((dt - today) / 864e5);
  // a year or more: "4 years 336 days left (1 797 days)"
  let yrs = 0; while (new Date(today.getFullYear() + yrs + 1, today.getMonth(), today.getDate()) <= dt) yrs++;
  const rest = Math.round((dt - new Date(today.getFullYear() + yrs, today.getMonth(), today.getDate())) / 864e5);
  const plural = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const [cls, icon] = n < 0 ? ["exp-over", "⛔"] : n <= 30 ? ["exp-soon", "🔴"] : n <= 60 ? ["exp-near", "🟠"] : ["exp-ok", "🟢"];
  const text = n < 0 ? `Expired ${plural(-n, "day")} ago` : n === 0 ? "Expires today"
    : yrs ? `${plural(yrs, "year")}${rest ? " " + plural(rest, "day") : ""} left (${n.toLocaleString("en-ZA")} days)` : `${plural(n, "day")} left`;
  return { n, icon, text, date: x.date, html: `<span class="expiry ${cls}" title="${esc(dt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}">${icon} ${text}</span>` };
}
async function renderInfo() {
  $("#main").innerHTML = `<p class="muted pad">Unlocking…</p>`;
  try { state.vault = await api("GET", "vault"); }
  catch (e) { $("#main").innerHTML = `<p class="pad">${esc(e.message)}</p>`; return; }
  renderInfoView();
}
function renderInfoView() {
  // sections, type buttons, people and the items in each section all in alphabetical order
  const az = (x, y) => x.localeCompare(y, "en", { sensitivity: "base" });
  const sections = [...state.vault.sections].sort(az);
  const items = [...state.vault.items].sort((x, y) => az(x.title, y.title));
  const soonest = (it) => {   // 🟠/🔴/⛔ next to the title when something on the card runs out within 60 days
    const b = (it.fields || []).map(expiryBadge).filter(Boolean).sort((x, y) => x.n - y.n)[0];
    return b && b.n <= 60 ? `<span class="expiry-flag" title="${esc(b.text)}">${b.icon}</span>` : ""; };
  const card = (it) => `<div class="vitem" data-vault="${it.id}">
      <div class="vhead"><b>${esc(it.title)}</b>${soonest(it)}${it.person ? ` ${pchips([it.person])}` : ""}<button type="button" class="ackbtn" data-vedit="${it.id}">✏️ Edit</button></div>
      ${(it.fields || []).map((f, i) => !f.v ? "" : `<div class="vrow"><span class="vk">${esc(f.k)}</span>
        <span class="vv" data-secret="${f.hide ? 1 : 0}" id="vv-${it.id}-${i}">${f.hide ? "••••••" : expiryBadge(f) ? fmtLong(expiryBadge(f).date) : esc(f.v)}</span>${expiryBadge(f)?.html || ""}
        <span class="vbtns">${f.hide ? `<button type="button" class="ackbtn" data-vshow="${it.id}|${i}">Show</button>` : ""}
          <button type="button" class="ackbtn" data-vcopy="${it.id}|${i}">Copy</button></span></div>`).join("")}
      ${it.notes ? `<div class="vnotes">${esc(it.notes)}</div>` : ""}
      <div class="meta">${it.updated_by ? `Last changed by ${esc(it.updated_by)} ${esc((it.updated_at || "").slice(0, 10))}` : ""}</div></div>`;
  // filters (person / type) and folded sections - remembered on this device (names of sections only, never details)
  const vf = state.vaultFilter ||= { person: "", section: "" };
  const folded = new Set(load("vaultFolded") || []);
  const shown = items.filter((it) => (!vf.person || (it.person || "–") === vf.person) && (!vf.section || it.section === vf.section));
  const groups = sections.filter((s) => shown.some((it) => it.section === s));
  const who = [...new Set(items.map((it) => it.person || "–"))].sort((x, y) => (x === "–") - (y === "–") || az(x, y));
  const chip = (kind, v, label, c) => `<button type="button" class="chip ${vf[kind] === v ? "on" : ""}" ${c ? `style="--c:${c}"` : ""} data-vf="${kind}|${esc(v)}">${label}</button>`;
  const filters = items.length ? `<div class="vfilters"><span class="lbl">Person</span>${chip("person", "", "All")}${who.map((p) =>
      chip("person", p, p === "–" ? "General" : esc(p), COLORS[p])).join("")}</div>
    <div class="vfilters"><span class="lbl">Type</span>${chip("section", "", "All")}${sections.filter((s) => items.some((it) => it.section === s)).map((s) =>
      chip("section", s, `${VAULT_ICON[s]} ${s}`)).join("")}</div>` : "";
  $("#main").innerHTML = `<div class="vintro">🔒 Only ${esc(adminNames())} can open this page. It's stored scrambled (encrypted) – the backups and
      the inbox check can't read it. Hidden numbers show for 30 seconds when you tap <b>Show</b>. Don't keep passwords, PINs or card numbers here.</div>
    <button class="btn-add" id="add-vault">+ Add</button>${filters}
    ${groups.length ? groups.map((s) => { const list = shown.filter((it) => it.section === s);
      return `<div class="card vsec ${folded.has(s) ? "folded" : ""}"><h3 data-vfold="${s}"><span>${VAULT_ICON[s]} ${s} <small class="muted">(${list.length})</small></span>
        <span class="vfold">${folded.has(s) ? "▸ Show" : "▾ Hide"}</span></h3>${list.map(card).join("")}</div>`; }).join("")
      : items.length ? `<div class="card pad"><p class="muted">Nothing matches – tap <b>All</b>.</p></div>`
      : `<div class="card pad"><p>Nothing here yet. Tap <b>+ Add</b> for e.g. the medical aid (member number, plan, emergency line), doctors, allergies,
         school contacts, insurance policies or car registrations.</p></div>`}`;
  $("#add-vault").onclick = () => vaultForm();
}
const vaultItem = (id) => state.vault?.items.find((x) => x.id === +id);
document.addEventListener("click", async (e) => {
  if (state.view !== "info") return;
  const fold = e.target.closest("[data-vfold]"), vf = e.target.closest("[data-vf]");
  if (fold) {   // fold / unfold a section (remembered on this device)
    const s = fold.dataset.vfold, set = new Set(load("vaultFolded") || []);
    set.has(s) ? set.delete(s) : set.add(s); save("vaultFolded", [...set]);
    const card = fold.closest(".vsec"); card.classList.toggle("folded"); fold.querySelector(".vfold").textContent = card.classList.contains("folded") ? "▸ Show" : "▾ Hide";
    return;
  }
  if (vf) { const [k, v] = vf.dataset.vf.split("|"); state.vaultFilter[k] = state.vaultFilter[k] === v ? "" : v; return renderInfoView(); }
  const t = e.target.closest("[data-vshow],[data-vcopy],[data-vedit]");
  if (!t) return;
  if (t.dataset.vedit) return vaultForm(vaultItem(t.dataset.vedit));
  const [id, i] = (t.dataset.vshow || t.dataset.vcopy).split("|"), f = vaultItem(id)?.fields[+i];
  if (!f) return;
  if (t.dataset.vshow) {
    const el = $(`#vv-${id}-${i}`); el.textContent = f.v; t.textContent = "Hide";
    t.onclick = (ev) => { ev.stopPropagation(); el.textContent = "••••••"; t.textContent = "Show"; t.onclick = null; };
    setTimeout(() => { if (document.body.contains(el)) { el.textContent = "••••••"; t.textContent = "Show"; t.onclick = null; } }, 30000);
  } else {
    try { await navigator.clipboard.writeText(f.v); toast(`${f.k || "Text"} copied`); } catch { toast("Couldn't copy – tap Show and copy it by hand"); }
  }
});

function vaultForm(it) {
  const x = it || { section: "Medical", title: "", person: "", fields: VAULT_TEMPLATE.Medical.map(([k, v, hide]) => ({ k, v, hide: !!hide })), notes: "" };
  const secs = state.vault?.sections || Object.keys(VAULT_ICON);
  const isExp = (k) => CalendarRules.EXPIRY_LABEL.test(k || "");   // "... expires" etc. get a date picker (saved as 2027-03-31)
  const valInput = (k, v) => isExp(k) ? `<input type="date" value="${esc(CalendarRules.expiryDate(v) || "")}" data-v>`
    : `<input placeholder="Value" value="${esc(v)}" data-v autocomplete="off">`;
  const line = (f = { k: "", v: "", hide: false }) => `<div class="vline"><input placeholder="Label, e.g. Member number" value="${esc(f.k)}" data-k>
      ${valInput(f.k, f.v)}<label title="Hide until Show is tapped"><input type="checkbox" data-h ${f.hide ? "checked" : ""}> hide</label>
      <span class="vmove"><button type="button" class="ackbtn" data-vup title="Move up">↑</button><button type="button" class="ackbtn" data-vdown title="Move down">↓</button>
      <button type="button" class="ackbtn" data-vdel title="Remove this line">✕</button></span></div>`;
  openDialog(`<form class="form" id="f" autocomplete="off"><h2>${it ? "Edit" : "Add"} – 🔒 Info</h2>
    <div class="two"><label>Section<select name="section">${secs.map((s) => `<option ${s === x.section ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>For<select name="person"><option value="">Everyone / not one person</option>${names().filter((p) => p !== "Family").map((p) =>
        `<option ${p === x.person ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label></div>
    <label>Title<input name="title" value="${esc(x.title)}" placeholder="e.g. Discovery medical aid" required></label>
    <div><div class="lbl">Details <small class="muted">(tick "hide" for numbers)</small></div><div id="vlines">${(x.fields.length ? x.fields : [{}]).map(line).join("")}</div>
      <button type="button" class="ackbtn" id="vadd" style="margin-top:6px">+ Add a line</button></div>
    <label>Notes<textarea name="notes" rows="3">${esc(x.notes || "")}</textarea></label>
    <div class="err"></div>
    <div class="actions">${it ? `<button type="button" class="danger" id="del">Delete</button>` : ""}
      <button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
    const f = $("#f");
    $("#cancel").onclick = closeDialog;
    $("#vadd").onclick = () => $("#vlines").insertAdjacentHTML("beforeend", line());
    $("#vlines").addEventListener("change", (e) => {   // label changed to / from e.g. "... expires": swap in / out the date picker
      if (!e.target.matches("[data-k]")) return;
      const row = e.target.closest(".vline"), v = row.querySelector("[data-v]");
      if (isExp(e.target.value) === (v.type === "date")) return;
      v.outerHTML = valInput(e.target.value, v.value);
    });
    $("#vlines").onclick = (e) => {   // remove, or move a line up / down (the order is the order on the card)
      const row = e.target.closest(".vline");
      if (e.target.closest("[data-vdel]")) row.remove();
      else if (e.target.closest("[data-vup]") && row.previousElementSibling) row.previousElementSibling.before(row);
      else if (e.target.closest("[data-vdown]") && row.nextElementSibling) row.nextElementSibling.after(row);
    };
    if (!it) f.elements.section.onchange = () => {   // new item: suggest the lines for that section while nothing is typed yet
      if ([...f.querySelectorAll("[data-v]")].some((i) => i.value)) return;
      $("#vlines").innerHTML = VAULT_TEMPLATE[f.elements.section.value].map(([k, v, hide]) => line({ k, v, hide: !!hide })).join("");
    };
    if (it) $("#del").onclick = () => confirm(`Delete "${it.title}" from Info? This can't be undone.`) &&
      submit(() => api("DELETE", `vault/${it.id}`), "Deleted");
    f.onsubmit = (e) => {
      e.preventDefault();
      const fields = [...f.querySelectorAll(".vline")].map((r) => ({ k: r.querySelector("[data-k]").value, v: r.querySelector("[data-v]").value, hide: r.querySelector("[data-h]").checked }));
      const body = { section: f.elements.section.value, person: f.elements.person.value, title: f.elements.title.value, notes: f.elements.notes.value, fields };
      submit(() => it ? api("PUT", `vault/${it.id}`, body) : api("POST", "vault", body), "Saved");
    };
  });
}

// phone-calendar link (Setup)
async function showFeed(reset) {
  if (reset && !confirm("Make a new link? The old one stops working – re-subscribe with the new one.")) return;
  const { url } = await api(reset ? "POST" : "GET", reset ? "me/feed/reset" : "me/feed");
  const webcal = url.replace(/^https?:/, "webcal:");
  $("#feed-box").innerHTML = `<input readonly value="${esc(url)}" id="feed-url" style="width:100%;margin:6px 0">
    <div class="feed-btns"><button type="button" id="feed-copy" class="primary">Copy link</button>
      <a class="btn" href="${esc(webcal)}">Open on this phone</a> <button type="button" id="feed-reset">New link</button></div>
    <div class="meta"><b>iPhone:</b> tap <i>Open on this phone</i> → Subscribe (or Settings › Calendar › Accounts › Add Account › Other › Add Subscribed Calendar, paste the link).<br>
      <b>Outlook (PC):</b> Calendar › Add calendar › Subscribe from web › paste the link › name it "${esc(state.data.brand?.feed || "Family Calendar")}".<br>
      <b>Outlook (phone app):</b> add it in Outlook on the PC or outlook.com – it then shows on the phone too.</div>`;
  $("#feed-copy").onclick = async () => { try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { $("#feed-url").select(); } };
  $("#feed-reset").onclick = () => showFeed(true);
}
document.addEventListener("click", (e) => {
  if (e.target.id === "feed-show") { e.target.remove(); showFeed(false).catch((err) => toast(err.message)); }
  const r = e.target.closest("[data-restore]");
  if (r) { r.disabled = true; restoreDeleted(r.dataset.restore).then(() => state.view === "log" && render()); }
});
$("#search").onclick = () => state.data && searchSheet();

// "setup" = a new install showing its setup-password box (api() drew it) - leave that on screen
refresh().then(approvalLink).catch((e) => { if (e.message !== "setup") $("#main").innerHTML = `<p class="pad">Couldn't load the calendar: ${esc(e.message)}</p>`; });
