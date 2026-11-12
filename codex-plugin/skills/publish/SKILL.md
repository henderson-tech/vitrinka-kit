---
name: publish
description: "Use to put work on vitrinka — capture UI ('publish', 'screenshot', 'journey', 'walkthrough', a testing-suite board) or author a document, page, diagram or docs board ('artifact', 'vitrinka this', 'publish this report', 'make this a diagram', 'document this repo')."
metadata:
  vitrinka-contract: "2026-09-15"
---

# publish

Modes: `publish [session|journey|walkthrough|board]` captures; `publish artifact [standalone|page|diagram|docs]` authors.

## Pick the mode

- Capture procedure: `docs {topic: "guide:publish-capture"}` (CLI `vitrinka docs guide:publish-capture`).
- `session`: a testing board that fills live while you build ("screenshot this as I go").
- `journey`: a signpost flow map, screens wired by what was clicked; multi-step, branching, full-page.
- `walkthrough`: a client-facing annotated walkthrough that outsiders read and annotate.
- `board`: a deliberately organized board or testing-journey suite; read `references/board.md`.
- Ambiguous capture: UI work in progress is `session`; named steps or paths are `journey`.
- Escalate `session` to `journey` the moment branching shows up: same set, same board slug.
- `artifact standalone`: a self-contained interactive page (report, analysis, review, dashboard, showcase); read `references/standalone.md`.
- `artifact page`: a markdown document card on a board, repo-file-backable; read `references/pages.md`.
- `artifact diagram`: ONE architecture diagram card, laid out by the server, refreshable from repo truth; read `references/diagram.md`.
- `artifact docs`: a repo's living documentation board (diagrams, pages, deep links); read `references/docs.md`.
- Card kinds and doctrine: `references/card-kinds.md`; runtime shelf: `references/runtime.md`; wire fields: `references/wire-fields.md`.

## Delegate composition

- Keep capture in this session: `--src`, `--state` and `--action` depend on the code you just wrote.
- Dispatch compose-shaped work (structure pass, steps sections, summary card, walkthrough narrative, board suites, standalone doc.json, docs-board narrative) to Agent `subagent_type: "vitrinka:vitrinka-publisher"` in the background, `model` set on the call.
- Run the initial import yourself so the URL exists at once: `vitrinka board create` (`--journey` for a tree); it is idempotent.
- A capture push already lands on the `<project>-<branch>-<key>` board and prints its URL; import only for a custom `--slug`/`--title`.
- A board about one PR names it: `--pr <owner/repo#n>` on the import, else `meta.pr` in the brief.
- Brief the agent fully: the mode, this skill's base directory, the reference to read, repo root and set root, what was captured (labels, declared branches, narrative), board slug, project, subgroup and meta, the summary verdict, the resolved `qa.id` with its `journey` children, and on an update pass what changed.
- On its notification relay the server-returned URL, then apply each `writebacks` item: validate `ref` as a safe repo-relative path in the active worktree, replace it with the complete `md`, commit and push it with the current work, then `refresh {card, source, rev}` that card from the pushed content.
- Report an unsafe or inapplicable write-back and never claim the publish complete; `writebacks: none` needs no repo action.
- Never fabricate or predict the URL while the agent runs.
- No Agent tool (Codex): work inline from the same references and say so.

## Every mode

- Hand back the server-returned `url` (it carries `/w/<workspace>`); never hand-compose `{base}/boards/<slug>`.
- A standalone artifact hands back the `/a/<id>` URL `vitrinka board push` prints; there is no set page.
- Slug = set-key: re-importing the same set updates the same board.
- Look up every element shape in `docs` (alias `artifact_docs`; CLI `vitrinka docs <topic>`), never recall it; legacy shapes and retired kind names are rejected.
- `get_templates` first; never invent card shapes.
- A renderer failure keeps its semantic source and is reported as a defect, never replaced by a raster or base64 figure or a hand-grown rectangle.
- Edit an element by reference: `read_element {id}` (outline, revision, JSON Pointer paths; `{id, paths:[...]}` for values), then `edit_element {id, revision, edits:[{op, path, value}]}` (`replace`, `add` with `-` appending, `remove` without value).
- Edits apply in order; indexes hold only for the revision read; keep outline pagination on one revision.
- A 409 on an edit means re-read the affected content and reconcile, never blindly retry.
- Edit a pushed card through a file, never retype it: `vitrinka board cards get <board> <id> --field src --out f`, edit, `vitrinka board cards patch <board> <id> --set-file src=f --expect-revision <rev>`; artifact markup is `--set-file html=<file>`.
- Write plain URLs, `[label](url)` or task keys (`vt-12`) in prose; `payload.inlineRefs` is server-owned, never authored.
- A board that belongs to a task in context: `add_task_ref {id, kind:"board", ref:"<slug>"}` once, no `cardId`.
- Share an element: `share_board {board, cardId}` or `vitrinka board share <board> --card <id>`; the link grants the whole board, so never mint one on a board carrying drafts or private cards.
- Hand a share URL over as `[<title>](<url>)`, exactly as minted.
- Auth is `vitrinka auth login` (`VITRINKA_TOKEN` or the OS keyring; self-hosted sets `VITRINKA_URL`); never print the token.
- Never run `vitrinka update` unprompted or repeat the offer.
- After a board wrap-up (docs board included) arm the listener yourself per the `listen` skill, announce `⏳ listening — annotate away` and end the turn; a subagent never arms the parent's monitor; a standalone artifact has nothing to listen to.
- On a bound task finish with `work handoff`.

