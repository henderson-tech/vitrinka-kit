---
name: pair
description: "Live pairing during user testing — supervise the app under test (`vitrinka qa pair`), listen for the recorder's ⌖ snaps, fix each bug while the tester keeps testing, and restart so fixes appear immediately. Invoke as /vitrinka:pair FROM THE APP'S REPO."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka:pair — fix the app while the user tests it

You are the **fixer half of a live pairing loop**. The user tests their app
with the vitrinka recorder running and marks bugs as they go (⌖ snaps,
notes); each snap is born as dispatched work and reaches you in seconds:
fix it, get the fix into the RUNNING app, and tell them — before they finish
testing the next screen. The recorder HUD shows them your presence ("● claude
listening") and your narration ("⟳ fixing №3 …").

Pair **composes with `listen`**: the watch arming, lease discipline, takeover
handling, drain scoping, cancel/409 rules and the never-`resolved` law are
all the listen skill's — read it first if this session hasn't. This skill
adds the supervisor, the pair worktree, the restart step, and the pace.

## Preflight — before the user starts testing

1. **Project map.** Read the repo-root `vitrinka.config.json` (schema:
   `../sessions/references/project.md`). Pair needs the `run` section; map it
   interactively and commit it if missing — like the sessions skill's Phase
   0. Mark HMR/Metro stacks `"hot": true`: for those the file save IS the
   deploy and `pair restart` deliberately does nothing. Give every stack a
   `ready` probe.
2. **Pair worktree** (user-gated creation): create `.worktrees/pair-<yyyy-mm-dd>`
   from `origin/main`. ALL fixes land here as commits on this one rolling
   branch — one PR reviews the whole pairing run.
3. **Supervise the app FROM the worktree**: `cd` there and run `vitrinka qa
   pair run`. The supervisor resolves the worktree's own
   `vitrinka.config.json`, so the running app serves the code your fixes
   land in. Hand the user each stack's URL. Re-running is safe
   (reuse-if-healthy). NEVER point a stack at an e2e `DATA_DIR`, and never
   wipe one — the user's boards, prefs and logins live there and must
   survive every restart.
   - vitrinka itself: run the dev server with `-static internal/web/static`
     so asset-only fixes (board engine, css, templates' static imports) are
     browser-refresh-fast — restart only for Go changes.
4. **Arm the listener** (per the listen skill, project scope, from the
   worktree) on the highest rung this harness offers — the
   `docs {topic: "guide:listening"}` ladder: a native Monitor on
   `exec vitrinka work watch` (then END THE TURN), the `vitrinka work listen
   --harness <name>` host (arm nothing, END THE TURN), or holding this turn
   on `wait_for_work`. Announce the rung's one line and never mix rungs.

Landing here mid-listen: a `№<id> [session] <project>: testing session
started — …` watch line (the `sessions[]` lane of `wait_for_work`) is the
user starting a recorder session — run this preflight now if you haven't;
the № is a SESSION id (`get {kind:"session", id}` for context, NOT
`get {kind:"annotation"}`) — then narrate you're in: `board_working` once the
session's board exists, e.g. "◉ paired — watching your session".

## The pair loop — per drained item

Work items arrive exactly as in `listen` (`wait_for_work`, scoped, serial,
oldest first). Per ⌖ snap (`[fix]`) or escalated note (`[note]`):

1. `set_status {id, status:"working"}` + narrate: `board_working {board,
   status:"⟳ fixing №<id> — <short cause>"}`. The narration is what the
   tester sees IN THE APP; keep it under a dozen words. `board_working` is
   a `rare`-module tool: the registration opts in on its `/mcp` URL with
   `?modules=core,qa,rare`.
2. **Fix in the pair worktree.** Smallest correct change; commit on the
   rolling branch (conventional message referencing №id).
3. **Get it into the running app**: hot stack — nothing to do; otherwise
   `vitrinka qa pair restart <stack>`. Wait for ready. State on disk
   survives; only the page reloads.
4. `reply {id, text}` — one or two sentences: what was wrong, what changed,
   and "it's live — reload if the page didn't".
5. `set_status {id, status:"in_review"}` — **the live app is the proof.** The
   tester verifies by looking at what they were already looking at, and
   accepts (or bounces, or snaps again) on the board. `attach_after` only
   when the fix is visual and a re-shot costs you nothing extra; never let
   screenshotting stall the loop.
6. Clear or advance the narration: next item's "⟳ fixing …", or
   `board_working {board, status:""}` when the queue is drained.

## Panel — what the tester sees

The recorder HUD's live pair panel is a **proxy of what you already emit** —
your `set_status` transitions, `reply` texts (commit hashes become links),
and `board_working` narration ARE its feed. Two things flow BACK from it, on
rails you already handle: a typed panel report lands as a dispatched
annotation in your queue exactly like a ⌖ snap, and a panel reply re-queues
the item exactly like a board thread reply (accept ✓ resolves it, bounce ↺
sends it back open).

Optional richer feed: the user can run `vitrinka qa pair relay` (a second
terminal, from your repo) to stream your assistant-text lines to the panel
live — opt-in only, ephemeral, assistant-visible text only (never thinking
or tool calls); it broadcasts your raw prose to whoever watches the panel,
so it is off unless explicitly started.

Bugs too big for the loop (a schema change, a refactor): say so in the
thread (`reply`), estimate honestly, `set_status {id, status:"open"}` to
hand it back, and keep pace with the queue — pair optimizes for the tester's
flow, not for finishing every item live.

## Wrap-up — when the recording ends

The stop shows up as the session board settling (and the user usually says
so). Then:

1. Run the repo's tests for what you touched (the `vitrinka.config.json` `e2e` runner
   for affected journeys when cheap, unit tests always).
2. Open the PR for the pair branch (`/prc`) — the whole run reviews as one.
3. Final board note: a `reply` on the last item (or a summary card via the
   publish skill on bigger runs) linking the PR and listing №ids fixed /
   handed back.
4. **Leave the app running** exactly as supervised. Report each stack's URL,
   the board link, and the PR link.
5. Before the hand-back on a bound task, run the `handoff` skill
   (`hand_back`) — the chat block is its `rendered` output.

Never `resolved`, never unscoped drains, never a second listener on the same
scope — the listen skill's laws all hold here.
