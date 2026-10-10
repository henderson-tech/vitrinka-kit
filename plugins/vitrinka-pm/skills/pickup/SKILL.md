---
name: pickup
description: "Use when a vitrinka task id or URL arrives in the prompt, or '/pickup <id|url>' is invoked, to start work in a fresh session; ending work is handoff, filing what you will not do here is spot."
metadata:
  vitrinka-contract: "2026-09-15"
---

# pickup — start where the last session stopped

The task IS the handoff: the server composes ONE bounded pickup view and
counts what it did not load. Read it, claim the task, start on the first
NEXT row. Never rebuild the picture from the tree, the ledger or a transcript.

## Resolve the task

First match wins: a bare number (`718`) · a task URL · nothing given → the
checkout binds it (branch name, worktree path or HEAD trailer carrying
`vt-<id>`). None → say which task you would need; never guess from titles.

Task ids are per-workspace. Spell the id `"<workspace>/<id>"` on
`get {kind:"task"}` and on every id-only call that follows (`hand_back`,
`spot`, `update`, `read_task_ref`), or pass `workspace` beside a bare id; a
URL already names it in `/w/<workspace>/`. A bare number lands in the
connection's default workspace — the one the registration names and the
SessionStart binding line shows (`vitrinka config bind` changes it) — which
may be another team's task under the same number: say which workspace
answered and stop.

## Read the pickup

`get {kind:"task", id, view:"pickup"}` — CLI `vitrinka task pickup [id|url]`
(also says whether the branch exists on origin; `--json` puts the pickup in
`data`). The reply is the pickup plus `rendered`, rows WHAT · LAST · DONE ·
ON · BRANCH · LINKS · BEFORE · READ · WHO · NEXT · SKIP; empty rows are
omitted, rows past the token cap are dropped whole and counted in SKIP.
LINKS names the issue the task tracks and the pages it refers to — open one
only when the work needs it; the pickup never fetches them.

## Work from it, in this order

1. **BEFORE** is a stop, not a note: an open `human` or `date` gate (who
   resolves it, or when), an open `blocks` link, a `waiting_on` field or a
   named prerequisite — say what waits on whom before touching code.
2. **READ** only the READ rows, each with `read_task_ref {id, ref}`. SKIP
   says what exists; it is not a reading list. Never `include: ["events"]`,
   never the done children, never a transcript until the pickup or the work
   says so.
3. **BRANCH**: continue on it when given; absent → a fresh worktree named
   `vt-<id>` so the hooks bind the session.
4. **Claim**: the SessionStart hook usually did (WHO lists you); otherwise
   `vitrinka task start [id]`. The run is how the team sees you on the plan.
5. **NEXT** is the work queue, not a menu: the task's open steps first, then
   its children. A step (a `☐` row, no id of its own) is worked HERE and
   ticked when done — `update {kind:"task", id, fields: {gates: [...]}}`
   with `done: true` and its `evidence`; a step that outgrows one sitting is
   promoted with `spot {fromStep}` (the spot skill), never retyped by hand.
   A step row's tail says when: `waiting — <cond>` is not due yet (leave
   it), `due — <cond>` fell due and is still undone; a BEFORE gate reading
   `when <cond>` closes itself. A child row is taken by its own `url`, and
   you keep going down the list until only rows that need the human remain
   (a merge they keep, a decision, an account or device only they hold).
   Never stop after one child; a decision the tree is waiting on is asked
   mid-flight, never filed as `Decide:` and left. Only the context window
   ends a sitting: a remainder bigger than it goes to a fresh session
   through its own pickup (the handoff skill launches it). An epic is
   never worked; its children are.

LAST empty means the task was never worked: WHAT, READ and NEXT are the
whole brief; the parent is one `get {kind:"task", id: parentId}` away. The
first hand-back (handoff skill) becomes the next session's LAST.

## The hooks

Claude Code gets the work loop from the vitrinka-pm plugin's own hooks
(`hooks/hooks.json`, each running `vitrinka hook-context <verb>` from
PATH): SessionStart `start` binds this session to the checkout's `vt-<id>`
as a live run and prints the binding line, the pickup and the todo and
schedule cues (cues on a real start only, never on a resume); PreToolUse
`touch` fires `path` todo conditions on the file being edited, offline;
SessionEnd `task-end` ends the run with what git knows; Stop `stop` is the
hand-back gate (handoff skill). Codex has no plugin hooks: `vitrinka setup`
writes the same set into `$CODEX_HOME/hooks.json`, trusted once in
`/hooks`. `vitrinka doctor` shows both rows and the repair.

## Never

- Never load the whole task (refs, comments, events, links, children)
  before the pickup says which.
- Never start on a task whose BEFORE names an open blocker without saying so.
- Never rebuild the branch from `git log` when BRANCH is given; never
  hand-compose a task URL — print the `url` the pickup returned.
