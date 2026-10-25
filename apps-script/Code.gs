/**
 * RSVP backend for the Carolina & Bruno wedding site.
 * Deploy as a Web App (see README.md); its /exec URL is EXEC in assets/app.js.
 *
 * The "Master Guest List" Google Sheet (in the Wedding RSVPs folder) is the source of
 * truth:  Invitations (one row per link)  ·  Guests (one row per person)  ·  Replies
 * (one row per submission, appended by this script — the latest row per code wins).
 * Each reply is also written back into Guests, matched by Seat ID: Coming, Arrives,
 * Needs room and Dietary are filled in, corrected/filled-in names replace the old
 * ones (the old name goes into Notes), and plus-ones get new rows.
 * Summary, Rooms and Tasks live in the same sheet; the website doesn't touch them.
 *
 *  doGet  ?token=<code> → that invitation (greeting, guests, …) + its latest reply (+open)
 *         ?status=1     → {open}
 *  doPost               → appends the reply to Replies, saves photos to "Wedding
 *                         Hometown Photos", EMAILS a summary, and (for the control
 *                         page, during the switch-over) also writes <token>.json.
 *
 * Close/open the site: run closeRsvp() / openRsvp() from the editor, or use the
 * control link (?admin=<ADMIN_KEY>&open=0|1; the key is a Script property).
 */

const SHEET_ID = '1dB3GTqQdIw38SFQcdaA8KdFXWXu34uFhD_vWtBXYPRs';     // Master Guest List
const RSVP_FOLDER_ID = '1EQPnCnQJDPdDPgisdI1A06RG7slCQZxy';           // safe to rename
const PHOTO_FOLDER_ID = '1mlBR-VSIX9qPc0BctutjmY2qE8oJXhNb';
const NOTIFY = 'bruno.c.coutinho@gmail.com';   // who gets the email (comma-separate for more)
// The control-page password is NOT in this file (the code is public). Set it once in
// the Apps Script editor: Project Settings → Script properties → ADMIN_KEY.
function adminKey_() { return PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || ''; }

const FIELDS = [
  'submitted_at', 'id', 'token', 'household', 'attending',
  'attendee_count', 'attendees', 'attendees_json', 'accommodation',
  'game', 'game_json', 'message',
];
// Replies tab: header → field of the reply record it holds.
const REPLY_COLS = {
  'Received': 'submitted_at', 'Code': 'token', 'Invitation': 'household',
  'Attending': 'attending', 'Coming': 'attendee_count', 'Who': 'attendees',
  'Needs room': 'accommodation', 'Message': 'message',
  'attendees_json': 'attendees_json', 'game_json': 'game_json',
};

const ROOM_LABEL = { both: 'Both nights', night19: '19th only', none: 'No' };

// ----- open / close (run these from the editor to toggle) -----
function isOpen_() {
  return PropertiesService.getScriptProperties().getProperty('RSVP_OPEN') !== 'false';
}
function closeRsvp() { PropertiesService.getScriptProperties().setProperty('RSVP_OPEN', 'false'); }
function openRsvp() { PropertiesService.getScriptProperties().setProperty('RSVP_OPEN', 'true'); }

// ----- sheet helpers -----
// A tab as {head: {header → column index}, rows: [...]}; columns are found by
// header name, so adding or reordering columns in the sheet doesn't break this.
function tab_(name) {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
  const values = sh.getDataRange().getValues();
  const head = {};
  (values[0] || []).forEach((h, i) => { head[String(h).trim()] = i; });
  return { sheet: sh, head: head, rows: values.slice(1) };
}
function cell_(t, row, header) {
  const i = t.head[header];
  return i === undefined ? '' : row[i];
}

// The invitation behind a link, or null if the code is unknown or its Status isn't
// "Invite" (so "Maybe later" links show the generic page and can't reply yet).
function invitation_(token) {
  const inv = tab_('Invitations');
  const row = inv.rows.find((r) => String(cell_(inv, r, 'Code')).trim() === token);
  if (!row || String(cell_(inv, row, 'Status')).trim() !== 'Invite') return null;
  const group = String(cell_(inv, row, 'Invitation')).trim();
  const guests = tab_('Guests');
  const members = guestRows_(guests, group).map((i) => {
    const r = guests.rows[i];
    return { name: String(cell_(guests, r, 'Name')).trim(), kid: cell_(guests, r, 'Kid') === true,
             seat: ensureSeat_(guests, i) };
  });
  return {
    name: String(cell_(inv, row, 'Greeting')).trim() || group, group: group,
    side: cell_(inv, row, 'Side'), category: cell_(inv, row, 'Type'),
    party: Math.max(members.length, 1), members: members,
  };
}

