/* Carolina & Bruno — RSVP.
 *
 * First visit  → a linear wizard (welcome → place → will you come → … → save).
 * Return visit → a menu/hub to edit any single section (unlocked once they've
 *                replied, detected via the backend or a local flag).
 *
 * The personal link (?i=<token>) is the "login": the backend looks the code up in
 * the Master Guest List sheet and returns the family (names, seats) plus any saved
 * answers for editing. "Save" sends the whole RSVP to the Google Apps Script web
 * app, which logs it in the sheet and stores each person's hometown photo in Drive.
 * The "just for fun" game is answered per attending person.
 */

// POST replies to the Apps Script web app and read back via JSONP (browsers block
// cross-origin GET reads of Apps Script). That's true locally too — previewing on
// localhost talks to the real backend, so use a test link. (?backend=local switches to
// the old serve_local.py dev server, if you have it.)
const LOCAL = new URLSearchParams(location.search).get("backend") === "local";
const EXEC = "https://script.google.com/macros/s/AKfycbxSCJj0KO2Y97PqmmN4tTd7hBpO4053NNCC_Q3_Erls7Rtk_l0N6fGNQeYHSPYGYwm3/exec";
const ENDPOINT = LOCAL ? "/rsvp" : EXEC;   // where RSVP POSTs go

// JSONP GET to Apps Script (bypasses CORS); resolves the returned JSON.
function jsonp(params) {
  return new Promise((resolve, reject) => {
    if (!EXEC) return reject(new Error("no exec"));
    const cb = "cb_" + Math.random().toString(36).slice(2);
    const s = document.createElement("script");
    const done = (fn, arg) => { clearTimeout(t); delete window[cb]; s.remove(); fn(arg); };
    const t = setTimeout(() => done(reject, new Error("timeout")), 8000);
    window[cb] = (data) => done(resolve, data);
    s.onerror = () => done(reject, new Error("jsonp"));
    s.src = EXEC + "?" + new URLSearchParams({ ...params, callback: cb }).toString();
    document.body.appendChild(s);
  });
}

const ARRIVAL = ["18 June", "19 June", "Earlier", "Not sure"];
const ACCOM_LABEL = { both: "Both nights", night19: "19th only", none: "All sorted" };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const state = {
  token: "", household: "", id: "", party: 1, members: [], savedAttendees: null,
  attending: "", accommodation: "", game: {}, open: true,
};
let mode = "first";                 // "first" (linear) | "return" (menu)
let history = ["welcome"];

/* ---------- mode ---------- */
function setMode(m) {
  mode = m;
  document.body.className = m === "return" ? "mode-return" : "mode-first";
  $("#startBtn").textContent = m === "return" ? "View / edit my RSVP" : "Open our invitation";
}
function lsKey() { return `cb-${state.token}`; }

/* ---------- navigation ---------- */
function firstFlow() {
  return state.attending === "no"
    ? ["welcome", "place", "rsvp", "note"]
    : ["welcome", "place", "rsvp", "attendees", "stay", "game", "note"];
}
function show(step) {
  $$(".step").forEach((s) => s.classList.toggle("active", s.dataset.step === step));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (mode === "first") {
    const f = firstFlow();
    const i = f.indexOf(step);
    $("#bar").style.width = i >= 0 ? `${(i / (f.length - 1)) * 100}%` : "0";
  }
  if (step === "menu") renderMenu();
  if (step === "attendees") buildAttendees();
  if (step === "game") buildGame();
}
function goNext() {
  const f = firstFlow();
  const i = f.indexOf(history[history.length - 1]);
  if (i < 0) return;
  if (f[i] === "attendees" && !checkAttendees()) return;
  if (i >= f.length - 1) { submit(); return; }
  history.push(f[i + 1]); show(f[i + 1]);
}
function goBack() {
  if (history.length > 1) { history.pop(); show(history[history.length - 1]); }
}

