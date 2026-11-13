---
name: work
description: "Use when a vitrinka task id or URL arrives in the prompt (work pickup), when work on a bound task ends or the Stop gate asks for a hand-back (work handoff), and when a 'later', 'out of scope' or 'someone should decide' thought appears mid-task (work spot)."
metadata:
  vitrinka-contract: "2026-09-15"
---

# work

Modes: `work pickup <id|url>` starts a task; `work handoff` ends it with `hand_back`; `work spot <what>` files what you will not do here. Contract: `docs {topic: "tasks"}`.

## Every mode

- Spell another workspace's task `"<workspace>/<id>"` on every id-only call (`get`, `hand_back`, `spot`, `update`, `read_task_ref`), or pass `workspace`; if the workspace that answered is not the task's, say which answered and stop.
- A check on your own work (a merge, a deploy confirmation, "verify X on preview", a look) is a STEP on the bound task, never a child.
- A child task is only for work that needs its own session, PR or QA record.
- A decision is asked now while a human is in the session and its answer recorded in `summary`, never filed as `Decide:`; a `human` gate or `decide: true` is only for a run nobody attends (a Workflow, a headless or scheduled run).
- Never decide a human's call silently in code.
- Print every `url` and `rendered` exactly as returned; never hand-compose a task URL.
- The vitrinka-pm hooks run `vitrinka hook-context <verb>`: SessionStart `start` binds the session to the checkout's `vt-<id>` as a live run and prints the pickup, PreToolUse `touch` fires `path` todos, SessionEnd `task-end` ends the run, Stop `stop` gates the hand-back; Codex gets them from `vitrinka setup` (trusted once in `/hooks`); `vitrinka doctor` repairs them.

## work pickup <id|url>

- Resolve the task, first match wins: a bare number, a task URL, else the checkout's binding (branch name, worktree path or HEAD trailer carrying `vt-<id>`); none: say which task you need, never guess from titles.
- Read `get {kind:"task", id, view:"pickup"}` (CLI `vitrinka task pickup [id|url]`, which also says whether the branch exists on origin) before anything else.
- Never load refs, comments, events, links, children or a transcript before the pickup names them; never `include: ["events"]`, never the done children.
- An unestimated task shows ESTIMATE: record `update {kind:"task", id, complexity, size, confidence}` against its bands BEFORE the work.
- PROFILE's route tier is advisory, never over an explicit routing choice.
- LINKS name the tracked issue and pages; open one only when the work needs it.
- BEFORE is a stop: say what waits on whom (an open `human` or `date` gate, a `blocks` link, `waiting_on`, a prerequisite) before touching code.
- Read only the READ rows, each with `read_task_ref {id, ref}`; SKIP is not a reading list.
- BRANCH given: continue on it, never rebuild it from `git log`; absent: create a worktree named `vt-<id>` so the hooks bind the session.
- RUN names a memo run: from the worktree run its `bind:` command (`memo run locate <run>`) and export the printed `MEMO_RUN=…` before any memory write; `UNAVAILABLE` means check out BRANCH and locate again; no `memo` on PATH: read RUN as information.
- WHO lacks you: `vitrinka task start [id]`.
- NEXT is the work queue: the task's open steps, then its children, worked down until only rows that need the human remain (a merge they keep, a decision, an account or device only they hold).
- Tick a step when done with `update {kind:"task", id, fields: {gates: [{name, done: true, evidence}]}}`, that item alone (`replaceFields` only to drop items).
- `waiting — <cond>` is not due yet; `due — <cond>` fell due; a BEFORE gate reading `when <cond>` closes itself.
- Take a child row by its own `url`; never stop after one child; never work an epic, only its children.
- A step that outgrows one sitting is promoted with `spot {fromStep}`, never retyped.
- LAST empty: WHAT, READ and NEXT are the whole brief; the parent is `get {kind:"task", id: parentId}`.
- A remainder bigger than the context window goes to a fresh session after the hand-back, never from a run nobody attends: `vitrinka qa session launch '<task url>' '<worktree abs path>'`; exit 0: print its receipt line and stop; non-zero: print `/continue <task url>` and stop.

