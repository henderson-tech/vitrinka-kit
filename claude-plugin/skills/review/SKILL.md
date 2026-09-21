---
name: review
description: "Use when asked to review a vitrinka board's screens or a journey pass for defects from the app's repo — 'review the board', 'review this journey', '/vitrinka:review [board] [journey] [eve]', 'have Eve review it'; human annotations are listen (live) / resolve (backlog)."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka:review — the review loop

Two modes, chosen by the trailing argument. They never mix in one run.

- **local (default)** — YOU are the reviewer. You read the screens with
  your own eyes, judge them against the team's review brief, file findings
  as staged annotations, fix the real ones in THIS repo and push a next
  pass. No server-side reviewer is requested, mentioned or waited on.
- **`eve`** — Eve, vitrinka's AI reviewer, judges the screens through the
  server-side judge and independent auditor. This session is a proxy: it
  requests the pass, waits, then RE-VERIFIES Eve's findings against the
  code before fixing. It files no findings of its own.

Failure modes this skill prevents:

1. **Looking and walking away** — the loop isn't done until fixes shipped
   and a next pass exists.
2. **Treating every finding as a defect** — a finding (yours or Eve's) is a
   claim; locate it in the code before touching anything.
3. **Fixing on top of stale screens** — fixes land as a NEW journey pass,
   never edits to the reviewed section.
4. **Verdicting findings yourself** — `accepted`/`dismissed` is the USER's
   call in the AI BOARD tab. Your outputs are code, replies in your report,
   and the next pass.
5. **Mixing modes** — a local run never calls `review_judge`; an `eve` run
   never files `annotate` items of its own.

Arguments: a board slug, optionally a journey key, optionally the word
`eve` last (`/vitrinka:review acme-audit checkout`, `/vitrinka:review
acme-audit checkout eve`). Without a journey, review the whole board or ask
which section when the board has several.

## Phase 0 — orient, one call each

1. `list {kind:"section", board}` — `journeys[]` is the map: each chain's key,
   pass count, latest pass. Pick the scope here.
2. `review_brief {project, persona?}` (CLI `vitrinka review brief
   [--project acme] [--persona "a senior mobile designer"]`) — the team's
   resolved rules (built-in ▸ workspace ▸ this project) as one prompt
   block. Both modes judge against THIS, never a rubric you retype. A rule
   that keeps misfiring is fixed at its source: `vitrinka review rules get
   <id>`, edit, `vitrinka review rules lint --fix <file>`, `vitrinka review
   rules put <file>` (admin+; the rule format is docs topic `review`).
3. `eve` mode only: `GET /api/v1/boards/{slug}/review-passes` — pass
   history with per-state finding tallies. A pass already `running` means
   STOP and wait (a second request 409s). A recent `failed` with a timeout
   error after a deploy window — re-request.

Every API call needs an `Authorization: Bearer` header (token from
`$VITRINKA_TOKEN`, fallback the credential `vitrinka auth token` prints;
`vitrinka auth login` mints it), fed via stdin (`printf 'Authorization:
Bearer %s' "$TOKEN" | curl -H @- <url>`) — never inline the token into a
command's arguments.

## Phase 1 (local) — review the screens yourself

1. `get_card_image {board, cardId}` per shot card in scope — measure on the
   pixels, not on the thumbnail or the card's text. Read every screen
   before filing anything: cross-cutting problems (one contrast token, one
   spacing scale) show up only across the set.
2. Judge each screen against the brief from Phase 0. Every finding names
   the rule it breaks, the region on the image, and what correct looks
   like. Sort into `finding` (a defect) and `suggestion` (taste).
3. File ONE `annotate {board, agent, items:[{key, cardId, cardVersion,
   region, image:{width,height}, summary, detail, category, severity}]}`
   batch for the whole scope — `image` is the size that read returned, so
   a region measured on another basis is refused instead of landing wrong.
   Read `covers` in each receipt: it lists the text under the filed region.
   Findings land `staged` for the user's Accept/Dismiss. Never file
   findings as document or `finding` cards via compose_board, never
   `highlight` them. Doctrine: docs topic `annotation`.

Nothing here calls a server-side reviewer; the findings are yours and the
report says so.

## Phase 1 (`eve`) — request the pass, then re-verify

`review_judge {board}` — or `{board, section}` for one journey section, or
`{board, journey}` to review a chain's LATEST pass with the previous pass as
reviewer context (prefer it whenever a chain exists). CLI: `vitrinka review
judge <board> [--rules a,b] [--model model]`. For a published set: `vitrinka
review judge <project>/<branchSlug>/<selector> --set` or `review_judge
{set:"project/branchSlug/selector"}`. The server resolves an existing board;
never invent one when the set is unowned or ambiguous. Immediate processing
is the default; `--batch` explicitly opts into waiting. `--calibration`
audits a sample of passing judgments to measure missed issues. The old board
reviewer is replaced, including the `request_review` compatibility door.
`review_judge`, `review_job`, `review_stats` and `request_review` live in
the `rare` module — never listed by default; the registration opts in on
its `/mcp` URL: `?modules=core,qa,rare`.

A pass requested without `instructions` receives the rendered brief
automatically. To steer it, tweak the Phase 0 block's focus and pass the
result as `instructions` (≤ 12 000 chars).

- 409 = review toggle off (ask the user to flip it on the board) or a pass
  already running (wait).
- 422 = no reviewable shot cards in scope — wrong section/journey, or the
  screens were never pushed. Fix the scope, don't retry blind.

Poll `review_judgments {board}` (CLI `vitrinka review judge <board>
--status`) until the pass is `completed` (or `failed`) — minutes, not
seconds; check in with the user rather than spinning hot.

Then read: `review_judgments {board}` returns jobs, version-pinned
judgments, independent audit assessments and per-rule triage.
`cannot_judge` remains unresolved; missing evidence is never a pass. Read
bounded evidence crops only as needed. Each failed judgment is automatically
audited; a supported finding still needs explicit selection to file (`POST
/api/v1/review/jobs/{id}/file {index}`) — the board review pane provides
that selection and human usefulness feedback. For local triage, `vitrinka
review judge export <job>` prints `judgments.json` (`--candidates` selects
mechanical candidates); MCP `review_job` supports `export_judgments` and
`export_candidates`. Mark selected rows `keep:true`, then use `review file`
with the exported `judge/<model>` agent. Preserve `jobId`,
`judgmentIndex`, card and version fields: they link later fix evidence back
to the original review and keep filing idempotent with the UI.

**Re-verify every finding against the code before it becomes work.** Eve
proposes; you confirm or refute. A finding that's wrong gets a line in your
report ("F: claims X; the code does Y") — the user dismisses it, not you.
Don't add findings of your own here; that is the local mode, run it as its
own pass.

## Phase 2 — triage into blocks

Triage the whole set at once, grouped by root cause exactly like
`/vitrinka:resolve` Phase 2 — five contrast findings on five screens are ONE
token fix:

- Work `proposed` findings of kind `finding`. `refuted` is context only.
  `kind: suggestion` is taste: surface to the user, don't auto-implement.
- `severity` orders the work; it doesn't gate it.

## Phase 3 — fix, reshoot, next pass

1. Fix the confirmed findings block-by-block, one coherent commit each — the
   resolve skill's scope discipline applies verbatim.
2. Re-capture the affected screens the way this repo does it (`vitrinka
   snap`/journey script) and push the set.
3. Compose the iteration as a NEW pass on the chain: `compose_board {board,
   journey, pass: "next", …}` with the fresh screens — never overwrite the
   reviewed section.
4. Close the loop in the mode you started in:
   - **local** — `get_card_image` the new pass's screens and re-check each
     fixed finding on the pixels; anything still open gets a fresh
     `annotate` item on the NEW card, with a `detail` that names the
     earlier key. No server pass is requested.
   - **`eve`** — link fresh evidence with `POST
     /api/v1/review/jobs/{id}/verify {cardId, cardVersion}` to enqueue the
     post-fix audit automatically, then `review_judge {board, journey}`
     reviews the wider pass for regressions. Resolution is evidence, never
     automatic usefulness points. AI dimensions (validity, actionability,
     impact, novelty, resolution) remain distinct from human feedback.
     Anchored 1–5 scores display as 1–100; there is no combined score.

## Phase 4 — report and ask for triage

One summary to the user (and to the board as a `callout` card when the
session is board-first): which mode ran, findings confirmed-and-fixed (with
commits), findings you believe are wrong (with evidence, for their dismiss
click), suggestions left for their call, and the new pass's outcome when it
lands. Before the hand-back on a bound task, run the `handoff` skill
(`hand_back`) — the chat block is its `rendered` output.

End with an explicit board ask to Accept or Dismiss the staged findings (the
card's Accept all / Dismiss all controls support batches). Never invent
verdicts to improve metrics. `vitrinka review stats --since 90d [--project
<slug>]` or `review_stats {since:"90d", project?}` shows filed, accepted,
dismissed and still-staged counts per rule and agent/model.
`dismissRate:null` means nobody decided yet; it is not a zero-percent
rejection rate.

## Don't rationalize

- "Looking at screenshots is expensive, I'll ask the server" → the default
  is local; the server reviewer is the user's explicit `eve` choice.
- "The pass is requested, my job is done" → the loop is request → verify →
  fix → next pass.
- "Eve flagged it, so it's a bug" → verify against code first; pushing back
  with evidence is a valid resolution.
- "I'll just accept the obvious ones on the board" → you have no verdict.
- "I'll re-shoot onto the same section" → same-section overwrites destroy
  the before.
- "Severity low, skip reading it" → low-severity findings cluster into the
  cross-cutting blocks that ARE worth fixing.

## Red flags — STOP

- A local run is calling `review_judge`, polling passes, or naming Eve.
- An `eve` run is filing `annotate` items of its own.
- You are about to PATCH an ai-annotation's `state`.
- You are fixing a finding you never located in the code.
- Your findings are document cards or a compose_board `finding` instead of
  `annotate` items with regions on the actual screenshots.
- A pass is `running` and you're requesting another.
- Your next pass has fewer screens than the findings you claim to have fixed.
- You've read findings one HTTP call at a time instead of the one
  board-level GET.