// ----- Guests: one row per person, linked to the website by its Seat ID -----
function guestRows_(guests, group) {
  const out = [];
  guests.rows.forEach((r, i) => { if (String(cell_(guests, r, 'Invitation')).trim() === group) out.push(i); });
  return out;
}
function setCell_(t, i, header, value) {
  const c = t.head[header];
  if (c === undefined) return;
  t.sheet.getRange(i + 2, c + 1).setValue(value);
  t.rows[i][c] = value;
}
function nextSeat_(guests) {
  let max = 0;
  guests.rows.forEach((r) => {
    const m = /^G(\d+)$/.exec(String(cell_(guests, r, 'Seat')).trim());
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'G' + String(max + 1).padStart(3, '0');
}
// Rows added by hand get their Seat ID the first time their invitation is opened.
function ensureSeat_(guests, i) {
  const seat = String(cell_(guests, guests.rows[i], 'Seat')).trim();
  if (seat) return seat;
  const id = nextSeat_(guests);
  setCell_(guests, i, 'Seat', id);
  return id;
}

// ----- rows added by hand: fill in what the website needs -----
// Runs on every edit of the sheet (see installTriggers). A new Invitations row gets a
// random Code, Status "Maybe later" (switching to Invite is a decision)
// and Type "family" if those are blank; a new Guests row
// gets a Seat. Edits made by scripts don't re-trigger it.
function tidySheet() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const inv = tab_('Invitations');
    const used = {};
    inv.rows.forEach((r) => { used[String(cell_(inv, r, 'Code')).trim()] = true; });
    inv.rows.forEach((r, i) => {
      if (!String(cell_(inv, r, 'Invitation')).trim()) return;
      if (!String(cell_(inv, r, 'Code')).trim()) {
        let code;
        do { code = newCode_(); } while (used[code]);
        used[code] = true;
        setCell_(inv, i, 'Code', code);
      }
      if (!String(cell_(inv, r, 'Status')).trim()) setCell_(inv, i, 'Status', 'Maybe later');
      if (!String(cell_(inv, r, 'Type')).trim()) setCell_(inv, i, 'Type', 'family');
    });
    const guests = tab_('Guests');
    guests.rows.forEach((r, i) => { if (String(cell_(guests, r, 'Invitation')).trim()) ensureSeat_(guests, i); });
  } finally { lock.releaseLock(); }
}
function onGuestListEdit(e) { tidySheet(); }
function newCode_() {
  const abc = 'abcdefghijklmnopqrstuvwxyz234567';      // the website accepts [a-z2-7]
  let out = '';
  for (let k = 0; k < 10; k++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}
// Run ONCE from the editor (Run → installTriggers) after deploying this version.
function installTriggers() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'onGuestListEdit')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onGuestListEdit').forSpreadsheet(SHEET_ID).onEdit().create();
  tidySheet();
}

// Writes one reply into Guests. Returns the attendees with Seat IDs filled in (so a
// plus-one keeps its row when the family edits their reply later).
function applyToGuests_(group, data) {
  const guests = tab_('Guests');
  const people = jparse_(data.attendees_json);
  const yes = data.attending === 'yes';
  const room = yes ? (ROOM_LABEL[data.accommodation] || '') : '';
  const mine = guestRows_(guests, group);
  const seen = {};
  const fill = (i, p) => {
    const coming = yes && !!p.coming;
    setCell_(guests, i, 'Coming', coming ? 'yes' : 'no');
    setCell_(guests, i, 'Arrives', coming ? (p.arrival || '') : '');
    setCell_(guests, i, 'Needs room', coming ? room : '');
    setCell_(guests, i, 'Dietary', coming ? (p.diet || '') : '');
  };
  people.forEach((p) => {
    const name = String(p.name || '').trim();
    // Match by Seat; replies from before Seat IDs existed fall back to the name.
    let i = p.seat ? mine.find((j) => String(cell_(guests, guests.rows[j], 'Seat')).trim() === String(p.seat)) : undefined;
    if (i === undefined && name) {
      i = mine.find((j) => !seen[j] && String(cell_(guests, guests.rows[j], 'Name')).trim().toLowerCase() === name.toLowerCase());
    }
    if (i !== undefined) {                                   // a known seat: update it
      p.seat = String(cell_(guests, guests.rows[i], 'Seat')).trim() || ensureSeat_(guests, i);
      const old = String(cell_(guests, guests.rows[i], 'Name')).trim();
      if (name && name !== old) {
        if (old) {
          const notes = String(cell_(guests, guests.rows[i], 'Notes')).trim();
          setCell_(guests, i, 'Notes', (notes ? notes + '; ' : '') + `Was "${old}" (changed in reply)`);
        } else if (p.child) {
          setCell_(guests, i, 'Kid', true);
        }
        setCell_(guests, i, 'Name', name);
      }
      fill(i, p);
      seen[i] = true;
    } else if (name) {                                       // a plus-one: new row
      let last = -1;
      guests.rows.forEach((r, j) => { if (String(cell_(guests, r, 'Invitation')).trim()) last = j; });
      const i2 = last + 1;
      if (i2 >= guests.rows.length) guests.rows.push(new Array(Object.keys(guests.head).length).fill(''));
      p.seat = nextSeat_(guests);
      setCell_(guests, i2, 'Invitation', group);
      setCell_(guests, i2, 'Name', name);
      setCell_(guests, i2, 'Kid', !!p.child);
      setCell_(guests, i2, 'Notes', 'Added by reply');
      setCell_(guests, i2, 'Seat', p.seat);
      fill(i2, p);
    }
  });
  // Anyone on the invitation that the reply didn't include isn't coming.
  mine.forEach((i) => { if (!seen[i]) fill(i, { coming: false }); });
  return people;
}

