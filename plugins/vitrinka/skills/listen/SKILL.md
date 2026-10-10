---
name: listen
description: "Use when a session should service a vitrinka annotation board live — '/vitrinka:listen [board-slug]' from the app's repo, 'listen to the board', 'watch the annotations'; a backlog is resolve."
metadata:
  vitrinka-contract: "2026-09-15"
---

# listen — the listening session

You are the **worker half of an audit loop**: the user annotates their app's
screens on a vitrinka board; you fix each annotation in THIS repository,
attach visual proof, and go back to listening. A human invokes it as
`/listen` (`/vitrinka:listen` when another command claims the name; `$listen`
in Codex).

`vitrinka work watch` is a persistent process that long-polls the work queue,
leases the scope, and prints ONE line per NEW item. `docs {topic:
"guide:listening"}` (CLI `vitrinka docs guide:listening`) is the ONE ladder
every listening skill follows — a native background Monitor on `exec
vitrinka work watch`, the `vitrinka work listen --harness <name>` host, or
one scoped drain — with the exact Monitor call, the rung-picking order and
the one-line announcement. Pick the highest rung this harness offers,
announce it once; the rest of this file applies unchanged on every rung. A
"monitor line" below means the line however it reaches you.

Argument: an optional board slug (`/vitrinka:listen acme-audit`). **Without
a board it AUTO-SCOPES to this repo + branch** — the project inferred from
the repo (the main worktree's name, the same derivation `vitrinka board push`
uses) and the current git branch.

## One listener per scope (the multi-session model)

The server enforces **at most one live listener per scope** — the same board
(or the same project+branch) cannot be listened to twice:

- The listener *leases* its scope through the `vitrinka work watch` long-poll
  — that long-poll IS the heartbeat. A clean stop (the monitor torn down, the
  host interrupted, the session exiting) releases the lease immediately and
  reverts any work it had claimed; a killed process's lease lapses on its
  TTL. The watch self-terminates when orphaned (it watches its own parent).
  The lease records the harness and the rung, shown beside the board's
  listening indicator.
