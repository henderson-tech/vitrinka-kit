---
name: todo-list
disable-model-invocation: true
description: "List open vitrinka todos for this repo's project (or all projects) and judge which are ripe now. Invoke as /vitrinka:todo-list [all] FROM THE APP'S REPO; the CLI is `vitrinka me todo list`, the MCP twins `list_tasks {types:[\"todo\"]}` and `ripe_todos`."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:todo-list — what is open, what is ripe

Current repo (the CLI resolves the project from the repo mapping):
`vitrinka me todo list --here --compact`. User says `all` → `--all`. `--json`
only when structured detail is needed. Without a shell: `list_tasks
{project, types: ["todo"]}` and `ripe_todos {project?}`.

The compact line is `- #<id> <title> [ctx] [<project>] — <when> (high)`.
The SessionStart hook already printed the same lines under "Open vitrinka
todos for this project" — when they are in the transcript, judge them rather
than listing again.

Judge free-text triggers, milestones and due dates against the current work;
do not claim every open item is ripe merely because it was listed. Ripeness
by clock or by a reached milestone is computed server-side (`ripe_todos`);
trigger-only todos are yours to judge.

`[ctx]` marks a handoff-grade context companion — before recommending or
working that item: `vitrinka me todo show <id>` (or `get_task`).

Present a compact list grouped by ripe now vs later; preserve exact ids and
titles so `/vitrinka:todo-done` can act on them.
