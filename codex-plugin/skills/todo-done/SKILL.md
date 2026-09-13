---
name: todo-done
disable-model-invocation: true
description: "Mark a vitrinka me todo done or dropped. Invoke as /vitrinka:todo-done <id|title> FROM THE APP'S REPO; the CLI is `vitrinka me todo done|drop`, the MCP twin `complete_todo`."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:todo-done — close a todo

Resolve the reference against open todos: `vitrinka me todo list --compact`
(`--all` when it may live in another project). An id is exact; a title with
exactly one clear match → use its id; multiple plausible → ask which. The
`[ctx]` companion is never deleted — it stays as history on the task.

- Completed: `vitrinka me todo done <id>` (MCP: `complete_todo {id}`)
- Abandoned / no longer applicable: `vitrinka me todo drop <id>`

A recurring scheduled todo stays open when marked done — the engine records
the completion in the task ledger and rolls `dueAt` to the next occurrence;
use `/vitrinka:remind` management (`schedule skip|end`) to skip or end the
series. A todo the SessionStart hook listed and you finished in this session
is closed the same way — never leave it open for the next session to re-read.

Report the id, exact title and resulting state.
