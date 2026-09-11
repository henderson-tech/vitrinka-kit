---
name: spot
description: "File something you spotted while working a vitrinka task but will NOT do in this change — a defect, a follow-up, a call a human owns — as a child task the moment you see it, through the one `spot` door. Use for `/vitrinka:spot \"<what you saw>\"` or whenever a 'later'/'out of scope'/'someone should decide' thought appears mid-work; ending work is the handoff skill."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:spot — file it the moment you see it

Working a task, you notice things: a bug next to the code you are changing,
a follow-up the change makes possible, a question only a human can settle.
Whatever you will NOT do in this change becomes a child task NOW — not at
the end of the session, not in a comment, not in the chat. Items batched
"for the hand-back" get lost; items filed as children are already on the
plan, ranked, visible, and the next session's NEXT rows.

## The moment

The trigger is a thought, not a milestone: "later", "not in this PR",
"out of scope", "somebody should look at", "we'd need to decide". Each one
is one child. Fire while the context is fresh — what · where · why — and
go back to the work.

## The verb

1. **Read the children first** — `get_task {id: <bound>, include:
   ["children"]}` — so nothing is filed twice. A match by meaning, not
   only by title, means: comment on the existing child if you have
   something new, else move on. Never re-file.
2. **File** through the one door:

   ```text
   spot {
     project: "acme",
     title: "<what, in one line>",
     type: "bug" | "task",
     body: "<what you saw · where (file, route, screen) · why it is out of scope here>",
     priority: "high",            # only when you know it
     parentId: <bound task>,      # the pickup you started from, the checkout's vt-<id>
     production: true,            # a user could hit it on the deployed product
     refs: [{kind: "board", ref: "acme-shop"}]   # evidence you already have
   }
   ```

   CLI: `vitrinka task spot "<title>" [--type bug|task] [--body …]
   [--priority …] [--parent <id>] [--production] [--ref kind:ref] [--label …]`
   — the parent defaults to the checkout's `vt-<id>`.

   - **No bound task → omit `parentId`**: the door files it under the
     project's rolling `Found during implementation` epic (minted on first
     use). Never ask, never file at the top level by hand.
   - `bug` (the default) for a defect that exists today; `task` for a
     follow-up or an improvement the change made possible.
   - A call a human owns — a product choice, a trade-off, an ambiguity in
     the brief — is a `task` titled `Decide: <the question>`; the body
     carries the options you see. Never decide it silently in code.
   - `production: true` for anything a user could hit on the deployed
     product: it wears the `might-affect-production` label so triage sees
     it first.
   - `refs` when you have them — a board, a session, a PR — so the reader
     lands on the evidence, not on your memory of it.
3. **Print the child's `url` as returned** — one line, the title and the
   url — and continue. The hand-back later lists it among the open children
   by itself.

## Why a child and not …

- **… a comment**: a comment is conversation on the parent; nobody picks a
  comment up, nothing ranks it, the pickup does not list it.
- **… an intake draft** (`propose_tasks`): drafts stay invisible until a
  human triages them; a spotted item on the task you hold is already
  triaged by being yours to see.
- **… the chat**: the chat ends with the session.
- **… a `blocks` link**: only when the item genuinely stops THIS task —
  then spot it AND `create_task_link {rel: "blocks"}` so the pickup's
  BEFORE row carries it.

## Never

- Never file the same finding twice — children first, then spot.
- Never file what you are about to do in this change; that is the work,
  not a spot.
- Never hand-compose a task URL — print the `url` the door returned.
