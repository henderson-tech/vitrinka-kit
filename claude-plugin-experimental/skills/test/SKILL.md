---
name: test
description: "Use when a built branch should be tested on devices, breakpoints or the iOS 26 Simulator with a chosen thoroughness — '/vitrinka-experimental:test', 'test this on iOS', 'run the device pass', 'review and auto-fix on phone and tablet'. Asks ONE batched question first, then runs unattended; Claude Code only."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka-experimental:test — ask what to test, then run only that

The thorough half of the Exp split. It never starts on its own: the human
has looked at the feature (usually after `/vitrinka-experimental:build-idea`)
and now decides what a device pass should cover and how hard it should try.
The skill asks once, launches the workflow, and reports the run board.

Vocabulary: a **run** is one invocation (one run board); a **lane** is one
device or breakpoint (one tab of the run board, a whole board of its own); a
**pass** is one shoot → publish → review → accept → fix → gate iteration
(one section `Pass N` inside every lane).

## Step 1 — ONE batched `AskUserQuestion` (never more, never zero)

Read `.claude/vitrinka-workflows.json` first: its `matrix` entries are the
pre-picked lanes and widths, its `checklist` extends the review criteria, its
`run.web` is where the app starts. Without the file, `lib/matrix.js` defaults
apply (web: iphone 390×844@3 · ipad 1024×768@2 · desktop 1440×810@2; expo:
iPhone 16 and Pixel 8 simulators).

Question areas, all in the same call (≤ 4 questions, multi-select where it
says so):

1. **Lanes** (multi) — `desktop`, `tablet`, `phone` viewports (repo matrix
   pre-picked), `ios-safari` (iOS 26 Simulator, Mobile Safari — offered for
   WEB apps too), `android` (expo only). "Other" takes an extra width as
   `WxH@S`.
2. **iOS 26 checks** (multi, shown when `ios-safari` is a candidate; all
   pre-picked) — translucent bars blend · safe-area insets · keyboard
   avoidance (captured with the keyboard OPEN) · viewport units (`100dvh`) ·
   scroll-end under fixed docks (a sticky header or bottom dock whose list
   lacks the matching offset, so the last item hides and scrolling stops).
   Optional extras: landscape · overscroll background.
3. **Thoroughness** — `shots` (capture and publish only) · `review` (plus a
   reviewer per lane, findings staged on the board) · `fix` (plus accept ≥
   threshold, fixers, gate, reshoot, up to `cap` passes; recommended).
4. **Loop bounds** (with `fix`) — `cap` 1–6 (default 2) and `severity`
   threshold `minor | major | blocker` (default `major`).

## Step 2 — launch

```text
Workflow {name: "vitrinka-experimental:test", args: {
  task: <epic or task id>, project?: "<slug>",
  lanes: [{key: "desktop", viewport: "1440x810@2"}, {key: "phone", viewport: "390x844@3"},
          {key: "ios-safari", checks: ["bars", "safe-area", "keyboard", "dvh", "dock"]}],
  thoroughness: "shots" | "review" | "fix", cap?: 2, severity?: "major",
  routes?: [...], journeys?: [...], pr?: "<owner/repo#n>", base?: "main"}}
```

Every answer is echoed into `args` — the workflow reads nothing the question
did not settle. `routes`/`journeys` come from the branch's quick-check board
or the terrain when known; the flow inventories inline otherwise.

## What the run leaves behind

- **The run board** `<branch>-test-run-<n>`, minted by the lanes door
  (`create {kind: "board", lanes: [...]}`): the parent is the Overview tab
  (run summary, verdict per lane), each lane is its own child board under a
  tab, each pass a section inside the lane. Hand the parent `url` over bare
  on its own line.
- **Findings** are annotations on the lane boards, born staged; with `fix`,
  defects at or above `severity` are accepted through the one agent-verdict
  door and fixed in the branch's worktree. Fixers touch an off-scope defect
  only when the fix stays within 2 files; anything larger is filed, not
  fixed.
- **The task engine**: one runner manifest per lane reaches
  `POST /tasks/{id}/run`, so the run's qa task lists the lanes and every
  finding the run leaves open is a bug task under the epic, linked to its
  lane — with `fix` an accepted one it did not fix, with `review` every
  defect filed, at any severity (suggestions stay staged). A route passes
  only where its lane captured it and a reviewer judged it after the last
  fix; anything else is a skip naming why. Open findings stay on the
  board; the hand-back never spots them as children.
- **The PR**: after every `fix` run the core `vitrinka:code-loop` reviews
  the final diff; the draft is marked ready only when no finding is open,
  every route on every lane earned a pass (a last-pass fix the cap left
  unreshot keeps the draft), every fixed usertest journey was walked again,
  every gate ended green, the code loop left
  nothing for the human, and the PR head is still the commit the record was
  filed at (a code-loop fix or prm push after it was never reshot) —
  otherwise it ends a draft (a PR already ready for review goes back to
  draft before the code loop pushes, clean record or not — the review
  is still ahead; a draft it cannot confirm, or a branch PR it cannot
  prove absent, holds that push and the loop's commits stay local) and the hand-back says why. `shots` and `review` runs
  leave it as it was.

## Contracts

- The iOS lane drives Mobile Safari on the simulator through
  `vitrinka board capture safari` (Appium XCUITest); simulator lanes always
  run on this machine, web viewports where `run.web` says.
- One run, one task, one worktree; the workflow never asks mid-run.
- Core `vitrinka:review-loop` is untouched; Exp runs its own loop.
