---
name: usertest
description: "Autonomous exploratory user-testing of the current repo's app on a live vitrinka board — multi-role checks (admin creates → user sees), edge cases, written scenarios, runner-backed tests, small fixes. Use for 'user test this', 'explore the new feature', 'QA this like a user'."
metadata:
  vitrinka-contract: "2026-08-30"
---

# usertest — explore the app like a user, leave evidence behind

Test the new functionality of the app in the CURRENT repo by driving it the
way real users will — not by reading the code and declaring it plausible. The
deliverables, in order of importance:

1. **A live board** (one per run) that narrates the exploration: what was
   tried, what broke, what's ambiguous. **Create it before the first
   scenario** and narrate into it as the run proceeds — a board assembled at
   the end is the deliverable that falls off a long session. Invoke the
   **publish** skill for every board mechanic (creation, journey sections,
   step cards, staged questions, the summary pass) and dispatch its
   `vitrinka-publisher` agent (Agent tool, `subagent_type:
   "vitrinka-publisher"`, background) for each compose-shaped pass; this
   skill owns only what goes on the board. The CLI's stored credential
   (`vitrinka auth status`) is the only sign-in the board needs — never
   reach for a browser login to publish.
   The board belongs to the feature's **qa task** (below) — one section per
   journey, titled by the journey's registry `key` when the plan has one.
2. **Written scenarios**: a page card per feature area listing the concrete
   scenarios exercised (role, preconditions, steps, expected), so the run is
   reproducible by a human or a future session.
3. **Runner-backed tests** for the scenarios worth keeping, written into the
   target repo's OWN test framework and conventions (its Playwright/Appium/
   whatever suite — never introduce a second framework; no suite at all →
   board a finding proposing one, don't scaffold it unasked).
4. **Small fixes**, PR-gated (below).

## The QA plan is the script (feature lifecycle D4/D6)

- **Resolve the target first**: `vitrinka task resolve-qa [--task <id>]
  --json` (`--task` a qa task, or the epic/story that owns one; else the
  branch's `vt-<id>`). Exit 4 → there is no plan: explore from the code
  and the decision log, publish UNLINKED, and say so in the hand-back —
  never file a qa task from a usertest run (the tasks skill's "QA plan"
  recipe belongs to the merge).
- **With a plan**, `get_task {id: <qa>, include: [children]}` lists the
  `journey` tasks — each with `fields.role`, `route`, `steps`, `expected`.
  Walk every journey as its role (the role matrix below still applies to
  the pairings the plan names), one board section per journey titled by
  its `fields.key`, and only then explore beyond the plan (edge cases,
  unplanned pairings) in their own sections.
- **Verdicts go on the journey**: `update_task {id: <journey>, fields:
  {verdict: pass|fail|partial}}` as each lane closes; the qa task's
  coverage rolls up on its own. A `fail` files its bug through intake —
  `propose_tasks {project, source: {kind: "journey", task: <journeyId>},
  drafts: [{type: "bug", title, body}]}` — and links it:
  `create_task_link {from: <bug>, to: <journey>, rel: "blocks"}`. The
  living journey diagram on the qa board paints that edge; refresh it
  once at the end (`refresh_card {id: <diagramCardId>}` from `qa_board`).
- **Evidence lands on the journey too**: the publisher stamps the board
  (`meta.section` per journey) and any recorded session as refs; a shot
  worth keeping beyond the board is `add_task_ref {kind: "shot"}`.

## The exploration contract

- **Build the role matrix first.** Enumerate the app's roles/identities from
  its own seeds, fixtures or docs (admin, member, guest, anonymous, …).
  Every multi-role feature gets its cross-role cell checked: an entity
  created as role A must appear correctly — and only as permitted — to role
  B. Identities come from the app's own dev seeds; when a needed role isn't
  derivable or seedable, board the gap and continue with the roles you have.
  NEVER invent auth bypasses or poke at production tenants.
- **Edge cases are the job, not the garnish.** Empty states, maximum/zero
  quantities, unicode + long strings, concurrent edits, stale tabs, deleted
  referents, permission revocation mid-flow, and the reload-after-every-step
  check. A feature that only passed its happy path is untested.
- **Truly understand before judging.** When behavior surprises, read the
  relevant code/spec before filing it — the board distinguishes *bug*
  (contract broken), *gap* (contract silent), and *question* (contract
  unclear; stage it as a board question for the user, don't guess).
- One journey section per feature area or role pairing; findings anchor to
  the step where they surfaced.

## Fix and blocker rules

Small issues found mid-run get fixed in the run's worktree and noted on the
board; everything reaches main only through the normal PR flow — this skill
never merges. Blockers resolve by taxonomy, and a blocked lane never stops
the others:

| Blocker | Action |
|---|---|
| code bug in the target app | fix in the worktree, board note links the commit |
| missing seed/fixture data | create via the app's own dev seeding path |
| env/infra/config | board the finding, route around, continue |
| destructive or migration-shaped | STOP that lane, board it, continue others |

"Safely resumable" is the test for any automatic resolution: if re-running
the step after your intervention can't make things worse, proceed; anything
irreversible waits for the user.

## Finishing

The board's summary section states: scenarios exercised (count + page-card
link), findings by severity, fixes made (PR link), blockers left open, and
what was deliberately NOT covered — silent truncation reads as coverage.
Hand over the board `url` (as returned by the server) bare on its own line
and, under it, the qa task's `url` with the journey verdicts (`pass 4 ·
fail 1 · untested 2`) — or "not linked — no qa task" when resolution failed
— then leave the app running and hand-testable, and say which state it's
parked in.
