/* Carolina & Bruno — RSVP.
 *
 * First visit  → a linear wizard (welcome → place → will you come → … → save).
 * Return visit → a menu/hub to edit any single section (unlocked once they've
 *                replied, detected via the backend or a local flag).
 *
 * The personal link (?i=<token>) is the "login": it greets the family and, once
 * the backend is live, loads their saved answers for editing. "Save" upserts the
 * whole RSVP to a Google Apps Script web app (one row per family, overwritten on
 * re-submit), which also stores each person's hometown photo in Drive.
 * The "just for fun" game is answered per attending person.
 */

// On localhost, talk to serve_local.py (writes a real CSV). In production, set this
// to the deployed Apps Script web-app URL (apps-script/README.md).
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const ENDPOINT = LOCAL ? "/rsvp" : "";   // TODO: paste Apps Script /exec URL for production

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
  if (i >= f.length - 1) { submit(); return; }
  history.push(f[i + 1]); show(f[i + 1]);
}
function goBack() {
  if (history.length > 1) { history.pop(); show(history[history.length - 1]); }
}

function renderMenu() {
  const set = (name, text) => { const el = $(`[data-status="${name}"]`); if (el) el.textContent = text; };
  set("attending", { yes: "Yes, joyfully", no: "Sadly, no" }[state.attending] || "Not answered yet");
  const coming = attendees().filter((p) => p.coming).length;
  set("attendees", coming ? `${coming} coming` : "—");
  set("accommodation", ACCOM_LABEL[state.accommodation] || "—");
  const anyGame = Object.values(state.game).some((g) => g && (g.game_place || g.hometown || g.photo || g.photo_url));
  set("game", anyGame ? "Added" : "—");
  set("message", collectFields().message ? "Written" : "Optional");
  const no = state.attending === "no";
  $$("[data-needyes]").forEach((b) => { b.classList.toggle("disabled", no); b.disabled = no; });
}

/* ---------- personalization + login (read-back) ---------- */
async function personalize() {
  const params = new URLSearchParams(location.search);
  const token = params.get("i");
  if (!token || !/^[a-z2-7]+$/.test(token)) return;
  state.token = token;
  try {
    const res = await fetch(`data/g/${token}.json`, { cache: "no-store" });
    if (!res.ok) return;
    const g = await res.json();
    state.household = g.name;
    state.id = g.id;
    state.party = Math.max(1, g.party || 1);
    state.members = Array.isArray(g.members) ? g.members : [];
    $("#familyName").textContent = g.name;
    $("#menuName").textContent = g.name;
    $("#welcomeLead").textContent = `Dear ${g.name}, we would love to celebrate our marriage with you.`;
    if (state.party > 1) {
      $("#attendeesHint").textContent =
        `We've saved up to ${state.party} seats for you — tick who's coming and when each person arrives.`;
    }
    // &reset=1 clears this family's saved state → opens fresh (first-visit)
    const reset = params.get("reset") === "1";
    if (reset) localStorage.removeItem(lsKey());
    const replied = reset ? false : await loadExisting();
    // return/menu mode: after a real reply, or forced with &edit=1 (preview/testing)
    if (!reset && (replied || localStorage.getItem(lsKey()) || params.get("edit") === "1")) {
      setMode("return"); buildAttendees();
    }
  } catch (_) { /* unknown / offline → generic page */ }
}

async function loadExisting() {
  if (!ENDPOINT) return false;
  try {
    const res = await fetch(`${ENDPOINT}?token=${encodeURIComponent(state.token)}`, { cache: "no-store" });
    const data = await res.json();
    if (!data || !data.found) return false;
    state.attending = data.attending || "";
    state.accommodation = data.accommodation || "";
    setField("message", data.message);
    if (data.attendees_json) { try { state.savedAttendees = JSON.parse(data.attendees_json); } catch (_) {} }
    if (data.game_json) {
      try {
        JSON.parse(data.game_json).forEach((e) => {
          state.game[e.name] = { game_place: e.game_place, hometown: e.hometown, photo_url: e.photo_url, skip: !!e.opted_out };
        });
      } catch (_) {}
    }
    return true;
  } catch (_) { return false; }
}
function setField(name, value) { const el = $(`[data-field="${name}"]`); if (el && value) el.value = value; }

