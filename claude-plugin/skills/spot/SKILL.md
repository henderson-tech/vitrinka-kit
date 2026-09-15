---
name: spot
description: "File something you spotted while working a vitrinka task but will NOT do in this change — a defect, a follow-up, a call a human owns — as a child task the moment you see it, through the one `spot` door. Use for `/vitrinka:spot \"<what you saw>\"` or whenever a 'later'/'out of scope'/'someone should decide' thought appears mid-work; ending work is the handoff skill."
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
   - `bug` (default) for a defect that exists today; `task` for a follow-up.
   - A call a human owns is a `task` titled `Decide: <the question>` with
     the options in the body. Never decide it silently in code.
   - `production: true` when a user could hit it on the deployed product.
   - `refs` (board, session, PR) whenever you have the evidence.
   - An item that genuinely stops THIS task is spotted AND linked with
     `create {kind:"task_link", rel: "blocks"}` so the pickup's BEFORE row carries it.
3. **Print the child's `url` as returned**, one line, and continue. The
   hand-back lists open children by itself.

## Never

- Never file the same finding twice — children first, then spot.
- Never file what you are about to do in this change.
- Never batch spots for the hand-back, never park them in a comment, an
  intake draft or the chat.
- Never hand-compose a task URL.
