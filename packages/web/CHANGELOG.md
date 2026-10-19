# @vitrinka/web

## 0.9.1

- **The button keeps its name with a shortcut set.** 0.9.0's default
  shortcut put its chord on the button, and the chord became part of the
  button's accessible name: "Report a problem Alt+Shift+A" (cs "Nahlásit
  problém Alt+Shift+A"). A screen reader read the glyphs as the name, and a
  host test that found the button by name — Voke's did — found nothing. The
  chord is now painted for the eye only, and assistive technology hears it
  from `aria-keyshortcuts` (`Alt+Shift+A` beside the button's Alt+arrow
  moves). Since 0.9.0.

## 0.9.0

- **Box first, and the default.** The marking bar reads **Box · Circle ·
  Arrow · Cover**, with Box picked when marking starts: most problems are a
  region, and a box is the one gesture nobody has to learn. Since 0.7.0
  marking started on Circle.
- **Hide is now Cover, and says what it does.** Reporters did not know what
  **Hide** was for. It is **Cover** (cs **Zakrýt**), and while it is picked
  the bar's line reads "Cover what the team shouldn't see" (cs "Zakryjte, co
  tým nemá vidět"). A placed cover reads "Covered — not sent" (cs "Zakryto —
  neodešle se"), shown once the box is wide enough to hold it. What a cover
  does is unchanged: the region is blank in everything the report sends.
- **The coach lives on the card, not on the page.** It no longer follows
  the pointer over the page you are marking. It rides on the card's edge
  that faces the page — above a card in a bottom corner, below one in a top
  corner — or beside the card when the window is too short, and over the
  card's top on a phone. Drawing goes on through it. It shows the picked
  shape (a box dragged, a loop drawn, an arrow, a cover) with its own line
  ("Click, hold and move across the problem."), stays while you mark, and
  leaves for good on **Got it, don't show again** (cs **Chápu, už
  nezobrazovat**). **Settings → Marking tips** brings it back, per browser
  (`vitrinka.report.coach`). The keyboard instructions left its face: they
  are the marking layer's description for screen readers.
- **The coach draws under its pointer.** The pointer ran on SVG motion at a
  steady pace and the line on an eased CSS animation of its own, so the line
  drew ahead of the pointer. Both now run on one SVG clock with the same
  timing: wherever the run is paused, the pointer's tip sits on the end of
  the line. Since 0.7.0.
- **⌥⇧A opens Report a problem by default** (Alt+Shift+A on Windows and
  Linux): the recorder pill's annotate chord, so "flag it here" is one key
  in either face. A reporter records another in Settings or removes it, and
  a removed shortcut stays removed (`off` in
  `vitrinka.recorder.report.keybind`).

Upgrading:

- **A page that uses ⌥⇧A / Alt+Shift+A itself** now shares it with the
  widget while Report a problem is mounted; the widget opens its card. A
  reporter can remove or change the widget's shortcut in Settings.
- **Tests that named the tools** press **Cover** instead of **Hide** (cs
  **Zakrýt** instead of **Skrýt**), and a first mark drawn without picking a
  shape is now a box. The coach no longer leaves after the first mark: a
  test that waited for it to hide presses **Got it, don't show again**.

## 0.8.2

- **Your own opener reaches Report a problem from the pill.** While a
  linked member's recorder pill was on screen — after **Record**, a reload
  onto a remembered pick, or a dev-mode member's first mount — every opener
  the host owns did nothing: the element's and the handle's `open()`, and
  the `open-selector` control, all spoke to the report face the pill had
  replaced. A user menu's "Report a problem" item closed its menu and left
  nothing open. An idle pill now swaps back, remembering Report a problem
  as the pick exactly as the pill's own menu row does, and opens the card.
  A pill that is recording, or still starting a recording, stays on
  screen, since leaving would strand the session, and the console says why
  once. `close()` on the pill still does
  nothing. Since 0.8.0.

## 0.8.1

- **Record keeps the report you started.** A linked member's **Record**
  swaps Report a problem for the recorder pill by unmounting the card, so a
  typed but unsent report — the description, a mark and its note, the
  picked type, an attached file — went with it. Record now waits while the
  card holds any of them, as it already did while a report was sending or
  waiting on **Try again**, and says why under its label: "Send or clear
  the report you started first" (cs "Odešlete nebo smažte rozepsané
  hlášení", also its accessible description). The waiting item stays
  reachable with the menu's arrows, so a screen reader reads the reason,
  and pressing it does nothing; it now looks unavailable. Since 0.8.0.
- **A report never sits on Sending….** No request of a report had a time
  limit, so one nothing answered — a server stuck in a handler, a
  connection or proxy holding it — left the card on **Sending…** for good:
  a follow-up report with an attached PNG was created, then waited minutes
  with its file, replay and submit unsent. Every leg now has a deadline,
  30 s for a call and 30 s plus the bytes at 32 KiB/s for an upload (a
  10 MiB file gets about six minutes), and preparing the capture gets 30 s
  before the report goes without it. A leg past its deadline fails like a
  dropped connection: the card shows the error and **Try again**, which
  resumes at that leg. Since 0.7.0.
- **A report opened early still shows the page.** The page recorder loads
  lazily; a card opened before it ran (a slow network, device or CI
  runner) froze a clip with no screen in it, and the report went without
  its replay. When the recorder runs by Send, the report now takes its view
  then, as it already did for a recorder that had only just started.
  Since 0.7.0.
- **Report a problem: motion where it belongs.** The marking bar's shape
  indicator is in place on its first frame instead of growing in; a parked
  card rescales and follows a resized window in its corner instead of
  overhanging and gliding back; reduced motion now also stops the menu's
  rise, the coach's dim and the chevron's turn. Since 0.8.0.
