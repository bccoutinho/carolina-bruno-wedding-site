# Carolina & Bruno — wedding website & RSVP

**Pousada Castelo de Alvito** (Largo do Castelo, 7920-999 Alvito, Beja), **Saturday
19 June 2027, 12:00**; guests welcome from 18 June. This repo is the guest website
(GitHub Pages) **and** its backend code. It is **public** — never commit guest data,
passwords or keys. (The old private planning repo `Carolina_Bruno_wedding` is no
longer where the website lives.)

- **Site:** `https://bccoutinho.github.io/carolina-bruno-wedding-site/?i=<code>`.
  Pushing to `main` deploys it (Pages, ~1 min). Bump the `?v=` on `app.js` / `style.css`
  in `index.html` when they change, so browsers fetch the new files.
- **Test link:** the "Carolina Mattsson (test)" row's Link on the Invitations tab
  (add `&reset=1` to start fresh).
- **Control page:** `admin.html?admin=<ADMIN_KEY>` — headcounts, who's replied, CSV,
  open/close. The key is a Script property in Apps Script (not in this repo).

## Where the data lives: the "Master Guest List" Google Sheet
`https://docs.google.com/spreadsheets/d/1dB3GTqQdIw38SFQcdaA8KdFXWXu34uFhD_vWtBXYPRs/edit`
— in the shared **Wedding RSVPs** Drive folder; both of us edit. Agents use the Google
Drive + Google Sheets connectors, signed in as the person they work for (Google sharing
is the only access control).

- **Summary** — expected guests ± range (unreplied seats count at their Likelihood
  rate; rates editable), room left vs venue capacity (an input), what inviting every
  "Maybe later" would add, beds needed / assigned / free.
- **Invitations** — one row = one invitation = one link = one reply. `Code` (random,
  never change once sent), `Invitation` (internal name), `Greeting` (guests see "Dear
  <Greeting>,"), `Side`, `Circle`, `Tier`, `Status` (Invite / Maybe later / Not inviting —
  **only "Invite" links work**), `Type` (single → plus-one button; family → "did we miss
  someone?"), `Sent`, formulas `Seats, Replied, Attending, Coming, Link`, `Notes`.
- **Guests** — one row per person. Ours: `Invitation` (dropdown), `Name` (blank = not
  known yet, highlighted), `Kid`, `Likelihood`, `Room` (dropdown from Rooms), `Notes`.
  Filled by replies (grey): `Coming, Arrives, Needs room, Seat, Dietary`; `Expected` is
  a formula.
- **Replies** — one row per submission, appended by the backend; latest per Code wins.
- **Rooms** — every bed in and around Alvito, with `Sleeps / Assigned / Free` formulas.
- **Tasks** — planning to-dos.

### Adding a guest
- **To an existing invitation:** add a **Guests** row — pick the `Invitation`, type the
  `Name`, tick `Kid` if needed, set `Likelihood`.
- **A new invitation:** add an **Invitations** row (`Invitation`, `Greeting`, `Side`),
  then their people on **Guests**. Leave `Code`, `Status`, `Type` blank: the backend's
  on-edit trigger fills Code (10 random chars from `abcdefghijklmnopqrstuvwxyz234567`),
  Status = **Maybe later**, Type = family, and a `Seat` for each Guests row. An agent
  can write a fresh unique code itself the same way.
- **Switching Status to Invite is a deliberate decision** — that's what makes the link
  work. Don't edit the grey columns or a Code that has been sent.

## How a reply flows
Guest opens `?i=<code>` → `GET` (JSONP) returns the invitation (greeting, people with
Seat IDs) + their latest reply → they answer → `POST` → the backend appends to
**Replies**, updates **Guests** by Seat (Coming / Arrives / Needs room / Dietary; a
corrected name replaces the old one, old name goes into Notes; names typed into blank
seats fill them; people left out or unticked → "no"; plus-ones → new rows "Added by
reply"), saves hometown photos to the **Wedding Hometown Photos** folder, emails a
summary to Bruno, and writes `<code>.json` to Wedding RSVPs (the control page reads those).

## Files
- `index.html`, `assets/app.js`, `assets/style.css` — the guest site (one page wizard;
  first visit = linear, return visit = edit menu).
- `admin.html` — control page.
- `apps-script/Code.gs` — the backend (Google Apps Script web app, run by Bruno's
  account). `/exec` URL is `EXEC` in `assets/app.js` and `admin.html`.

## Changing the backend
Edit `apps-script/Code.gs`, then in the Apps Script editor: paste it in →
**Deploy → Manage deployments → Edit → Version: New version** (the `/exec` URL stays the
same). Once only: **Project Settings → Script properties → `ADMIN_KEY`**, and
**Run → `installTriggers`** (installs the on-edit trigger; accept the Sheets permission).