function renderMenu() {
  const set = (name, text) => { const el = $(`[data-status="${name}"]`); if (el) el.textContent = text; };
  set("attending", { yes: "Yes, joyfully", no: "Sadly, no" }[state.attending] || "Not answered yet");
  const comingList = attendees().filter((p) => p.coming);
  const kids = comingList.filter((p) => p.child).length;
  set("attendees", comingList.length ? `${comingList.length} coming${kids ? ` (${kids} kid${kids > 1 ? "s" : ""})` : ""}` : "Not set yet");
  set("accommodation", ACCOM_LABEL[state.accommodation] || "Not set yet");
  const anyGame = Object.values(state.game).some((g) => g && (g.game_place || g.hometown || g.song || g.photo || g.photo_url));
  set("game", anyGame ? "Added" : "Not set yet");
  set("message", collectFields().message ? "Written" : "Optional");
  const no = state.attending === "no";
  $$("[data-needyes]").forEach((b) => { b.classList.toggle("disabled", no); b.disabled = no; });
}

/* ---------- personalization + login (read-back) ---------- */
// One backend call answers both "who is this link?" and "what did they reply?".
async function lookup(token) {
  try {
    if (LOCAL) return await (await fetch(`${ENDPOINT}?token=${encodeURIComponent(token)}`, { cache: "no-store" })).json();
    return await jsonp({ token });
  } catch (_) { return null; }
}
async function personalize() {
  const params = new URLSearchParams(location.search);
  const token = params.get("i");
  if (!token || !/^[a-z2-7]+$/.test(token)) return;
  state.token = token;
  try {
    const data = await lookup(token);
    const g = data && data.household;
    if (!g) return;
    state.household = g.name;
    state.id = g.id;
    state.party = Math.max(1, g.party || 1);
    state.members = Array.isArray(g.members) ? g.members : [];
    $("#familyName").textContent = `Dear ${g.name},`;
    $("#menuName").textContent = g.name;
    $("#welcomeLead").textContent = `We invite you to celebrate our marriage.`;
    // Single invitees get a plus-one button; families get a "did we miss someone?" note instead.
    // Driven by the household's Type in the sheet; falls back to party size if unset.
    const single = g.category ? g.category === "single"
                              : (state.party <= 1 && state.members.length <= 1);
    const addBtn = $("#addGuest"), missNote = $("#missNote");
    if (addBtn) addBtn.hidden = !single;
    if (missNote) missNote.hidden = single;
    // &reset=1 clears this family's saved state → opens fresh (first-visit)
    const reset = params.get("reset") === "1";
    if (reset) { localStorage.removeItem(lsKey()); return; }
    // Return visit: this device already replied (localStorage flag), the backend has
    // their reply, or &edit=1 → straight to the edit menu, with the saved answers filled in.
    const replied = applyReply(data);
    if (replied || localStorage.getItem(lsKey()) || params.get("edit") === "1") {
      setMode("return"); buildAttendees(); renderMenu(); show("menu");
    }
  } catch (_) { /* unknown / offline → generic page */ }
}

function applyReply(data) {
  if (!data || !data.found) return false;
  state.attending = data.attending || "";
  state.accommodation = data.accommodation || "";
  setField("message", data.message);
  if (data.attendees_json) { try { state.savedAttendees = JSON.parse(data.attendees_json); } catch (_) {} }
  if (data.game_json) {
    try {
      JSON.parse(data.game_json).forEach((e) => {
        state.game[e.name] = { game_place: e.game_place, hometown: e.hometown, song: e.song, photo_url: e.photo_url, skip: !!e.opted_out };
      });
    } catch (_) {}
  }
  return true;
}
function setField(name, value) { const el = $(`[data-field="${name}"]`); if (el && value) el.value = value; }