## work handoff

- End a bound task's work with ONE `hand_back {id, summary, …}` (CLI `vitrinka task handback [id] [-] --flags`, `-` reads the body from stdin); never a chat-only next-steps list.
- Print `rendered` verbatim: same lines, order and urls, nothing added; a line you want to add is a field you forgot, so call again.
- `next` holds only what the human must do; build what you can do before the hand-back; a remainder that outgrew the context says so in `buildOn`.
- `next` items land as steps (`kind` step · human · date · action, `who`, `at`, optional `when`); `task: true` files a child instead.
- Every human gate carries `ask` (≤ 90 characters, verb first, no ids, paths or links) and `why`.
- A gate that closes on an observable fact is `kind: human` with `when` in the todo grammar (`pr 12 merged`, `deployed prod`); only human and date gates tick by `when`.
- Work that only starts at that moment is a step or `kind: action` with the same `when`: due, never done.
- `omitted` with `decide: true` becomes a `human` gate `Decide: …` (unattended runs only); other omissions become children, except with `run` passed: they stay in the run and mint no child.
- `done` lists what shipped; write `summary` for the team: what changed for the product, not the diff.
- `surfaces`, `buildOn`, `branch`, `worktree`, `prerequisites`, `readFirst` become the next pickup's rows; a non-empty `prerequisites` marks the parent epic `waiting`.
- `refs` attach a pr or board; `sessionId` ends the live run.
- Each pr ref carries its status read right before the call (`gh pr view <url> --json state,isDraft`): `meta: {url, state: merged | open | draft | closed}`.
- `diff` is `git diff --numstat $(git merge-base origin/main HEAD)` of the branch; the reply's `observation` says hit, size_miss or no_baseline.
- Never repeat spotted items in `next`.
- `status` moves by itself (a run → in progress, an open PR → in review, a merged PR → done unless a step, gate or other claiming PR is open); steps re-filed by name keep their tick.
- Never set `status` to move work forward; set it only to correct (reopen, cancel, back to backlog) or `done` on a merged task whose remaining work you finished.
- Never attach the summary through `upload_task_file` yourself.
- A bound memo run (`MEMO_RUN` set): run its keep step first (`memo promote <run> --plan`, decide, `--apply`), then pass `run` (`memo run locate <task> --json` → data.ref); never `--transcript` with it.
- Ride the transcript only when the work passes to someone else: `vitrinka task handback --transcript` (`--transcript=<path>` for Codex); nothing archives one by itself.
- The Stop gate (`vitrinka hook-context stop`) blocks a closing message with a `Next steps` heading while the bound task's live run has no newer hand-back: make the call, print `rendered`, stop; never drop the heading to dodge it.
- MCP gone: `vitrinka task handback <workspace>/<id> - < body.json`; offline it queues (exit 0, `data.queued`); say so, never re-send.

## work spot <what>

- Fix a real defect found en route in this change, even outside scope; spot only what you will not do here (a follow-up, a large or risky fix the user has seen, a call a human owns in an unattended run).
- File the moment the thought appears; never batch spots for the hand-back, never park them in a comment, an intake draft or the chat.
- Read the children first (`get {kind: "task", id: "<workspace>/<id>", include: ["children"]}`); a match by meaning gets a comment, never a second child.
- File through `spot {project, title, …}` (CLI `vitrinka task spot "<title>"`, parent defaults to the checkout's `vt-<id>`); body = what, where (file, route, screen), why it is out of scope.
- No bound task: omit `parentId`, the door files under the rolling `Found during implementation` epic; never file at the top level by hand.
- `bug` (default) for a defect that exists today; `task` for a follow-up needing its own session, PR or QA record.
- A step that outgrew the checklist: `fromStep` (item id or exact name) moves it.
- `production: true` when a user could hit it on the deployed product; `refs` (board, session, PR) whenever you hold the evidence.
- An item that stops THIS task: spot it AND `create {kind: "task_link", id, toTaskId, rel: "blocks"}`.
- Print the child as `[<key>](<url>)`, one line, and continue.
