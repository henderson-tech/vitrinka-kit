---
name: test
description: "Use when a built branch should be tested on viewports, simulators or iOS 26 Safari at a chosen thoroughness — '/vitrinka-experimental:test', 'test this on iOS', 'run the device pass'. Asks ONE batched question, then runs unattended; Claude Code only."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka-experimental:test — ask what to test, then run only that

The thorough half of the Exp split. It never starts on its own: the human
has looked at the feature (usually after `/vitrinka-experimental:build-idea`)
and decides what a device pass covers and how hard it tries. The skill asks
once, launches the workflow, hands the run board over.

A **run** is one invocation (one run board); a **lane** is one viewport,
simulator or iOS Safari (one tab of the run board, a board of its own); a
**pass** is one shoot → publish → review → accept → fix → gate iteration
(section `Pass N` inside every lane).

## Step 1 — ONE batched `AskUserQuestion` (never more, never zero)

Read `.claude/vitrinka-workflows.json` first: `projectType`, `matrix`
(the pre-picked lanes and widths), `checklist` (extra review criteria),
`exclude`, `board` (the run-board slug base), `run.web`. Without it the
defaults apply — web: `iphone` 390×844@3 · `ipad` 1024×768@2 · `desktop`
1440×810@2; expo: `iphone` (iPhone 16) and `android` (Pixel 8) simulators.

≤ 4 questions in the same call, multi-select where it says so:

1. **Lanes** (multi) — the matrix devices by name, plus `ios-safari`
   (Mobile Safari on the iOS 26 Simulator — offered for web apps too);
   "Other" adds a lane as `<key>` + `WxH@S`. A lane key is a matrix device,
   carries a viewport, or is `ios-safari` — anything else is refused.
2. **iOS 26 checks** (multi, when `ios-safari` is a candidate; the first
   five pre-picked) — `bars` translucent bars blend · `safe-area` insets ·
   `keyboard` avoidance (captured with the keyboard OPEN) · `dvh` viewport
   units · `dock` scroll-end under fixed docks (a sticky header or bottom
   dock whose list lacks the matching offset hides the last item); extras
   `landscape`, `overscroll`.
3. **Thoroughness** — `shots` (capture and publish only) · `review` (plus a
   reviewer per lane and the usertest, findings staged on the board) · `fix`
   (plus accept ≥ threshold, fixers, gate, reshoot up to `cap`; recommended).
4. **Loop bounds** (with `fix`) — `cap` 1–6 passes (default 2) and
   `severity` `minor | major | blocker` (default `major`).

## Step 2 — launch

```text
Workflow {name: "vitrinka-experimental:test", args: {
  task: "<epic or story id>", project?: "<slug>",
  lanes: [{key: "desktop", viewport: "1440x810@2"}, {key: "iphone", viewport: "390x844@3"},
          {key: "ios-safari", checks: ["bars", "safe-area", "keyboard", "dvh", "dock"]}],
  thoroughness: "shots" | "review" | "fix", cap?: 2, severity?: "major",
  routes?: [...], journeys?: [...], scope?: "<prose>", scopeFiles?: [...],
  pr?: "<owner/repo#n>", base?: "main", board?: "<slug base>"}}
```

Every answer is echoed into `args`; the workflow reads nothing the question
did not settle. `routes`/`journeys`/`scope` come from the branch's
quick-check board or terrain when known — the flow runs `vitrinka:map`
otherwise; `pr` names the branch's PR when one exists.

Returns `{boardUrl, lanes, branch, task, passes, converged, open,
unverified, qaTask, bugs, pr, ready, demoted, handback}` — print `handback`
verbatim, `boardUrl` first as a masked link (`[<board title>](<boardUrl>)`).

## What the run leaves behind

- **The run board** `<branch>-test-run-<n>`, minted by the lanes door in
  ONE call — `create {kind: "board", slug, title, board_type: "review",
  project, meta, lanes: [{key, label}]}`: the parent is the Overview tab,
  each lane its own child board under a tab, each pass a section inside.
  pin: internal/web/lanes_test.go#TestLanesDoor
- **Findings** are annotations on the lane boards, born staged; with `fix`,
  defects at or above `severity` are accepted on the user's standing
  instruction and fixed in the branch's worktree. An off-scope defect is
  fixed only when the whole fix stays within 2 files; otherwise it is filed.
- **The QA record**: one runner manifest per lane through the run door —
  `vitrinka qa run --task <id> --results <manifest> --bugs direct --runner
  vitrinka-experimental:test` (MCP: `publish_run {id, manifest, bugs, pr}`)
  — so the qa task lists the lanes and every finding left open is a bug
  task under the epic, linked to its lane. A route passes only where its
  lane captured it and a reviewer judged it after the last fix; anything
  else is a skip naming why. Open findings stay on the board and are
  already bugs; the hand-back never spots them as children.
- **The PR**: a `fix` run ends with core `vitrinka:code-loop` over the final
  diff and marks the draft ready only when no finding is open, every route
  on every lane earned a pass, every fixed usertest journey was walked
  again, every gate ended green, the code loop left nothing for the human
  and the PR head is the commit the record was filed at — otherwise it ends
  (or returns to) a draft and the hand-back says why. A PR the run cannot
  prove a draft before the code loop holds that push: its commits stay
  local and its findings ride the hand-back. `shots` and `review` leave the
  PR as it was.

## Contracts

- The `ios-safari` lane drives Mobile Safari on the simulator through
  `vitrinka board capture safari --state <check state>`; simulator lanes
  always run on this machine, web viewports where `run.web` says — with
  `ios-safari` on, a devbox url must be reachable from here. The usertest
  lane is `vitrinka qa usertest` (`start` · `case` · `verdict` · `finish
  --bugs direct`), one case per journey titled verbatim so a fix is tracked
  across passes; its failures join the fix list as functional findings.
- One run, one task, one worktree; the workflow never asks mid-run.
- Core `vitrinka:review-loop` is untouched; Exp runs its own loop.
