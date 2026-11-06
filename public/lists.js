// 🛒 Lists: shopping lists and the like for the family's own logins (lib/lists.js). Private unless people are added to a list.
// Works in a shop with no signal: changes are kept on this device (localStorage "lists.queue") and sent when there's a connection;
// the last copy of each list is kept too ("lists.copy.<id>"). An open list checks for other people's changes every few seconds.
(function () {
  // the open list survives a refresh (and reopening the app), like the section does (cal.view): "lists.openId"
  // a tapped notification opens /?list=<id>: straight to that list (set before app.js picks the page to start on)
  try { const q = new URLSearchParams(location.search).get("list");
    if (/^\d+$/.test(q || "")) { for (const st of [sessionStorage, localStorage]) { st.setItem("lists.openId", q); st.setItem("cal.view", "lists"); } history.replaceState(null, "", location.pathname + location.hash); } } catch { /* private mode */ }
  const remembered = () => { try { return +(sessionStorage.getItem("lists.openId") || localStorage.getItem("lists.openId")) || null; } catch { return null; } };
  const remember = (id) => { try { for (const st of [sessionStorage, localStorage]) id ? st.setItem("lists.openId", id) : st.removeItem("lists.openId"); } catch { /* private mode */ } };
  const L = { lists: null, people: [], me: null, open: remembered(), list: null, items: [], suggestions: [], dept: {}, departments: [], dragging: false, place: "", timer: null };
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
  const queue = () => store.get("lists.queue", []), setQueue = (q) => store.set("lists.queue", q);
  const cid = () => (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  const places = () => (state.data.places || []).filter((p) => p.active !== 0 && p.kind === "home");
  const placeName = (l) => l.place === "other" ? l.place_name : places().find((p) => p.key === l.place)?.label || "";
  // the same icon the calendar shows for the house (Settings > Places); a named other place gets a pin
  const OTHER = "📍", placeIcon = (l) => l.place === "other" ? OTHER : places().find((p) => p.key === l.place)?.icon || "";
  const where = (l) => placeName(l) ? `${placeIcon(l)} ${placeName(l)}`.trim() : "";
  // everyone in the family who has a login (owner + members) = "Shared with all"; otherwise the names
  const sharedAll = (l) => L.people.length > 1 && L.people.every((p) => p.id === l.owner_id || l.members.some((m) => m.id === p.id));
  const shared = (l) => l.members?.length ? (sharedAll(l) ? "Shared with all" : `Shared with ${l.members.map((m) => esc(m.name)).join(", ")}`) : l.owner_id === L.me ? "Just you" : `From ${esc(l.owner || "")}`;

  // 📌 jobs: who a line is for (",3,7," = logins) and when it's due
  const forIds = (v) => String(v || "").split(",").map(Number).filter((n) => n > 0);
  const nameOf = (id) => id === L.me ? "you" : L.people.find((p) => p.id === id)?.name || "";
  const dueText = (d) => d ? `by ${fmtDay(d)}` : "";
  const jobLine = (i) => { const f = forIds(i.for_ids).map(nameOf).filter(Boolean), bits = [f.length ? `📌 For ${f.join(", ")}` : "", i.done ? "" : dueText(i.due)].filter(Boolean);
    return bits.length ? `<small class="ljob${!i.done && i.due && i.due < todayISO() ? " late" : ""}">${esc(bits.join(" · "))}</small>` : ""; };

  // ---------- sending: straight away when there's a connection, otherwise kept and sent later in the same order
  async function send(op) {
    setQueue([...queue(), op]);
    await flush();
  }
  // one change at a time, in order: a second call while sending just waits for this one to carry on through the queue
  let sending = null;
  function flush() { return sending ||= (async () => {
    await null;   // let "sending" be set before this can finish (an empty queue would otherwise leave it set for good)
    try {
      for (let q = queue(); q.length; q = queue()) {
        const op = q[0];
        // a request that never answers (a bad signal) mustn't hold up the rest: after 15 seconds it waits for the next try
        const slow = new Promise((_, no) => setTimeout(() => no(Object.assign(new Error("slow"), { offline: true })), 15000));
        try { const res = await Promise.race([apiCall(op.method, op.path, op.body), slow]); if (L.open && op.path.startsWith(`lists/${L.open}/`) && res.items && queue().length === 1) take(res); }
        catch (e) { if (e.offline || /reach|offline/i.test(e.message)) break; toast(e.message); }   // no connection: try again later. Anything else: drop that change
        setQueue(queue().slice(1));
      }
    } finally { sending = null; offlineNote(); }
  })(); }
  const offlineNote = () => { const n = queue().length, el = $("#lsync"); if (el) el.innerHTML = n ? `⏳ ${n} change${n === 1 ? "" : "s"} waiting for a connection` : ""; };
  // a copy from the server: drawn again only if something changed - the 5-second check would otherwise redraw the list under your
  // thumb and lose a tick now and then
  const take = (res) => { const sig = JSON.stringify([res.list, res.items]), same = sig === L.sig && L.list?.id === res.list?.id;
    L.list = res.list; L.items = res.items; L.suggestions = res.suggestions || L.suggestions; L.dept = res.dept || L.dept; L.departments = res.departments || L.departments; L.people = res.people || L.people; L.me = res.me ?? L.me; store.set(`lists.copy.${L.list.id}`, { list: res.list, items: res.items, suggestions: L.suggestions, dept: L.dept, departments: L.departments }); if (res.duplicate) toast(`"${res.duplicate}" is already on the list`); if (state.view === "lists" && L.open && !same) drawList(); L.sig = sig; };

  // ---------- the lists
  async function render() {
    if (L.open) return openList(L.open);
    try { const r = await api("GET", "lists"); L.lists = r.lists; L.people = r.people; L.mine = r.mine; L.me = r.me; store.set("lists.all", r); }
    catch (e) { const c = store.get("lists.all", null); if (!c) { $("#main").innerHTML = `<p class="pad err">${esc(e.message)}</p>`; return; } L.lists = c.lists; L.people = c.people; L.mine = c.mine; L.me = c.me; }
    drawAll();
    flush();
  }
  function drawAll() {
    if (state.view !== "lists" || L.open) return;
    // a box per house (blue bar, folds with ▾ / ▸ - remembered on this device, "lists.foldPlaces"), then Other places (named places and
    // lists with no place); a row per list: name, who it's shared with under it, how many to get on the right. A private list sits under
    // its place too: nobody else sees it anyway. Side by side on a PC, one under another on a phone. Empty boxes aren't shown.
    const shut = new Set(store.get("lists.foldPlaces", []));
    const line = (l, other) => `<button type="button" class="lrow" data-lo="${l.id}"><span><b>${esc(l.name)}</b><small>${[other ? esc(where(l) || "Anywhere") : "", !l.members?.length && l.owner_id === L.me ? "🔒 Just you" : shared(l)].filter(Boolean).join(" · ")}</small></span><em class="${l.open ? "" : "lzero"}" title="${l.open} to get">${l.open}</em><i aria-hidden="true">›</i></button>`;
    // 📌 For me: everything still to do that's for you, from every list (only when there's something)
    const mine = L.mine || [];
    // PC: a table - Item | List | Due | Days left; phone: list and date under the name
    // the same lights as the ammo stock: 🔴 late, 🟠 today to 2 days, 🟢 3 days or more
    const daysLeft = (d) => { if (!d) return ["", ""]; const n = Math.round((Date.parse(`${d}T00:00`) - Date.parse(`${todayISO()}T00:00`)) / 864e5);
      const words = n < 0 ? `${-n} day${n === -1 ? "" : "s"} late` : n === 0 ? "Today" : n === 1 ? "Tomorrow" : `${n} days`;
      return [`${n < 0 ? "🔴" : n <= 2 ? "🟠" : "🟢"} ${words}`, n < 0 ? "late" : n <= 2 ? "soon" : ""]; };
    const mineRow = (m) => { const late = m.due && m.due < todayISO() ? "late" : "", [dl, dc] = daysLeft(m.due);
      return `<div class="lrow lminerow${m.important ? " limp" : ""}"><input type="checkbox" data-mt="${m.list_id}|${esc(m.client_id ? `c:${m.client_id}` : m.id)}" aria-label="Done: ${esc(m.text)}"><button type="button" data-lo="${m.list_id}"><span class="lmitem"><b>${m.important ? "⭐ " : ""}${esc(m.text)}</b><small class="lmsub ${late}">${esc([m.list, m.due ? fmtDay(m.due) : ""].filter(Boolean).join(" · "))}</small></span><span class="lmlist">${esc(m.list)}</span><span class="lmdue ${late}">${m.due ? fmtDay(m.due) : ""}</span><span class="lmdays ${dc}">${dl}</span></button></div>`; };
    const forMe = mine.length ? `<section class="lcol lmine"><button type="button" class="lcolh" data-fp="_mine" aria-expanded="${!shut.has("_mine")}">${shut.has("_mine") ? "▸" : "▾"} 📌 For me (${mine.length})</button>${shut.has("_mine") ? ""
      : `<div class="lmhead"><span>Item</span><span class="lmlist">List</span><span class="lmdue">Due</span><span class="lmdays">Days left</span></div>${mine.map(mineRow).join("")}`}</section>` : "";
    const cols = [...places().map((p) => [p.key, `${p.icon || ""} ${p.label}`.trim(), L.lists.filter((l) => l.place === p.key), false]), ["_other", `${OTHER} Other places`, L.lists.filter((l) => !l.place || l.place === "other" || !places().some((p) => p.key === l.place)), true]].filter(([, , ls]) => ls.length);
    $("#main").innerHTML = `<div class="ls lswide">${pageHead("🛒 Lists")}
      ${forMe}${cols.length ? `<div class="lcols">${cols.map(([k, t, ls, other]) => `<section class="lcol"><button type="button" class="lcolh" data-fp="${esc(k)}" aria-expanded="${!shut.has(k)}">${shut.has(k) ? "▸" : "▾"} ${esc(t)} (${ls.length})</button>${shut.has(k) ? "" : ls.map((l) => line(l, other)).join("")}</section>`).join("")}</div>`
        : `<p class="muted pad">No lists yet: tap the round + to make one.</p>`}<p class="meta" id="lsync"></p></div>`;
    $("#main").querySelectorAll("[data-fp]").forEach((b) => b.onclick = () => { const f = new Set(store.get("lists.foldPlaces", [])); f.has(b.dataset.fp) ? f.delete(b.dataset.fp) : f.add(b.dataset.fp); store.set("lists.foldPlaces", [...f]); drawAll(); });
    $("#main").querySelectorAll("[data-lo]").forEach((b) => b.onclick = () => openList(+b.dataset.lo));
    $("#main").querySelectorAll("[data-mt]").forEach((c) => c.onchange = () => {   // done, straight from For me
      const [lid, k] = c.dataset.mt.split("|"); L.mine = (L.mine || []).filter((m) => `${m.list_id}|${m.client_id ? `c:${m.client_id}` : m.id}` !== c.dataset.mt);
      drawAll(); toast("Done"); send({ method: "PUT", path: `lists/${lid}/items/${k}`, body: { done: true } });
    });
    offlineNote();
    setTimeout(() => globalThis.fabFor?.("lists"), 0);
  }

  async function listForm(l) {
    // the family's logins: never open "Share with" without them - saving an empty list of names would unshare the list
    if (!L.people.length) { try { const r = await api("GET", "lists"); L.people = r.people; L.lists = r.lists; L.me = r.me; } catch (e) { toast(e.message); return; } }
    const others = L.people.filter((p) => p.id !== L.me), mine = new Set((l?.members || []).map((m) => m.id));
    openDialog(`<form class="form" id="f" autocomplete="off"><h2>${l ? "Change the list" : "New list"}</h2>
      <label>Name<input name="name" maxlength="80" value="${esc(l?.name || "")}" placeholder="e.g. Groceries" required></label>
      <label>Where<select name="place"><option value="">Anywhere</option>${places().map((p) => `<option value="${esc(p.key)}" ${l?.place === p.key ? "selected" : ""}>${p.icon || ""} ${esc(p.label)}</option>`).join("")}<option value="other" ${l?.place === "other" ? "selected" : ""}>${OTHER} Other…</option></select></label>
      <label id="lpn" ${l?.place === "other" ? "" : "hidden"}>Which place<input name="place_name" maxlength="60" value="${esc(l?.place_name || "")}"></label>
      <div class="lshare"><span class="meta">Share with (nobody ticked = just you)</span>${others.length ? others.map((p) => `<label class="fatick"><input type="checkbox" name="members" value="${p.id}" ${mine.has(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("") : `<span class="meta">Nobody else in the family has a login yet.</span>`}</div>
      <div class="err"></div><div class="actions">${l ? `<button type="button" class="danger" id="del">Remove</button>` : ""}<button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
      const f = $("#f"), err = (t) => { f.querySelector(".err").textContent = t; };
      $("#cancel").onclick = closeDialog;
      f.elements.place.onchange = () => { $("#lpn").hidden = f.elements.place.value !== "other"; };
      f.onsubmit = async (e) => { e.preventDefault();
        const body = { name: f.elements.name.value, place: f.elements.place.value, place_name: f.elements.place_name.value, members: new FormData(f).getAll("members").map(Number) };
        try { if (l) { take(await api("PUT", `lists/${l.id}`, body)); closeDialog(); toast("Saved"); } else { const r = await api("POST", "lists", body); closeDialog(); openList(r.id); } } catch (x) { err(x.message); } };
      $("#del")?.addEventListener("click", async () => { if (!confirm(`Remove the list "${l.name}" and everything on it?`)) return; try { await api("DELETE", `lists/${l.id}`); closeDialog(); L.open = null; remember(null); render(); toast("Removed"); } catch (x) { err(x.message); } });
    });
  }

  // ---------- one list
  async function openList(id) {
    L.open = id; remember(id);
    const copy = store.get(`lists.copy.${id}`, null);
    if (copy) { L.list = copy.list; L.items = copy.items; L.suggestions = copy.suggestions || []; L.dept = copy.dept || {}; L.departments = copy.departments || []; drawList(); } else { L.dept = {}; L.departments = []; $("#main").innerHTML = `<p class="muted pad">Loading…</p>`; }   // categories belong to the list
    await flush();
    try { take(await apiCall("GET", `lists/${id}`)); } catch (e) { if (!copy) { L.open = null; remember(null); $("#main").innerHTML = `<p class="pad err">${esc(e.message)}</p>`; return; } }
    clearInterval(L.timer);
    L.timer = setInterval(async () => {   // other people's changes, every few seconds while the list is open and on screen
      if (state.view !== "lists" || L.open !== id) { clearInterval(L.timer); return; }
      if (document.hidden || queue().length || document.activeElement?.closest?.("#ladd")) return;
      try { take(await apiCall("GET", `lists/${id}`)); } catch { /* no connection: keep the copy */ }
    }, 5000);
  }
  // departments = sections (blue bars, in the order they come up; a bar's ≡ moves the whole department), each folds away with its ▾ / ▸
  // like Completed (remembered on this device per list: "lists.fold.<id>"). No department = "Other".
  const NONE = "Other";
  const folded = () => new Set(store.get(`lists.fold.${L.list?.id}`, []));
  const fold = (name) => { const f = folded(); f.has(name) ? f.delete(name) : f.add(name); store.set(`lists.fold.${L.list.id}`, [...f]); drawList(); };
  const addShut = () => !!store.get("lists.addShut", false);
  const hideDone = () => !!store.get("lists.hideDone", false);   // the Completed section folded away (this device, every list)
  // when it was completed, in this device's time: " · Fri 06/11/2026 10:05"
  const when = (at) => { const d = at && new Date(at); if (!d || isNaN(d)) return "";
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return ` · ${fmtDay(iso)} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`; };
  function groups(open) {
    if (!open.some((i) => i.category)) return [["", open]];
    const g = new Map();   // "Other" too sits where it was dragged to
    open.forEach((i) => { const k = i.category || NONE; if (!g.has(k)) g.set(k, []); g.get(k).push(i); });
    return [...g.entries()];
  }
  const ikey = (i) => i.client_id ? `c:${i.client_id}` : String(i.id);
  // a move (an item within its department, or a whole department) = the new order of everything still to get, sent in one go
  function saveOrder(gs) {
    const open = gs.flatMap(([, ls]) => ls);
    L.items = [...open, ...L.items.filter((i) => i.done)];
    drawList();
    send({ method: "PUT", path: `lists/${L.list.id}/order`, body: { keys: open.map(ikey) } });
  }
  // drag by the ≡: the line (or the whole department) follows the finger; the others make room as it passes their middle.
  // Let go = the new order is saved. Pointer events, so it's the same with a mouse, a finger or a pen.
  function dragger(h) {
    h.onpointerdown = (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      const group = h.dataset.drag === "group", el = group ? h.closest("ul.lgroup") : h.closest("li"), lopen = $("#lopen");
      const where = () => [el.parentElement, [...el.parentElement.children].indexOf(el)];
      const [box0, at0] = where();
      // the page follows the drag, not the ≡: moving the line in the page drops a handle's pointer capture, which is what made it
      // stop after one place. The placing is done at most every 16 ms.
      L.dragging = true; el.classList.add("ldrag"); document.body.classList.add("ldragging");
      let scroll = null, lastY = e.clientY, frame = 0, edge = 0;
      const mid = (x) => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; };
      const place = () => {
        frame = 0;
        const y = lastY;
        if (group) {   // a whole department among the others
          const next = [...lopen.children].filter((x) => x !== el && x.matches("ul.lgroup")).find((x) => y < mid(x));
          if (next) { if (next !== el.nextElementSibling) lopen.insertBefore(el, next); } else if (el !== lopen.lastElementChild) lopen.appendChild(el);
        } else {
          // a line can go anywhere, into another department too: before the first line or bar below the finger.
          // Before a department's bar = the end of the department above it; above the first bar = the top of the first department.
          const marks = [...lopen.querySelectorAll("li[data-k], li.lgrp")].filter((x) => x !== el), next = marks.find((x) => y < mid(x));
          if (!next) { const last = [...lopen.querySelectorAll("ul.lgroup")].pop(); if (el !== last.lastElementChild) last.appendChild(el); }
          else if (next.matches("li.lgrp")) {
            const ul = next.parentElement, prev = ul.previousElementSibling;
            if (prev?.matches("ul.lgroup")) { if (el !== prev.lastElementChild) prev.appendChild(el); }
            else if (next.nextElementSibling !== el) ul.insertBefore(el, next.nextElementSibling);
          } else if (next !== el.nextElementSibling) next.parentElement.insertBefore(el, next);
        }
        // near the top or bottom of the screen: keep scrolling while held there (and keep placing the line as the page moves)
        const want = y < 70 ? -12 : y > innerHeight - 90 ? 12 : 0;
        if (want !== edge) { clearInterval(scroll); edge = want; scroll = edge ? setInterval(() => { scrollBy(0, edge); if (!frame) frame = setTimeout(place, 16); }, 30) : null; }
      };
      const move = (ev) => { if (ev.pointerId !== e.pointerId) return; ev.preventDefault(); lastY = ev.clientY; if (!frame) frame = setTimeout(place, 16); };
      const up = (ev) => {
        if (ev && ev.pointerId !== e.pointerId) return;
        clearInterval(scroll); clearTimeout(frame); if (frame) place();
        removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
        el.classList.remove("ldrag"); document.body.classList.remove("ldragging"); L.dragging = false;
        const [box1, at1] = where();
        if (box1 === box0 && at1 === at0) return;
        const byKey = new Map(L.items.map((i) => [ikey(i), i]));
        const gs = [...lopen.querySelectorAll("ul.lgroup")].map((ul) => [ul.dataset.g, [...ul.querySelectorAll("li[data-k]")].map((li) => byKey.get(li.dataset.k)).filter(Boolean)]);
        // dropped into another department: it takes that department (the "Other" section = none)
        if (!group && box1 !== box0) {
          const it = byKey.get(el.dataset.k), dep = box1.dataset.g && box1.dataset.g !== NONE ? box1.dataset.g : null;
          if (it && (it.category || null) !== dep) {
            it.category = dep;
            if (dep) L.dept[it.text.trim().toLowerCase()] = dep; else delete L.dept[it.text.trim().toLowerCase()];
            send({ method: "PUT", path: `lists/${L.list.id}/items/${ikey(it)}`, body: { text: it.text, note: it.note, category: dep } });
          }
        }
        saveOrder(gs);
      };
      addEventListener("pointermove", move, { passive: false }); addEventListener("pointerup", up); addEventListener("pointercancel", up);
    };
  }
  // the headings sort the list (the order everyone sees, like a sort in Excel; dragging still works after):
  // Item / Added by = A-Z inside each department, Department = the departments A-Z (Other last). Tapped again = Z-A.
  const az = (a, b) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
  // Item / Added by sort inside each department
  const cmp = (by, dir) => (a, b) => dir * az(a[by] || "", b[by] || "");
  function sortedBy(gs, by) {   // 1 = A-Z now, -1 = Z-A now, 0 = neither
    const ok = (dir) => gs.every(([, ls]) => ls.every((x, n) => !n || cmp(by, dir)(ls[n - 1], x) <= 0));
    return ok(1) ? 1 : ok(-1) ? -1 : 0;
  }
  // ▲ / ▼ only on the heading last tapped on this list, while the list is still in that order (a drag or a new thing ends it)
  const lastSort = () => store.get(`lists.sort.${L.list?.id}`, null);
  const shown = (gs, by) => { const s = lastSort(); return s?.by === by && sortedBy(gs, by) === s.dir ? s.dir : 0; };
  const arrow = (d) => d === 1 ? " ▲" : d === -1 ? " ▼" : "";
  function sortBy(gs, by) {
    const dir = shown(gs, by) === 1 ? -1 : 1;
    store.set(`lists.sort.${L.list.id}`, { by, dir });
    return gs.map(([n, ls]) => [n, [...ls].sort((a, b) => cmp(by, dir)(a, b) || az(a.text, b.text))]);
  }
  function drawList() {
    if (state.view !== "lists" || !L.list || L.dragging) return;
    L.sig = null;   // what's on screen may now differ from the last server copy
    const l = L.list, open = L.items.filter((i) => !i.done), done = L.items.filter((i) => i.done), keep = $("#ladd")?.elements.text.value || "";
    // a list nobody else is on: no "Added by" column - it would say the same name on every line
    const priv = !l.members?.length;
    const gs = groups(open), dragItems = () => open.length > 1, shut = folded();   // any line can move, into another department too
    const text = (i) => `<b>${i.important ? "⭐ " : ""}${esc(i.text)}</b>${i.note ? `<small>${esc(i.note)}</small>` : ""}${jobLine(i)}`;
    // ≡ = hold and drag up or down (like most list apps); a department's ≡ moves the whole department
    const BIN = `<svg width="16" height="17" viewBox="0 0 16 17" aria-hidden="true"><path d="M2 4h12M6 4V2.5h4V4M3.5 4l.8 10.5h7.4L12.5 4M6.5 7v5M9.5 7v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const GRAB = `<svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M2 2h14M2 7h14M2 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    const grab = (kind, label) => `<span class="lgrab" data-drag="${kind}" role="button" aria-label="Drag to move ${esc(label)}">${GRAB}</span>`;
    const row = (i, canDrag) => `<li class="${i.done ? "ldone" : ""}${i.important ? " limp" : ""}" data-k="${esc(ikey(i))}"><label><input type="checkbox" data-lt="${esc(i.client_id || i.id)}" ${i.done ? "checked" : ""}><span>${text(i)}${priv && i.done ? `<small class="lby">Completed ${when(i.done_at).replace(" · ", "")}</small>` : ""}</span></label>${priv ? "" : `<span class="lwho">${i.done ? `${esc(i.done_by || "")}<small>${when(i.done_at).replace(" · ", "")}</small>` : esc(i.added_by || "")}</span>`}<button type="button" class="lmore" data-le="${esc(i.client_id || i.id)}" aria-label="Change ${esc(i.text)}">✎</button>${canDrag ? grab("item", i.text) : i.done ? `<button type="button" class="lbin" data-ldel="${esc(i.client_id || i.id)}" aria-label="Delete ${esc(i.text)}">${BIN}</button>` : `<span class="lgrab lnograb"></span>`}</li>`;
    const openHTML = gs.map(([name, ls]) => `<ul class="litems lgroup" data-g="${esc(name)}">${name ? `<li class="lgrp"><i></i><button type="button" class="lfold" data-fold="${esc(name)}" aria-expanded="${!shut.has(name)}">${shut.has(name) ? "▸" : "▾"} ${esc(name)} (${ls.length})</button>${gs.length > 1 ? grab("group", name) : "<i></i>"}</li>` : ""}${shut.has(name) ? "" : ls.map((i) => row(i, dragItems(ls))).join("")}</ul>`).join("");
    // no place / shared-with line under the name: the main Lists page shows it already
    // the add box is drawn once per list and then left alone, so typing is never interrupted when changes come back from the
    // server or from other people (it kept losing the cursor); only the parts around it are drawn again
    // 🛒 "Going shopping" tells everyone else on the list (a shared list only); while it's on, everyone sees who's shopping until when
    const shopOn = l.shopping_by && l.shopping_until > new Date().toISOString(), mineShop = shopOn && l.shopping_by === L.me;
    const until = shopOn ? new Date(l.shopping_until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
    // 🛒 next to WhatsApp: the trolley with a light in front, like the ammo lights - 🔵 nobody's shopping (tap = "I'm going to the
    // shop"), 🟢 for the 2 hours someone is (not red - that reads as broken).
    const shopLabel = mineShop ? "Done shopping" : shopOn ? `${l.shopper || "Someone"} is shopping – tap if you're going too` : "Going shopping – tell everyone on this list";
    const shopBtn = !l.members?.length ? "" : `<button type="button" class="lshopbtn ${shopOn ? "on" : ""}" id="lshop" data-on="${mineShop ? 0 : 1}" aria-label="${esc(shopLabel)}" title="${esc(shopLabel)}"><span class="lshopdot">${shopOn ? "🟢" : "🔵"}</span>🛒${shopOn ? `<small>${mineShop ? "" : `${esc(l.shopper || "")} `}till ${until}</small>` : ""}</button>`;
    const topHTML = `<div class="lback"><button type="button" class="lbackl" id="lall">← All lists</button><span>${shopBtn}<button type="button" class="ackbtn" id="lwa">💬 Send by WhatsApp</button></span></div>`;
    // (the shopping time sits under the 🟢🛒 itself, not in a line here)
    const shopNote = "", metaHTML = `<div class="lbar"><i></i><button type="button" class="lbartog" id="ltitle" aria-expanded="${!addShut()}">${addShut() ? "▸" : "▾"} ${esc(l.name)}</button>${l.owner_id === L.me ? `<button type="button" class="lbaredit" id="ledit" aria-label="Change the list" title="Change the list">✎</button>` : "<i></i>"}</div>${shopNote}`;
    const restHTML = `<datalist id="lsug">${L.suggestions.filter((s) => !open.some((i) => i.text.toLowerCase() === s.toLowerCase())).map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
      <datalist id="ldep">${L.departments.map((d) => `<option value="${esc(d)}">`).join("")}</datalist>
      ${open.length > 1 ? `<div class="lhead"><span><button type="button" data-sort="text">Item${arrow(shown(gs, "text"))}</button></span>${priv ? "" : `<button type="button" class="lwho" data-sort="added_by">Added by${arrow(shown(gs, "added_by"))}</button>`}<span class="lhpad"></span></div>` : ""}
      <div id="lopen">${open.length ? openHTML : `<ul class="litems"><li class="lempty">Nothing to get. Add something above.</li></ul>`}</div>
      ${done.length ? `<button type="button" class="ldonehead" id="ltog" aria-expanded="${!hideDone()}">${hideDone() ? "▸" : "▾"} Completed (${done.length})</button>${hideDone() ? "" : `<ul class="litems">${done.map((i) => row(i, false)).join("")}</ul>`}` : ""}`;
    if ($("#ladd")?.dataset.list === String(l.id)) { $("#ltop").innerHTML = topHTML; $("#lmetaw").innerHTML = metaHTML; $("#lrest").innerHTML = restHTML; }
    else $("#main").innerHTML = `<div class="ls"><div id="ltop">${topHTML}</div><div class="lbox ${addShut() ? "lshut" : ""}"><div id="lmetaw">${metaHTML}</div>
      <form id="ladd" autocomplete="off" data-list="${l.id}"><input name="text" list="lsug" maxlength="120" placeholder="Add something…" value="${esc(keep)}" aria-label="Add to the list" enterkeyhint="done" required><input name="note" maxlength="200" placeholder="Note" aria-label="Note"><input name="category" list="ldep" maxlength="40" placeholder="Category" aria-label="Category" enterkeyhint="done"><button class="lsubmit" tabindex="-1" aria-hidden="true"></button></form>
      <div id="lrest">${restHTML}</div></div><p class="meta" id="lsync"></p></div>`;
    $("#lall").onclick = () => { L.open = null; remember(null); clearInterval(L.timer); render(); };
    $("#ledit")?.addEventListener("click", () => listForm(l));
    const shopping = async (on) => {
      try { take(await api("POST", `lists/${l.id}/shopping`, { on })); toast(on ? "🛒 Everyone on the list has been told" : "Done shopping"); } catch (x) { toast(x.message); }
    };
    $("#lshop")?.addEventListener("click", (e) => { e.stopPropagation(); shopping(e.currentTarget.dataset.on === "1"); });
    $("#lshopoff")?.addEventListener("click", () => shopping(false));
    // the list's name folds away the add boxes and the column headings: in the shop, just the things to tick (this device, every list)
    $("#ltitle").onclick = () => { store.set("lists.addShut", !addShut()); $(".lbox").classList.toggle("lshut", addShut()); drawList(); };
    ["#ltog"].forEach((s) => $(s)?.addEventListener("click", () => { store.set("lists.hideDone", !hideDone()); drawList(); }));
    $("#lwa").onclick = () => {
      const lines = [`🛒 ${l.name}${placeName(l) ? ` (${placeName(l)})` : ""}`, ...gs.flatMap(([name, ls]) => [...(name ? ["", `*${name}*`] : []), ...ls.map((i) => `• ${i.important ? "⭐ " : ""}${i.text}${i.note ? ` – ${i.note}` : ""}`)])];
      window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank", "noopener");
    };
    $("#lopen").querySelectorAll("[data-drag]").forEach(dragger);
    $("#lopen").querySelectorAll("[data-fold]").forEach((b) => b.onclick = () => fold(b.dataset.fold));
    $("#main").querySelectorAll("[data-sort]").forEach((b) => b.onclick = () => saveOrder(sortBy(gs, b.dataset.sort)));
    const f = $("#ladd");
    if (f) {
      // Enter always adds, from any of the three boxes: with a suggestion list open (Department, or the item's own suggestions) the
      // browser would otherwise use that Enter to close the list
      f.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing && e.target.matches("input")) { e.preventDefault(); f.requestSubmit(); } };
      // a thing put in a department before goes there again by itself
      f.elements.text.onchange = () => { const d = L.dept[f.elements.text.value.trim().toLowerCase()]; if (d && !f.elements.category.value) f.elements.category.value = d; };
      f.onsubmit = (e) => { e.preventDefault();
        const t = f.elements.text.value.trim(), note = f.elements.note.value.trim(), category = f.elements.category.value.trim() || L.dept[t.toLowerCase()] || ""; if (!t) return;
        if (open.some((i) => i.text.trim().toLowerCase().replace(/\s+/g, " ") === t.toLowerCase().replace(/\s+/g, " "))) { toast(`"${t}" is already on the list`); return; }
        const c = cid(), same = (i) => i.text.trim().toLowerCase().replace(/\s+/g, " ") === t.toLowerCase().replace(/\s+/g, " ");
        const back = done.find(same);   // already completed: that one comes back (the server does the same), with the new note / department if given
        if (back) Object.assign(back, { done: 0, done_by: null, done_at: null, for_ids: null, assigned_by: null, due: null, client_id: c, note: note || back.note, category: category || back.category, added_by: state.data.me.name });
        L.items = back ? [...open, back, ...done.filter((i) => i !== back)] : [...open, { id: -Date.now(), client_id: c, text: t, note: note || null, category: category || null, done: 0, added_by: state.data.me.name }, ...done];
        if (category) { L.dept[t.toLowerCase()] = category; if (!L.departments.includes(category)) L.departments = [...L.departments, category].sort(); }
        f.elements.text.value = ""; f.elements.note.value = ""; f.elements.category.value = ""; drawList(); $("#ladd").elements.text.focus();
        send({ method: "POST", path: `lists/${l.id}/items`, body: { text: t, note, category, client_id: c } });
      };
    }
    const key = (k) => /^\d+$/.test(k) ? k : `c:${k}`;
    const tick = (it, k, done, fresh) => {
      it.done = done ? 1 : 0; it.done_by = state.data.me.name; it.done_at = it.done ? new Date().toISOString() : null;
      if (fresh) Object.assign(it, { for_ids: null, assigned_by: null, due: null });
      const twin = (x) => x !== it && x.done === it.done && x.text.trim().toLowerCase() === it.text.trim().toLowerCase();
      L.items = it.done ? L.items.filter((x) => !twin(x)) : L.items.some(twin) ? L.items.filter((x) => x !== it) : L.items;   // never the same thing twice
      L.items.sort((a, c) => a.done - c.done); drawList();
      send({ method: "PUT", path: `lists/${l.id}/items/${k}`, body: { done: it.done, ...(fresh ? { fresh: true } : {}) } });
    };
    $("#main").querySelectorAll("[data-lt]").forEach((b) => b.onchange = () => {
      const it = L.items.find((i) => String(i.client_id || i.id) === b.dataset.lt); if (!it) return;
      // 📌 a completed job taken off Completed: back as it was (a mistaken tick), or as a new line (doing it again: who and date cleared)
      if (!b.checked && it.done && (it.for_ids || it.due)) {
        b.checked = true;
        const was = [jobLine({ ...it, done: 0 }).replace(/<[^>]+>/g, "")].filter(Boolean).join("");
        openDialog(`<div class="form"><h2>Put it back</h2><p><b>${esc(it.text)}</b>${was ? `<br><small class="meta">${was}</small>` : ""}</p>
          <div class="actions"><button type="button" id="cancel">Cancel</button><button type="button" class="ackbtn" id="lasnew">Back as a new line</button><button type="button" class="primary" id="laswas">Back as it was</button></div></div>`, () => {
          $("#cancel").onclick = closeDialog;
          $("#laswas").onclick = () => { closeDialog(); tick(it, key(b.dataset.lt), false, false); };
          $("#lasnew").onclick = () => { closeDialog(); tick(it, key(b.dataset.lt), false, true); };
        });
        return;
      }
      tick(it, key(b.dataset.lt), b.checked, false);
    });
    $("#main").querySelectorAll("[data-le]").forEach((b) => b.onclick = () => itemForm(L.items.find((i) => String(i.client_id || i.id) === b.dataset.le), key(b.dataset.le)));
    // 🗑 on a completed line (↩ Undo for a few seconds)
    $("#main").querySelectorAll("[data-ldel]").forEach((b) => b.onclick = () => removeItem(L.items.find((i) => String(i.client_id || i.id) === b.dataset.ldel), key(b.dataset.ldel)));
    offlineNote();
    setTimeout(() => globalThis.fabFor?.("lists"), 0);
  }
  // a line removed (🗑 or Remove in ✎): the toast offers ↩ Undo, which puts it back exactly as it was (POST lists/<id>/restore)
  function removeItem(it, k) {
    if (!it) return;
    const lid = L.list.id, at = L.items.indexOf(it), copy = { ...it };
    L.items = L.items.filter((x) => x !== it); drawList();
    send({ method: "DELETE", path: `lists/${lid}/items/${k}` });
    toast(`"${it.text}" removed`, { label: "↩ Undo", run: () => {
      if (L.open === lid) { L.items.splice(Math.min(at, L.items.length), 0, copy); drawList(); }
      send({ method: "POST", path: `lists/${lid}/restore`, body: { item: copy } });
    } });
  }
  function itemForm(it, k) {
    if (!it) return;
    const lid = L.list.id, others = (L.lists || store.get("lists.all", {}).lists || []).filter((x) => x.id !== lid);
    // departments as buttons (the browser's suggestion list is clumsy on phones); a new one can still be typed
    const deps = [...new Set([...L.departments, it.category].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    // the people on this list (owner + shared with), for "For"
    const onIt = [L.list.owner_id, ...(L.list.members || []).map((m) => m.id)].map((id) => ({ id, name: id === L.list.owner_id ? L.list.owner || nameOf(id) : (L.list.members.find((m) => m.id === id)?.name || nameOf(id)) }));
    const forNow = forIds(it.for_ids);
    openDialog(`<form class="form" id="f" autocomplete="off"><h2>Change it</h2>
      <label>What<input name="text" maxlength="120" value="${esc(it.text)}" required></label>
      <label>Note<input name="note" maxlength="200" value="${esc(it.note || "")}"></label>
      <label class="fatick limpbox"><input type="checkbox" name="important" ${it.important ? "checked" : ""}> ⭐ Important</label>
      ${onIt.length > 1 ? `<div class="lshare"><span class="meta">For (optional – they get a notification)</span>${onIt.map((p) => `<label class="fatick"><input type="checkbox" name="for" value="${p.id}" ${forNow.includes(p.id) ? "checked" : ""}> ${esc(p.id === L.me ? `${p.name} (you)` : p.name)}</label>`).join("")}</div>` : ""}
      <label>Due (optional – it goes on the calendar)<input type="date" name="due" value="${esc(it.due || "")}"></label>
      <div class="ldeps"><span class="meta">Category</span><div>${["", ...deps].map((d) => `<button type="button" class="ldepb ${(it.category || "") === d ? "on" : ""}" data-dep="${esc(d)}">${d ? esc(d) : "None"}</button>`).join("")}</div>
        <input name="category" maxlength="40" value="${esc(it.category || "")}" placeholder="or type a new one" aria-label="Category"></div>
      ${others.length ? `<label>List<select name="move"><option value="">${esc(L.list.name)} (this list)</option>${others.map((x) => `<option value="${x.id}">Move to ${esc(x.name)}${placeName(x) ? ` – ${esc(placeName(x))}` : ""}</option>`).join("")}</select></label>` : ""}
      <div class="actions"><button type="button" class="danger" id="del">Remove</button><button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`, () => {
      const f = $("#f"); $("#cancel").onclick = closeDialog;
      const forBoxes = [...f.querySelectorAll("[name=for]")];
      forBoxes.forEach((x) => x.onchange = () => { if (forNow.length && !forBoxes.some((y) => y.checked)) f.elements.due.value = ""; });
      const mark = () => f.querySelectorAll("[data-dep]").forEach((b) => b.classList.toggle("on", b.dataset.dep === f.elements.category.value.trim()));
      f.querySelectorAll("[data-dep]").forEach((b) => b.onclick = () => { f.elements.category.value = b.dataset.dep; mark(); });
      f.elements.category.oninput = mark;
      f.onsubmit = (e) => { e.preventDefault();
        const text = f.elements.text.value.trim() || it.text, note = f.elements.note.value.trim() || null, category = f.elements.category.value.trim() || null, to = +f.elements.move?.value || 0;
        const fr = [...f.querySelectorAll("[name=for]:checked")].map((x) => +x.value);
        const due = onIt.length > 1 && it.for_ids && !fr.length ? null : f.elements.due.value || null;   // nobody on it any more: no date either
        const forStr = fr.length ? `,${fr.join(",")},` : null, jobChanged = (onIt.length > 1 && forStr !== (it.for_ids || null)) || due !== (it.due || null);
        if (jobChanged) { it.for_ids = onIt.length > 1 ? forStr : it.for_ids; it.due = due; send({ method: "PUT", path: `lists/${lid}/items/${k}`, body: { ...(onIt.length > 1 ? { for: fr } : {}), due } }); }
        const imp = f.elements.important.checked ? 1 : 0;
        if (imp !== (it.important ? 1 : 0)) { it.important = imp; send({ method: "PUT", path: `lists/${lid}/items/${k}`, body: { important: !!imp } }); }
        const changed = text !== it.text || note !== (it.note || null) || category !== (it.category || null);
        Object.assign(it, { text, note, category });
        if (category) { L.dept[text.trim().toLowerCase()] = category; if (!L.departments.includes(category)) L.departments = [...L.departments, category].sort(); }
        if (changed) send({ method: "PUT", path: `lists/${lid}/items/${k}`, body: { text, note, category } });
        if (to) {   // onto another list (the server joins it up with the same thing there, if it's on it already)
          L.items = L.items.filter((x) => x !== it);
          send({ method: "PUT", path: `lists/${lid}/items/${k}`, body: { move_to: to } });
          toast(`Moved to ${others.find((x) => x.id === to)?.name || "the other list"}`);
        }
        closeDialog(); drawList();
      };
      $("#del").onclick = () => { closeDialog(); removeItem(it, k); };
    });
  }

  addEventListener("online", () => flush());

  // first in the menu after the calendar
  globalThis.EXTRA_VIEWS = { lists: {
    fab: () => L.open ? null : ["New list", () => listForm(null)],
    label: "🛒 Lists", short: "Lists", ok: (d) => !!d.me?.family && !d.setupMode, render, open: () => { L.open = null; remember(null); } }, ...(globalThis.EXTRA_VIEWS || {}) };

  document.head.insertAdjacentHTML("beforeend", `<style>
    .ls { max-width: 760px; margin: 0 auto; padding: 12px 8px 90px; display: grid; gap: 12px; }
.ls.lswide { max-width: 1240px; } .lcols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; align-items: start; }
    .lcol { background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
    .lcolh { display: block; width: 100%; border: 0; background: var(--brand); color: #fff; text-align: center; font: inherit; font-weight: 700; padding: 9px; font-size: 15px; cursor: pointer; }
    .lrow { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: 0; border-top: 1px solid var(--line); background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
    .lcolh + .lrow { border-top: 0; } .lrow:hover { background: var(--bg); }
    .lrow > span { flex: 1; min-width: 0; display: grid; } .lrow b { font-weight: 600; font-size: 15px; overflow-wrap: anywhere; } .lrow small { font-size: 12px; color: var(--muted); }
    .lrow em { font-style: normal; font-weight: 700; font-size: 16px; min-width: 22px; text-align: right; } .lrow em.lzero { color: var(--muted); font-weight: 500; } .lrow i { font-style: normal; color: var(--muted); font-size: 18px; }
    .lback { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; } .lback > span { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .lshopnote { margin: 0; padding: 6px 12px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 13px; text-align: center; } .lshopnote .lbackl { font-size: 13px; padding: 0 2px; text-decoration: underline; }
    .lshopbtn { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; padding: 2px 6px; font-size: 22px; line-height: 1; cursor: pointer; }
    .lshopbtn { display: inline-grid; grid-template-columns: auto auto; align-items: center; column-gap: 4px; } .lshopbtn .lshopdot { font-size: 12px; }
    .lshopbtn small { grid-column: 1 / -1; font-size: 10.5px; color: var(--muted); text-align: center; margin-top: 1px; white-space: nowrap; }
    .lbox { background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
    /* the list's name = the blue bar; ✎ on it changes the list (like ✎ on a line); "← All lists" = a plain back link; WhatsApp stays green */
    .lbar { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; background: var(--brand); color: #fff; text-align: center; font-weight: 700; padding: 5px 0; font-size: 16px; }
    .lbartog { border: 0; background: transparent; color: #fff; font: inherit; font-weight: 700; font-size: 16px; cursor: pointer; padding: 4px 0; }
    .lshut #ladd, .lshut .lhead { display: none; }
    .lbaredit { border: 0; background: transparent; color: #fff; font-size: 17px; cursor: pointer; padding: 4px 0; }
    .lbackl { border: 0; background: transparent; color: var(--text); font: inherit; font-weight: 600; padding: 6px 2px; cursor: pointer; } .lbackl:hover { text-decoration: underline; } .lmeta { text-align: center; margin: 6px 10px; }
    #ladd { position: relative; display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1.3fr) minmax(0, 1.3fr); gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--line); }
    #ladd input { padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); font: inherit; font-size: 16px; min-width: 0; }
    .litems { list-style: none; margin: 0; padding: 0; } .litems li { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
    .litems label { flex: 1; display: flex; align-items: center; gap: 12px; padding: 6px 12px; min-height: 40px; box-sizing: border-box; cursor: pointer; min-width: 0; }
    .litems input[type=checkbox] { width: 22px; height: 22px; flex: none; } .litems span { display: grid; min-width: 0; } .litems b { font-weight: 500; font-size: 14px; overflow-wrap: anywhere; }
    .litems small { font-size: 12.5px; } .litems small.lby { color: var(--muted); font-size: 11.5px; }
    .litems li.ldone b { text-decoration: line-through; color: var(--muted); } .lempty { padding: 14px 12px; color: var(--muted); }
    .lmore { flex: none; width: 32px; border: 0; background: transparent; color: var(--muted); font-size: 15px; padding: 6px 0; cursor: pointer; }
    .ldonehead { display: block; width: 100%; padding: 6px 10px; background: var(--brand); color: #fff; border: 0; border-top: 1px solid rgba(255,255,255,.25); font: inherit; font-weight: 700; font-size: 14px; text-align: center; cursor: pointer; }
    .lbin { flex: none; width: 40px; align-self: stretch; border: 0; background: transparent; color: var(--del-text, #c92a2a); cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .lshare { display: grid; gap: 4px; }
    /* ⭐ important: the calendar's important yellow (not on Completed - it's done) */
    .litems li.limp:not(.ldone), .lminerow.limp { background: var(--important); } .limpbox { font-weight: 600; }
    .litems small.ljob, .lminerow small { color: var(--muted); font-size: 11.5px; } .litems small.ljob.late, .lminerow small.late { color: var(--del-text, #c92a2a); }
    .lmine { margin-bottom: 14px; } .lminerow { display: flex; align-items: center; gap: 10px; padding: 0 0 0 12px; } .lminerow input { width: 22px; height: 22px; flex: none; }
    .lminerow button { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; text-align: left; border: 0; background: transparent; color: var(--text); font: inherit; padding: 10px 12px 10px 0; cursor: pointer; } .lminerow b { font-weight: 600; font-size: 15px; }
    .lmitem { flex: 1; min-width: 0; display: grid; } .lmlist, .lmdue, .lmdays { flex: none; font-size: 13px; } .lmlist { width: 190px; } .lmdue { width: 130px; } .lmdays { width: 118px; text-align: left; white-space: nowrap; }   /* left-aligned: the lights sit in one line */
    .lmdue.late, .lmdays.late { color: var(--del-text, #c92a2a); font-weight: 600; } .lmdays.soon { font-weight: 600; }
    /* the For me headings: blue and white like every table heading; lined up with the columns (51px = the row's left edge, tick box and gap) */
    .lmhead { display: flex; gap: 12px; background: var(--brand); color: #fff; font-weight: 600; font-size: 13px; padding: 6px 12px 6px 51px; border-top: 1px solid rgba(255,255,255,.25); } .lmhead > span:first-child { flex: 1; }
    .lmsub { display: none; }
    @media (max-width: 699px) { .lmhead, .lmlist, .lmdue { display: none; } .lmsub { display: block; } .lmdays { width: 104px; font-size: 12.5px; } }   /* phone: days left stays as its own column, so the lights line up */
    .ldeps { display: grid; gap: 6px; } .ldeps > div { display: flex; flex-wrap: wrap; gap: 6px; }
    .ldepb { border: 1px solid var(--line); background: var(--card); color: var(--text); border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 14px; cursor: pointer; }
    .ldepb.on { background: var(--brand); border-color: var(--brand); color: #fff; }
    .lhead { display: flex; align-items: center; border-bottom: 1px solid var(--line); background: var(--brand); padding-left: 34px; } .lhead > span:first-child { flex: 1; display: flex; gap: 4px; min-width: 0; }
    .lwho { flex: none; width: 150px; font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; line-height: 1.25; } .lwho small { display: block; font-size: 11px; }
    .lhead .lwho { color: #fff; text-align: left; padding: 6px 0; font-size: 13px; } .lhpad { flex: none; width: 72px; }
    .lnograb { cursor: default; }
    .litems li.lgrp { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; background: var(--brand); color: #fff; border-top: 1px solid rgba(255,255,255,.25); }
    .lfold { border: 0; background: transparent; color: #fff; font: inherit; font-weight: 700; font-size: 13.5px; padding: 5px 4px; cursor: pointer; }
    .lgrp .lgrab { color: #fff; width: 40px; } .lsubmit { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

    .lhead button { border: 0; background: transparent; color: #fff; font: inherit; font-weight: 600; font-size: 13px; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
    @media (max-width: 560px) { .lwho { width: 96px; } .lhead { padding-left: 40px; } .lhead > span:first-child button { padding: 8px 4px; font-size: 12px; } .lhead > span:first-child { gap: 2px; overflow: hidden; } }
    /* phones: ✎ and ≡ sit in from the edge, before "Added by", so a thumb scrolling down the right-hand side doesn't grab a line */
    @media (max-width: 560px) {
      .litems li > label { order: 1; } .litems li > .lmore { order: 2; } .litems li > .lgrab, .litems li > .lbin { order: 3; } .litems li > .lwho { order: 4; padding-left: 6px; }
      .lhead > span:first-child { order: 1; } .lhead > .lhpad { order: 2; } .lhead > .lwho { order: 3; padding-left: 6px; }
      .litems li.lgrp > i:first-child { display: none; } .litems li.lgrp > .lfold { grid-column: 2; grid-row: 1; } .litems li.lgrp > .lgrab, .litems li.lgrp > i:last-child { grid-column: 1; grid-row: 1; }   /* a department's ≡ at the left end of its bar */
    }
 
    .lgrab { flex: none; display: flex; align-items: center; justify-content: center; width: 40px; align-self: stretch; color: var(--muted); cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
    body.ldragging, body.ldragging * { user-select: none; -webkit-user-select: none; cursor: grabbing; touch-action: none; }
    .ldrag { position: relative; z-index: 2; background: var(--card); box-shadow: 0 4px 14px rgba(0,0,0,.25); opacity: .95; } .ldrag .lgrab { cursor: grabbing; color: var(--text); }
    .lgroup { margin: 0; } .lgroup.ldrag { outline: 2px solid var(--brand); }
    @media (max-width: 560px) { #ladd { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } #ladd input[name=text] { grid-column: 1 / -1; } }
  </style>`);
})();
