---
name: cleanup
description: "Use when a project's tasks need cleaning against reality — '/vitrinka:cleanup [project]', 'clean up the tasks', 'dedupe the backlog', 'fix the task statuses against the code and PRs', 'close finished epics'. Claude Code runs the plugin's cleanup workflow; Codex runs the same stages inline."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka:cleanup — the task engine against reality

One unattended pass over a project's open tasks: inventory → group
(duplicates, contradicted statuses, orphans, epics, stale) → verify every
flag against the code, the PRs and the QA record → apply what is proven →
propose the rest → one report page. The human decides twice: the trust
level before the run, the proposals and drafts after it.

## Launch (Claude Code)

Workflow tool: `{name: "vitrinka:cleanup", args: {now: "<today,
YYYY-MM-DD>", project?, trust?: "evidence", staleDays?: 45, focus?:
"<prose>", types?: ["task", "bug", "story", "epic"], model?: "opus[1m]"}}`.
`now` is required — a workflow cannot read the clock. `model` is the
long-context tier for the inventory, grouping and verification stages
(default the 1M-context Opus; the run falls back to plain `opus` when that
tier is not available to the account). Wait for the completion notification; the
closing message is its `reportUrl` with the counts (applied · proposed ·
drafted · report-only), never a chat retelling of the page.

## Contracts

- **Trust is the standing decision.** `evidence` (default): only PROVEN
  corrections are applied — a merged PR, a passing run, a commit trailer,
  the thing visibly there or gone; `likely` closes and merges land as plan
  proposals; everything else is report-only. `all`: likely is applied too.
  `none`: nothing is applied, proven and likely closes/merges become
  proposals — the dry run. Every applied change lands ONE comment on the
  task, "Cleanup <date>: <change> — <evidence>"; the comment is the record
  and the task event follows by itself.
- **Doors only, nothing deleted.** Statuses through `bulk_update_tasks` /
  `update {kind: "task"}`; a duplicate is `create_task_link {rel:
  "duplicates"}` plus `cancelled` — the survivor keeps the history; an
  orphan gets its `parentId`; an epic is refined through the feature preset
  (`ledger_state · next_action · waiting_on`) and closed with `status:
  "done"` only when every child is done or cancelled AND the outcome is
  met. Judgment calls ride the intake door as plan proposals —
  `propose_tasks` with source `{kind: "eve:plan", ref: "cleanup:<stamp>",
  meta: {proposal: {op: close | merge, target, into?, group?, reason}}}`,
  the human's verdict is `proposal_verdict`; new work ("we should really do
  this") rides as intake drafts with source `{kind: "cleanup"}` and keeps
  its dedupe verdict. A 409 on a proposal means the same change is already
  pending — a receipt, never a retry.
- **Scope.** Types task · bug · story · epic in groups backlog · unstarted ·
  started. `todo` (the me skill's), `qa`, `journey` and `meeting` are never
  touched. `focus` narrows in prose. The repo's standing override is
  `.claude/vitrinka-workflows.json` `cleanup: {staleDays, protectLabels}` —
  a protected label is never listed.
- **Determinism.** Two independent readers group the same inventory; a
  cluster only one of them saw is capped at likely; every verifier action
  cites evidence a human can open (PR ref, commit, run id, file path, task
  id); the plan is plain code. A rerun the same day replays the cached
  stages (`resumeFromRunId`), so `trust: "none"` first and `"evidence"`
  after reading the report costs one extra Apply, not a second inventory.
- **Undo is a door too**: a status is corrected with `update {kind: "task",
  status}`, a duplicate with `delete_task_link` and a status, a proposal or
  a draft with its decline.

## Codex

No workflow runtime: run the stages inline in this order with the same
contracts — page every open task into `.vitrinka/cleanup/<date>/inventory.json`
(`list {kind: "task", fields: "full"}`, the done set beside it), group,
verify each flag against the task's refs, `git log --all --grep vt-<id>`,
`gh pr list --search vt-<id>` and the QA record, apply the proven through
the doors above, propose the rest, and author the report page through the
artifact skill.
