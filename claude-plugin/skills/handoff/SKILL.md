---
name: handoff
description: "Use when work on a bound vitrinka task ends — '/vitrinka:handoff', the Stop gate asking for a hand-back, or a session wrapping up; starting a task is pickup."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka:handoff — the hand-back is a projection of the task

Work on a bound task ends with ONE call: `hand_back` (id spelled `"<workspace>/<id>"` when the repo is bound to a workspace, as the pickup spelled it; CLI `vitrinka task
handback [id]`, `- < body.json` for an exact body). It lands everything in one
transaction — `next` items land as **steps** on the task's checklist
(`kind` step · human · date · action, `who` / `at`, an optional `when` that
ticks the step by itself), `task: true` files a child, `omitted` with
`decide: true` becomes a `human` gate `Decide: …` (waiting on `who`) and
other omissions children, `summary` becomes the next version of the
task's `handoff` attachment, `surfaces` · `buildOn` · `branch` · `worktree` ·
`prerequisites` · `readFirst` become the next pickup's ON · BRANCH · BEFORE ·
READ rows, `refs` (pr, board) attach, `sessionId` ends the live run — and
returns `rendered`, the chat block. The schema carries each field's shape;
the full contract is `docs {topic: "tasks"}`.

## Contracts

- **A next step that is a check on the work you just did is a step, not a
  task**: a merge, a deploy confirmation, "verify X on preview", "look at
  the hub once", a human decision — one line each, on THIS task. A child
  task (`task: true`, with `type`) is only for work that needs its own
  session, PR or QA record. Steps re-filed by name keep their tick.
- `next` holds only what the human must do (a merge they keep, a decision,
  an account or device only they hold). Work the agent can do is built
  before the hand-back, not filed; a remainder that outgrew the context
  window is the one exception, and it says so in `buildOn`.
- A step whose trigger is observable carries `when` in the todo grammar
  (`pr 12 merged`, `deployed prod`): the server ticks it with evidence, so
  the record follows the work without a call.
- Write `summary` for the team, not the reviewer: what changed for the
  product, not the diff.
- **The transcript is a hand-off, never a default.** A session's
  conversation rides the hand-back only when the work passes to someone
  else: the CLI door `vitrinka task handback --transcript` archives the
  running session's transcript on the task and labels it `eve-distill` so
  the colleague opens the digest. Nothing archives a transcript by itself.
- Spotted items already filed (spot skill) are NOT repeated in `next`; the
  block's "Next steps" are the task's open steps and gates, never its
  children (the pickup's NEXT owns those).
- A non-empty `prerequisites` marks the parent epic `waiting`.
- `status` moves by itself (a run → in progress, an open PR → in review, a
  merged PR → done). Fill it only to correct: reopen, cancel, back to backlog.
- **Print `rendered` verbatim** — same lines, order and urls, nothing added.
  A line you want to add by hand is a field you forgot: call again.
- The Stop gate blocks a closing message with a `Next steps` heading while
  the bound task has no hand-back newer than this session's run: make the
  call, print `rendered`, stop. Never drop the heading to dodge it. Codex
  runs the same hook once `vitrinka setup` wrote it and `/hooks` trusted it
  (`vitrinka doctor` shows `hooks·codex`).
- The personal `/handoff` and `/continue` commands keep their file form for
  repositories without vitrinka; with a bound task they call this skill and
  the pickup skill.

## Never

- Never end a bound task's work with a chat-only next-steps list.
- Never file a check on your own work, a merge or a human call as a child
  task — it is a step or gate on the task.
- Never write, shorten or reorder the hand-back block by hand.
- Never attach the summary through `upload_task_file` yourself — the door
  versions the `handoff` lineage.
- Never set `status` to move work forward.
