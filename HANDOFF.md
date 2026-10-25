# Handoff for Bruno's agent — finish publishing the backend (25 Oct 2026)

Read this first, then `CLAUDE.md` in this repo. Written by Carolina's agent after a
working session on 25 Oct 2026. Bruno: this needs ~5 minutes in the Apps Script editor
in your Google account; your agent can walk you through it.

## What changed today (short version)
- **The guest list now lives in the "Master Guest List" Google Sheet**
  (`https://docs.google.com/spreadsheets/d/1dB3GTqQdIw38SFQcdaA8KdFXWXu34uFhD_vWtBXYPRs/edit`,
  inside the shared *Wedding RSVPs* Drive folder). Tabs: Summary, Invitations, Guests,
  Replies, Rooms, Tasks. `guests.csv`, the member-roster CSVs and `build_guests.py` in
  the planning repo are no longer used.
- **This repo is now the only home of the website AND the backend code**
  (`apps-script/Code.gs`). The planning repo's `website/` folder is an outdated copy —
  **do not copy anything from it**, especially not `website/apps-script/Code.gs`.
- Every invitation got a new random 10-character code; the old 5-character codes and the
  `data/` files are gone. Only the test invitation and Raquel's are set to Status =
  Invite; everything else is "Maybe later" until the invitations go out.

## Where things stand (checked 25 Oct, evening)
- Website: live, commit `d671335` (Bruno's), pointing at the deployment
  `https://script.google.com/macros/s/AKfycbxSCJj0KO2Y97PqmmN4tTd7hBpO4053NNCC_Q3_Erls7Rtk_l0N6fGNQeYHSPYGYwm3/exec`
  (the `EXEC` constant in `assets/app.js` and `admin.html`).
- Backend: **works for guests** — it can read the sheet now (the Sheets permission was
  granted). The test link greets "Dear Carolina," with three people pre-filled.
- **Problem left:** that deployment runs the **old planning-repo copy** of `Code.gs`.
  You can tell because it has `const ADMIN_KEY = '…'` near the top and no
  `function adminKey_()` / `function roster_()`. Effects: the control page's "Not replied
  yet" list is empty, and the control-page password is written into the code instead of
  being a Script property.

## Task 1 — publish the right Code.gs (do this)
Bruno's Google account is in Italian; English labels in brackets.

1. Open **script.google.com** → the wedding project → `Code.gs`.
2. **Before replacing anything, note the password:** find the line
   `const ADMIN_KEY = '…';` near the top and copy the value between the quotes.
   (Don't write it into any file in this repo — the repo is public.)
3. **Set it as a Script property:** gear icon **Impostazioni progetto** (Project
   Settings) → **Proprietà script** (Script properties) → **Aggiungi proprietà script**
   (Add script property) → Property `ADMIN_KEY`, Value = the password from step 2 →
   **Salva proprietà script** (Save script properties).
4. **Paste the right code:** open
   `https://raw.githubusercontent.com/bccoutinho/carolina-bruno-wedding-site/main/apps-script/Code.gs`
   → ⌘A ⌘C → back in the editor click inside `Code.gs` → ⌘A ⌘V → ⌘S.
   **Check:** ⌘F finds `function adminKey_()` and `function roster_()`; no red error.
5. **Run `installTriggers` once:** Editor (`< >` icon) → choose `installTriggers` in the
   function dropdown → **Esegui** (Run). If a permission screen appears: **Esamina
   autorizzazioni** (Review permissions) → the account → **Avanzate** (Advanced) →
   **Vai a … (non sicuro)** (Go to … (unsafe)) → **tick every box / Seleziona tutto** →
   **Consenti** (Allow). The log must end with **"Esecuzione completata"**. If it shows
   an error, stop and report it.
6. **Publish a new version of the EXISTING deployment** (so the URL stays the same):
   **Esegui il deployment** (Deploy) → **Gestisci deployment** (Manage deployments) →
   select the deployment whose URL ends in `…Q3_Erls7Rtk_l0N6fGNQeYHSPYGYwm3/exec` →
   pencil (Edit) → **Versione: Nuova versione** (Version: New version) → keep
   **Esegui come: Me** and **Chi ha accesso: Chiunque** (Anyone) → **Esegui il
   deployment** (Deploy).
   - **Don't use "Nuovo deployment" (New deployment)** — that creates a new URL.
     If that happens anyway: put the new `/exec` URL into `EXEC` in `assets/app.js`
     and `admin.html`, bump `?v=` on `app.js`/`style.css` in `index.html`, commit, push.

### Check it worked
```bash
EXEC="https://script.google.com/macros/s/AKfycbxSCJj0KO2Y97PqmmN4tTd7hBpO4053NNCC_Q3_Erls7Rtk_l0N6fGNQeYHSPYGYwm3/exec"
curl -sL "$EXEC?token=mjnlno3zzz"                 # JSON with "household":{"name":"Carolina",…}
curl -sL "$EXEC?admin=<ADMIN_KEY>&all=1"           # JSON whose keys include "roster" (2 entries)
```
If the first one returns an HTML page ("Errore … SpreadsheetApp.openById"), the Sheets
permission is missing → redo step 5. If the second has no `"roster"`, the old code is
still deployed → redo steps 4 and 6. Then open
`https://bccoutinho.github.io/carolina-bruno-wedding-site/admin.html?admin=<ADMIN_KEY>` —
"Not replied yet" should list the live invitations.

## Task 2 — test reply (optional, after Task 1)
Open the test link `https://bccoutinho.github.io/carolina-bruno-wedding-site/?i=mjnlno3zzz&reset=1`,
go through the RSVP and save. Expect: a new row on **Replies**; on **Guests**, the
"Carolina Mattsson (test)" rows get Coming / Arrives / Needs room / Dietary; Bruno gets
the email. (The control page's "Reset all (test)" only clears test invitations.)

## Task 3 — the grandmother test (Bruno adds his grandmother)
In the sheet, either add a **Guests** row to an existing invitation (e.g. pick
"Mercedes Coutinho" as Invitation, type her name), or give her her own invitation:
**Invitations** row with `Invitation` (internal name), `Greeting` (what she sees: "Dear
…,"), `Side` = groom → leave `Code`/`Status`/`Type` blank; then a **Guests** row for her.
After Task 1 the on-edit trigger fills Code (random), Status = **Maybe later**, Type =
family and her Seat. Set Status = **Invite** when her link should work; the link appears
in the `Link` column. (Before Task 1's trigger exists, an agent can write the code
itself: 10 random characters from `abcdefghijklmnopqrstuvwxyz234567`, unique.)

## Later — `clasp`, so backend changes publish from this repo
So nobody has to paste code again: on Bruno's computer, switch on the Apps Script API at
`https://script.google.com/home/usersettings`, run `npx @google/clasp login` (browser
sign-in as Bruno), then `npx @google/clasp clone <Script ID>` into `apps-script/`
(Script ID: Project Settings → IDs) and check `.clasp.json` has `"rootDir": "apps-script"`.
After that: `clasp push` then `clasp deploy -i <deployment ID of the …GYwm3/exec
deployment>`. Script properties and permission prompts still happen in the browser.

## Don'ts
- Don't put the control-page password, or any guest data, in this repo (public).
- Don't change a Code in the sheet once that invitation's link has been sent.
- Don't edit the grey (reply-filled / formula) columns in the sheet.
- Don't copy from the planning repo's `website/` folder.