- **Newest wins (same machine):** if another session ON THIS MACHINE holds
  the scope, your `vitrinka work watch` claim displaces it automatically —
  no 409, nothing to surface. The displaced session's monitor emits one `⚠
  listener for <scope> taken over by <actor>@<session> — standing down` line
  and exits. **If YOUR monitor emits that line**, acknowledge in one line
  ("listener moved to <session> — standing down") and do NOT re-arm.
- Scope held live by a session on a **different machine**: `vitrinka work
  watch` prints `⚠ listener already active (live, another machine): …` and
  exits (code 2). Tell the user which session holds it and stop — a
  cross-machine live lease is never stolen.
- `--takeover` steals only an **expired** lease (a crashed/hard-killed
  session). Same-machine live leases need no flag; cross-machine live ones
  can never be stolen. `vitrinka doctor` shows who holds a scope.

Scope flags (all optional): `--board <slug>` (one board), `--project <p>
--branch <b>` (override the inferred repo scope), `--all` (the firehose —
claims no scope; only for a read-only overview session, never to work items
another session owns).

All scope resolves *within the token's workspace* — `wait_for_work` /
`list {kind:"work"}` scoping by `{board}` or `{project, branch}` only ever
sees that workspace's work; another workspace of the organisation is
`<workspace>/<slug>` or `<workspace>/<project>`.

## Preconditions — check once, then arm

1. You are in the app repository the board's screenshots come from (`git
   rev-parse --show-toplevel` works and the project matches what capsules
   will reference). Clearly not an app repo → say so and stop.
2. The `vitrinka` MCP tools are available (`wait_for_work`, `set_status`,
   `reply`, `attach_after`, `get {kind:"capsule"}`) and the `vitrinka`
   binary is on PATH. Either missing → `vitrinka setup` registers both
   (`vitrinka doctor` names what is missing); never hand-write a
   registration.
3. Your rung, per `guide:listening`: the `Monitor` tool exists → rung 1;
   `VITRINKA_LISTEN_HOST` is set → rung 2 (the host already leases the
   scope — arm nothing); otherwise rung 3 (drain once with `wait_for_work
   {…scope, timeoutSec: 1}`, end on idle, name `vitrinka work listen
   --harness <name>` as the continuous path). Never claim a listener is
   active when none is armed.

Arm it exactly as the guide shows (rung 1: `exec vitrinka work watch
--keepalive 0`, `--board <slug>` for a board — **the `exec` is
load-bearing**), announce the rung's one line in the SAME turn and **END
THE TURN**: do not loop, do not poll, do not sleep. If the watch's FIRST
output line is `⚠ listener already active (live, another machine) …` (exit
2), surface which session owns it and stop.

## On a work line — drain the queue

A monitor line is `№<id> [<intent>] <board>: <prompt…>` — one per new
annotation. Other line shapes:

- `№<id> [answer] <board>: <question> → <answer>` — an ANSWERED BOARD
  QUESTION (a "Send to Claude" dispatch): `wait_for_work` returns it in
  `choices[]` alongside `work[]`; record the decision (answer + any `note`,
  or a multi-select's per-pick `notes`) per the brainstorming skill, not as
  a code-fix item. Choices are delivered exactly once — act on the drained
  `choices[]` in this turn (or re-read via `get {kind:"questions", board}`,
  the durable record, if lost).
- `№<id> [session] <project>: testing session started — …` — the user began
  a RECORDER SESSION on your project (the `sessions[]` lane): the № is a
  session id (`get {kind:"session"}`, not `get {kind:"annotation"}`), and
  the move is `vitrinka-qa:pair`'s preflight and loop; there is no
  annotation to service yet.
- `№<id> [ask] <board>: <question> → <prompt>` — an ASK-AI INFO REQUEST, in
  `wait_for_work`'s `asks[]`. Service asks FIRST (a ● working popover is
  open on their screen): stream `answer_ask {id, text, partial:true}` in 2-4
  sentence chunks, final chunk without `partial` — grounded in this repo's
  actual code when the ask is about behavior, popover-sized, never a code
  change.

When re-invoked by a line (or a batch):

1. **Drain via MCP, SCOPED THE SAME WAY.** `wait_for_work({ …scope,
   timeoutSec: 1 })`, looped until it returns `{"idle":true}`, working each
   returned capsule serially, oldest first. Pass the SAME scope the listener
   uses: `{ board }` for a board listener, `{ project, branch }` for the
   auto-scoped repo listener. `timeoutSec: 1` (NOT 50) — the watch is what
   waits. Rung 3 performs only the scoped drain.
2. On idle, **end the turn on every rung** — an armed monitor stays
   armed (`persistent`), the host keeps its loop. Never disarm it yourself.

Do NOT re-arm the listener on each notification.

## Keepalive heartbeats

A `· keepalive <scope>` line is NOT work — a presence-gated heartbeat the
watch emits while the user has a scope board open and this session has been
idle for about one prompt-cache TTL; the wake itself re-warms the cache. On
a keepalive line, **do nothing**: no `wait_for_work`, no replies, no text —
end the turn immediately. Batched with real work lines, drain normally. The
interval is `vitrinka work watch --keepalive <sec>` (default `0`, disabled).
Opting in deliberately causes model wakeups; the watch emits none while
nobody is viewing a board. Never enable it just to keep an idle model busy.

## Working one item

1. **Claim it**: `set_status {id, status: "working"}` — the board pin flips
   amber live. A 409 (cancelled / already claimed) → skip silently.
2. **Announce the plan**: `reply` with ONE terse line.
3. **Understand**: the capsule has the ask, the region, and a crop — see it
   with `get_card_image {annotation: id}` if the region matters. `get
   {kind:"capsule", id}` re-fetches the latest brief after user edits.
4. **Fix it in this repo.** The annotated ask only — no drive-by refactors.
   Commit with a conventional message referencing №id.
5. **Prove it**: regenerate the screen(s) and push a new set the way this
   repo does it (its CLAUDE.md / `vitrinka board capture` / journey script).
   Then `attach_after {id, project, branch, selector, file, commit}` pointing
   at the fixed screen inside the set you just pushed.
6. **Report**: `reply` with 1-3 lines (what changed, commit, anything to
   eyeball), then `set_status {id, status: "in_review"}`.

At most one `reply` per meaningful moment (plan, pushed vN); never "still
working". Pass `agent` on `reply` and `attach_after` (`claude-code` /
`codex` / …) so the thread shows `agent:<runtime>` beside your verified
identity.

Something ELSE wrong on the screen (not the annotated ask)? Don't widen the
fix — file it: `get_card_image {board, cardId}` to measure, then `annotate
{board, agent, items:[{key, cardId, cardVersion, region,
image:{width,height}, summary, …}]}` with `image` = the size that read
returned; read `covers` in the receipt — the text under the filed region. It
lands `staged`; the user accepts it into the queue. Never a document card,
never `highlight` for a finding (docs topic `annotation`).

## Cancels

Any vitrinka tool returning **409 "cancelled"** for an item means the user
withdrew it mid-flight:

1. Revert the working-tree changes you made FOR THAT ITEM (surgical).
2. Do not reply to the cancelled annotation (writes bounce); mention the
   cancellation in your session output only.
3. Move on to the next ready item.

## Degraded / down

A work line `⚠ vitrinka unreachable for <n>s — listener degraded`: tell the
user vitrinka looks down and the listener is retrying — **keep the listener
armed** (it self-recovers and prints `✓ vitrinka reachable again`). Do not
disarm or re-arm. On rung 3 report a failed drain and end the turn; there is
no background listener to claim is retrying.

## Stopping the listener

- **The user asks to stop listening** → rung 1: `TaskStop` the monitor; rung
  2: Ctrl-C in the host's terminal; rung 3: no listener was armed.
  Each releases the lease at once and re-queues anything claimed. Never just
  "stop paying attention" — the lease outlives your attention.
- **The user is exiting the harness** and its exit dialog lists the monitor:
  `Exit anyway` stops it (the lease is released); `Move to background and
  exit` keeps it leasing and answering the board with no session attached.
  If asked which to pick: `Exit anyway` unless they specifically want the
  queue held.
- **Never disarm and re-arm** to "refresh" it.

## Rules

- **Never `set_status resolved`** — only the user accepts, on the board.
- Statuses are the UI: claim before touching code, in_review only after the
  after-shot is attached.
- One item at a time; the queue is FIFO — oldest first.
- A fix that genuinely needs the user's input: `reply` with the question,
  `set_status {status: "open"}` to put it back, and go back to listening —
  any plain reply in the thread re-queues the item and wakes you again
  (annotation threads route to the listening agent by default; only explicit
  `@eve` turns go to Eve, vitrinka's AI reviewer).
- Context grown unwieldy after many fixes: finish the current item, tell the
  user to restart the listener, and stop.
- `update available X → Y · run: vitrinka update` on stderr: relay it ONCE
  and offer `vitrinka update`; never run it unprompted.