/* ---------- attendee rows ---------- */
function attendeeRow(person) {
  const { name = "", coming = true, arrival = "18 June", isExtra = false } = person || {};
  const row = document.createElement("div");
  row.className = "attendee" + (coming ? "" : " declined");
  const opts = ARRIVAL.map((d) => `<option${d === arrival ? " selected" : ""}>${d}</option>`).join("");
  row.innerHTML =
    `<label class="coming" title="Coming?"><input type="checkbox"${coming ? " checked" : ""}></label>` +
    `<input type="text" class="name" placeholder="${isExtra ? "Guest (plus-one)" : "Full name"}" value="${esc(name)}">` +
    `<select class="arrive" aria-label="Arrival day"${coming ? "" : " disabled"}>${opts}</select>` +
    `<button type="button" class="x" aria-label="Remove">&times;</button>`;
  const chk = row.querySelector(".coming input");
  chk.addEventListener("change", () => {
    row.classList.toggle("declined", !chk.checked);
    row.querySelector(".arrive").disabled = !chk.checked;
  });
  row.querySelector(".x").addEventListener("click", () => row.remove());
  return row;
}
function buildAttendees() {
  const list = $("#attendeeList");
  if (list.childElementCount) return;
  const saved = state.savedAttendees;
  if (saved && saved.length) { saved.forEach((p) => list.appendChild(attendeeRow(p))); return; }
  const rows = Math.max(state.party, state.members.length, 1);
  for (let i = 0; i < rows; i++) list.appendChild(attendeeRow({ name: state.members[i] || "" }));
}
function attendees() {
  return $$("#attendeeList .attendee").map((r) => {
    const name = r.querySelector(".name").value.trim();
    if (!name) return null;
    return { name, coming: r.querySelector(".coming input").checked, arrival: r.querySelector(".arrive").value };
  }).filter(Boolean);
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
        `<label class="field"><span>The nicest photo of your hometown</span>` +
          `<input type="file" class="g-photo" accept="image/*">` +
          `<small>Please upload a <strong>high-resolution</strong> photo — the sharper, the better.</small>` +
          `<img class="g-prev" alt=""${img ? ` src="${esc(img)}"` : " hidden"}></label>` +
      `</div>`;
    const fields = block.querySelector(".g-fields");
    const place = block.querySelector(".g-place");
    const home = block.querySelector(".g-home");
    const prev = block.querySelector(".g-prev");
    block.querySelector(".g-skip").addEventListener("change", (e) => {
      g.skip = e.target.checked; fields.hidden = g.skip;
    });
    place.addEventListener("input", () => { g.game_place = place.value.trim(); });
    home.addEventListener("input", () => { g.hometown = home.value.trim(); });
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
    if (g.skip) return { name: p.name, game_place: "", hometown: "", opted_out: true };
    const e = { name: p.name, game_place: g.game_place || "", hometown: g.hometown || "" };
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
  if (!ENDPOINT) return true;
  try {
    const res = await fetch(`${ENDPOINT}?status=1`, { cache: "no-store" });
    const d = await res.json();
    return d.open !== false;                 // only closed when explicitly false
  } catch (_) { return true; }               // never lock guests out on a glitch
}
function applyClosed() {
  const b = $("#closedBanner"); if (b) b.hidden = false;
  $$("[data-submit]").forEach((x) => (x.disabled = true));
}

async function submit() {
  if (!state.open) { status("err", "RSVPs are closed — please email us for changes."); return; }
  const fields = collectFields();
  if (!state.attending) { status("err", "Please answer “Will you come?” first."); return; }

  const people = state.attending === "yes" ? attendees() : [];
  const coming = people.filter((p) => p.coming);
  if (state.attending === "yes" && coming.length === 0) {
    status("err", "Add at least one guest who's coming (in “Who's coming”).");
    return;
  }
  const summary = people.map((p) => (p.coming ? `${p.name} (${p.arrival})` : `${p.name} (not coming)`)).join("; ");

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
    status("", "");
    $("#doneMsg").textContent = state.attending === "no"
      ? "We'll miss you — thank you for letting us know. You can change this anytime with your link."
      : "Your reply is saved. You can change it anytime with your link.";
    setMode("return");
    show("done");
  } catch (_) {
    $$("[data-submit]").forEach((b) => (b.disabled = false));
    status("err", ENDPOINT
      ? "Something went wrong — please try again, or email us."
      : "RSVP isn't connected yet — please check back soon.");
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
