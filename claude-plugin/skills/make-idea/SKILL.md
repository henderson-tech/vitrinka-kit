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
them in the worktree, gates, runs `vitrinka:map` + `vitrinka:review-loop`
(shoot every route on every device, review, fix, reshoot until clean or
cap), then `vitrinka:code-loop` (native code review with fixes, the PR
through prm) and hands the task back. The notification's result carries
the rendered hand-back block: print it verbatim as the closing message.

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
- Standalone use: `vitrinka:review-loop` alone is a responsivity/UX pass
  over an existing surface (`args.scope` names what to focus on);
  `vitrinka:code-loop` alone reviews and PRs a finished branch.
- Codex has no workflow runtime: run step 1's exploration inline, finish
  step 2, and hand the brief to a Claude Code session for step 3.