- **Two tabs no longer lose a note to a shared seq.** On the IndexedDB
  lane (hosts without Web Locks) a browser can deliver another tab's
  `localStorage` writes after the lock has passed to the next tab, so two
  tabs could number captures with the same seq; the server keeps the first
  row per seq, and a note vanished from both. Each holder now leaves a
  fence (`vitrinka.recorder.lock.seq`) that the next one waits to read, so
  the previous holder's writes are visible first; after 1 s it numbers
  anyway and warns once, so a cleared store never wedges it. The Web Locks
  lane is unchanged. Since 0.3.4.

## 0.8.0

**Report a problem grows back up.** The calm face now gives the people in
your app what the recorder pill gave its testers: it says who they are,
links a vitrinka account, finds their earlier reports, and marks a problem
without hiding how to finish.

- **One card.** The describe card and every mark's note are now one card:
  the reporter's word for it (**Bug · Suggestion · Question · Other**,
  optional, sent as `type` — a hint for triage, never the category),
  "What went wrong?", one numbered note line per mark, the attached files,
  and **Send** in the foot. It keeps one size from drafting through
  sending, an error and the thanks, so Send never leaves the screen; a long
  list scrolls inside it. A note on a mark is now enough to send.
- **Marking under a top bar.** "Show us where" puts a glass bar at the top
  of the page: one plain line ("Mark where the problem is"), a segmented
  **Circle · Box · Arrow · Hide** whose indicator slides to the pick, and
  **Cancel**. Cancel leaves marking and drops this pass's marks, asking
  first ("Discard 2 marks?" · **Discard** / **Keep**); ⌘Z / Ctrl+Z takes
  back the newest mark when no field has the caret; Esc, or "Show us where"
  again, leaves marking and keeps the marks. **Done** and **Undo** are
  gone: Done only returned to a card that no longer leaves the screen, and
  the bottom bar it sat in hid how to finish.
- **Notes no longer float on the page.** Since 0.7.0 each mark's note
  opened at the mark, a 220 px field over the page and over the other
  marks. A mark now carries only a pin — its number and ✕ — and a press on
  the number puts the caret in its line in the card.
- **The card parks away from the marks.** Marking starts with the card
  exactly where it rested. It moves only when a mark lands under it, to the
  corner that covers the least of the marks, clear of the top bar.
- **Who you are.** The header shows an account chip: the initials and
  first name of the person your app signed (`identify({token})`, the name
  as vitrinka returns it) or asserted, else **?**. It opens the account
  popover: who, and how ("Signed in by this app", or that the team checks
  an anonymous report first); **Link your vitrinka account** — the pill's
  flow, a code with **Open vitrinka** and a QR — or **Linked to vitrinka
  as …** with **Unlink**; and **Open the report portal** when the project
  has one.
- **The ⋯ menu.** **My reports**; **Recent recordings** and **Record** for
  a linked member; **Settings**; **Open vitrinka** (a member) or **Open the
  report portal**. A list opens inside the card with ← back. Settings sits
  behind a real cog: since 0.7.0 its glyph was a ring of rays that read as
  brightness, a sun.
- **My reports.** For a reporter your server signed, the widget trades the
  token once for a short-lived reporter session (`POST
  /api/v1/report/session`) and lists their reports from `GET
  /api/v1/report/mine` (header `X-Vitrinka-Reporter`), each with its step:
  Received, Planned, In progress, Fixed, Done. A lapsed session is renewed
  and asked once more; the `vkb_` key alone still reads nothing. An
  asserted email or an anonymous reporter gets this browser's own sends
  instead — the last 20 for this vitrinka and site, filed or "Waiting for
  approval", marked "Sent from this browser".
- **The face switch for linked members** (npm entry only). A browser
  holding a vitrinka member link for the widget's `base` gets **Record**:
  it swaps Report a problem for the recorder pill in place, recording on
  the member's own link, never your `vkb_` key. The idle pill's ⋯ menu then
  offers **Report a problem**, which swaps back. The pick is remembered per
  browser and origin (`vitrinka.report.face`); a member who never picked
  starts on the pill when their vitrinka display mode is dev. Reporters
  never see the switch, and a `vkr_` key the host passes is a build's, not
  a person's. `report-widget.mjs` carries no pill, so the script tag offers
  neither Record nor Recent recordings. New API: `onReportFace` on
  `VitrinkaRecorderPill` and in `mountRecorderHud`'s options adds the
  pill's row; `face` on the handle and the element now says which face is
  on screen; a stored device link remembers the `base` it was minted on.
