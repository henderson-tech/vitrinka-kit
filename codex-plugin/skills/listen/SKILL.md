---
name: listen
description: "Use to work a vitrinka board's annotation queue from the app's repo — 'listen to the board', 'watch the annotations' (live); 'resolve the board', 'work through the annotations' (listen resolve); 'pair with me while I test', 'fix while I test' (listen pair)."
metadata:
  vitrinka-contract: "2026-09-15"
---

# listen

Modes: `listen [board]` services new annotations live; `listen resolve [board]` works an accumulated backlog; `listen pair` fixes a recorder session while a human tests.

## Scope

- Without a board, scope to this repo + branch (project from the main worktree's name, as `vitrinka board push` derives it; the current git branch).
- Scope flags: `--board <slug>`, `--project <p> --branch <b>`; `--all` claims no scope and is only for a read-only overview, never to work another session's items.
- Pass the listener's exact scope to every drain: `{board}` for a board, `{project, branch}` for the repo.
- Never call `list {kind:"work"}` or `wait_for_work` unscoped.
- Run from the app repository the board's screenshots come from (`git rev-parse --show-toplevel` works, the project matches); otherwise say so and stop.
- Missing MCP tools (`wait_for_work`, `set_status`, `reply`, `attach_after`, `get {kind:"capsule"}`) or `vitrinka` binary: run `vitrinka setup` (`vitrinka doctor` names what is missing); never hand-write a registration.

## Arm the listener (live and pair)

- Follow `docs {topic: "guide:listening"}` (CLI `vitrinka docs guide:listening`): pick the highest rung, announce its one line once, never mix rungs.
- Rung 1, a `Monitor` tool: arm `exec vitrinka work watch --keepalive 0` (`--board <slug>` for a board); the `exec` is load-bearing, never drop it.
- Rung 2, `VITRINKA_LISTEN_HOST` set: the host already leases the scope; arm nothing.
- Rung 3, neither: drain once with `wait_for_work {…scope, timeoutSec: 1}`, end on idle, name `vitrinka work listen --harness <name>` as the continuous path.
- Never claim a listener is active when none is armed.
- Arm, announce and END THE TURN in the same turn: never loop, poll or sleep.
- One live listener per scope; the `vitrinka work watch` long-poll is the lease.
- A same-machine claim displaces the older session; if YOUR monitor prints `⚠ listener for <scope> taken over by <actor>@<session> — standing down`, acknowledge in one line and never re-arm.
- `⚠ listener already active (live, another machine)` (exit 2): tell the user which session holds it and stop; never steal a cross-machine live lease.
- `--takeover` steals only an expired lease; `vitrinka doctor` shows who holds a scope.
- Never re-arm on each notification; never disarm and re-arm to refresh.

## On a monitor line

- `№<id> [<intent>] <board>: <prompt…>` is a new annotation: drain `wait_for_work({…scope, timeoutSec: 1})` (NOT 50) until `{"idle":true}`, working each capsule serially, oldest first.
- On idle end the turn on every rung.
- `№<id> [answer] <board>: <question> → <answer>` is an answered board question in `choices[]`: record the decision (answer, `note`, per-pick `notes`) per the `brainstorming` skill in this turn; re-read via `get {kind:"questions", board}` if lost.
- `№<id> [ask] <board>: <question> → <prompt>` is an ask in `asks[]`: service it FIRST with `answer_ask {id, text, partial:true}` in 2–4 sentence chunks, the last without `partial`, grounded in this repo's code, never a code change.
- `№<id> [session] <project>: testing session started — …` is a recorder session in `sessions[]`: the № is a session id (`get {kind:"session", id}`, never `get {kind:"annotation"}`); run `listen pair`.
- `· keepalive <scope>` is not work: do nothing and end the turn; batched with real lines, drain normally.
- Keepalive interval is `vitrinka work watch --keepalive <sec>` (default `0`, off); never enable it to keep an idle model busy.
- `⚠ vitrinka unreachable for <n>s — listener degraded`: tell the user and keep the listener armed; it prints `✓ vitrinka reachable again`; on rung 3 report the failed drain and end the turn.
- `update available X → Y · run: vitrinka update`: relay it once and offer `vitrinka update`; never run it unprompted.

## Work one item

- Claim: `set_status {id, status: "working"}` before touching code; a 409 (cancelled or already claimed) means skip silently.
- `reply` ONE terse plan line; at most one `reply` per meaningful moment, never "still working".
- Pass `agent` (`claude-code`, `codex`, …) on `reply` and `attach_after`.
- See the region with `get_card_image {annotation: id}`; each attachment A<n> with `get_card_image {annotation: id, attachment: n}`; `get {kind:"capsule", id}` re-fetches the brief after user edits.
- Fix the annotated ask only, in this repo's worktree; no drive-by refactors.
- Commit with a conventional message referencing №id.
- Prove it: push a new set the way this repo captures, then `attach_after {id, project, branch, selector, file, commit}` on the fixed screen.
- Report: `reply` 1–3 lines (what changed, commit, what to eyeball), then `set_status {id, status: "in_review"}`.
- Never `set_status resolved`: only the user accepts, on the board.
- Needs the user's input: `reply` the question, `set_status {status: "open"}`, go back to listening; their thread reply re-queues it (only `@eve` turns go to Eve).
- Another defect on the screen: measure with `get_card_image {board, cardId}`, file `annotate {board, agent, items:[{key, cardId, cardVersion, region, image:{width,height}, summary, …}]}` with `image` = the size that read returned, read `covers`; it lands `staged`; never a document card, never `highlight`.
- 409 "cancelled" on any call: revert that item's working-tree changes only, never reply to it, mention it in your output, move on.
- Context unwieldy after many fixes: finish the current item, tell the user to restart the listener, stop.

## Stop listening

- On the user's ask: rung 1 `TaskStop` the monitor, rung 2 Ctrl-C the host; each releases the lease and re-queues claimed items.
- Stop the monitor on every stop path of this session; never just stop paying attention, the lease outlives it.
- Exiting the harness with the monitor listed: recommend `Exit anyway` unless the user wants the queue held (`Move to background and exit`).

## listen resolve [board]

- Phase 0: ONE `list {kind:"work", board, status: "open"}` (or `{project, branch, status: "open"}`); never work a `staged`, `resolved`, `in_review` or another session's `working` item.
- Never loop `get {kind:"annotation"}` over the queue; never `scrape_board` a backlog (only per `section` when an item concerns journey order).
- Phase 1, triage every item from its prompt: self-contained (names files or routes) needs nothing; ambiguous target needs its crop; `⌖E…` refs need `get {kind:"annotation"}` (refs outrank the crop); a thread needs `get {kind:"capsule"}`; an upload needs `get_card_image {annotation, attachment: n}`.
- `fix`, `refactor`, `redesign` change code (`redesign` invokes the repo's design skills); `investigate` is an ANSWER via `reply`, code only for a real defect, answer first.
- `reshoot` changes NO code: re-capture and `attach_after`, zero diffs.
- Phase 2, group by root cause, component or subsystem, never board order: one block per repeated pattern, shared token or component, flow, and server vs client vs other repo; 3–8 items per block, cross-cutting blocks first.
- Flag other-repo items to the user; never edit this repo to compensate.
- Record the block map (annotation ids per block) in your task tracker.
- Enrich all flagged items in ONE subagent (`model` on the call) that reads crops via `get_card_image {annotation: "<workspace>/<id>"}` or `{board, cardId, region}` and returns TEXT only; never a crop image in your context, never a crop fetched by URL.
- Phase 3, per block: claim each item with `set_status working`, one coherent commit (or server and client halves), the repo's checks once per block.
- Read an exemplar the prompt names and reuse it; never re-implement beside it.
- Verify an `investigate` claim against code AND data (tables, logs).
- Spatial question to the user: `highlight` a rectangle on the card, then `reply` and `set_status {status: "open"}`, and list it in the summary.
- Phase 4: capture proof of every changed surface; md5-guard consecutive captures and stop when two hash identical (the app is stuck); verify one probe frame via a subagent first.
- ONE verifier subagent per batch of shots returns PASS/FAIL with quoted visible text; never read the shots yourself.
- Journey screens re-capture as a NEW pass (`compose_board {board, journey, pass: "next", …}`), never over the reviewed section.
- Close per block right after its verification, never at session end: `attach_after`, `reply` 1–3 lines (for `investigate` the answer), `set_status in_review`.
- An item from an Eve review job (`jobId`, `judgmentIndex`): `review_verify {job, cardId, cardVersion, judgmentIndex}` with a newer version, then `review_judge {board, journey}` re-reads the pass and `review_judgments {board}` reads the verdicts.
- STOP when: 10+ edits with no item `in_review`; your context holds a crop image; you are working a `staged` or foreign `working` item.

## listen pair

- Preflight: read the repo-root `vitrinka.config.json` (schema: the `vitrinka-qa:qa` skill's `references/project.md`); map a missing `run` section with the user and commit it.
- Mark HMR/Metro stacks `"hot": true` (`pair restart` does nothing for them); give every stack a `ready` probe.
- Work in a worktree `.worktrees/pair-<yyyy-mm-dd>` from `origin/main`; every fix is a commit on that one branch, one PR for the run.
- From that worktree run `vitrinka qa pair run` (`status`, `logs`, `stop`); hand the user each stack's URL; re-running is safe.
- Never point a stack at an e2e `DATA_DIR` and never wipe one.
- Arm the listener with project scope from the worktree.
- On a `[session]` line: run the preflight if not done, `get {kind: "session", id}`, then narrate `board_working {board, status: "◉ paired — watching your session"}` once the board exists.
- Per `[fix]` snap or `[note]`: `set_status working`, narrate `board_working {board, status: "⟳ fixing №<id> — <short cause>"}` (under a dozen words), smallest correct fix committed on the pair branch.
- Get it live: hot stack nothing; otherwise `vitrinka qa pair restart <stack>` and wait for ready.
- `reply {id, text}` in one or two sentences ending "it's live — reload if the page didn't", then `set_status in_review`: the live app is the proof.
- `attach_after` only when the fix is visual and a re-shot costs nothing extra; never let screenshots stall the loop.
- Advance the narration, or `board_working {board, status: ""}` when drained.
- A panel report arrives as dispatched work; a panel reply re-queues like a thread reply.
- `vitrinka qa pair relay` streams assistant text to the panel only when the user starts it.
- Too big for the loop (a schema change, a refactor): say so in `reply`, estimate, `set_status open`, keep pace.
- Wrap up when the recording ends: run the tests for what you touched (unit tests always, the `vitrinka.config.json` `e2e` runner for affected journeys), open the pair branch's PR through the repo's flow, `reply` on the last item (or a `publish` summary card) with the PR and the №ids fixed or handed back.
- Leave the app running as supervised; report each stack's URL, the board and the PR.
- On a bound task finish with `work handoff`.
