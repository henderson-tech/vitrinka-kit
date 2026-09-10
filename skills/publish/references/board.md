# Intent: board — boards born organized (+ testing-journey suites)

**Delegation:** this intent's creation + composition work runs in the
`vitrinka-publisher` agent — see the Delegation section in `../SKILL.md`.
Brief it with this file's path so it follows these contracts itself.

A board created bare (`create_board {slug}` and nothing else) is homeless: no
project group in the sidebar, no type, no meta — and retrofitting organization
later never happens. This skill makes the metadata a first-class part of
creation, and encodes the journeys grammar that turns vitrinka into the
testing-suite management surface.

## Creating any board

1. **Check it doesn't exist**: `list_boards {project}` — a 409 on create means
   reuse **only when the board is already yours**, never suffix-mint a
   duplicate. The 409 body names the incumbent's `project` and `url`: a
   different project's board is a collision, not a reuse — pick another slug
   and leave that board alone. (Adopting one is how an app's PR journey and an
   AI-review session ended up sharing the same canvas.)
2. **Create fully-specified** — every field you know at birth goes in the one
   `create_board` call:
   - `slug` — `<project>-<purpose>` (`acme-payroll-audit`), stable, and
     **never a bare date**: slugs are workspace-global, so `2026-08-25` is
     every project's slug at once. A date belongs in a slug only behind a
     project (and usually a branch) that already scopes it — which is exactly
     what `vitrinka board create` defaults to when you pass no `--slug`:
     `<project>-<branch>-<setkey>`.
   - `board_type` — `board` (annotation canvas, default) | `brainstorm` |
     `journeys` (testing-journey suites, below) | another token when a real
     new family emerges. The type drives the sidebar's type groups for
     projectless boards.
   - `project` — files it under the project's sidebar group; omit only for
     genuinely cross-project boards.
   - `subgroup` — one more sidebar fold under the project. Canonical
     vocabulary: `reviews` (PR-review boards) | `testing` (QA/session/set
     boards) | `brainstorming` | `design` (mockups, design directions) |
     `journeys` (testing-journey suites). Stamp the matching one whenever the
     board belongs to a family; ad-hoc tags (`audits`) are allowed for real
     new families. When omitted the server infers it (brainstorm→brainstorming,
     journeys→journeys, `pr-<N>-*`→reviews, `s-YYYYMMDD*`→testing) —
     `design` has no pattern and must always be passed explicitly.
   - `meta` — the JSON bag: `{parentBoard}` for child boards,
     `{commitSha, tracedAt}` for git-tied ones. Stamp later with
     `set_board_meta` (merge-patch — send only the keys that change).
   - `theme` — the board's look, at birth or later via `set_board_meta
     {theme}` (`""` = house default; open vocabulary). Known bundles:
     `sketch` (hand-drawn: rough strokes + Caveat hand type, exports follow),
     `playful`, `technical`, `diary`, `girlies`, `release`. Pick `sketch`
     when the user asks for a hand-drawn / whiteboard mood.
3. **Structure template-first**: `get_templates` ONCE, start from the matching
   skeleton (QA session, decision map, dashboard, deck, journey suite …) in
   one `compose_board` call per coherent unit — intent not coordinates;
   a single card is a batch of one, anchored by relation. Save a
   recurring structure of your own with `save_template` and instantiate via
   `compose_board {template, params}`.
4. **Hand over the server's `url` field** from the create/list response — it
   carries the `/w/<workspace>` segment; never compose a path yourself.
5. **Arm the listener AUTOMATICALLY** — if this session will service the
   board's annotations (it almost always will), follow the listen skill
   (`/vitrinka:listen`; the plugin's `skills/listen/SKILL.md`) right after
   creating: arm the monitor exactly as that skill specifies (the `exec` in its
   Monitor command is load-bearing — without it the watch outlives the session
   and holds the board's lease forever), announce
   `⏳ listening — annotate away`. Never offer or wait to be asked — a board
   without a live listener silently queues annotations nobody reacts to.

## Testing-journey suites (`board_type: "journeys"`)

The management surface for an app's code-derived testing-journeys
(`.testing-journeys/` docs in the app repo). Vitrinka holds the living map;
the app repo holds the truth; the trace stamp ties them. Full grammar with a
compose-ready skeleton: `get_templates` → **template 10**. The shape:

- **One suite board per area** — `<project>-<area>-journeys`, type
  `journeys`, subgroup `journeys`. One SECTION per journey inside it; steps
  embed the journey's screens (`step {image|cardId}` — reference sets you
  already pushed, never re-upload); a `checklist` per journey for the sweep.
- **Git tie**: at trace time stamp `meta.{commitSha, tracedAt}` plus the
  `journeys: {"<journeyId>": {section}}` map — that map is how a refiner (or
  a later session) resolves journey id → section deterministically. The
  board's drift badge derives from meta: `driftedBy` set means a PR touched
  the journey's anchors (`drifted · PR #n`); after refreshing the affected
  sections, clear it and advance `commitSha`/`tracedAt` in one
  `set_board_meta` merge-patch.
- **Runs are child boards**, never sections on the suite: create with
  `meta.parentBoard = "<suite-slug>"` (nests under the suite in the sidebar)
  and portal-link it in the suite's "Runs" section (`kind:"board"`). Fill the
  run as a QA session (template 1): steps flip `status` via `update_cards` as
  the run progresses — never stack retest cards — and close with ONE summary
  callout.
- **Iterating a journey** after code changes = the suite section's NEXT PASS
  (`compose_board {journey, pass:"next"}`, template 2) — the old pass stays
  for comparison and `request_review {journey}` reviews the delta.

### Token economy — vitrinka as the testing central only works if cheap

| Instead of | Do |
|---|---|
| Scraping the suite board for state | `list_sections` — journeys[], passes, latest, per-section counts |
| Re-uploading screens per run | `step {image}` referencing the pushed set, or `cardId` for a live face |
| A new board per test execution idea | one suite per AREA; runs as children; passes for iterations |
| Rebuilding structure per session | the `meta.journeys` map + template 10; `save_template` for house variants |
| N compose calls | one compose per suite/run/pass |
| Finding suites by scanning all boards | `list_boards {project, board_type:"journeys"}` |

The app-repo side (which journeys exist, anchor-index, affected-journeys from
a diff) belongs to the app repo's own skill (e.g. its own `acme-journeys`) —
this skill owns the vitrinka surface those tools write to.

## Don't rationalize

- "I'll create the board now and organize it later" → later is never. The
  create call carries type/project/subgroup/meta or the board is born lost.
- "A run is small, I'll add it as a section on the suite" → runs are child
  boards; suite sections are journeys. Mixing them breaks the sidebar
  nesting, the pass chains, and every future session's mental model.
- "I'll invent the suite structure, it's simple" → `get_templates` is one
  call; template 10 is the agreed grammar. Divergent suites can't be managed
  centrally.
- "The journey changed, I'll edit the old section in place" → next pass.
  Non-destructive iteration is what makes drift auditable.
