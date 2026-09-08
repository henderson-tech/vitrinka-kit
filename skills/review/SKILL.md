---
name: review
description: "Drive the AI-review loop on a board — request a review pass by Eve, vitrinka's AI reviewer, verify and fix the real findings in this repo, push a next-pass iteration, re-review. Invoke as /vitrinka:review [board-slug] [journey] FROM THE APP'S REPO; human annotations are listen (live) / resolve (backlog)."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:review — the AI-review loop

You are driving the machine half of the audit loop: Eve, vitrinka's AI reviewer, reviews the board's
screens and files findings; you separate real defects from noise, fix them in
THIS repo, and give the reviewer a next pass that shows what changed. The failure modes
this skill exists to prevent:

1. **Requesting a pass and walking away** — findings nobody reads are wasted
   review budget; the loop isn't done until fixes shipped and a next pass ran.
2. **Treating every finding as a defect** — the reviewer proposes; some findings are
   wrong, some are taste. You verify against code before touching anything.
3. **Fixing on top of stale screens** — fixes must land as a NEW journey pass,
   not edits to the reviewed section; the chain is how the reviewer sees the delta.
4. **Verdicting findings yourself** — `accepted`/`dismissed` is the USER's
   call in the AI BOARD tab, exactly like `resolved` on human annotations.
   Your outputs are code, replies in your report, and the next pass.

Arguments: a board slug, optionally a journey key
(`/vitrinka:review acme-audit checkout`). Without a journey, review the whole
board or ask which section when the board has several.

## Phase 0 — orient, one call each

1. `list_sections {board}` — the `journeys[]` array is the map: each chain's
   key, pass count, and latest pass. Pick the scope here.
2. `GET /api/v1/boards/{slug}/review-passes` — pass history with per-state
   finding tallies. A pass already `running` means STOP and wait (a second
   request 409s). Recent `failed` with a timeout error is normal after a
   deploy window — just re-request.

Vitrinka is an authenticated service: every API call needs an
`Authorization: Bearer` header (token from `$VITRINKA_TOKEN`, fallback the
credential `vitrinka token` prints; `vitrinka auth login` mints it). Feed the
header via stdin (`printf 'Authorization:
Bearer %s' "$TOKEN" | curl -H @- <url>`) — never inline the token into a
command's arguments.

## Phase 1 — request the pass

`request_review {board}` — or `{board, section}` for one journey section, or
`{board, journey}` to review a chain's LATEST pass with the previous pass as
reviewer context (the iteration mode; prefer it whenever a chain exists).

- 409 = review toggle off (ask the user to flip it on the board) or a pass
  already running (wait).
- 422 = no reviewable shot cards in scope — your section/journey choice is
  wrong, or the screens were never pushed. Fix the scope, don't retry blind.

Findings stream in as the review pass completes. Poll `review-passes` until the pass is
`completed` (or `failed`) — it takes minutes, not seconds; check in with the
user rather than spinning hot.

## Phase 2 — read and triage the findings

`GET /api/v1/boards/{slug}/ai-annotations` — there is deliberately no MCP
tool for this yet; the raw API is the path. Each finding: `cardId`, `region`,
`category`, `severity`, `summary`, `detail`, `state`, `kind`.

Triage the whole set at once, grouped by root cause exactly like
`/vitrinka:resolve` Phase 2 — five contrast findings on five screens are ONE
token fix, not five:

- Work `proposed` findings of kind `finding`. `refuted` means the reviewer already
  talked itself out of it — read those only as context. `kind: suggestion` is
  taste: surface to the user, don't auto-implement.
- **Verify before fixing.** A finding is a claim; check it against the actual
  code/tokens. A finding that's wrong gets a line in your report ("F: claims
  X; the code does Y") — the user dismisses it, not you.
- `severity` orders the work; it doesn't gate it. A blocker that's wrong is
  still wrong.

**Your own findings** (the user asked YOU to review screens, or you spot
what the reviewer missed): `get_card_image {board, cardId}` per screen — measure on
the pixels, then ONE `annotate {board, agent, items:[{key, cardId,
cardVersion, region, summary, detail, category, severity}]}` batch. They land
`staged` for the user's Accept/Dismiss; never file findings as document or
`finding` cards via compose_board, never `highlight` them. Doctrine: docs
topic `annotation`.

## Phase 3 — fix, reshoot, next pass

1. Fix the confirmed findings block-by-block, one coherent commit each — the
   resolve skill's scope discipline applies verbatim.
2. Re-capture the affected screens the way this repo does it (`vitrinka
   snap`/journey script) and push the set.
3. Compose the iteration as a NEW pass on the chain:
   `compose_board {board, journey, pass: "next", …}` with the fresh screens —
   never overwrite the reviewed section; the chain is the audit trail.
4. `request_review {board, journey}` — the reviewer now reviews the new pass with the
   old one attached, so it can confirm fixes and catch regressions.

## Phase 4 — report

One summary to the user (and to the board as a `callout` card when the session
is board-first): findings confirmed-and-fixed (with commits), findings you
believe are wrong (with evidence, for their dismiss click), suggestions left
for their call, and the new pass's outcome when it lands.

## Don't rationalize

- "The pass is requested, my job is done" → the loop is request → triage →
  fix → next pass. A dangling pass is worse than none; its findings rot.
- "Eve flagged it, so it's a bug" → the reviewer proposes. Verify against code first;
  pushing back with evidence is a valid resolution.
- "I'll just accept the obvious ones on the board" → you have no verdict.
  Fix code; the user clicks accept/dismiss.
- "I'll re-shoot onto the same section" → chains exist so the reviewer sees
  the delta. Same-section overwrites destroy the before.
- "Severity low, skip reading it" → low-severity findings cluster into the
  cross-cutting blocks that ARE worth fixing.

## Red flags — STOP

- You are about to PATCH an ai-annotation's `state`.
- You are fixing a finding you never located in the code.
- Your findings are document cards or a compose_board `finding` instead of
  `annotate` items with regions on the actual screenshots.
- A pass is `running` and you're requesting another.
- Your next pass has fewer screens than the findings you claim to have fixed.
- You've read findings one HTTP call at a time instead of the one board-level
  GET.
