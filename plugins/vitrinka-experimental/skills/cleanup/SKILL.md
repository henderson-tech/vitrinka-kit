---
name: cleanup
description: "Use when a project's tasks need cleaning against reality — '/vitrinka-experimental:cleanup [project]', 'clean up the tasks', 'dedupe the backlog', 'fix the statuses against the code and PRs', 'close finished epics'. Claude Code only: it runs as a workflow."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka-experimental:cleanup — the task engine against reality

One unattended pass over a project's open tasks: inventory → group
(duplicates, contradicted statuses, orphans, epics, stale, ideas) → verify
every flag against the code, the PRs and the QA record → apply what is
proven → propose the rest → one report page. The human decides twice: the
trust level before the run, the proposals and drafts after it.

## Launch

```text
Workflow {name: "vitrinka-experimental:cleanup", args: {now: "<today, YYYY-MM-DD>", project?, trust?: "evidence" | "all" | "none", staleDays?: 45, focus?: "<prose>", types?: ["task", "bug", "story", "epic"], readers?: 2, reviewers?: 3, model?: "opus[1m]"}}
```

`now` is required — a workflow cannot read the clock; it stamps the scratch
dir `.vitrinka/cleanup/<stamp>/` and every "Cleanup <date>:" comment.
`project` defaults to the checkout's binding. `model` is the long-context
tier for Inventory, Group and Verify (falls back to `opus` when the account
lacks it); Apply and Report run on the session model.

Returns `{project, trust, before, after, applied, proposed, drafted,
refused, reportOnly, reportUrl, boardUrl}`; the closing message is
`reportUrl` with the counts, never a retelling of the page.

## Contracts

- **Trust is the standing decision.** `evidence` (default) applies only
  PROVEN corrections — a merged PR, a passing run, a commit trailer, the
  thing visibly there or gone — and files `likely` closes and merges as
  plan proposals; `all` applies likely too; `none` applies nothing and
  proposes every close and merge — the dry run. Every applied change lands
  ONE `create {kind: "comment", id, body}` on the task, "Cleanup <date>:
  <change> — <evidence>"; the comment is the record.
- **Doors only, nothing deleted.** A status is `bulk_update_tasks {ids,
  patch: {status}}` (per task `update {kind: "task", id, status}` when the
  grant refuses bare ids); a duplicate is `create {kind: "task_link", id,
  toTaskId, rel: "duplicates"}` plus `status: "cancelled"` — the survivor
  keeps the history; an orphan gets its `parentId`; an epic is refined
  through `fields` (partial merge) and closed `done` only when every child
  is done or cancelled AND the outcome is met. Judgment calls ride
  `propose_tasks {project, source: {kind: "eve:plan", ref: "cleanup:<stamp>",
  meta: {proposal: {op: "close" | "merge", target, into?, group?, reason}}},
  drafts}`; the verdict is `proposal_verdict {id, verdict}` — admin or agent
  token, so a member grant's refusals are listed for an admin in the report.
  New work rides `propose_tasks` with source `{kind: "cleanup", ref:
  "<stamp>"}` and keeps its dedupe verdict. A 409 on a proposal means the
  same change is already pending — a receipt, never a retry.
  pin: internal/web/intake_proposal_conflict_test.go#TestIntakeAPIAnswersPendingProposalWithVerdictDoor
  The pending ones read as `list {kind: "intake", project, group: "plan"}`
  (`"stale"` once their target moved on, `"cleanup"` for the drafts).
- **Scope.** Types task · bug · story · epic in groups backlog · unstarted ·
  started; `todo`, `qa`, `journey` and `meeting` are never touched; `focus`
  narrows in prose. The repo's standing override is
  `.claude/vitrinka-workflows.json` `cleanup: {staleDays, protectLabels}` —
  a protected label is never listed.
- **Determinism.** Two readers group the same inventory; a cluster only one
  saw is capped at likely; every action cites evidence a human can open
  (PR, commit, run id, file path, task id); the plan is plain code. A rerun
  the same day replays the cached stages (`resumeFromRunId`, same session),
  so `trust: "none"` first and `"evidence"` after reading the report costs
  one extra Apply, not a second inventory.
- **Undo is a door too**: a status with `update {kind: "task", id, status}`,
  a duplicate with `delete {kind: "task_link", id}` and a status, a proposal
  with `proposal_verdict {id, verdict: "decline"}`, a draft with
  `intake_verdict {id, verdict: "decline"}`.
