---
name: qa
description: "Use for vitrinka QA from the app's repo — 'user test this', 'QA this like a user', 'run the tests and publish' (qa usertest); 'review the board', 'review this journey', 'have Eve review it' (qa review); 'process the session', 'pending sessions', 'vitrinka qa session archive|continue' (qa sessions)."
metadata:
  vitrinka-contract: "2026-09-15"
---

# qa

Modes: `qa usertest` tests like a user; `qa review [board] [journey] [eve]` files findings on a board; `qa sessions [board|id] [fix|test]` turns recorded sessions into fixes and tests. Run every mode from the app's repo.

## Every mode

- Locate a finding in the code before you report it as real.
- Leave the app running and hand-testable; say which state it is parked in.
- Print hand-back blocks and links exactly as returned; never compose or shorten a link.
- On a bound task finish with `work handoff`.

## qa usertest

- Runner lane: `vitrinka qa run -- <test command>` runs the command verbatim and publishes what it left (declared runners, else a `usertest-run-<id>.json` manifest, JUnit XML, Playwright JSON, `allure-results/`, wdio reports) as ONE run on the plan.
- Target: `--task <id>`, else the checkout's `vt-<id>`, else the project's rolling **Unplanned runs** epic; the same run id republished replaces its cards; a plan waiting on its reviewer answers 409.
- Never require a reporter, plugin or test change: JUnit alone covers Selenium, Cypress, Maestro, Detox, Jest, Go and home-grown harnesses.
- Shots reach the board when the runner writes them (Playwright `screenshot: "on"`, allure png) or through `VITRINKA_RUN_ID`, `VITRINKA_RUN_DIR`, `VITRINKA_RUN_STARTED_AT`, `VITRINKA_SHOTS=always`; `shotMeta[<file>].step` pins one to a step.
- The MCP twin is `publish_run {id, manifest}`; never the publisher agent, never a hand-written manifest, never `qa run publish` after `run`, never double-written verdicts or bugs the run covered.
- Exploratory lane: `vitrinka qa usertest start` (`--task`, `--app`, `--platform`, `--device`), `case "<title>"` (`--key`), `vitrinka board capture` shots, `verdict pass|fail|skip [--note …]`, `finish [--pr …] [--bugs intake|direct|none]`; `status` shows the open session.
- A `fail` carries `--note`: it becomes the bug draft's first line.
- Build the role matrix first from the app's seeds, fixtures or docs; every multi-role feature gets a cross-role case (created as role A, seen by role B only as permitted).
- A role you cannot seed is a `skip` with a note, never an invented bypass; never touch production tenants.
- Test edge cases: empty states, zero and maximum quantities, unicode and long strings, concurrent edits, stale tabs, deleted referents, permission revoked mid-flow, reload after every step.
- Read the code before judging: a broken contract is a `fail` with the note, an unclear one a `skip` saying so; never guess a verdict.
- Snap what proves the verdict (before, result, failure) and read every image back.
- Scenarios worth keeping go into the repo's OWN test framework, never a second one; no suite: a `skip` case noting the proposal, never an unasked scaffold; then run them through the runner lane.
- Fix small issues in the run's worktree and note them in the case; land them through the repo's PR flow.
- A blocked case never stops the others: code bug → fix and link the commit; missing seed data → the app's seeding path; env or infra → `skip`; destructive or migration-shaped → STOP that case.
- Re-run a step on your own only when it is non-destructive.
- Finish by pasting the block `run` / `finish` printed, plus what was NOT covered.

## qa review [board] [journey] [eve]