## Capture

- `.vitrinka/` is machine-local and ignores itself; never add vitrinka lines to the repo's `.gitignore`.
- Ad-hoc output goes under `.vitrinka/scratch/<topic>/`, never a root `.screenshots-<topic>` dir or loose repo-root files.
- `.vitrinka/screenshots/.active` present = capture ON; absent = OFF.
- Pass `--src` on every shot: the implementing file plus 1–2 key components, repo-relative.
- Pass `--state` with what a reproducer needs.
- Web captures are 2× device scale unless `capture.hidpi` is off (`vitrinka config hidpi off`); `board capture web --viewport WxH` refuses a 1× file.
- Never downscale native simulator or device captures.
- `--open <deeplink>` navigates, waits and captures; never chain shell sleeps.
- A capture pushes detached; never wait or poll.
- Read every saved image to verify the screen and state yourself; never delegate it.
- Full-page: the viewport shot is the primary card; add a content-only companion only when the content overflows; never scroll-and-stitch.
- Never commit shots.
- A failed upload writes `.vitrinka/screenshots/.vitrinka-offline`: warn once, keep capturing; the next push sends what is missing.
- Desktop app: test the `~/.config/vitrinka/desktop-app` flag file, never probe /Applications.

## Boards (session and journey wrap-up)

- Steps ARE the walkthrough: ONE `section` per journey or area, a numbered `step` per screen with `status` and `image: {project, branch, selector, file}` naming a shot of this session's set.
- Never keep a serpentine row of raw shots beside a steps section: skip `board create` or remove the row with `update_cards {remove:[…]}`.
- Removing anyone else's cards answers `409 needs_confirm`: repeat with `confirm:<token>` and `reason`.
- `step.note` is a one-line caption; put the explanation in a `text` card beside it in a row `cluster`; read `clipped` after compose (docs `board:step`).
- A live annotate→fix loop on one screen stays a real shot card (crops and face versions exist only on shot and media cards).
- "Review these screens and annotate what's off" is `annotate` (survey with `get_card_image {cardIds}`, measure on a single-card read), never a `finding` or document card, never `highlight`; docs topic `annotation`.
- End every board with ONE summary `callout` (verdict, counts, links, what was NOT covered); later passes update it, never stack a second.
- Statuses live on the cards (`step.status`).
- Iteration is the next pass (`pass: "next"`), never mixed takes.

## Journeys

- `--target` is the clicked element's bbox in IMAGE px, measured, never eyeballed (× `devicePixelRatio`, at the shot's scroll state).
- `--next <LABEL>` names the target shot's `--label`; one screen appears once and every branch points at its label; a fabricated chain edge into a branch target or back into its source is suppressed.
- Never convert a journey into a steps section: the tree is the deliverable.
- Without the CLI: `compose_board` edges take `fromRegion`/`toRegion` `{x,y,w,h}` in image px and optional `rel: "subtask" | "blocks" | "refs"` (canvas relations, not `task_links`).

## Walkthroughs

- Write `--action`/`--title`/`--note` for the reader, in the client's language and voice: ONE intro `text` card, a `callout` per caveat.
- A share link shares the WHOLE board; never mint one on a board with drafts the client must not see.
- Use a sandbox or demo org for any shot showing tenant data; mint-then-revoke any credential that appears on screen.

## QA plan

- Test results never come through this skill: runner output is `vitrinka qa run -- <test command>`, exploratory testing is `qa usertest`.
- Resolve the target before dispatching: `vitrinka task resolve-qa --json`; exit 4 = no qa task: publish unlinked and say so; `qa.pending` = the plan waits on its reviewer: say so, never file a second plan.
- Never create a qa task or a journey from a publish.
- The publisher stamps the board once (`add_task_ref {kind: "board", meta: {board: true}}`) and links sections to `journey` children by `fields.key`, else EXACT title; an unmatched section is listed under `warnings`, never force-matched.
- A walkthrough carries no verdicts; a finding worth one is a `qa usertest` case whose `finish` files the bug.
