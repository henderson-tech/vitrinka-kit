---
name: brainstorming
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Decision-led design: Claude maps the decisions, the user leads architecture and scope via batched multiple-choice; ends in a committed decision log, then builds."
metadata:
  vitrinka-contract: "2026-08-30"
---

# Decision-Led Brainstorming

Turn an idea into settled decisions fast. Claude does the legwork — reads the codebase, finds the decision points that actually matter, presents them as rich multiple-choice with recommendations and previews. The user steers scope, direction, and architecture. The output is a short committed decision log, then implementation starts directly from it.

<HARD-GATE>
Do NOT write code, scaffold, or invoke implementation skills until the decision map's questions are answered (or the user explicitly says "just build it"). This applies regardless of perceived simplicity — for a truly trivial task the decision map may be 1-2 questions, but it still gets presented.
</HARD-GATE>

## Flow

```
Explore context → Decision map (user edits it) → Batched Q&A → Decision log (commit) → Build
```

### 1. Explore context

Read the project's CLAUDE.md, relevant source, docs, and recent commits. For UI work, resolve the surface's DESIGN.md. Understand what exists before proposing anything — options must be tailored to this project's stack and patterns, never generic.

**Scope check first:** if the request spans multiple independent subsystems, say so immediately and help decompose. Each sub-project gets its own decision map → log → build cycle. Don't burn questions refining details of something that needs splitting.

