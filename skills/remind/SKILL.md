---
name: remind
disable-model-invocation: true
description: "Schedule a vitrinka reminder — a todo with a clock, optionally recurring — and manage the series (list, ripe, move, skip, end). Invoke as /vitrinka:remind FROM THE APP'S REPO; the CLI is `vitrinka me schedule add`, the MCP twin `create_task {type:\"todo\", dueAt, fields:{lead, every}}`."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:remind — a todo with a clock

A reminder is an ordinary todo with a clock: `at` (the task's `dueAt`) = the
actual event/deadline; `lead` = how early it becomes ripe. Untimed capture →
`/vitrinka:todo`. The skill is `/vitrinka:remind`, not `/schedule` (that name
is reserved by Claude Code); the CLI verb is `vitrinka me schedule add`.

## Create

Prefer relative input when the user phrases the moment relatively:

```bash
vitrinka me schedule add <title words> \
  (--in 24h | --at 2026-09-12T09:00:00+02:00) [--lead 4h] \
  [--every 90d] [--priority low|normal|high] \
  --body "<what must happen and where>" \
  [--context-file <path> | --context "<text>"]
```

- Durations: `30m · 4h · 3d · 2w · 1y` — `--lead` compounds (`1d4h`),
  `--every` is one segment.
- `--at` is RFC 3339; convert "tomorrow 09:00" yourself, in the user's zone.
- The current repository determines the project; a reminder that belongs
  elsewhere is scheduled from that repo.
- `--context-file` with the `/vitrinka:todo` context template when the future
  work needs non-obvious decisions or pointers.

## Manage

```bash
vitrinka me schedule list [--all]
vitrinka me schedule ripe [--compact] [--all]
vitrinka me schedule move <id> (--in 3d | --at <RFC3339>)
vitrinka me schedule skip <id>
vitrinka me schedule end <id>
vitrinka me todo done <id>
```

`done` closes a one-off; on a recurrence it records the completion and rolls
`dueAt` forward from the previous `dueAt` (at least once, then until it is in
the future) — the todo stays open. `skip` advances one occurrence without
claiming completion; `end` completes the series. `ripe --claim` is the
SessionStart hook's own call (it marks the announcement in the local cooldown
ledger) — do not run it by hand.

A reminder the SessionStart hook injected ("Scheduled vitrinka todos that are
RIPE now — ALL projects") is already claimed for this session — act on it or
surface it clearly; silently ignoring it suppresses its next delivery for the
claim cooldown. Overdue ones re-announce sooner than merely ripe ones.
