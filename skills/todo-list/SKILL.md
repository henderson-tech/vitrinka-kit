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
The session-start cue prints only the todos that FIRED ("Fired vitrinka
todos for this project"), never the open list — when a cue is in the
transcript, work those rows; list only when asked what else is open.

Ripeness is decided server-side (`ripe_todos {project, branch?, task?,
paths?}`): the clock, a reached milestone, and typed `when` conditions — a
PR merged, a release cut, a deploy marked, another todo done, the bound
task, a touched path. Pass what you know about the session (branch, task,
the paths you are editing) so those conditions can fire. Prose triggers
never fire on their own: judge them against the current work, and do not
claim every open item is ripe merely because it was listed. A prose todo
that names one of the typed moments is worth converting with `--when`.

`[ctx]` marks a handoff-grade context companion — before recommending or
working that item: `vitrinka me todo show <id>` (or `get_task`).

Present a compact list grouped by ripe now vs later; preserve exact ids and
titles so `/vitrinka:todo-done` can act on them.