/* ---------- attendee rows ---------- */
// Each person invited has a seat (their row in the guest sheet), so names can be
// corrected but people can't be removed — they're unticked instead. Only plus-ones
// (no seat) get a remove button.
function attendeeRow(person) {
  const { name = "", coming = true, arrival = "18 June", child = false, diet = "", seat = "", isExtra = false } = person || {};
  const row = document.createElement("div");
  row.className = "attendee" + (coming ? "" : " declined");
  if (seat) row.dataset.seat = seat;
  const opts = ARRIVAL.map((d) => `<option${d === arrival ? " selected" : ""}>${d}</option>`).join("");
  row.innerHTML =
    `<label class="coming" title="Coming?"><input type="checkbox"${coming ? " checked" : ""}></label>` +
    `<input type="text" class="name" placeholder="${isExtra || !seat ? "Guest (plus-one)" : "Full name"}" value="${esc(name)}">` +
    `<select class="arrive" aria-label="Arrival day"${coming ? "" : " disabled"}>${opts}</select>` +
    `<label class="kid" title="Is this a child?"><input type="checkbox" class="kidck"${child ? " checked" : ""}> kid</label>` +
    (seat ? "" : `<button type="button" class="x" aria-label="Remove">&times;</button>`) +
    `<input type="text" class="diet" placeholder="Allergies or dietary needs (optional)" value="${esc(diet)}"${coming ? "" : " disabled"}>`;
  const chk = row.querySelector(".coming input");
  chk.addEventListener("change", () => {
    row.classList.toggle("declined", !chk.checked);
    row.querySelector(".arrive").disabled = !chk.checked;
    row.querySelector(".diet").disabled = !chk.checked;
    row.querySelector(".name").classList.remove("missing");
  });
  row.querySelector(".name").addEventListener("input", (e) => e.target.classList.remove("missing"));
  const x = row.querySelector(".x");
  if (x) x.addEventListener("click", () => row.remove());
  return row;
}
// A member can be a plain name string (legacy) OR {name, kid, seat} (from the guest
// sheet). A blank name becomes an empty, editable row; kid slots pre-tick "kid".
function memberToPerson(m) {
  if (m && typeof m === "object") return { name: m.name || "", child: !!m.kid, seat: m.seat || "" };
  return { name: m || "" };
}
function buildAttendees() {
  const list = $("#attendeeList");
  if (list.childElementCount) return;
  const saved = state.savedAttendees;
  if (saved && saved.length) { saved.forEach((p) => list.appendChild(attendeeRow(p))); return; }
  const members = Array.isArray(state.members) ? state.members : [];
  const rows = Math.max(state.party, members.length, 1);
  for (let i = 0; i < rows; i++) list.appendChild(attendeeRow(memberToPerson(members[i])));
}
// Everyone with a name, plus unnamed seats (sent as not coming, so the sheet knows).
function attendees() {
  return $$("#attendeeList .attendee").map((r) => {
    const name = r.querySelector(".name").value.trim();
    const seat = r.dataset.seat || "";
    if (!name && !seat) return null;
    const coming = !!name && r.querySelector(".coming input").checked;
    const p = { name, coming, arrival: r.querySelector(".arrive").value, child: r.querySelector(".kidck").checked,
                diet: coming ? r.querySelector(".diet").value.trim() : "" };
    if (seat) p.seat = seat;
    return p;
  }).filter(Boolean);
}
// Ticked as coming but no name → flag it (returns true when everything's fine).
function checkAttendees() {
  const missing = $$("#attendeeList .attendee").filter((r) =>
    r.querySelector(".coming input").checked && !r.querySelector(".name").value.trim());
  missing.forEach((r) => r.querySelector(".name").classList.add("missing"));
  const msg = $("#attendeesStatus");
  if (msg) msg.textContent = missing.length
    ? "Please add a name for everyone coming, or untick anyone who isn't." : "";
  return !missing.length;
}