- **Attachments.** 📎 in the foot picks files; pasting or dropping a file
  onto the card adds it (pasted text stays text). Each file is checked
  against the project's caps — `attachments` in `GET
  /api/v1/report-config`, by default 10 MiB per file, 5 per report, images,
  PDF and text — before anything is sent, and one that breaks a cap is
  refused at once, the line naming the cap. They ride their own leg, `POST
  /api/v1/reports/{id}/attachment?name=`, after the create and before the
  replay; **Try again** sends only the files that did not land, and a file
  the server refuses for good is left out while the report still files.
- **Typing in the widget never fires the page's shortcuts.** A host that
  listens in the capture phase on `window` or `document` (a BPMN modeler's
  `e`) ran before the shadow host's bubble-phase shield, and shadow
  retargeting showed it the host element as `event.target`, never the
  field, so its "ignore keys while typing" check failed. One `window`
  capture listener now stops typing keys aimed at a field of the card, a
  mark's line or a pill sheet; the text still lands, and Enter, Esc, Tab
  and chords that do not edit text (the reporter's shortcut, the pill's
  ⌥⇧ keys) pass. Its limit: a `window` capture listener the page
  registered before the widget mounted still runs first. Since 0.7.0 on
  Report a problem; the pill's sheets had the same leak.
- **The button moves.** Drag it to any corner (it snaps to the nearest) or
  press Alt+arrow while it has focus; the corner is remembered per origin
  (`vitrinka.report.dock`) and the card opens beside it.
- **Size and technical details.** Settings adds Small · Medium · Large, one
  scale for the button, the card and the marking bar
  (`vitrinka.report.size`), and read-only technical details for a support
  conversation: version, capture window, whether capture runs, the buffer
  and its cap, the server.
- **The thanks say what happens next.** A filed report says the team will
  take a look, with **See your report** when the server returned its page;
  one held for approval (an asserted or anonymous reporter) says the team
  checks it before it is filed.

Upgrading:

- **Upgrade vitrinka first.** My reports from the server, attachments, the
  report type and a dev-mode member's start use doors that ship with the
  vitrinka release serving this version as `/vendor/report-widget-1.mjs`:
  `POST /api/v1/report/session`, `GET /api/v1/report/mine`, `POST
  /api/v1/reports/{id}/attachment`, `type` in the report envelope,
  `attachments` in `/api/v1/report-config` and `displayMode` on
  `/api/v1/recorder/me`. The script tag always matches its server; an npm
  host can run ahead of it. On an older vitrinka, My reports falls back to
  this browser's list, each attachment is refused (the report files
  without it, under the default caps) and a dev-mode start never triggers.
  An older vitrinka refuses the unknown `type` field; the widget then sends
  the report again without it, so the reporter's word is lost but the report
  is not.
- **Done, Undo and "N places marked" are gone** (the `done`, `undo` and
  `marked` strings). The catalog is internal, so no host code changes, but
  a host test that clicked **Done** / **Hotovo** or **Undo** / **Zpět** in
  marking now presses Esc or "Show us where" to finish, and the pin's ✕ or
  ⌘Z to take a mark back.

## 0.7.2

- **One pill when the extension starts in this tab.** The extension's hello
  can reach the page before its claim does. The page then showed its quiet
  "Recording in another tab" pill beside the extension's own, and kept it
  after the claim landed, because the HUD heard only a change of leader. A
  change of the claim's holder now reaches the HUD too, so the page's pill
  hides as soon as the claim is read. Since 0.6.0.

## 0.7.1

- **Report a problem hands focus back.** Closing the card returns focus to
  whatever had it when the card opened — the host's own control (`button:
  false` with `open-selector` or `open()`), the field the reporter's shortcut
  fired in — and falls back to the button. With the button hidden, focus
  was lost to `<body>`.

## 0.7.0

**Report a problem** — the report face of the one capture client (QA Studio
D6): the same engine as the recorder, a reporter's face.

- **`@vitrinka/web/report`** — `mountReport(opts)` and the
  `<vitrinka-report>` element (`key`, `base`, `open-selector`, `locale`,
  `button`): a large floating "Report a problem" button (`button: false`
  hides it), a card that asks "What went wrong?" with Send, and **Show us
  where** to mark the frozen page — circle, box, arrow, hide — numbered
  1, 2, 3… with an optional note each. No element selector. Until the first
  mark a coach card rides beside the pointer: a tiny loop of the gesture and
  "Click, hold and move around the problem". `open()`, `close()`,
  `identify({token} | {email, name?})`, `setLocale('cs' | 'en')`,
  `unmount()`; `face: 'recorder'` mounts the recorder pill instead (npm).
- **One file for vitrinka** — `@vitrinka/web/report-widget.mjs`
  (`build/report-widget.mjs`), served as `/vendor/report-widget-1.mjs`:
  React-free, its only runtime import the deployment's
  `/vendor/rrweb-record-1.min.js`, loaded lazily.
- **The capture profile** (D7) from `GET /api/v1/report-config`, which the
  host can only narrow: memory or browser storage (IndexedDB, masked before
  storage, expiring with the window, cleared after send and on the next load
  past its age), the window (default 5 min), the size cap, and the classes
  (errors · interactions · full · console · network). Drafts stay in memory.
- **The report wire**: `POST /api/v1/reports` → chunks → rrweb rows →
  `submit`, under the `vkb_` key; leg-resumable (Retry resumes, never
  duplicates); marks as viewport rects with `env.viewport {w, h, dpr}`; a
  hide blanks its region in the replay before it leaves the browser.
- **cs / en built in**: the browser's language by default; the `locale`
  option, attribute and `setLocale()` repaint live without losing the draft
  or the marks.
- **The reporter's own shortcut**, recorded in the card's settings by
  pressing it (a modifier required, Esc cancels); no default.
- **Marks from the keyboard**: the marking layer takes focus; Enter places
  a mark, arrows move it, Shift+arrows resize it, Enter sets it.
- **Stored capture is scoped** to vitrinka's origin, the project, the
  masking profile and the classes it was captured under: a load under
  anything else drops it. A hide names the nodes it covers when drawn, and
  without rrweb's mirror a report with a hide goes without its replay.
  Console and network entries are stored in spans of their own (an
  errors-only profile keeps them across loads); a draft reads the stored
  windows when the card opens.
- **One runtime per page**: the recorder face, when mounted, runs the
  page's capture (`claimCapture`); a report face beside it reports without
  one and never rewrites the recorder's server, key or rules.
  `identify(null)` on a widget is anonymous even under a page-wide
  `identify()`; a tag that gets its `key`/`base` after connecting mounts then.
  Widgets share a capture only when they ask the same of it (key, base,
  `capture`, `sanitizeUrl`); the report moves into an open (modal) dialog
  and back, draft and marks intact; a window whose snapshot is over the
  wire cap is left out whole.

Engine changes the recorder face shares:

- The flight buffer takes a profile (window, checkout interval, caps, an
  optional store). Windows now age against the clock — a window is kept
  while it still covers part of the window — and a window being recorded
  that alone outgrows the cap restarts from a forced full snapshot instead
  of waiting for the next checkout; a clip says `truncated` when a cap cut
  it. An idle page's window is replaced by a fresh snapshot once its newest
  event is older than the window. The pill's last minute is otherwise
  unchanged (30 s windows, 4 MiB).
- `patchNetwork({detail})` and `patchConsole({levels})` take their settings
  per acquisition, so nothing a report face chose outlives its release.
- The rrweb lane takes its recorder as an argument
  (`capture/rrweb-lane.ts`); `capture/rrweb.ts` binds the static import.
- The network lane has a metadata-only mode, the console lane can tap
  `warn` / `info` / `log`, the API client takes an explicit `target`
  (`{url, key}`) per call, and the HUD host's inline style moved to its own
  module so mounting the host no longer pulls in the React sheets.

## 0.6.0

The pill now says what it is doing at every step, and keeps what you write.

- **After Stop: Saving… → Building board · k/n → Board ready.** "Saved"
  used to mean only that the server accepted the Stop, and the board link
  appeared later without a word. The pill now shows the server's build
  (`projection` step and progress) and then **Board ready · Open board**. A
  failed build says so, with **Retry** when another pass can fix it (the
  Retry closes the session again, a door a recorder token already has). The
  ✕ became **Done**: it only ever dismissed the face.
- **Start reads as an action.** The idle dot is red, **Starting…** shows
  while a session boots, the ⋯ keeps the tray's inset from the pill's edge,
  and a one-time hint per site says what Start does.
- **The sync chip left the tray.** The rec dot carries the sync state as a
  ring (green, amber backlog, warn offline, red ended); while the tools are
  out, a float above the pill counts what the server acknowledged — actions,
  frames, notes, pages (`HudSync.acked`).
- **History.** A tray button lists the recording's notes and annotations in
  the board annotation island's layout. **Save edit** sends a NEW note with
  `replaces: <cid>` (the stream stays append-only; the board keeps the
  versions in the thread); **reference** starts a note carrying `refs:
  [<cid>]`, which the board turns into an annotation ref. Every note now
  carries a client id, `cid` (`docs/PROTOCOL.md`). The list is kept on the
  device for the recording's life (a recorder token reads nothing back).
- **The composer.** The `board | task` toggle is gone: everything lands on
  the board. The sheet names what an annotation points at — its crop where
  the host can read pixels (`HudController.captureRegion`, the extension),
  else its size and route — with **Reselect**. A dragged height is now a
  minimum: releasing the grip never snaps the box back. A draft left by a
  click on the page parks as a small drop on the pill; hover previews it, a
  click resumes it.
- **Honest flashes.** The clock says **queued** until the server
  acknowledged a note, then **Saved** (`HudSync.pendingNotes`). A note
  written while paused is queued and sent instead of dropped.
- **A recording in another tab** shows a quiet "Recording in another tab"
  pill instead of no recorder at all (`HudSnapshot.followingElsewhere`).
- **Controller contract.** `HudAnnotation.task` is removed; `note` and
  `annotate` take a `HudNoteLink`; `listNotes`, `captureRegion` and
  `retryBuild` are optional. A host that omits them gets today's behaviour
  for that part.

## 0.5.3

- **Credentials in URL paths no longer reach vitrinka (`sanitizeUrl`).**
  The recorder scrubbed secrets only in query strings and fragments, and
  recorded `route` fields with no redaction at all. An app whose routes
  carry tokens in the path (`/reset-password/:token`, `/cart/:id/:token`,
  `/invite/:token`) uploaded them with every session and bug report.
  `VitrinkaRecorderRoot` and `RecorderConfig` now take an optional
  `sanitizeUrl: (url: string) => string`. It rewrites every URL and route
  the recorder captures before the redaction engine scrubs it:
  - navigation `url` and `route`, including the page a session starts on;
  - the `route` of clicks, notes and annotations;
  - network request URLs;
  - the page URL on each rrweb full snapshot;
  - a bug report's navigation and note.

  It applies under `fullFidelity` too. A sanitizer that throws or returns a
  non-string fails closed: the recorder keeps only the URL's origin, or
  `[redacted]` when there is none, and logs one warning. See
  [Credentials in URL paths](README.md#credentials-in-url-paths-sanitizeurl).
- **Routes are redacted.** Every `route` field now passes the same scrub as
  a URL, so a workspace's value patterns reach routes too. Without a
  `sanitizeUrl`, a route that matches no pattern is recorded as before.

## 0.5.2

- **A page that leads keeps the recording against an extension that is only
  starting.** 0.5.1's yield (a page holding the claim lets go when the
  extension records in another tab) also fired on the `starting` the
  extension's Start probe announces before it reads the page's claim. The
  page stepped aside and the extension's Start went through instead of being
  refused. The page now yields only to an extension recording or paused
  elsewhere, so a `starting` probe meets the claim and is refused. This does
  not cover extension 0.11.0. Its `one.js` announces `recording` as soon as
  the Start probe installs it, before the probe reads the claim, and a page
  cannot tell that apart from a real recording in another tab. Use extension
  0.11.1 or later, which installs `one.js` only where no recorder already
  leads.

## 0.5.1

- **A claim names its session.** The server answers a session's id as a
  number, and 0.5.0 wrote it into `data-vitrinka-lead` as one. The codec
  reads only a string, so the extension's refusals lost their `#N`, and the
  page re-announced its hello on every state change. The recorder now keys a
  session by the id's string from the moment it is created. The codec also
  reads a 0.5.0 page's numeric id.
