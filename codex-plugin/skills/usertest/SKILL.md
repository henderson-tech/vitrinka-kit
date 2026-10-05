---
name: usertest
description: "Use for 'user test this', 'explore the new feature', 'QA this like a user', 'run the tests and publish', or 'vitrinka qa run|usertest' from the app's repo."
metadata:
  vitrinka-contract: "2026-09-15"
---

# usertest — test like a user, let vitrinka keep the record

Drive the app the way real users will; vitrinka owns everything after the
test (the qa task and its journeys, the board, the screenshots, the bug
drafts, the links). You own what to try and the verdict. Two lanes, one verb
each; `vitrinka qa run --help` and `vitrinka qa usertest --help` carry the
flags.

## Lane 1 — runner-backed: `vitrinka qa run -- <test command>`

The command runs verbatim (inherited stdio, its exit code is yours); vitrinka
reads what it left behind — the repo's declared runners, else anything newer
than the start: a `usertest-run-<id>.json` manifest, JUnit XML, Playwright
JSON, `allure-results/`, wdio reports — and publishes it as the family's QA
record: one journey per spec with verdicts and steps, the qa board, refs and
one bug draft per failing case. Target: `--task <id>`, else the checkout's
`vt-<id>`, else the project's rolling **Unplanned runs** epic. The same run
id republished replaces its cards.

- Any runner, unchanged: JUnit alone covers Selenium, Cypress, Maestro,
  Detox, Jest, Go and a home-grown harness. No reporter, plugin or test
  change is ever required.
- Screenshots reach the board when the runner writes them (Playwright
  `screenshot: "on"`, allure png attachments) or through the env `run`
  sets: `VITRINKA_RUN_ID`, `VITRINKA_RUN_DIR`, `VITRINKA_RUN_STARTED_AT`,
  `VITRINKA_SHOTS=always`.
- Never write a manifest by hand, never call `run publish` after `run`,
  never double-write verdicts or file bugs the run covered.

## Lane 2 — exploratory: `vitrinka qa usertest …`

`start [--task <id>] [--app web] [--platform …] [--device …]` opens the
session; `case "<title>"` opens a case (one journey, keyed by the title's
slug) and every `vitrinka board capture` until its `verdict pass|fail|skip
[--note …]` attaches to it; `finish [--pr …] [--bugs intake|direct|none]`
folds the session into a run and publishes it through lane 1's door. A
`fail` carries `--note`: it becomes the bug draft's first line.

The craft is yours:

- **Build the role matrix first** from the app's own seeds, fixtures or
  docs. Every multi-role feature gets its cross-role cell as its own case:
  an entity created as role A appears to role B correctly and only as
  permitted. A role you cannot seed is a `skip` with a note, never an
  invented bypass. Never poke at production tenants.
- **Edge cases are the job**: empty states, zero/maximum quantities,
  unicode and long strings, concurrent edits, stale tabs, deleted referents,
  permission revoked mid-flow, reload after every step.
- **Understand before judging**: read the relevant code first. A contract
  broken is a `fail` with the note; a silent or unclear contract is a `skip`
  whose note says so — never guess a verdict.
- **Snap what proves the verdict** (before, result, failure) and read every
  image back before moving on.

## Tests worth keeping

Scenarios that proved something go into the repo's OWN test framework and
conventions — never a second framework; no suite → a `skip` case noting the
proposal, not an unasked scaffold. Then run them through lane 1.

## Fixes and blockers

Small issues found mid-run are fixed in the run's worktree and noted in the
case; everything reaches main through the normal PR flow — this skill never
merges. A blocked case never stops the others: a code bug → fix and link the
commit; missing seed data → the app's own seeding path; env/infra → `skip`
and route around; destructive or migration-shaped → STOP that case. Proceed
on your own only when re-running the step cannot make things worse.

## Finishing

Paste the hand-back block `run` / `finish` printed exactly as returned (the
qa task url, the board url, one line per journey, the bugs filed); never
compose or shorten a link. Add what was deliberately NOT covered, then leave
the app running and hand-testable and say which state it is parked in.
