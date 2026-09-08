---
name: annotations
description: "Fallback drain: pull this board's (or repo+branch's) annotation work directly over MCP when the normal dispatch didn't arrive. One-shot — drain, work the items, done; arms no listener. Invoke as /vitrinka:annotations [board-slug] FROM THE APP'S REPO; continuous servicing is /vitrinka:listen."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:annotations — manual MCP drain (dispatch fallback)

The user hit "Send to Claude" (or expected you to be woken) and nothing
happened. Don't diagnose the transport — just fetch the work directly over MCP
and do it. This is a ONE-SHOT drain, not a listener: you do not arm
`vitrinka watch` here.

Argument: an optional board slug (`/vitrinka:annotations acme-audit`).
Without one, auto-scope to this repo + branch exactly like `/vitrinka:listen`
does (project = main worktree name, branch = current git branch).

## Drain

1. Call `wait_for_work({ board, timeoutSec: 1 })` — or
   `{ project, branch, timeoutSec: 1 }` for the auto-scope — and loop until it
   returns `{"idle":true}`. Each call returns ready-to-act capsules in `work[]`
   plus any answered board questions in `choices[]`.
2. **NEVER call it (or `list_work`) unscoped** — the global firehose contains
   other sessions' work; acting on it steals from their queues.
3. If `wait_for_work` itself errors, fall back to
   `list_work({ board, status: "open" })` (same scoping) and `get_annotation`
   per item you actually need enriched.
4. Only `open` items are yours. `staged` = the user hasn't sent them — never
   work those. `working` = another live session's claim; `resolved`/`in_review`
   = history.

## Act

- `work[]` items: work them serially, oldest first, under the per-item rules of
  `/vitrinka:listen` (fix in THIS repo, attach proof, reply, hand back
  `in_review`; `reshoot` = re-capture only, no code changes).
- `choices[]` items: answered questions — record the decision (answer + `note`)
  per the brainstorming skill; they are not code-fix items. They're delivered
  exactly once, so act in this turn — if lost, `/vitrinka:answers` re-reads the
  durable record.
- A large backlog (dozens of items, repeated themes) deserves the
  `/vitrinka:resolve` treatment — group into functional blocks instead of
  one-by-one fixes.
- Defects you notice that nobody annotated are NOT yours to fix here — file
  them with `annotate` (`get_card_image` per screen, one batch with keys and
  regions) so they wait `staged` for the user's Accept; docs topic
  `annotation`.

When the drain comes up `{"idle":true}` on the first call, say so plainly —
the queue is empty; the dispatch the user expected either never staged or was
already claimed. Suggest re-arming the listener with `/vitrinka:listen` if
they want continuous servicing back.