**The feature epic is the record.** Before the map, find or file the epic this work belongs to — it is where the brainstorm board, the decision log, the PRs, the QA plan and the final artifact will hang (feature lifecycle 2026-09-08). An epic already in context (named by the user, the branch's `vt-<id>`, a `feature:` line from a handoff) is used as is; none → `create_task {type: "epic", title: "<the topic as a sentence>", fields: {outcome: "<one line>"}}` (the feature preset fills in as decisions settle) and quote its `shortUrl` in the map message. When a brainstorm board exists (below), attach it once: `add_task_ref {id: <epic>, kind: "board", ref: "<slug>", meta: {board: true}}`. A trivial map (1–2 questions on a one-file change) files no epic — say so and move on.

### 2. Decision map — the user sets the agenda

Open with the map, not a question:

> "Here are the N decisions that actually matter for this, in dependency order: 1) … (stakes: …), 2) …, 3) … Anything to cut, add, or reorder?"

**The map is WRITTEN OUT, always — as visible assistant text, in a message of its own, before any `AskUserQuestion` call.** A map that exists only in your reasoning does not exist: `AskUserQuestion` renders header + question + options and nothing else, so a map-check whose options say "cut #6" / "drop the HMR question" is unreadable when the numbered list was never printed. Never carry the map inside the question text or the option labels. Sequence, no exceptions: print the numbered map → then (optionally) one `AskUserQuestion` to collect edits to it.

- Each entry: one line naming the decision + one line of stakes (what it constrains downstream).
- Only decisions with real alternatives make the map. If there's one sane answer given the codebase, don't ask — state the assumption in the log instead.
- The user edits the map before any question is asked. Their cuts are final; their additions go in.
- When the whole feature has genuinely distinct architectural approaches, "which approach" is simply the first decision on the map — with the fork's consequences as the stakes. There is no separate mandatory "approach selection" phase.

### 3. Batched Q&A — frontier rounds, up to 4 per call

Use `AskUserQuestion` with **up to 4 questions per call**. Each round asks the **frontier**: every open decision whose prerequisites are already settled. A question whose best options depend on an answer still open this round belongs to a later round — asking it now means guessing at answers you haven't heard. Settled answers push the frontier outward; recompute it between rounds. Most maps settle in 1-3 rounds, and you're done when the frontier is empty — nothing left silently assumed.

**Facts are your job; only decisions go to the user.** When a frontier question hinges on an environment fact (what the code does, what a config says), look it up — or dispatch a subagent and, without blocking, ask the rest of the frontier while it runs; only the dependent questions wait.

Question design:
- Lead with your recommendation: first option, "(Recommended)" suffix, and make the description say WHY.
- Every option's description carries tradeoffs — what it costs and constrains, not just what it is.
- Use `preview` for anything structural: ASCII mockups for layouts, code snippets for API shapes, component trees for architecture. Skip previews for plain preference questions.
- The engine auto-appends "Other" — never hard-block an off-map answer.
- Between rounds, one short sentence on how the answers reshaped what's left. No re-litigating settled answers.

### 4. Decision log — short, committed

Write `docs/specs/YYYY-MM-DD-<topic>-decisions.md`:

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

Commit it. No prose spec, no self-review loop, no reviewer subagent, no formal approval gate — the table IS the user's answers, already approved by giving them.

Then attach it to the epic as its decision record: `upload_task_file {id: <epic>, kind: "decision", filename: "<topic>-decisions.md", content: <the log>, hint: "read before building or revising <topic>"}` — a later pass on the same topic uploads the next VERSION of the same filename, never a second lineage. Tick the epic's `decisions` gate items as the table settles them (`fields.decisions[].done` with the log as `evidence`).

### 5. Build — directly

Start implementing from the decision log in the same session (worktree if a branch is warranted). Do NOT write a separate implementation plan (`docs/plans/*-implementation.md`, `/superpowers:writing-plans`, phased WP documents) — the user has explicitly rejected that step as slow and quality-degrading. In-session task tracking (TaskCreate) is fine; a committed plan document is not. Only write one if the user explicitly asks.

## Principles

- **User leads, Claude maps.** The user owns scope, direction, and architecture calls; Claude owns finding the decision points and doing them justice.
- **Don't ask what the codebase already answers.** Every question must have real alternatives; obvious calls become logged assumptions.
- **YAGNI ruthlessly** — strip speculative features from every option.
- **Tailored, never generic** — options reference this project's actual files, patterns, and constraints.
- **Speed is a feature.** Batch questions, keep the log short, get to code.

## Visual surface: vitrinka brainstorm boards

For heavy UI questions, the visual surface is a **vitrinka brainstorm board** — the persistent artifacts app — an authenticated service: `vitrinka auth login` mints your token, and `VITRINKA_TOKEN` or the OS keyring is always required (default base `https://app.vitrinka.ai`; self-hosted deployments set `VITRINKA_URL`). No throwaway server: the board outlives the session and the user annotates/answers from any signed-in machine.

**When:** for questions where 2-3 *different visual takes* beat prose — full-screen layouts, competing design directions, flows — OR when the user explicitly asks for a board session. Plain preference questions stay in the terminal (`AskUserQuestion`). "Which wizard layout?" → board. "What does personality mean here?" → terminal. When a board session is on **and the board actually exists** (created, composed, URL handed over), the FULL decision map lives on the board (step 2) — every decision is its own CHAPTER section (`<key> · <title>`) holding its entry, per-option diagrams and takes, and the camera follows the operator's active question — and the terminal carries only the numbered map list plus quick clarifications — the terminal map is never skipped, only shortened to its titles. Until the board exists, terminal mode is in force and step 2's written-out map is mandatory.

The full board flow — creation, the decision-map template, ground-truth
imports, visual takes, the ↻ regenerate flow, the payload cheat sheet, and the fallback
ladder — lives in `references/board.md`. Read it before composing anything on
a board; every payload shape there is exact (a drifted shape costs a 400).

**Report the spend behind every composition.** Pass `usage: {tokens, effort}` on `create_board`, `compose_board` and `update_cards` — your own rough estimate of what the call cost you that the server cannot see (thinking + reading the takes you drew from; `effort` low | medium | high). A one-line self-report, never validated, never billed; it lands in the workspace's agent calls ledger, which the `query` tool / `vitrinka query` reads back as SQL.

**Offer just-in-time, never upfront.** The first time a genuinely visual fork appears, offer it as its own message ("I can put the 2-3 takes on a vitrinka board you can click through and answer on — want that?"). On decline, stay text-only and don't offer again unless they raise it. The decision log links the board URL under the relevant decisions.