- **A page that holds the claim yields to the extension recording
  elsewhere.** A tab that thaws after the extension started in another tab
  (its Start probe could not reach a frozen tab) kept recording, so two
  recordings ran. The page now releases its claim and waits, capturing
  nothing, and resumes when the extension stops (D14). A Stop that is
  already saving keeps its claim and its face.
- **`withRecorderLock` is exported** from `@vitrinka/web/recorder`. A custom
  storage driver shared with the package's own driver on one origin (a
  host's own dock key, say) can take the very lock the package numbers
  events under, instead of copying it.

## 0.5.0

- **The page recorder and the Vitrinka extension are one recorder.** A page
  could embed this recorder while the tester's browser ran the extension,
  and the two fought. The extension's shortcuts swallowed the pill's ⌥⇧A/N/P,
  either one could start its own recording, and two pills could show. Now the
  first to start leads and the other becomes its remote: its pill hides, it
  captures nothing (no rrweb, click, nav, console or net lane, no flight
  recorder), and its pause, stop, note and shortcuts act on the leader. Two
  recordings never run at once. The session lands where the leader is
  configured; neither side ever borrows the other's credential.
- **They speak over the DOM, the one thing their worlds share.** The
  recorder marks the document with `data-vitrinka-page="web/0.5.0"` on
  `<html>`. Whoever records holds `data-vitrinka-lead`, a JSON claim
  (`{v, by, id, state, sessionId, since}`) written only by its holder and
  taken by a synchronous check-and-set before any network call. Actions are
  `window` CustomEvents with a JSON-string `detail`: `vitrinka:hello`,
  `vitrinka:command` (`pause`, `stop`, `note`) and `vitrinka:ack`. Each is
  answered inside its own dispatch, so a page never waits on a timer. A
  holder that no longer answers (an extension reloaded or uninstalled) is
  cleared under its own id. The page writes nothing until its root's effect
  runs, so a server-rendered `<html>` hydrates untouched.
