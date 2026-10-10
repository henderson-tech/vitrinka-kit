---
name: me
disable-model-invocation: true
description: "Use for personal todos, reminders, milestones and the agenda in vitrinka — '/me [add|list|done|drop|remind|milestone|agenda]', 'remind me', 'add a todo', 'what is ripe', 'add to today's todos <task>', 'plan X for tomorrow', 'what's on my agenda'."
metadata:
  vitrinka-contract: "2026-09-15"
---

# me — todos, reminders, milestones, agenda

A todo is a task of type `todo` in the current repository's project with the
`moment` preset (`trigger · lead · every · context · commit · branch`). The
CLI is the validated writer: `vitrinka me todo|schedule|agenda --help` and
each verb's `--help` carry the flags. Without a shell the MCP twins are
`create {kind:"task", type:"todo"}`, `list {kind:"task", f:{types:["todo"]}}`,
`ripe_todos`, `complete_todo`, `create|list|update {kind:"milestone"}`
(`reached: true` marks one) and `create|list|update|delete {kind:"agenda"}`.
Ids are per-workspace: `"<workspace>/<id>"` on every id-only call.

## Contracts the verbs do not print

- **Ripeness is the server's call.** `ripe_todos {project?, branch?, task?,
  paths?}` (CLI `vitrinka me schedule ripe --compact`) decides: the clock, a
  reached milestone, and typed `when` conditions — `pr 472 merged|closed`,
  `release cut|next`, `deployed prod [<sha>]`, `path internal/billing/**`,
  `task 423`, `after 331`. Pass what you know so those fire. Prose
  `--trigger` text never fires on its own: judge it against the current
  work, never call every listed item ripe. A prose todo naming a typed
  moment is worth converting: `vitrinka me todo backfill --dry-run` proposes
  `when` conditions for the project's prose todos, each needing a human
  verdict.
- **Choose the smallest moment**: `--milestone <name>` (an exact existing
  name from `me todo milestone list` — a new spelling creates a separate
  node) · `--when "<condition>"` · `--trigger "<text>"` · `--due
  YYYY-MM-DD` · none = backlog. A precise time (`--at`/`--in`, `--lead`,
  `--every`) is a reminder: `vitrinka me schedule add` — the skill form is
  `/me remind`, never `/schedule` (reserved by Claude Code). Milestone and
  trigger are exclusive; `--at`/`--in` exclude milestone, trigger and due;
  `--lead`/`--every` need a time.
- **Context companion** (`--context-file <path>` | `--context "<text>"`)
  only when a session weeks later needs non-obvious decisions, evidence or
  the first move: `# Context: <title>` · `## Intent` · `## Insights &
  decisions` · `## Pointers` · `## First step when picked up`. The list
  marks it `[ctx]`; read it (`vitrinka me todo show <id>`) before working
  the item; it is never deleted.
- **Closing**: `me todo done <id>` / `complete_todo` completes; `me todo
  drop <id>` abandons. A recurring reminder stays open on `done` (the
  completion is recorded and `dueAt` rolls forward); `me schedule skip <id>`
  advances one occurrence, `me schedule end <id>` completes the series. A
  todo the SessionStart cue listed and you finished this session is closed
  the same way, never left for the next session.
- **The SessionStart cue** prints only todos that FIRED — work those rows;
  list only when asked what else is open. A cue-injected reminder is already
  claimed for this session: act on it or surface it; `me schedule ripe
  --claim` is the hook's own call, never run by hand.
- **Reaching a milestone** (`me todo milestone reach <name|id>`, `update
  {kind:"milestone", reached: true}`) prints the todos it ripened — report
  them as unblocked, never mark them done; `unreach` (`reached: false`)
  undoes a mistake.
- **The agenda plans EXISTING tasks on a person's days.** "Add to today's
  todos <task>" or "plan X for tomorrow" with an existing task (its url,
  `<workspace>/<id>` or id) is `create {kind:"agenda", task, day}` (CLI
  `vitrinka me agenda add <task> [--tomorrow|--on <day>] [--at HH:MM --for
  90m]`) — never a new todo, never a move of its `dueAt` (the team's
  deadline). A new free-text item becomes a todo task first, then is
  planned. Day words: today · tomorrow · yesterday · a weekday ·
  YYYY-MM-DD, resolved by the server in the person's zone. Repeating a plan
  answers or moves the one open item; an open item from an earlier day
  floats onto today by itself — never re-plan it. A tick (`update
  {kind:"agenda", id, done: true}`, `me agenda done <item>`) closes the item
  only; the task's state never moves — except a todo's: the tick completes
  it in the same write (a repeating one advances to its next occurrence).
  "What's on my agenda" is `list {kind:"agenda"}` (`vitrinka me agenda
  [week]`); the SessionStart cue's "Today on your agenda" rows are the plan
  for this session.
- Resolve a title reference against `me todo list --compact` (`--all`
  across projects); one clear match acts, several ask. Report the id, exact
  title and resulting state.
