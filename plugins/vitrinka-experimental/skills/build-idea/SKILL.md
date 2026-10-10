---
name: build-idea
description: "Use when a committed brief should become a running feature and a draft PR with no device pass — '/vitrinka-experimental:build-idea', 'build it and hand it to me'; the device pass afterwards is test. Claude Code only, as a workflow."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka-experimental:build-idea — brief → running feature → one quick check → draft PR

THE build-idea: it stops where the human should look first. It plans and
implements from the brief, gates, does ONE quick "does it work" check and
hands over a running app and a draft PR. No device matrix, no review loop,
no code loop — those are `/vitrinka-experimental:test`, a separate decision
once the human has looked.

## Launch

The brief comes out of `vitrinka:brainstorming` (or `make-idea`), committed
on the feature branch:

```text
Workflow {name: "vitrinka-experimental:build-idea", args: {brief: "<repo-relative path>", task: "<epic or story id>", project?: "<slug>", base?: "main"}}
```

`brief` and `task` are required; `cap`, `severity`, `matrix` and `lanes`
are refused. Wait for the completion notification — the workflow never
asks mid-run.

## Phases

1. **Plan** — the brief into ≤ 4 disjoint slices plus `shared`, the
   feature's scope files, its routes and the ONE main journey.
2. **Implement** — `shared` first, slices in parallel in THIS worktree, a
   sweep for what they left, then the repo's gates. A red gate is repaired
   once; still red is reported, never hidden.
3. **Quick check** — starts the app where the run target says, opens every
   changed route once at 1440×810@2, walks the journey once and publishes
   `<branch>-quick-check`: one section, a shot and a works/broken card per
   route, a summary card. No reviewer, no findings.
4. **Ship** — `prm` opens a DRAFT PR; `vitrinka-pm:handoff` (`hand_back`)
   closes the run with the board, the app url, the parked state and what to
   poke at; `next` holds two steps: look, then `/vitrinka-experimental:test`.

Returns `{plan, gate, app, board, routes, journey, pr, handback}` — print
`handback` verbatim.

## Contracts

- **The human sees the feature before any device pass is spent.** The PR
  stays a draft; nothing marks it ready or merges.
- **The app stays running** after the hand-back — locally, or on its devbox
  workspace url. `.claude/vitrinka-workflows.json` `run.web` (`auto` |
  `devbox` | `local`) decides; `auto` takes the branch's devbox when one
  resolves. No app url means the quick check is skipped and the hand-back
  says so.
- **Scope is the brief's.** Implementers touch the plan's files; an
  off-scope defect is a `left` item the hand-back spots as a child, never a
  fix here. A broken route is a fact in the summary, not a child.
- A run binds ONE task and ONE worktree, which exists before launch.