- **Start is refused while the other side leads.** The pill's Start and
  `__vitrinkaRecorder.start()` check before any network call and reject with
  a `RecorderBusyError` (`code: 'recorder_busy'`, `leader`). The pill shows
  the reason (**Already recording**, the full sentence on hover) until you
  dismiss it, for example "the Vitrinka extension is recording in another tab
  — stop it there first". Any other failed Start now shows **Couldn't start**
  on the pill instead of only reaching the console.
- **A recording that comes back never preempts.** A session resumed after a
  reload, or joined from another tab, into a document or browser the
  extension leads waits as a follower, capturing nothing. It resumes when the
  extension lets go. Nothing is stopped on your behalf.
- **Relayed shortcuts keep working.** Chrome hands the extension's command
  chords to its worker, never to the page. The extension relays them as a
  synthetic keydown, and the leading HUD acts on it (`isTrusted: false`
  included). It takes the key with `preventDefault` only, so a host that
  skips `defaultPrevented` keys leaves it alone. A follower's HUD binds no
  chord.
- `__vitrinkaRecorder.status()` gains `leader` (`'page' | 'extension'`) and
  `following`. While the extension leads, `pause`, `stop` and `note` act on
  it, and a note it can no longer take rejects with "the recording ended
  before the note arrived" instead of landing in a later session.
- `HudController`: `HudSnapshot.following` hides the HUD as the leader's
  remote. It closes the sheet, menu, link sheet and annotate mode, keeps the
  drafts and their images and keeps the dock spot. `onRemoteStop(run)`
  registers the HUD's Stop flow, which a remote stop runs with no second
  confirm. `faceChanged(face)` reports the inline flow face, so the host
  holds its claim as `saved` while **Saved · Open board** shows. `HudFace`
  is exported from `@vitrinka/web/hud`.
- **`@vitrinka/web/one.iife.js`** (`build/one.iife.js`) is the protocol as
  one 5 KB script defining `globalThis.VitrinkaOne`, for the extension's
  content scripts. The extension vendors it beside `hud.iife.js` under the
  same pin. The protocol types (`Claim`, `Hello`, `Command`, `Ack`, …) are
  exported from `@vitrinka/web/hud`.
- An older extension (≤ 0.10) is invisible to the protocol, and both behave
  as before.

## 0.4.0

- **Notes, annotations and bug reports carry images.** Testers asked to
  attach a reference of "how it should be" while recording. The sheet now
  takes images three ways: the **Attach image** paperclip beside Send,
  an image pasted into the text box (a text paste stays a text paste), and
  image files dropped onto the sheet, which highlights while you drag.
  Thumbnails line up above the footer, each with a **Remove** ×. A note
  carries up to 4 and may have no text; a bug report still needs its
  description. The images survive a cancel like the draft's text. On the
  board they become the tester's own thread message under the note.
- **Images are re-encoded before they leave the browser.** WebP at 0.85,
  JPEG where the browser cannot write WebP, PNG when JPEG would lose
  transparency. The long edge is at most 2560 px and the file at most
  12 MiB; an animated image keeps its first frame. EXIF and GPS metadata are
  gone. A file that is not an image is refused with the reason in the
  footer's context slot, so the footer never moves.
- **Only where the server allows it.** The paperclip shows when
  `GET /api/v1/recorder/policy` answers `attachments: true`. A server before
  attachments omits the field, and a workspace can switch them off. The
  recorder then sends notes as before, text only.
