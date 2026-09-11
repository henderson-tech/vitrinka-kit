---
name: usertest
description: "Test the current repo's app like a user and leave the QA record behind — one verb per lane: `vitrinka run -- <test command>` for runner-backed suites, `vitrinka usertest start · case · snap · verdict · finish` for exploratory sessions. Use for 'user test this', 'explore the new feature', 'QA this like a user', 'run the tests and publish'."
metadata:
  vitrinka-contract: "2026-08-30"
---

# usertest — test like a user, let vitrinka keep the record

Test the new functionality of the app in the CURRENT repo by driving it the
way real users will — not by reading the code and declaring it plausible.
Vitrinka owns everything after the test: attribution, linking, the qa task
and its journeys, the board, the screenshots, the bug drafts. You own only
what to try and what verdict it earned.

Two lanes, one verb each. Both end in the same QA record, and neither needs
a manifest, a board, a publisher agent or a task tool from you.

## Lane 1 — runner-backed: `vitrinka run -- <test command>`

```text
vitrinka run -- bun x playwright test e2e/checkout.spec.ts
vitrinka run -- bun run appium:smoke
vitrinka run --task 392 --pr acme/shop#41 -- bun test
```

`run` executes the command exactly as given (inherited stdio, its exit code
becomes yours), then finds what it left behind and publishes it:

- **Results** — the repo's declared runners (`.vitrinka/project.json`
  `runners[]`, written by `vitrinka project setup --runners`) first, else
  a scan for anything newer than the start: a `usertest-run-<id>.json`
  manifest, JUnit XML, a Playwright JSON report, an `allure-results/`
  directory, wdio JSON reports. `--results <path>` names one explicitly.
- **Target** — `--task <id>` (a qa task, story or epic), else the
  checkout's `vt-<id>` (branch, worktree path, commit trailer), else the
  project's rolling **Unplanned runs** epic — a run never ends unlinked.
- **The record** — the family's open qa task or a LIVE one created from
  the run, one `journey` per spec, verdicts and steps written, the qa
  board's journey sections with a run callout, the case checklist and the
  screenshots, `run`/`board`/`shot`/log/`pr` refs, and one bug draft per
  failing case `blocks`-linked to its journey (`--bugs direct|none` to
  change that). The same run id republished replaces its cards.

**Any runner, unchanged.** The command runs verbatim and vitrinka only reads
what it left behind: JUnit XML alone covers Selenium, Cypress, Maestro,
Detox, TestCafe, Jest, Go and a home-grown harness — no vitrinka reporter,
plugin or test change is ever required. Playwright JSON, allure-results and
wdio reports are read natively too.

Screenshots reach the board when the runner writes them: Playwright's
`screenshot: "on"` (or its JUnit `[[ATTACHMENT|…]]` lines), allure png
attachments, or a reporter honouring the env `run` sets —
`VITRINKA_RUN_ID`, `VITRINKA_RUN_DIR` (a scratch directory for this run),
`VITRINKA_RUN_STARTED_AT`, `VITRINKA_SHOTS=always`.

Never write a manifest by hand, never call `run publish` after `run`,
never double-write verdicts or file bugs for cases the run covered — the
door did. `--dry-run` shows the folded manifest without publishing.

## Lane 2 — exploratory: `vitrinka usertest …`

```text
vitrinka usertest start [--task <id>] [--app web] [--platform ios|android|web|macos] [--device "iPhone 17 Pro"]
vitrinka usertest case "Admin creates a coupon, member sees it"
vitrinka snap ios --route /coupons --note "the new coupon in the member list"
vitrinka usertest verdict pass|fail|skip [--note "what happened"]
… more cases …
vitrinka usertest finish [--pr owner/repo#n] [--bugs intake|direct|none]
```

- `start` opens the session (`.vitrinka/usertest-run.json`); `--task`
  defaults to the checkout's `vt-<id>`, else `finish` files under
  **Unplanned runs**.
- `case "<title>"` opens a case; **every `snap` until its verdict attaches
  to it** (the capture prints `attached to usertest case …`). One case is
  one journey on the qa task, keyed by the title's slug (`--key` to pick).
- `verdict` closes the case. A `fail` should carry `--note`: it becomes
  the bug draft's first line.
- `finish` folds the session into a run manifest under `.vitrinka/runs/`,
  publishes it through the same door as lane 1 and prints the same
  hand-back. `--dry-run` prints the manifest instead.

What goes into a session is your craft — the record is not:

- **Build the role matrix first.** Enumerate the app's roles from its own
  seeds, fixtures or docs (admin, member, guest, anonymous, …). Every
  multi-role feature gets its cross-role cell checked as its own case: an
  entity created as role A must appear correctly — and only as permitted —
  to role B. Identities come from the app's own dev seeds; a role you
  cannot seed is a `skip` case with a note, never an invented bypass.
  NEVER poke at production tenants.
- **Edge cases are the job, not the garnish.** Empty states, maximum/zero
  quantities, unicode + long strings, concurrent edits, stale tabs,
  deleted referents, permission revocation mid-flow, reload after every
  step. A feature that only passed its happy path is untested.
- **Understand before judging.** When behavior surprises, read the
  relevant code before the verdict: a *bug* (contract broken) is a `fail`
  with the note; a *gap* (contract silent) or a *question* (contract
  unclear) is a `skip` whose note says so — never guess a verdict.
- **Snap what proves the verdict** — the state before the action, the
  result, the failure — and read every image back before moving on.

## Writing tests worth keeping

Scenarios that proved something belong in the target repo's OWN test
framework and conventions (its Playwright/Appium/whatever suite — never a
second framework; no suite at all → a `skip` case noting the proposal, not
an unasked scaffold). Once written, run them through lane 1 so the record
carries them as journeys with verdicts.

## Fix and blocker rules

Small issues found mid-run get fixed in the run's worktree and noted in the
case's `--note`; everything reaches main only through the normal PR flow —
this skill never merges. Blockers resolve by taxonomy, and a blocked case
never stops the others:

| Blocker | Action |
|---|---|
| code bug in the target app | fix in the worktree, the case note links the commit |
| missing seed/fixture data | create via the app's own dev seeding path |
| env/infra/config | `skip` with the note, route around, continue |
| destructive or migration-shaped | STOP that case (`skip`), continue others |

"Safely resumable" is the test for any automatic resolution: if re-running
the step after your intervention can't make things worse, proceed; anything
irreversible waits for the user.

## Finishing

Paste the hand-back block `run` / `finish` printed — the qa task `url`, the
board `url`, one line per journey with its verdict, the bugs filed — exactly
as returned; never compose or shorten a link. Add what was deliberately NOT
covered (silent truncation reads as coverage), then leave the app running
and hand-testable, and say which state it's parked in.
