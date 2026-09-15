---
name: brainstorming
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Decision-led design: Claude maps the decisions, the user leads architecture and scope via batched multiple-choice; ends in a committed decision log and a feature brief, then builds or hands off."
metadata:
  vitrinka-contract: "2026-09-15"
---

# Decision-Led Brainstorming

Claude maps the decisions as rich multiple-choice with recommendations and previews; the user steers scope, direction and architecture. Output: a short committed decision log plus a **feature brief** the next session or a subagent builds from directly.

Procedure: `docs {topic: "guide:brainstorm-flow"}` (CLI `vitrinka docs guide:brainstorm-flow`). Board payload shapes: `references/board.md`; brief template and caps: `references/brief.md`.

<HARD-GATE>
Do NOT write code, scaffold, or invoke implementation skills until the decision map's questions are answered (or the user explicitly says "just build it"). A truly trivial task still gets a 1-2 question map.
</HARD-GATE>

## Laws

- **Two levels, ONE flow, the SAME artifacts** (log · brief · Plan chapter). `default` spends 1–3 rounds; the argument word `deep` lifts the limits, keeps the board on from the start and forces the architectural path. Prototype code under `deep` is labelled throwaway and never lands on the branch.
- **Classify first, out loud** — spike / bounded / architectural — so the user can override it. The ratchet is one-way: hidden complexity upgrades the path, nothing downgrades; when in doubt, take the heavier path.
- **The map is WRITTEN OUT, always** — visible assistant text, a message of its own, before any `AskUserQuestion` call. Never carry the map inside the question text or option labels. A map that is not printed does not exist; simple means a 1–2 question map, not no map.
- **The user edits the map before any question is asked.** Their cuts are final; their additions go in. Only decisions with real alternatives make the map; one sane answer given the codebase is a stated assumption in the log.
- **Up to 4 questions per `AskUserQuestion` call**, always the frontier; done only when the frontier is empty. Facts are your job, only decisions go to the user; never re-litigate settled answers.
- **Question design**: recommendation first ("(Recommended)" suffix, the description says WHY); every option's description carries its tradeoffs; `preview` for anything structural; the engine auto-appends "Other" — never hard-block an off-map answer.
- **The feature epic is the record** and **the feature has ONE worktree**, created when the epic exists; the log and the brief are its first commits, the build continues on the same branch. A docs-only PR for the log is NEVER opened; a second worktree for the code is never created.
- **The brief is written before code.** Whatever the exit, do NOT write a separate implementation plan (`docs/plans/*-implementation.md`, phased WP documents) — the brief's work packages are the plan; a committed plan document is not.
- **A session that is mostly spent never recommends "Build here."** The closing question opens with the context-window reading (tokens and percent) because only the agent can see it.
- **Principles**: user leads, Claude maps · don't ask what the codebase already answers · YAGNI ruthlessly · tailored, never generic · speed is a feature.

## Decision log — template

`YYYY-MM-DD-<topic>-decisions.md` in the project's spec directory, committed:

```markdown
# <Topic> — Decisions

## Summary
2-3 sentences: the problem and the shape of the solution.

## Decisions
| # | Decision | Call | Why |
|---|----------|------|-----|

## Assumptions
Things not asked because one answer was sane — stated so they're contestable.

## Architecture notes
Only what a fresh session needs to build correctly: key components, data flow, integration points. A few lines or one diagram — not a spec.

## Open questions
Deferred decisions, if any.
```

Attached to the epic with `upload_task_file {kind: "decision", filename: "<topic>-decisions.md"}`; a later pass on the same topic uploads the next VERSION of the same filename, never a second lineage.

## Feature brief — contracts

- `compose_brief {id: <epic>}` (CLI `vitrinka task brief <id>`) is the ONE door to the skeleton; its deterministic sections come from the picks, its `<!-- skill -->` placeholders are filled under the hard caps in `references/brief.md`. Trim to the cap, never append past it. Real files and routes, not descriptions of them.
- **The lineage name is the SERVER's** — upload with `versionOf: <ref.id>` and `filename: <ref.meta.filename>` from the compose reply (`<epic-slug>-brief.md`), never the topic or the dated spec filename; a different name forks a second lineage and pickup reads the stale skeleton.
- A trivial map with no epic has no brief: the log's Architecture notes are its hand-off. A terminal-only brainstorm gets `404 no_brainstorm_board` from compose: write the whole brief from `references/brief.md` and upload it under the same name and `kind: "brief"`.

## Closing question — ALWAYS the last `AskUserQuestion`

"In which style to implement?" with three exits — **Build here** (this session, the feature worktree, the whole remaining budget) · **Fresh session** (print `/continue <task url>` and stop) · **Subagent-driven** (forks on the brief's ordered `Work packages`, disjoint files, one package per fork, ≤ 4 per phase, a context-inheriting fork reviewer after each phase). A spike ends in its recommendation instead. Before the hand-back on a bound task, run the `handoff` skill (`hand_back`) — the chat block is its `rendered` output.

## Visual surface: vitrinka brainstorm boards

An authenticated service: `vitrinka auth login` mints your token; `VITRINKA_TOKEN` or the OS keyring is always required (self-hosted deployments set `VITRINKA_URL`). No throwaway server: the board outlives the session.

- **Board vs terminal**: the board is for 2-3 *different visual takes* — layouts, design directions, flows — or an explicit ask; plain preference questions stay in `AskUserQuestion`. Offer just-in-time, once; on decline stay text-only.
- **Until the board actually exists** (created, composed, URL handed over), terminal mode is in force and the written-out map is mandatory. With a board, the FULL map lives on it — one CHAPTER section per decision — and the terminal map is shortened to its titles, never skipped.
- **Every payload shape in `references/board.md` is exact** — read it before composing anything on a board.
- **A board session listens**: once the URL is handed over, hold the highest rung of the listen skill's ladder (rung 3: hold this turn on `wait_for_work {board}`, never ending it on your own).
- **Report the spend**: `usage: {tokens, effort}` on every `create {kind:"board"}`, `compose_board` and `update_cards`.