- **Wire.** Each image uploads to `POST /sessions/:id/shot?seq=N` with its
  own Content-Type. An `attachment` event `{name, mime, bytes, w, h}` then
  carries the returned `blobKey`. Its seq is allocated with the note's,
  just below it, and the note lists the image seqs as `attachments`. An idle
  bug report carries its images into its short session the same way. The
  `protocol` module adds `AttachmentPayload`, `NotePayload` and
  `RecorderPolicyResponse`.
- **A queued image survives a reload.** Its bytes wait in an IndexedDB
  blob journal (`vitrinka.recorder.blobs`) until the server acknowledged its
  event. A reload, or another tab finishing a closed tab's tail, uploads it
  before its event is delivered, and Stop waits for it like the rest of the
  tail. The queue holds at most 64 MiB (200 images) across notes; past that
  the oldest image is dropped with a console warning and its note lands
  without it.
- `HudController`: `HudSnapshot.canAttach`, `note(text, attachments?)`,
  and `attachments` on `HudAnnotation` and `HudReport`. `HudAttachment` is
  exported from `@vitrinka/web/hud`. A host without `canAttach` gets the text-only
  HUD it had.
- The HUD's propagation shield also stops `paste` and the drag events, so a
  page's own upload handler never takes an image meant for the sheet.
- **A roomier sheet you can resize.** The note, annotate and bug-report
  sheet is now 440 px wide at every HUD size (was 288 at size M). Its text
  box grows with the draft up to 20 rows, then scrolls; the footer row keeps
  its layout and the sheet stays beside the pill, inside the viewport. A grip
  on the corner away from the pill (**Resize note**, **Resize annotation**,
  **Resize report**) drags the width (320 to 960 px) and the text box's cap
  live; on a phone's full-width bottom sheet it drags the cap alone. Its
  arrow keys step 16 px (Shift: 64), and Enter or a double-click restores
  the default.
- **The sheet size is a HUD preference.** `HudPrefs` gains `sheetW` and
  `sheetH` (CSS px, 0 = the default) and `DEFAULT_PREFS` carries 0 for both.
  A resize calls `setPrefs({sheetW, sheetH})` once, on release. The in-page
  recorder applies it at once, keeps it in its storage, and sends it to
  `PATCH /api/v1/recorder/me` in a request of its own. A server that
  predates the fields answers that request 422. The size then stays on the
  device for the page's lifetime, with no retry and no error, and size and
  details still sync. A linked user's server copy wins on load, as for size
  and details. An answer without the fields never resets the device's size.

## 0.3.4

- **Two tabs no longer collide on event sequence numbers.** Events and rrweb
  chunks share an exclusive allocator using Web Locks, with an IndexedDB
  transaction fallback for HTTP hosts. A separate watermark prevents pause,
  policy and Stop writes from rewinding the counter. Stop settles queued
  allocations before draining; failed allocations stay queued for retry.
  Shared custom storage drivers implement `withLock(name, run)`.
  Accepted payloads are journaled before the async lock and retain the same
  identity until server acknowledgement; reloads and surviving tabs can
  recover them. Pending allocation memory is bounded to 16 MiB.
- **Stop saves every open tab's tail before closing the session.** Mounted
  tabs acknowledge only after their last rrweb batch and pending captures
  have drained. A sibling that cannot save refuses the Stop instead of
  losing its last notes. Shared drivers expose `keys()` alongside `watch()`.
  A departing tab leaves an unsaved marker instead of falsely acknowledging
  delivery; a surviving tab can recover a durable tail. Back-forward cache
  returns restore participant registration. Every path observing Stop ships
  the last DOM batch before pausing its local cache.
- The sync indicator uses the highest acknowledged seq even when an rrweb
  chunk's delayed event row appears last in the upload batch.

## 0.3.3

- **The other tabs leave the recording at the Stop, not when the save
  ends.** 0.3.2 told them only once the stopping tab had drained its
  queue and the server had closed the session, so for as long as that
  took (seconds on a busy page) their pills still said rec with a running
  clock, and their lanes kept capturing. The stopping tab now writes the
  shared record as paused, with its clock frozen at the Stop, and marked
  `stopping`. The other tabs stop capturing and painting rec within
  milliseconds, and turn idle when the save ends. Its own tail still
  lands. A stop that keeps the session (server unreachable) hands it back
  to them as it is. Pause and resume are refused on a session another tab
  is stopping. That tab renews its mark every 20 s while its Stop is out,
  and a mark left by a tab closed mid-stop expires after 90 s into an
  ordinary pause.
