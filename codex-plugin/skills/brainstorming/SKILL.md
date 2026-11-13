---
name: brainstorming
description: "Use before any creative work — a new feature, component, capability or behaviour change — and on 'brainstorm', 'design this', 'think this through with me' before code is written."
metadata:
  vitrinka-contract: "2026-09-15"
---

# brainstorming

Output: a committed decision log and a feature brief the next session builds from. Procedure: `docs {topic: "guide:brainstorm-flow"}` (CLI `vitrinka docs guide:brainstorm-flow`). Board mechanics and payload shapes: `references/board.md`; brief template and caps: `references/brief.md`.

<HARD-GATE>
Do NOT write code, scaffold, or invoke implementation skills until the decision map's questions are answered (or the user explicitly says "just build it"). A truly trivial task still gets a 1-2 question map.
</HARD-GATE>

## Laws

- Bind scope before filing: resume the project's explicit session binding; unknown asks for an active sprint or **No sprint** and persists the choice before the feature is created.
- Children and required follow-ups inherit approved scope; never infer scope from dates or the sole active sprint.
- `default` spends 1–3 rounds; the argument `deep` lifts the limits, puts the board on from the start and forces the architectural path; both produce the same log, brief and Plan chapter.
- Prototype code under `deep` is labelled throwaway and never lands on the branch.
- Classify out loud first (spike, bounded, architectural) so the user can override; hidden complexity upgrades the path, nothing downgrades it.
- Write the map out as visible assistant text, in a message of its own, before any `AskUserQuestion` call; never carry it inside question text or option labels.
- The user edits the map before any question; their cuts are final, their additions go in.
- Only decisions with real alternatives make the map; a single sane answer is a stated assumption in the log.
- Up to 4 questions per `AskUserQuestion` call, always the frontier; done when the frontier is empty.
- Facts are your job; only decisions go to the user; never re-litigate a settled answer; never ask what the codebase answers.
- Recommendation first (suffix "(Recommended)", the description says why); every option's description carries its tradeoffs; `preview` for anything structural; never hard-block an off-map answer.
- The feature epic is the record; the feature has ONE worktree, created when the epic exists; the log and the brief are its first commits and the build continues on that branch.
- Never open a docs-only PR for the log; never create a second worktree for the code.
- Write the brief before code; never write a separate implementation plan (`docs/plans/*-implementation.md`, phased WP documents): the brief's work packages are the plan.

## Decision log

- File `YYYY-MM-DD-<topic>-decisions.md` in the project's spec directory with sections Summary (2–3 sentences), Decisions (`| # | Decision | Call | Why |`), Assumptions, Architecture notes (only what a fresh session needs), Open questions.
- Attach it to the epic: `upload_task_file {kind: "decision", filename: "<topic>-decisions.md", source: {ref: "<repo path of the log>.md", rev: "<git sha>"}}`; a later pass uploads the next VERSION of the same filename, never a second lineage.
- Cite a decision in source as `(vitr:dec/…)` from the upload's `rowCites`, after a self-contained sentence; never a bare `(Dn)`.
- A parser `warning` never creates a replacement edge; `get {kind: "cite", codes: [...]}` resolves a code, `create {kind: "cite", target}` mints one (`docs {topic: "guide:cite"}`).

## Feature brief

- `compose_brief {id: <epic>}` (CLI `vitrinka task brief <id>`) is the ONE door to the skeleton; fill its `<!-- skill -->` placeholders under the caps in `references/brief.md`; trim to the cap, never append past it.
- Name real files and routes, never descriptions of them.
- Upload with the server's lineage: `versionOf: <ref.id>`, `filename: <ref.meta.filename>` (CLI `vitrinka task upload <epic> <file> --kind brief --version-of <ref.id>`); never the topic or dated filename, which forks a second lineage.
- A trivial map with no epic has no brief; the log's Architecture notes are the hand-off.
- `404 no_brainstorm_board` from compose: write the whole brief from `references/brief.md` and upload it under the same name with `kind: "brief"`.

## Closing question

- The last `AskUserQuestion` is "In which style to implement?", opening with this session's context reading (tokens and percent).
- A mostly spent session never recommends Build here.
- **Build here**: this session, the feature worktree, the whole remaining budget.
- **Fresh session**: after the hand-back, run `vitrinka qa session launch '<task url>' '<feature worktree abs path>'` (it runs `$VITRINKA_SESSION_LAUNCHER`; never wrap that variable in `sh -c`); exit 0: print its receipt line and stop; non-zero: print `/continue <task url>` and stop.
- **Subagents**: fresh native agents (never `fork`), one per ordered `Work package` with disjoint files, `model` set on each call, one reviewer agent after each phase.
- A spike ends in its recommendation instead.
- On a bound task finish with `work handoff`.

## Board

- An existing canvas meant for Studio is converted, never recreated: `set_board_meta {slug, board_type:"brainstorm"}`; subgroup alone never selects Studio.
- Use the board for 2–3 different visual takes (layouts, directions, flows) or on an explicit ask; plain preference questions stay in `AskUserQuestion`; offer it once, just in time; on decline stay text-only.
- A take of an in-app surface renders with the app's `app.css` and real components, never a private kit.
- Until the board exists and its URL is handed over, the written-out terminal map is mandatory; with a board, the full map lives on it (one chapter section per decision) and the terminal map shrinks to its titles.
- Once the URL is handed over, never open `AskUserQuestion` for a decision that has a chapter: print the titles and the URL, listen, end the turn.
- Move board questions to the terminal only on the user's explicit ask, retracting them from the board; never ask in both.
- A decision settled in the terminal closes its board question: `update {kind:"question", id, answer, note}`; a 409 names a different board pick: ask which stands.
- A dropped direction is cancelled, never left Active: `update {kind:"brainstorm", board, action:"plan"}` dry-runs, then `action:"cancel", rows` with the rows the user keeps selected; `reopen` undoes it.
- Close an epic-less brainstorm with `finish`; one with an epic finishes when the epic is done.
- Read `references/board.md` before composing anything on a board; every payload shape there is exact.
- A board session listens per the `listen` skill; without a background wake path drain once and end on idle; never loop empty MCP waits through the model.
