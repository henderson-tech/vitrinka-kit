---
name: make-idea
description: "Use when an idea should become merged work with the human in the loop only at the brainstorm and the merge — '/vitrinka:make-idea <idea>', 'make this idea', 'build this end to end'. Claude Code only: the build runs as the plugin's workflows."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka:make-idea — idea → terrain → brainstorm → build → PR

Three moves. The human decides twice: in the brainstorm and at the merge.
Everything between runs unattended as workflows; each workflow's completion
notification is the only way it reaches this session — it never asks
mid-run, so every decision it would need is settled here first.

## 1. Map the terrain

Workflow tool: `{name: "vitrinka:map", args: {scope: "idea", requirements:
"<the idea as given>", project, task?}}`. In a big project an idea almost
always builds on something that exists; the terrain names the routes,
doors, components and tests it touches, the **extend points** to build on,
the **duplication risks** (what the idea would re-implement) and the
**open questions**. Wait for the notification; the terrain artifact url is
in its result.

## 2. Brainstorm — the brainstorming skill, terrain in hand

Run the brainstorming skill as it stands. The terrain is the As-is; its
open questions are round-one forks; every duplication risk becomes a
decision (extend or replace — never silently both). It ends with the epic,
the decision log and the committed `<topic>-brief.md`. No brief, no build.

## 3. Build

Workflow tool: `{name: "vitrinka:build-idea", args: {brief: "<repo-relative
brief path>", task: "<epic or story id>", project?, cap?: 3, severity?:
"minor", matrix?}}`. It plans the brief into disjoint slices, implements
them sequentially in the worktree, gates, runs `vitrinka:review-loop`
(shoot every route on every device, review, fix, reshoot until clean or
cap), then `vitrinka:code-loop` (native code review with fixes, the PR
through `prm --once`) and hands the task back.

The build returns `next: {name, args}` between implement → verify → ship,
and between review passes. Launch each returned continuation unchanged,
without asking the human to nudge it. Each new run gets up to ten agents;
children share that run's allowance. A continuation contains the state
and expected Git revision. If that revision changed outside the loop,
verify the current branch afresh instead of reusing the old evidence.
A code-review fix triggers another UI verification before hand-back.

An interrupted run resumes with `resumeFromRunId` in the SAME Claude
session (or its `claude --resume` restoration); runtime replay reuses the
unchanged prefix of completed agent calls. A fresh session cannot replay
that journal: use a returned continuation, or the ui-loop pass files, and
reverify stale evidence. Never invent missing state.

Only the terminal result's `receipt.status: "complete"` means the build
was verified. `incomplete` names blockers, including missing coverage,
failed gates and fixes not reshot before the cap. Print its hand-back
verbatim, preserve these blockers, and drive the PR review inline through
prm in this session; a workflow agent does not wait on CI or review bots.

## Contracts

- A worktree exists before step 1; the workflows run in this session's
  checkout and start apps where the repo's CLAUDE.md says.
- `cap` is passes (1–6), `severity` the lowest defect level the loop
  accepts and fixes on its own (`blocker` · `major` · `minor`); anything
  below stays staged on the board for the human. Suggestions are never
  auto-accepted.
- The device matrix and review checklist default per project type (web:
  iPhone, iPad, desktop; expo: iOS + Android simulators). A repo overrides
  them in `.claude/vitrinka-workflows.json` (`projectType`, `matrix`,
  `checklist`, `exclude`, `board`, `baseUrl`) — never in the invocation.
  The same file's `run: {web: "auto" | "devbox" | "local"}` is the run
  target the Exp flows (`vitrinka-experimental:*`) honour: `auto` starts the
  app on the branch's devbox when one resolves, else locally; simulators
  always run locally.
- Standalone use: `vitrinka:review-loop` alone is a responsivity/UX pass
  over an existing surface (`args.scope` names what to focus on);
  `vitrinka:code-loop` alone reviews and PRs a finished branch.
- Codex has no workflow runtime: run step 1's exploration inline, finish
  step 2, and hand the brief to a Claude Code session for step 3.
