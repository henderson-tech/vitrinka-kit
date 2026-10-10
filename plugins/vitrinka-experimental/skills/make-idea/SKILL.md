---
name: make-idea
description: "Use when an idea should become a running feature and a draft PR, deciding only at the brainstorm and the look — '/vitrinka-experimental:make-idea <idea>', 'make this idea', 'build this end to end'. Claude Code only, as workflows."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka-experimental:make-idea — idea → terrain → brainstorm → build → look

Three moves. The human decides at the brainstorm and again when the
feature is in front of them; everything between runs as workflows whose
completion notification is the only way they reach this session — settle
every decision they would need here first, they never ask mid-run.

## 1. Map the terrain

Workflow tool: `{name: "vitrinka:map", args: {scope: "idea", requirements:
"<the idea as given>", project, task?}}`. In a big project an idea builds on
something that exists: the terrain names the routes, doors, components and
tests it touches, the **extend points**, the **duplication risks** (what the
idea would re-implement) and the **open questions**, as one artifact whose
url is in the result.

## 2. Brainstorm — `vitrinka:brainstorming`, terrain in hand

The terrain is the As-is; its open questions are round-one forks; every
duplication risk becomes a decision (extend or replace — never silently
both). It ends with the epic, the decision log and the committed
`<topic>-brief.md`. No brief, no build.

## 3. Build — `vitrinka-experimental:build-idea`

Workflow tool: `{name: "vitrinka-experimental:build-idea", args: {brief:
"<repo-relative brief path>", task: "<epic or story id>", project?, base?:
"main"}}`. It plans the brief into ≤ 4 disjoint slices, implements them in
this worktree, runs the repo's gates, does ONE quick "does it work" check
(every changed route once at desktop, the main journey once, published as
`<branch>-quick-check`), opens a DRAFT PR through `prm` and hands the task
back through `vitrinka-pm:handoff` with the running app url, the parked
state and what to poke at. No device matrix, no review loop, no code loop:
`cap`, `severity`, `matrix` and `lanes` are refused — a device pass is not
a build decision.

The result is `{plan, gate, app, board, routes, journey, pr, handback}`;
print `handback` verbatim. Its `next` is the human's: look at the feature,
then `/vitrinka-experimental:test` chooses the device pass. The PR stays a
draft until that run — or the human — marks it ready; nothing here merges.

## Contracts

- A worktree exists before step 1; the workflows run in this session's
  checkout and start the app where `.claude/vitrinka-workflows.json`
  `run.web` says (`auto` | `devbox` | `local`; `auto` takes the branch's
  devbox when one resolves, else local).
- A red implementation gate is repaired once and otherwise reported in the
  hand-back, never hidden; a broken route is a fact in its summary, an
  off-scope defect a spotted child.
- An interrupted run resumes with `resumeFromRunId` in the SAME session;
  a fresh session relaunches step 3 from the committed brief.
- A brief that already exists skips to step 3; `vitrinka:map` alone
  refreshes the terrain.
- Opt-in: `vitrinka setup --experimental` or `vitrinka setup modules
  enable experimental`.