- A review files findings and never fixes: a staged finding awaits the user's Accept/Dismiss; a code change, capture or composed pass before it is a verdict.
- Never set a finding's verdict (`review_job feedback`, a state change); fixing accepted findings is `listen resolve`.
- Local (default): you judge with your own eyes; never call `review_judge`, poll jobs or name Eve.
- `eve`: Eve judges server-side; you re-verify her findings against the code and file none of your own.
- Never mix modes in one run.
- Phase 0: with a journey or `eve`, `list {kind: "section", board}` (`journeys[]` = key, pass count, latest pass); without a journey review the whole board or ask which section.
- Phase 0: `review_brief {project, persona?}` (CLI `vitrinka review brief [--project acme] [--persona "…"]`) is the ONE rubric; never retype one.
- A misfiring rule is fixed at its source: `vitrinka review rules get <id>`, edit, `vitrinka review rules lint --fix <file>`, `vitrinka review rules put <file>` (`docs {topic: "review"}`).
- `eve` Phase 0: `review_judgments {board}`; a `running` job means wait (a second request 409s); a recent `failed` with a timeout after a deploy window means re-request.
- Local plan: `review_plan {boards: […], scope?, sections?}` (CLI `vitrinka review plan <board>…`), `sections` naming a journey's latest pass; take the recommended option of a `needs_scope` reply unless the user named another; `full: true` only when the user asks to re-judge.
- `sheets: 0` is already complete: go to the receipt; pass `run` exactly as the reply spells it (`"<workspace>/<id>"` across workspaces).
- Prove sight: `get_card_image {run, sheet: 1}`, then echo its SIGHT CODE on the next call (`get_card_image {run, sheet: 2, sight}` or `review_plan {run, sight}`).
- No band, no image or `[image omitted]`: stop, file nothing, offer a rerun where images reach the model or as `eve`; never guess a code (three wrong ones lock the run).
- Read every sheet in order; `crop` + `vs` tiles show only what differs; never re-file a `prior`; confirm or reject each `lint` candidate.
- Measure on `get_card_image {board, cardId}`, never on a sheet; image bytes never leave a tool result (no base64 in a shell, no own montage; in code mode pass the block to `image(block)`).
- Judge against the brief: each finding names the rule, the region and what correct looks like; `finding` is a defect, `suggestion` is taste.
- File ONE `annotate {board, agent, run, items: [{key, cardId, cardVersion, region, image: {width, height}, summary, detail, category, severity}]}` per board, `image` = the single read's size; read `covers`; a `duplicate` names the finding you restated.
- Never document or `finding` cards via `compose_board`, never `highlight` (`docs {topic: "annotation"}`).
- Receipt: `review_plan {run}`; the report cites it.
- `review lane: codex` in the SessionStart line (`vitrinka config reviewer`): plan here, hand the run id, boards and brief to one `codex` agent for sight through filing, then verify its findings.
- `eve` plan: `review_plan {boards, judge: "eve", scope?, sections?}` (`--judge eve`), then `review_judge {run}` (CLI `vitrinka review judge --run <id>`); a changed rubric or Eve setting answers 409 with the re-plan; no host reads an eve run's sheets.
- Wait on `review_plan {run}`: minutes, not seconds; check in with the user rather than spinning.
- Without a plan: `review_judge {board}`, `{board, section}`, `{board, journey}` (latest pass with the previous as context; use it whenever a chain exists) or `{set: "project/branchSlug/selector"}`; CLI `vitrinka review judge <board> [--rules a,b] [--model model]`; never invent a board for an unowned set.
- `batch` opts into waiting; `calibration` audits a sample of passing judgments; `instructions` (≤ 12 000 chars) steer a pass, else the brief rides automatically.
- 409 = review toggle off or a pass running; 422 = no reviewable shots in scope: fix the scope, never retry blind.
- Poll `review_judgments {board}` (CLI `--status`) until `completed` or `failed`, in one read, never job by job.
- `cannot_judge` stays unresolved; missing evidence is never a pass.
- Filing outside a run needs a human's selection: `review_job {id, operation: "file", index}`; triage via `vitrinka review judge export <job>` (`--candidates`) or `review_job {id, operation: "export_judgments" | "export_candidates"}`, mark `keep: true`, then `vitrinka review file <board> <candidates.json> --agent judge/<model>`.
- Preserve `jobId`, `judgmentIndex`, card and version fields.
- Group the whole set by root cause in the report, never in a commit; label `suggestion` as taste, `refuted` as context; order by `severity`.
- Report which mode ran, findings grouped by root cause, findings you believe wrong ("F: claims X; the code does Y"), suggestions; add a `callout` card when the session is board-first.
- End with an explicit ask to Accept or Dismiss the staged findings and name `listen resolve` as the run that fixes them; never invent verdicts.
- `vitrinka review stats --since 90d [--project <slug>]` / `review_stats {since: "90d", project?}`; `dismissRate: null` means nobody decided, never a zero rate.

## qa sessions [board|id] [fix|test]

- Procedure: `docs {topic: "guide:sessions-pipeline"}`; stage engines `references/fix.md` (session → shipped fixes) and `references/generate-test.md` (session → journey tests); a trailing `fix` or `test` runs only that stage.
- Without an argument process every pending session, oldest first, one at a time.
- Discover: `search {q: "<project>", groups: ["sessions"], project, limit: 50}` (`tags: "ai"` isolates agent recordings).
- Digest ONCE: `get {kind: "session", id | board}` feeds both stages; an issues view is not coverage evidence.
- Stamp: `update {kind: "session", id, pipeline: {…}}` (keys merge, null deletes; shape `references/registry.md`); the server stamps are the ledger, no repo file mirrors them.
- `vitrinka.config.json` at the repo root is the ONE project map (`references/project.md`); missing or incomplete: STOP, map it with the user, commit it.
- Pending = status `done`, `boardSlug` set, no `tested` stamp; `triaged` without `tested` resumes at the test stage.
- Never process a `recording` session; never regenerate a `tested` one without an explicit ask.
- The `tested` stamp names its `journeys: [<key>…]` (an `observed` run, never a pass); never publish a session as a runner result.
- `environment` `sim` or tag `ai` is a dev-loop recording: never pipelined unless named as the argument.
- Each session gets its own worktree as the integration tree; parallel fix batches get their own worktrees off one base; never several agents in one tree.
- Ship only after the verification run: the targeted journeys ran green (or explained) against a stack that passed readiness; one branch per session; backfill `testPr` once the PR exists.
- The verification pass is `compose_board {board, journey: <pass-chain key>, pass: "next"}` on the SESSION board, one `step` per journey, never another board.
- A failing NEW test goes back to its emitter (fix, or `expectedFail` with the linked issue, never delete); a failing EXISTING test after your fixes is your regression.
- The first run's mapping questions are the only planned user interaction; surface hard blockers in the close-out and move to the next session.
- Add no subagents beyond what the engines specify.
- Archive a transcript only when work passes to someone else: `vitrinka qa session archive <transcript.jsonl> --task <id> [--hint "load when …"] [--version-of <ref>]` or `vitrinka task handback --transcript`; never from a hook.
- A credential in a transcript refuses the upload with no flag past it: rotate and archive again; e-mails, phones and opaque runs are masked as `▮▮▮ [redacted-<type>]`.
- `vitrinka qa session continue <task-id> [--ref <distill-ref>]` prints an offer, never runs it; without a distill label the task `eve-distill` or use `ask_task`.