/* ---------- game (per attending person) ---------- */
function buildGame() {
  const list = $("#gameList");
  list.innerHTML = "";
  const people = attendees().filter((p) => p.coming);
  if (!people.length) {
    list.innerHTML = '<p class="sub">Add who\'s coming first (in “Who\'s coming”).</p>';
    return;
  }
  people.forEach((p) => {
    const g = state.game[p.name] || (state.game[p.name] = {});
    const img = g.dataUrl || g.photo_url;
    const block = document.createElement("div");
    block.className = "game-person";
    block.innerHTML =
      `<h3 class="person">${esc(p.name)}</h3>` +
      `<label class="skip-person"><input type="checkbox" class="g-skip"${g.skip ? " checked" : ""}> Prefer not to take part</label>` +
      `<div class="g-fields"${g.skip ? " hidden" : ""}>` +
        `<label class="field"><span>A place you've never been, but would love to visit</span>` +
          `<input type="text" class="g-place" value="${esc(g.game_place || "")}" placeholder="e.g. Kyoto, Japan"></label>` +
        `<label class="field"><span>Your hometown</span>` +
          `<input type="text" class="g-home" value="${esc(g.hometown || "")}" placeholder="Town, country"></label>` +
        `<label class="field"><span>A song from your home country we should play</span>` +
          `<input type="text" class="g-song" value="${esc(g.song || "")}" placeholder="Song and artist"></label>` +
        `<label class="field"><span>A nice photo of your hometown</span>` +
          `<input type="file" class="g-photo" accept="image/*">` +
          `<small>Please upload a <strong>high-resolution</strong> photo. The sharper, the better.</small>` +
          `<img class="g-prev" alt=""${img ? ` src="${esc(img)}"` : " hidden"}></label>` +
      `</div>`;
    const fields = block.querySelector(".g-fields");
    const place = block.querySelector(".g-place");
    const home = block.querySelector(".g-home");
    const song = block.querySelector(".g-song");
    const prev = block.querySelector(".g-prev");
    block.querySelector(".g-skip").addEventListener("change", (e) => {
      g.skip = e.target.checked; fields.hidden = g.skip;
    });
    place.addEventListener("input", () => { g.game_place = place.value.trim(); });
    home.addEventListener("input", () => { g.hometown = home.value.trim(); });
    song.addEventListener("input", () => { g.song = song.value.trim(); });
    block.querySelector(".g-photo").addEventListener("change", (e) => {
      if (!e.target.files[0]) return;
      resizePhoto(e.target.files[0], (res) => {
        g.photo = { b64: res.b64, type: res.type, name: res.name };
        g.dataUrl = res.dataUrl;
        prev.src = res.dataUrl; prev.hidden = false;
      });
    });
    list.appendChild(block);
  });
}
function collectGame() {
  return attendees().filter((p) => p.coming).map((p) => {
    const g = state.game[p.name] || {};
    if (g.skip) return { name: p.name, game_place: "", hometown: "", song: "", opted_out: true };
    const e = { name: p.name, game_place: g.game_place || "", hometown: g.hometown || "", song: g.song || "" };
    if (g.photo) { e.photo_b64 = g.photo.b64; e.photo_type = g.photo.type; e.photo_name = g.photo.name; }
    else if (g.photo_url) { e.photo_url = g.photo_url; }       // carry forward on edit
    return e;
  });
}

