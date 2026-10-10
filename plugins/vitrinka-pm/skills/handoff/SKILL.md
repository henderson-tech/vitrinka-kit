---
name: handoff
description: "Use when work on a bound vitrinka task ends — '/handoff', the Stop gate asking for a hand-back, or a session wrapping up; starting a task is pickup."
metadata:
  vitrinka-contract: "2026-09-15"
---

# handoff — the hand-back is a projection of the task

Work on a bound task ends with ONE call: `hand_back {id, summary, …}` (id
spelled `"<workspace>/<id>"` as the pickup spelled it; CLI `vitrinka task
handback [id] [-] --flags`, `-` reading the exact body from stdin). It lands
everything in one transaction and returns `rendered`, the chat block:

- `next` items land as **steps** on the task's checklist (`kind` step ·
  human · date · action, `who` / `at`, an optional `when` that ticks a human
  or date gate by itself and makes a step or action due); `task: true`
  files a child instead.
- `omitted` with `decide: true` becomes a `human` gate `Decide: …` (waiting
  on `who`; an unattended run only); other omissions become children.
- Every human gate (a `kind: human` step, a `decide: true` omission)
  carries `ask` — the sentence the person reads in Needs you, ≤ 90
  characters, verb first, no ids, paths or links — and `why`, what waits on
  the answer; the title stays the agent's name for it.
- `done` lists what shipped; `summary` becomes the next version of the
  task's `handoff` attachment.
- `surfaces` · `buildOn` · `branch` · `worktree` · `prerequisites` ·
  `readFirst` become the next pickup's ON · BRANCH · BEFORE · READ rows.
- `refs` (pr, board) attach; `sessionId` ends the live run.

Each pr ref carries its status, read right before the call (`gh pr view
<url> --json state,isDraft`): `meta: {url, state: merged | open | draft |
closed}` — re-attaching updates it, and the block prints `🔀 PR (merged |
waiting | draft | closed): [repo#N](<url>)`, `unknown` when none was given. The schema
carries each field's shape; the full contract is `docs {topic: "tasks"}`.

## Contracts

- **A next step that is a check on the work you just did is a step, not a
  task**: a merge, a deploy confirmation, "verify X on preview", "look at
  the hub once", a decision left by a run nobody attends — one line each,
  on THIS task. A child task (`task: true`, with `type`) is only for work
  that needs its own session, PR or QA record. Steps re-filed by name keep
  their tick.
- `next` holds only what the human must do (a merge they keep, an account
  or device only they hold). Work the agent can do is built
  before the hand-back, not filed; a remainder that outgrew the context
  window is the one exception, and it says so in `buildOn`.
- **That remainder's fresh session** (never from a run nobody attends):
  after `rendered`, with `$VITRINKA_SESSION_LAUNCHER` set run
  `sh -c '${VITRINKA_SESSION_LAUNCHER:?} "$@"' _ '<task url>' '<worktree abs path>'`:
  exit 0 → print its receipt line and stop; unset or non-zero → print
  `/continue <task url>` and stop.
- **A decision is asked, never filed, while a human is in the session**:
  ask it before the hand-back (AskUserQuestion in Claude Code) and record
  the answer in `summary`. `decide: true`, or a `human` step that is a
  decision, is only for a run nobody attends: a Workflow, a headless or
  scheduled run.
- A merge or other gate that closes when an observable fact lands is
  `kind: human` (`who` the person who acts) with `when` in the todo grammar
  (`pr 12 merged`, `deployed prod`): the server ticks it with evidence, so
  the record follows the work without a call. Only human and date gates
  tick by their `when`.
- Work that only STARTS at that moment ("ship after the merge", "redeploy
  once it is out") is a step (the default) or `kind: action` with the same
  `when`: the server marks it due, never done, and the pickup shows it
  `waiting — <when>`, then `due — <when>`.
- Write `summary` for the team, not the reviewer: what changed for the
  product, not the diff.
- **The transcript is a hand-off, never a default.** A session's
  conversation rides the hand-back only when the work passes to someone
  else: `vitrinka task handback --transcript` (bare: the running Claude Code
  session's file; `--transcript=<path>` for Codex) archives it on the task
  after the hand-back and labels the task `eve-distill` so the colleague
  opens the digest. Nothing archives a transcript by itself.
- Spotted items already filed (spot skill) are NOT repeated in `next`; the
  block's "Next steps" are the task's open steps and gates, never its
  children (the pickup's NEXT owns those).
- A non-empty `prerequisites` marks the parent epic `waiting`.
- `status` moves by itself (a run → in progress, an open PR → in review, a
  merged PR → done). Fill it only to correct: reopen, cancel, back to backlog.
- **Print `rendered` verbatim** — same lines, order and urls, nothing added.
  A line you want to add by hand is a field you forgot: call again.
- **The Stop gate** (the vitrinka-pm plugin's Stop hook, `vitrinka
  hook-context stop`; on Codex the same hook `vitrinka setup` wrote and
  `/hooks` trusted) blocks a closing message with a `Next steps` heading
  while the bound task has a live run and no hand-back newer than it: make
  the call, print `rendered`, stop. Never drop the heading to dodge it. No
  run known = no block.
- **The MCP gone is no reason to skip the hand-back**: `vitrinka task
  handback <workspace>/<id> - < body.json` takes the same body; offline it
  queues (exit 0, `data.queued`) and lands once before the next CLI call
  that reaches the server — say so in the closing message, never re-send.

## Never

- Never end a bound task's work with a chat-only next-steps list.
- Never file a check on your own work, a merge or a human call as a child
  task — it is a step or gate on the task.
- Never file a `Decide:` gate for a call the human in the session could
  answer now.
- Never write, shorten or reorder the hand-back block by hand.
- Never attach the summary through `upload_task_file` yourself — the door
  versions the `handoff` lineage.
- Never set `status` to move work forward.
