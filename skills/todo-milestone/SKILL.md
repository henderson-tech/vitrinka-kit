---
name: todo-milestone
disable-model-invocation: true
description: "Create or reach vitrinka milestones and surface the todos a reach ripens. Invoke as /vitrinka:todo-milestone [add|reach|list] FROM THE APP'S REPO; the CLI is `vitrinka me todo milestone`, the MCP twins `create_milestone`, `update_milestone {reached:true}`, `list_milestones`."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:todo-milestone — named moments

Milestones are the project's native milestones; a todo waiting on one ripens
the moment it is reached (`reachedAt`). They are per project — run from the
relevant repository.

Before creating, list existing milestones and reuse the exact existing name
when the moment already exists — a near-duplicate alias is a separate node
reaching only its own waiting todos:

```bash
vitrinka me todo milestone list
vitrinka me todo milestone add <name> [--due YYYY-MM-DD]
```

Reach: `vitrinka me todo milestone reach <name|id>` — it prints the todos it
ripened. Report them as now unblocked and never mark them done
automatically: reaching only makes their work ripe. A reach made by mistake
is undone with `vitrinka me todo milestone unreach <name|id>`.

Without a shell: `list_milestones {project}`, `create_milestone`,
`update_milestone {id, reached: true}` (then `ripe_todos {project}` for the
list).
