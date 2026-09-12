# Feature brief — template and caps

The brief is the ONE document an implementing session (or a subagent) reads
instead of the brainstorm. `compose_brief {id: <epic>}` returns it with the
deterministic sections filled from the board's picks and every prose section
holding a `<!-- skill -->` placeholder; the skill replaces each placeholder
under the cap beside it. A brief that still carries a placeholder is visibly
incomplete — that is the point of the marker; never delete one without
filling it.

**Trim, never append.** A cap is a hard ceiling: when a section would exceed
it, cut the weakest lines until it fits. Do not add a "continued" section, an
appendix, or a link to a longer version. If the feature genuinely needs more,
it needs splitting into two epics, not a longer brief.

Filename: `<topic>-brief.md`; a later pass uploads the next VERSION of the
same filename (`upload_task_file` keeps the lineage), never a second file.

```markdown
# <Topic> — Brief

Epic: <url> · brainstorm <board url> (Plan chapter: scrape_board {section: "Plan"}) · log: docs/specs/<date>-<topic>-decisions.md

## Intent
<!-- skill --> 3 sentences: the problem, the outcome, who it is for.

## Vocabulary
<!-- skill --> ≤ 8 terms · `term` — one-line meaning, as resolved in round one.

## As-is
<!-- skill --> ≤ 12 lines. What exists today, naming the REAL files, packages
and routes (`internal/web/x.go`, `/p/<project>?task=`), not descriptions of them.

## To-be
<!-- skill --> ≤ 15 numbered user stories, one line each:
1. As a <actor>, I want <thing>, so that <benefit>.

## Architecture
<!-- server --> the architecture diagram card from the Plan chapter (link).
<!-- skill --> Boundaries, ≤ 10 units, one line each:
- `<unit>` — does: … · used by: … · depends on: …

## Decisions that matter
<!-- server --> one row per decision: key · title · chosen option · rejected labels · diagram link.
<!-- skill --> ≤ 8 load-bearing calls only, each "chosen over X because Y". Preference-level calls stay in the log.

## Prerequisites
<!-- skill --> ≤ 8: migrations, settings, credentials, other epics, external dependencies.

## Acceptance criteria
<!-- skill --> ≤ 15, each testable, each naming the story number it proves and the test seam (e.g. "S3 · e2e/pm-brief.spec.ts" / "S7 · store.Pickup unit").

## Work packages
<!-- skill --> ≤ 8, ordered, DISJOINT files, one line each — the unit a subagent takes:
1. <name> — files: … · done when: …

## Open questions
<!-- server --> unanswered decisions from the board, if any.

## Out of scope
<!-- skill --> what was explicitly cut, one line each.

## Refs
<!-- server --> the epic's refs with their `meta.load` (brief first · brainstorm board on-demand · others).
```

Section markers: `<!-- server -->` lines are filled by `compose_brief` and are
not edited by the skill; `<!-- skill -->` lines are the skill's and are
replaced, marker included, with the content. A server section the skill
disagrees with is fixed on the board (reopen the decision), then recomposed —
never patched in the markdown.
