---
name: pickup
description: "Pick up a vitrinka task or epic from a fresh session — read its server-composed pickup (last hand-back, branch, what to read first, what to do next, what NOT to load), claim it, start on NEXT. Use when a task id or URL arrives in the prompt or `/vitrinka:pickup <id|url>` is invoked; ending work is the handoff skill."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:pickup — start where the last session stopped

The task IS the handoff. A fresh session never rebuilds the picture from the
tree, the ledger or a transcript: the server composes ONE bounded pickup view
that says what the task is about, what the last hand-back left, which branch
exists, what to read first, who is on it, and what to do next — in rank
order — and counts what it deliberately did not load. Read that, claim the
task, start on the first NEXT row.

## Resolve the task

In this order, the first that matches wins:

1. a bare number — `718`;
2. a task URL — `…/p/acme?task=718` or `…/t/718`;
3. nothing given — the checkout binds it: the branch name, the worktree
   path or the HEAD commit trailer carrying `vt-<id>`.

None of those → say which task you would need; never guess from titles.

## Read the pickup

`get_task {id, view: "pickup"}` (CLI: `vitrinka task pickup <id|url>`,
which also marks whether the branch exists on origin). The answer is the
pickup JSON plus `rendered`, a dense text block:

```text
pickup #718 · Checkout as one guided flow · epic · in_progress
WHAT   <the epic's outcome, else the body's first line>
LAST   <when> · by <who> · <the last hand-back's summary>
DONE   <what that hand-back finished>
ON     <surfaces it opened — APIs, components> — <where to build on>
BRANCH <branch> · worktree <path>
BEFORE <what must be true first> [#id status] · …
READ   <kind> v<n> <filename> — <hint>          (one line each)
WHO    <actor> since <relative>                  (live runs)
NEXT   #id <title> [type] — <url>                (open children, rank order)
SKIP   17 done children · 42 events · 3 attachments — not loaded
```

Rows the server had nothing for are omitted; rows past the token cap are
dropped whole and counted in SKIP, never truncated.

## Work from it — in this order

1. **BEFORE** first. An open `blocks` link, a `waiting_on` field or a
   prerequisite the last hand-back named is a stop, not a note: say what is
   waiting and on whom before touching code.
2. **READ** only what the READ rows name: `read_task_ref {id, ref}` for
   each — that is the decision log, the plan, the latest hand-back, the
   refs someone flagged read-first. Nothing else. Never `include:[events]`,
   never `include:[children]` for the done ones, never a transcript,
   until the pickup — or the work itself — says you need it. SKIP tells
   you what exists; it is not a reading list.
3. **BRANCH**: continue on it when it exists (worktree path given, on
   origin per the CLI line). Absent → a fresh worktree named `vt-<id>`
   so the hooks bind the session.
4. **Claim it**: the SessionStart hook usually did — WHO lists your own
   session then. Otherwise `vitrinka task start <id>` (or `POST
   /tasks/{id}/runs`); the run is how the team sees you on the plan and
   what moves the status to in progress.
5. **NEXT**: take the first row that nobody in WHO holds; it carries the
   child's own url. Pick a child up with its own pickup when it is more
   than one sitting's work. On an epic the NEXT rows are its children —
   the epic itself is never "worked", its children are.

## When LAST is empty

No hand-back yet — the task was filed, planned or brainstormed but never
worked. Then WHAT, READ (the decision log, if any) and NEXT are the whole
brief; the parent, when there is one, is one `get_task {id: parentId}`
away. Do not read further down the tree to compensate; file what you
learn as you go (the spot skill) and the first hand-back (the handoff
skill) becomes the LAST the next session reads.

## Never

- Never load the whole task — refs, comments, events, links, children —
  before the pickup says which.
- Never start on a task whose BEFORE names an open blocker without saying
  so.
- Never rebuild the branch from `git log` when BRANCH is given; never
  hand-compose a task URL — print the `url` the pickup returned.
