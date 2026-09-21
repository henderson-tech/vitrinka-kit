---
name: spot
description: "Use for '/vitrinka:spot <what you saw>' or whenever a 'later', 'out of scope' or 'someone should decide' thought appears mid-work on a vitrinka task; ending work is handoff."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka:spot — file it the moment you see it

Whatever you will NOT do in this change becomes a child task NOW — not at
the end of the session, not in a comment, not in the chat. The trigger is a
thought: "later", "not in this PR", "out of scope", "somebody should decide".
One thought, one child, filed while the context is fresh; then back to work.

## The verb

1. **Read the children first** — `get {kind:"task", id: <bound>, include:
   ["children"]}` — so nothing is filed twice; a match by meaning gets a
   comment if you have something new, never a second child.
2. **File** through the one door — MCP `spot`, CLI `vitrinka task spot
   "<title>" [--type bug|task] [--body …] [--priority …] [--parent <id>]
   [--production] [--ref kind:ref] [--label …]` (the parent defaults to the
   checkout's `vt-<id>`). Body = what · where (file, route, screen) · why it
   is out of scope here.
   - No bound task → omit `parentId`: the door files under the project's
     rolling `Found during implementation` epic. Never file at the top
     level by hand.
   - `bug` (default) for a defect that exists today; `task` for a follow-up
     that needs its own session, PR or QA record. A check on the work you
     are doing, a merge, a look, a verify is a STEP on the bound task
     (`update {kind:"task", fields: {gates: [...]}}`, or `next` at
     hand-back) — never a child.
   - A call a human owns is a `human` gate on the bound task (`kind:
     "human"`, `who`, the options as `evidence`; `decide: true` at
     hand-back does the same). Never decide it silently in code; a child
     `task` only when the decision is itself a piece of work.
   - A step that outgrew the checklist is promoted, not retyped: `fromStep`
     (its item id or exact name) removes it from the parent as the child is
     filed.
   - `production: true` when a user could hit it on the deployed product.
   - `refs` (board, session, PR) whenever you have the evidence.
   - An item that genuinely stops THIS task is spotted AND linked with
     `create {kind:"task_link", rel: "blocks"}` so the pickup's BEFORE row carries it.
3. **Print the child's `url` as returned**, one line, and continue. The
   hand-back lists open children by itself.

## Never

- Never file the same finding twice — children first, then spot.
- Never file what you are about to do in this change, nor a check on it —
  that is a step on the task.
- Never batch spots for the hand-back, never park them in a comment, an
  intake draft or the chat.
- Never hand-compose a task URL.