/* ---------- photo resize (client-side, kept high quality) ---------- */
function resizePhoto(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 2600;
      let { width: w, height: h } = img;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = c.toDataURL("image/jpeg", 0.92);
      cb({ b64: dataUrl.split(",")[1], type: "image/jpeg", name: file.name, dataUrl });
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ---------- submit (upsert) ---------- */
function collectFields() {
  const out = {};
  $$("[data-field]").forEach((el) => { out[el.dataset.field] = el.value.trim(); });
  return out;
}
function status(cls, msg) {
  ["#formStatus", "#menuStatus"].forEach((id) => {
    const e = $(id); if (e) { e.className = "form-status " + cls; e.textContent = msg; }
  });
}

async function checkOpen() {
  try {
    let d;
    if (LOCAL) {
      if (!ENDPOINT) return true;
      d = await (await fetch(`${ENDPOINT}?status=1`, { cache: "no-store" })).json();
    } else {
      if (!EXEC) return true;
      d = await jsonp({ status: 1 });
    }
    return d.open !== false;                 // only closed when explicitly false
  } catch (_) { return true; }               // never lock guests out on a glitch
}
function applyClosed() {
  const b = $("#closedBanner"); if (b) b.hidden = false;
  $$("[data-submit]").forEach((x) => (x.disabled = true));
}

async function submit() {
  if (!state.open) { status("err", "RSVPs are closed. Please email us for changes."); return; }
  const fields = collectFields();
  if (!state.attending) { status("err", "Please answer “Will you come?” first."); return; }

  if (state.attending === "yes" && $("#attendeeList").childElementCount && !checkAttendees()) {
    status("err", "Please add a name for everyone coming (in “Who's coming”).");
    return;
  }
  const people = state.attending === "yes" ? attendees() : [];
  const coming = people.filter((p) => p.coming);
  if (state.attending === "yes" && coming.length === 0) {
    status("err", "Add at least one guest who's coming (in “Who's coming”).");
    return;
  }
  const summary = people.filter((p) => p.name)
    .map((p) => (p.coming ? `${p.name} (${p.arrival}${p.child ? ", child" : ""})` : `${p.name} (not coming)`)).join("; ");

  const payload = {
    submitted_at: new Date().toISOString(),
    id: state.id, token: state.token,
    household: state.household || (people[0] && people[0].name) || "",
    attending: state.attending,
    attendee_count: coming.length,
    attendees: summary,
    attendees_json: JSON.stringify(people),
    accommodation: state.attending === "yes" ? state.accommodation : "",
    game: state.attending === "yes" ? collectGame() : [],
    message: fields.message || "",
  };

  $$("[data-submit]").forEach((b) => (b.disabled = true));
  status("", "Saving…");
  try {
    if (!ENDPOINT) throw new Error("no endpoint");
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    if (state.token) localStorage.setItem(lsKey(), "1");
    $$("[data-submit]").forEach((b) => (b.disabled = false));  // re-enable so edit→save works in-session
    status("", "");
    $("#doneMsg").textContent = state.attending === "no"
      ? "Thank you for letting us know. Change it anytime with your link."
      : "Your reply is saved. Change it anytime with your link.";
    setMode("return");
    show("done");
  } catch (_) {
    $$("[data-submit]").forEach((b) => (b.disabled = false));
    status("err", ENDPOINT
      ? "Something went wrong. Please try again, or email us."
      : "RSVP isn't connected yet. Please check back soon.");
  }
}

/* ---------- wiring ---------- */
function wire() {
  $("#startBtn").addEventListener("click", () => {
    if (mode === "return") { show("menu"); return; }
    history = ["welcome", "place"]; show("place");
  });
  $$("[data-next]").forEach((b) => b.addEventListener("click", goNext));
  $$("[data-back]").forEach((b) => b.addEventListener("click", goBack));
  $$("[data-menu]").forEach((b) => b.addEventListener("click", () => show("menu")));
  $$("[data-open]").forEach((b) => b.addEventListener("click", () => { if (!b.disabled) show(b.dataset.open); }));
  $$("[data-submit]").forEach((b) => b.addEventListener("click", submit));

  $$("[data-attending]").forEach((b) => b.addEventListener("click", () => {
    state.attending = b.dataset.attending;
    if (mode === "first") {
      history = history.slice(0, history.indexOf("rsvp") + 1);
      const f = firstFlow();
      const next = f[f.indexOf("rsvp") + 1];
      history.push(next); show(next);
    } else { show("menu"); }
  }));
  $$("[data-accom]").forEach((b) => b.addEventListener("click", () => {
    state.accommodation = b.dataset.accom;
    if (mode === "first") goNext(); else show("menu");
  }));

  $("#addGuest").addEventListener("click", () => $("#attendeeList").appendChild(attendeeRow({ isExtra: true })));
}

personalize();
wire();
(async () => { state.open = await checkOpen(); if (!state.open) applyClosed(); })();
