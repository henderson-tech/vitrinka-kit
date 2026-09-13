---
name: todo
disable-model-invocation: true
description: "Capture a personal todo in vitrinka — a task of type todo with its moment (milestone, trigger, due date), optional context companion and dependencies. Invoke as /vitrinka:todo FROM THE APP'S REPO; the CLI is `vitrinka me todo add`, the MCP twin `create_task {type:\"todo\"}`."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:todo — capture a todo

A todo is a task of type `todo` in the current repository's project, carrying
the seeded `moment` preset (`trigger · lead · every · context · commit ·
branch`). The CLI is the validated writer — never build the task by hand.
Related: `/vitrinka:todo-list`, `/vitrinka:todo-done`,
`/vitrinka:todo-milestone`, `/vitrinka:remind`.

## Choose the moment

Smallest shape preserving the ask:

- `--milestone <name>` — reusable named moment (`/vitrinka:todo-milestone`
  lists the existing ones; reuse an exact name before inventing one).
- `--trigger "<text>"` — one-off condition a future session judges.
- `--due YYYY-MM-DD` — soft deadline; may accompany a milestone or trigger.
- No moment flags — ordinary backlog.
- Precise time (`--at`/`--in`, a lead, a recurrence) → `/vitrinka:remind`.

Milestone and trigger are exclusive; `--at`/`--in` are exclusive with
milestone, trigger and due; `--lead`/`--every` need a date. The project comes
from the repo's mapping (`.vitrinka/project.json`, then the local registry);
run from the repository the todo concerns. Genuinely ambiguous timing,
priority or outcome → one concise batched question.

## Context companion

Use `--context-file <path>` (or `--context "<text>"`) when a session picking
this up weeks later would need non-obvious decisions, investigated evidence,
exact code pointers, or a clear first move. Skip for self-contained captures.
The companion is the `context` field; the list marks it `[ctx]`, `vitrinka
todo show <id>` prints it. Format:

```markdown
# Context: <title>

## Intent
<desired outcome and why>

## Insights & decisions
<facts learned and choices already made>

## Pointers
<files, symbols, issues, URLs>

## First step when picked up
<one concrete action and current confidence>
```

## Write

One command from the repository the todo concerns:

```bash
vitrinka me todo add <title words> \
  [--milestone <name> | --trigger "<text>"] [--due YYYY-MM-DD] \
  [--priority low|normal|high] [--depends <id,…>] \
  --body "<concise markdown body>" \
  [--context-file <path> | --context "<text>"]
```

`--depends` links the todo behind the ids it waits on (`blocks` links).
Without a shell, the MCP twin is `create_task {project, type: "todo", title,
body, dueAt, milestoneId, priority, fields: {trigger, context, commit,
branch}}` plus `create_task_link {rel: "blocks"}` per dependency.

Report the created todo id and title, project, moment, priority, and whether
a context companion was written.