function latestReply_(token) {
  const t = tab_('Replies');
  for (let i = t.rows.length - 1; i >= 0; i--) {
    const r = t.rows[i];
    if (String(cell_(t, r, 'Code')).trim() !== token) continue;
    const rec = {};
    Object.keys(REPLY_COLS).forEach((h) => {
      const v = cell_(t, r, h);
      rec[REPLY_COLS[h]] = v instanceof Date ? v.toISOString() : v;
    });
    return rec;
  }
  return null;
}

function appendReply_(rec) {
  const t = tab_('Replies');
  const row = new Array(Object.keys(t.head).length).fill('');
  Object.keys(REPLY_COLS).forEach((h) => {
    if (t.head[h] !== undefined) row[t.head[h]] = h === 'Received' ? new Date() : rec[REPLY_COLS[h]];
  });
  t.sheet.appendRow(row);
}

// ----- Drive helpers (reply files kept for the control page) -----
function fileFor_(folder, token) {
  const it = folder.getFilesByName(`${token}.json`);
  return it.hasNext() ? it.next() : null;
}

function doPost(e) {
  try {
    if (!isOpen_()) return json({ ok: false, closed: true });
    const data = JSON.parse(e.postData.contents);
    const token = String(data.token || '');
    const inv = invitation_(token);
    if (!inv) return json({ ok: false, error: 'unknown link' });
    data.household = inv.group;                // the sheet's name for it, not the greeting

    const game = Array.isArray(data.game) ? data.game : [];
    game.forEach((p) => {
      if (p.photo_b64) {
        p.photo_url = savePhoto_(p.photo_b64, p.photo_type, `${data.household}-${p.name}`);
        delete p.photo_b64; delete p.photo_type; delete p.photo_name;
      }
    });
    data.game_json = JSON.stringify(game);
    data.game = game
      .map((p) => `${p.name}: ${p.game_place || '—'} / from ${p.hometown || '—'}${p.photo_url ? ' [photo]' : ''}`)
      .join('  ·  ');

    const rec = {};
    FIELDS.forEach((f) => { rec[f] = data[f] || ''; });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      rec.attendees_json = JSON.stringify(applyToGuests_(inv.group, data));
      appendReply_(rec);
    } finally { lock.releaseLock(); }

    const folder = DriveApp.getFolderById(RSVP_FOLDER_ID);
    const content = JSON.stringify(rec, null, 2);
    const existing = fileFor_(folder, token);
    if (existing) existing.setContent(content);
    else folder.createFile(`${token}.json`, content, 'application/json');

    notify_(rec);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  let out;
  if (p.admin && p.admin === adminKey_()) {    // control page: toggle + data + reset
    if (p.open === '1') openRsvp();
    else if (p.open === '0') closeRsvp();
    if (p.reset) resetTest_(p.reset);
    out = p.all ? { open: isOpen_(), replies: allReplies_(), roster: roster_() } : { open: isOpen_() };
  } else if (p.status) {
    out = { open: isOpen_() };
  } else if (!p.token) {
    out = { ok: true, service: 'rsvp', open: isOpen_() };
  } else {                                      // a guest's link: who they are + saved reply
    const token = String(p.token);
    const household = invitation_(token);
    const reply = household ? latestReply_(token) : null;
    out = Object.assign(reply ? Object.assign(reply, { found: true }) : { found: false },
                        { household: household, open: isOpen_() });
  }
  return respond_(e, out);                      // JSONP when ?callback= is present
}