- **"Open board" appears once the board exists.** The server builds a
  session's board after the stop, rendering stills first (30–60 s), so
  neither the create nor the done answer carried a link. The pill said
  "Saved · in Recents" (or "Sent · in Recents" for a bug report) and
  never offered the board. The recorder also read only `board.url`,
  while the server answers `boardUrl`. Both are read now. A stop or
  report saved before its board exists reads the session every 1.5 s, for
  up to 10 minutes (the extension's numbers), until the server names the
  board. The link then lands on the recent, and the Saved / Sent face
  turns into "Open board". A `HudController` host may return the saved
  `sessionId` from `stop()` / `report()` (`HudSaved`) to get the same.
  Recents opened after a reload pick up the wait for a board still being
  projected, and `window.__vitrinkaRecorder.stop()` reads `boardUrl` too.

## 0.3.2

- **A Stop in one tab ends the recording in every tab.** A second tab of
  the app opened during a recording joins it (it reads the shared
  `localStorage` record, as a reload does), but nothing told it when
  another tab stopped: its pill kept a running recording — the clock
  counting from the original start, Start hidden — and its clicks and
  navigations kept going to a session the server had closed, until a
  reload. Each tab now follows the record the others write: a Stop
  there turns this pill idle and drops this tab's undelivered tail for
  that session, a Start there is joined, a pause follows. Recents
  follow too. A custom `RecorderStorage` driver may implement the new
  optional `watch(key, onChange)` to get the same; the memory driver has
  nothing to share.
- **A stopped recording leaves no trace on the pill.** While "Saved"
  showed (and after it), the pill still said `data-state="rec"` and the
  folded clock kept counting from the ended session's start. The state
  now follows the live recording only, and the clock stands where it
  stopped.

## 0.3.1

- **A bug report always carries the current screen.** When a checkout
  window went over the 4 MiB / 20 000-event cap on its own, it was dropped
  and the buffer stayed empty until the next 30-second checkout; a report
  opened in that gap (or before the first snapshot) froze a clip with no
  rrweb window, so vitrinka rendered no stills, the board stayed empty and
  the description never reached intake. Opening the report sheet now takes
  a fresh checkout when the clip holds no snapshot, so the clip opens on at
  least the current screen. A clip that already holds a window is frozen
  as-is — a checkout would rotate its older window out.

## 0.3.0

- **Report a bug, without a recording running.** A new ⋯ menu row. While
  the pill is mounted and idle on a device that can record, it keeps the
  page's last minute in memory — rrweb as two 30-second checkout windows,
  plus the click, navigation, console and network lanes. Report freezes
  that clip, asks what went wrong (required) and lets you **Mark on
  screen** (annotate mode's element pick or region drag). Send files one
  short session: `meta.kind: "report"`, title `Bug report: <first line>`,
  the buffered events with their original timestamps, the rrweb windows as
  chunks, then your description as a task annotation, then done. vitrinka
  renders stills from the clip and the annotation becomes an intake draft.
  The pill says **Sending…**, then **Sent · Open board**, or offers
  **Retry**. During a recording, Report adds the task annotation to the
  running session instead.
- **The buffer never leaves memory before Send.** Nothing is written to
  storage or sent; it runs the recording's own redaction (the workspace
  policy is fetched once when it starts); caps of 4 MiB / 20 000 rrweb
  events and 500 lane events drop the older window; a reload, an unlink or
  a recording start discards it. `flightRecorder={false}` on
  `VitrinkaRecorderRoot` turns it off.
- **Every session sends `meta.devicePixelRatio`**, the scale its rects are
  in, so the server renders stills at it.
- `HudController` gains optional `holdReport` / `report` and the snapshot an
  optional `canReport`; a host without them (the extension today) shows no
  report row.

## 0.2.2

- **A click never records more than the DOM stream shows.** A click on a
  filled input, textarea or select used to record its value as the click's
  text — a password field included — though rrweb masks every input. Now a
  form field's text is always empty, and so is the text of an element at,
  inside or wrapping `.rr-mask` / `.rr-block`. Under a `maskAllText` policy
  a click records no text at all.
- **URL secrets are scrubbed from the start URL and from rrweb.** The
  session's first navigation and rrweb's Meta event (the page URL every
  full snapshot opens with: start, each checkout, resume) carried the raw
  `location.href`, so a magic-link or OAuth-callback token in the query or
  fragment reached the recording. Both now pass `redactUrl`, like every
  later navigation already did.
- **PEM private keys are scrubbed** from bodies, console lines and headers,
  whatever key carries them (`@vitrinka/redact` 0.1.2).

## 0.2.1

- **Linking survives a flaky network.** One failed approval check (a
  dropped connection, an edge error page, a 5xx or a 429) used to end the
  link with "Failed to fetch · Try again", even though the code was still
  valid. Now the pill keeps waiting: it retries with a growing pause (up to
  30s) until the code itself expires. Only an expired code, a token for
  another workspace or Cancel ends it. Needs `@vitrinka/link` 0.1.3.
- **No more passive-listener errors on Angular hosts.** On a page that runs
  zone.js (any Angular app), Esc in the menu, the note sheet or annotate
  mode logged "Unable to preventDefault inside passive event listener
  invocation", and the browser went ahead with the default anyway. zone.js
  runs every listener of a kind through the first one registered, and
  Angular CDK registers its keydown, mousedown and touchstart listeners as
  passive. The HUD now registers every listener that cancels an event
  directly with the browser, never passive.

## 0.2.0

- **Stop is in the pill.** A ■ next to the other tools. It asks inline
  ("Stop & save? Stop · Keep recording"; Esc or Keep cancels). Then the pill
  says **Saving…**, with a spinner and a progress bar while the tail drains.
  Then it says **Saved · Open board**, with the server's board link. That
  stays until you dismiss it. If the server cannot be reached, the pill says
  so and offers **Retry**. Nothing is lost. Unlink asks the same way.
- **Recents and the account.** The ⋯ menu (now on the idle puck too) names
  who the recorder is linked as: `you@… · Workspace`, or `Recorder key ·
  <name> · project <p>` for a key build. It lists the device's last five
  recordings, with age, length, status and a link to each board. It has
  **Go to vitrinka**. A recent without a board link is refreshed from the
  session's own read.
- **Eight spots, and a vertical pill.** Move to is a miniature screen with
  eight spots: a 3×3 grid without the centre. At middle left and middle
  right, the recording pill stands up and becomes vertical. Its menu,
  tooltips and sheets open sideways. A pushed-away tab comes back to the
  nearest third of its edge.
- **Tooltips never clip.** There is one tooltip, and it shows the shortcut.
  It is placed inside the viewport, flipping and shifting as needed from
  every spot. Menus, sheets and the details card follow the same placement.
- **A sync chip you can read.** `synced`, `sending N`, `offline · N` or
  `ended`, with an icon and a colour for each, and no hover needed. A routine
  2s flush does not flicker it.
- **Size and technical details.** S · M · L scales the whole HUD. Technical
  details shows events, queue and chunks, last sync, server seq, session id
  and recorder version. Both are user prefs (`GET`/`PATCH
  /api/v1/recorder/me`) and are cached on the device. They stay on the
  device for key builds, servers without the route, and offline.
- **"Saved" on the pill** for a moment after a note or annotation.
- **Annotate does not touch the page.** A drag over text no longer selects
  it. Presses, moves and hovers no longer reach the app. The crosshair is
  set by a blocked stylesheet, so the page's `<html>` is never restyled.
- The record dot's ripple is drawn outside layout, so the dot and the clock
  are spaced evenly.
- **The HUD is a seam.** `@vitrinka/web/hud` exports
  `mountRecorderHud(controller, opts)` and the `HudController` contract. The
  in-page recorder is one implementation of it. `build/hud.iife.js`
  (`@vitrinka/web/hud.iife.js`) is the same mount as one self-contained
  script with React bundled in. It defines `globalThis.VitrinkaHud.mount`.
- The HUD's surfaces stay out of the recording. The rrweb-blocked host is
  0×0. rrweb 2 cannot drop a blocked node entirely, so it leaves an empty,
  zero-size placeholder. Clicks, the recorder's own requests and `vitrinka:`
  logs are not captured.

## 0.1.5

- **A `project` prop.** `VitrinkaRecorderRoot` takes `project`. A
  device-linked session then files into that project instead of the one the
  host's rule picks. One origin that serves several apps by path can now send
  each app's sessions to its own project. A recorder key's pin still wins.

## 0.1.4

- **Annotate works by finger.** On a phone or tablet, a drag in annotate
  mode used to scroll the page: the browser took the gesture and the
  marquee froze where it was. The next tap then quit annotate mode without
  picking anything. Now annotate mode owns every touch on the page, so a
  drag draws the region, and the page no longer pans, zooms, selects text
  or opens a long-press menu. Leaving annotate mode gives all of that back.
  If the browser does take a gesture, the marquee clears and you stay in
  annotate mode.
- **A pick never presses the page.** Tapping or clicking a button to
  annotate it also pressed the button, on desktop too, and the journey
  recorded the pick as a click. The pick's click is now swallowed, even
  after annotate mode has closed.
- Finger taps get a 12px slop before they become a marquee (a mouse keeps
  6px). A slip that draws only a sliver stays in annotate mode instead of
  quitting it, and a second finger never moves the marquee.

## 0.1.3

- **A throw over a page link or image lands.** Grabbing the HUD where the
  page has a link or image underneath could start the browser's native drag
  of that element. The browser then cancelled the pointer, and the HUD snapped
  back to its spot. A press on the capsule, the puck or the tab now blocks
  native drags until it ends.

## 0.1.2

- **A HUD that is barely there.** Idle, it is a 28px glass puck (a hollow
  ring until the device is linked) whose label slides out on hover or focus.
  While recording it rests as a dot-and-timer capsule and unfolds into the
  tools (sync · pause · note · annotate · more) on hover, focus or tap,
  folding back 2.5s after you leave; the health line still opens by itself
  when something is wrong. Smoked-glass surface, readable on light and dark
  pages. Accessible names are unchanged; the capsule is `Recorder controls`
  (`aria-expanded`), and a polite status line tells screen readers whether
  it is recording, paused or offline.
- **Move it anywhere.** Drag the capsule or puck and it lands on one of six
  spots (corners, top and bottom centre); a flick lands where it is thrown.
  Push it past a side edge and it tucks into a 6px tab (`Show recorder`).
  Arrow keys on the focused handle and the menu's **Move to** picker move it
  without dragging. The spot is remembered per site.
- **Sheets open toward the page centre** from wherever the HUD sits, at most
  288px wide; on a phone they are a bottom sheet above the keyboard, and the
  link sheet drops the QR on touch devices (a phone cannot scan itself).
- `prefers-reduced-motion` stills the ripple, the springs and the slides.
- Needs `@vitrinka/link` 0.1.2 (`@vitrinka/link/dock`).

## 0.1.1

- **The recorder never changes the page under test**: rrweb records images by
  URL (`inlineImages: false`). Inlining made rrweb set
  `crossOrigin="anonymous"` on the page's own no-CORS cross-origin `<img>`,
  which refetched it in CORS mode and broke it on hosts without ACAO.
- **Link into the right workspace**: a `url` addressing `/w/<slug>`
  preselects that workspace on the approve page, and a token approved into
  any other one is discarded; the link sheet says `linked into <x> — this app
  records into <slug>; link again and pick <slug>`. Needs `@vitrinka/link`
  ≥ 0.1.1.

## 0.1.0

- Initial release: the React DOM journey recorder (`@vitrinka/web/recorder`)
  — rrweb DOM stream (chunked like the browser extension), DOM clicks,
  navigation, `console.error` / uncaught errors, fetch/XHR with
  `@vitrinka/redact`; the pill HUD in a top-layer shadow host with notes,
  element/region annotations and keyboard shortcuts; `window.__vitrinkaRecorder`
  control handle; `withVitrinkaRecorder` (`@vitrinka/web/next`) build guard.
- Device link: no key needed — the pill links the device (`@vitrinka/link`),
  stores the minted token under `vitrinka.recorder.link`; `recorderKey` is
  for CI. The runtime strip is the URL alone.
