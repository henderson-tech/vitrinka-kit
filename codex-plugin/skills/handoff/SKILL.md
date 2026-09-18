---
name: handoff
description: "Hand a vitrinka task back at the end of a session through ONE door — `hand_back` (CLI `vitrinka task handback`) files next steps as children, attaches the summary as the task's versioned hand-back and returns the chat block to print verbatim. Use for `/vitrinka:handoff`, when the Stop gate asks for a hand-back, or whenever work on a bound task ends; starting is the pickup skill."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka:handoff — the hand-back is a projection of the task

Work on a bound task ends with ONE call: `hand_back` (id spelled `"<workspace>/<id>"` when the repo is bound to a workspace, as the pickup spelled it; CLI `vitrinka task
handback [id]`, `- < body.json` for an exact body). It lands everything in one
transaction — `next` and `omitted` become ranked children (`decide: true`
titles a human's call `Decide:`), `summary` becomes the next version of the
task's `handoff` attachment, `surfaces` · `buildOn` · `branch` · `worktree` ·
`prerequisites` · `readFirst` become the next pickup's ON · BRANCH · BEFORE ·
READ rows, `refs` (pr, board) attach, `sessionId` ends the live run — and
returns `rendered`, the chat block. The schema carries each field's shape.

## Contracts

- Write `summary` for the team, not the reviewer: what changed for the
  product, not the diff.
- Spotted items already filed (spot skill) are NOT repeated in `next`; the
  block lists open children by itself.
- `next` holds only what the human must do (a merge they keep, a decision,
  an account or device only they hold). Work the agent can do is built
  before the hand-back, not filed; a remainder that outgrew the context
  window is the one exception, and it says so in `buildOn`.
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
- Never write, shorten or reorder the hand-back block by hand.
- Never attach the summary through `upload_task_file` yourself — the door
  versions the `handoff` lineage.
- Never set `status` to move work forward.
