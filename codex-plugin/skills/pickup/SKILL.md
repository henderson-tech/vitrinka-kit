---
name: pickup
description: "Pick up a vitrinka task or epic from a fresh session — read its server-composed pickup (last hand-back, branch, what to read first, what to do next, what NOT to load), claim it, start on NEXT. Use when a task id or URL arrives in the prompt or `/vitrinka:pickup <id|url>` is invoked; ending work is the handoff skill."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka:pickup — start where the last session stopped

The task IS the handoff: the server composes ONE bounded pickup view and
counts what it did not load. Read it, claim the task, start on the first
NEXT row. Never rebuild the picture from the tree, the ledger or a transcript.

## Resolve the task

First match wins: a bare number (`718`) · a task URL · nothing given → the
checkout binds it (branch name, worktree path or HEAD trailer carrying
`vt-<id>`). None → say which task you would need; never guess from titles.

## Read the pickup

`get {kind:"task", id, view: "pickup"}` — CLI `vitrinka task pickup <id|url>` (also
says whether the branch exists on origin; `--json` puts the pickup in
`data`). The reply is the pickup JSON plus `rendered`, rows WHAT · LAST ·
DONE · ON · BRANCH · BEFORE · READ · WHO · NEXT · SKIP; empty rows are
omitted, rows past the token cap are dropped whole and counted in SKIP.

Task ids are per-workspace. When the repo is bound to a workspace (the
binding line the session shows, or `vitrinka setup`), spell the id
`"<workspace>/<id>"` on `get {kind:"task"}` and on every id-only call that follows
(claim, `spot`, `hand_back`); a URL already names it in `/w/<workspace>/`.
A bare number lands in the connection's home workspace, which may be a
different team's task under the same number — say which workspace answered
and stop.

## Work from it, in this order

1. **BEFORE** is a stop, not a note: an open `blocks` link, a `waiting_on`
   field or a named prerequisite — say what waits on whom before touching
   code.
2. **READ** only the READ rows, each with `read_task_ref {id, ref}`. SKIP
   says what exists; it is not a reading list. Never `include: [events]`,
   never the done children, never a transcript until the pickup or the work
   says so.
3. **BRANCH**: continue on it when given; absent → a fresh worktree named
   `vt-<id>` so the hooks bind the session.
4. **Claim**: the SessionStart hook usually did (WHO lists you); otherwise
   `vitrinka task start <id>`. The run is how the team sees you on the plan.
5. **NEXT** is the work queue, not a menu: start on the first row nobody in
   WHO holds, by its own url, and keep going down the list until only rows
   that need the human remain (a merge they keep, a decision, an account or
   device only they hold). Never stop after one child; a decision the tree
   is waiting on is asked mid-flight, not filed as `Decide:` and left. Only
   the context window ends a sitting: a remainder bigger than it goes to a
   fresh session through its own pickup. An epic is never worked; its
   children are.

LAST empty means the task was never worked: WHAT, READ and NEXT are the whole
brief; the parent is one `get {kind:"task", id: parentId}` away. File what you learn
with the spot skill; the first hand-back (handoff skill) becomes the next
session's LAST.

## Never

- Never load the whole task (refs, comments, events, links, children)
  before the pickup says which.
- Never start on a task whose BEFORE names an open blocker without saying so.
- Never rebuild the branch from `git log` when BRANCH is given; never
  hand-compose a task URL — print the `url` the pickup returned.