// "Reset" only ever clears TEST invitations (Side = test) — real replies are kept.
function resetTest_(which) {
  const inv = tab_('Invitations');
  const testCodes = inv.rows
    .filter((r) => String(cell_(inv, r, 'Side')).trim() === 'test')
    .map((r) => String(cell_(inv, r, 'Code')).trim());
  const codes = which === 'all' ? testCodes : testCodes.filter((c) => c === which);
  if (!codes.length) return;
  const t = tab_('Replies');
  for (let i = t.rows.length - 1; i >= 0; i--) {
    if (codes.indexOf(String(cell_(t, t.rows[i], 'Code')).trim()) >= 0) t.sheet.deleteRow(i + 2);
  }
  const folder = DriveApp.getFolderById(RSVP_FOLDER_ID);
  codes.forEach((c) => { const f = fileFor_(folder, c); if (f) f.setTrashed(true); });
}

// The live invitations (Status = Invite) for the control page's "not replied yet" list.
function roster_() {
  const inv = tab_('Invitations');
  return inv.rows
    .filter((r) => String(cell_(inv, r, 'Status')).trim() === 'Invite' && String(cell_(inv, r, 'Code')).trim())
    .map((r) => ({ token: String(cell_(inv, r, 'Code')).trim(), name: String(cell_(inv, r, 'Invitation')).trim(),
                   party: Number(cell_(inv, r, 'Seats')) || 0 }));
}

function allReplies_() {
  const files = DriveApp.getFolderById(RSVP_FOLDER_ID).getFiles();
  const out = [];
  while (files.hasNext()) {
    const f = files.next();
    if (f.getName().slice(-5) === '.json') {
      try { out.push(JSON.parse(f.getBlob().getDataAsString())); } catch (err) { /* skip */ }
    }
  }
  return out;
}

function respond_(e, obj) {
  const body = JSON.stringify(obj);
  const cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + body + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

// ----- email -----
function notify_(rec) {
  try {
    const coming = rec.attending === 'yes';
    const subject = `RSVP: ${rec.household} — ${coming ? 'coming (' + rec.attendee_count + ')' : 'not coming'}`;
    MailApp.sendEmail(NOTIFY, subject, formatRecord_(rec));
  } catch (err) { /* don't fail the save if email is over quota */ }
}

function formatRecord_(rec) {
  const att = jparse_(rec.attendees_json);
  const games = {};
  jparse_(rec.game_json).forEach((g) => { games[g.name] = g; });
  const lines = [];
  lines.push(`${rec.household} — ${rec.attending === 'yes' ? 'coming' : 'not coming'}`);
  if (rec.attending === 'yes') {
    lines.push('');
    att.forEach((p) => {
      if (!p.name) return;                     // an unnamed seat nobody filled in
      if (p.coming) {
        const g = games[p.name] || {};
        lines.push(`  • ${p.name}${p.child ? ' (child)' : ''} — arrives ${p.arrival}${p.diet ? ` — diet: ${p.diet}` : ''}`);
        if (!g.opted_out) {
          if (g.hometown || g.game_place) lines.push(`      from ${g.hometown || '—'}, dreams of ${g.game_place || '—'}`);
          if (g.song) lines.push(`      song: ${g.song}`);
          if (g.photo_url) lines.push(`      photo: ${g.photo_url}`);
        }
      } else {
        lines.push(`  • ${p.name} — not coming`);
      }
    });
    lines.push(`  Room: ${rec.accommodation || '—'}`);
  }
  if ((rec.message || '').trim()) lines.push(`\n  Comment: "${rec.message.trim()}"`);
  lines.push(`\n  (${rec.submitted_at})`);
  return lines.join('\n');
}

function jparse_(v) { try { return JSON.parse(v || '[]'); } catch (e) { return []; } }

function savePhoto_(b64, type, label) {
  const folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
  const bytes = Utilities.base64Decode(b64);
  const safe = String(label || 'guest').replace(/[^\w-]+/g, '_');
  const file = folder.createFile(Utilities.newBlob(bytes, type || 'image/jpeg', `${safe}.jpg`));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
