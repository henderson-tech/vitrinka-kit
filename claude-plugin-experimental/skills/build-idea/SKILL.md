---
name: build-idea
description: "Use when a committed feature brief should become a running feature and a draft PR with NO device pass — '/vitrinka-experimental:build-idea', 'exp build', 'build it and hand it to me'; the thorough device pass afterwards is the Exp test skill. Claude Code only: the build runs as a workflow."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka-experimental:build-idea — brief → running feature → one quick check → draft PR

The Exp build stops where the human should look first. It plans and
implements from the brief exactly like the core build, then does ONE quick
"does it work" check and hands over a running app and a draft PR. No device
matrix, no review loop, no code loop — those are `/vitrinka-experimental:test`,
run only when the human asks.

## Launch

The brainstorm is the core `brainstorming` skill (or `make-idea`); once the
brief is committed on the feature branch:

```text
Workflow {name: "vitrinka-experimental:build-idea", args: {brief: "<repo path>", task: <epic id>, project?: "<slug>", base?: "main"}}
```

`brief` and `task` are required. Nothing else is accepted: the build has no
`cap`, `severity` or `matrix` — a device pass is a separate decision.

## What the workflow does

1. **Plan** — reads the brief into ≤ 4 disjoint slices plus `shared`, the
   feature's `scope` (files + routes) and its main `journey`.
2. **Implement** — `shared` first, slices in parallel in ONE worktree, a sweep
   for what is left, then the repo's gates (tests, typecheck, build). A red
   gate is fixed once; still red is reported, never hidden.
3. **Quick check** — starts the app where the repo's run target says
   (`.claude/vitrinka-workflows.json` → `run.web`: `auto` picks the devbox when
   one resolves for the branch, else local), opens every changed route ONCE at
   1440×810, walks the main journey once, and publishes `<branch>-quick-check`:
   one section, one desktop shot per route, one works/broken verdict card per
   route. No reviewer agent, no findings — a broken route is named in the
   hand-back, not filed.
4. **Ship** — the `prm` skill opens a DRAFT PR (CI runs, nothing can merge).
5. **Hand-back** — the `handoff` skill's `hand_back` with the quick-check
   board, the running URL, the parked state and what to poke at; its `next`
   offers `/vitrinka-experimental:test` as the one step after the human has
   looked.

## Contracts

- **The human sees the feature before any device pass is spent.** A
  direction that is wrong costs the build, never a night of reviews.
- **The app stays running** after the hand-back when it runs locally; a
  devbox app is left on its workspace URL. The hand-back names the URL.
- **Scope is the brief's.** The implementers touch the plan's `scope`; a
  defect found outside it is spotted as a child task, never fixed here.
- **Core stays untouched.** `vitrinka:build-idea`, `review-loop` and
  `code-loop` are unchanged; the Exp flow reuses only core `vitrinka:map`
  (idea scope) and the core skills (`prm`, `handoff`).
- A run binds ONE task and ONE worktree; the workflow never asks mid-run —
  the completion notification is how this session learns the outcome.
