---
name: publish
description: "Use when asked to capture or visualise UI work on vitrinka — 'publish', 'screenshot', 'journey', 'walkthrough', a testing-suite board; authored documents, pages and diagrams are artifact."
metadata:
  vitrinka-contract: "2026-09-15"
---

# publish — one skill, four intents

Everything *captured* lands here; everything *authored* (standalone documents,
pages, diagrams, docs boards) is the **artifact** skill. Pick the intent
first, then follow the procedure.

Procedure — capture steps per intent: `docs {topic: "guide:publish-capture"}`
(CLI `vitrinka docs guide:publish-capture`).

| Intent | Deliverable | When |
|---|---|---|
| **session** | testing board that fills live | sticky capture while building — "screenshot this as I go" |
| **journey** | signpost flow map — screens wired by *what was clicked* | visualize a user journey: multi-step, branching, full-page |
| **walkthrough** | client-facing annotated walkthrough | outsiders will read (and annotate) the journey |
| **board** | a deliberately organized board / testing-journey suite | board management, not capture → `references/board.md` |

Ambiguous ask: UI work in progress → **session**; a flow with named
steps/paths → **journey**. Escalate session → journey mid-stream whenever
branching shows up — same set, same board slug.

## Delegation — capture is yours, publishing is the agent's

**Capture stays in this session; composition runs in the plugin's
`vitrinka-publisher` agent** (you just wrote the code — `--src`, `--state`
and `--action` depend on that knowledge). Everything compose-shaped
delegates: the structure pass, steps sections, summary card, walkthrough
narrative, board suites. Dispatch via the Agent tool, `subagent_type:
"vitrinka-publisher"`, in the **background** — keep working; the completion
notification carries the result.

- **Stays inline**: the one-command initial import (`board-from-set` /
  `journey-from-set`) — a single idempotent CLI call; run it yourself so the
  user gets the URL the moment the board exists. Incremental re-runs too.
- **Brief the agent fully** — it starts with zero context: the intent, this
  skill's base directory (so it Reads the intent's section +
  `references/card-kinds.md` itself), repo root + set root, what was captured
  (labels, declared branches, narrative), board slug/project/subgroup + meta,
  the summary verdict you want, the resolved `qa.id` + its `journey`
  children, and — on update passes — what changed.
- **When the notification lands**: relay the server-returned URL to the user
  and inspect `writebacks`. For each write-back, validate that `ref` is a safe
  repo-relative path in the active worktree, replace it with the supplied
  complete `md`, commit and push it with the current work, then refresh that
  repo-backed card from the pushed content. An unsafe or inapplicable
  write-back is reported, and the publish is not claimed complete. Once
  write-backs are settled, arm the listener YOURSELF (the listen skill) — a
  subagent can never arm the parent's monitor. Never fabricate or predict the
  URL while waiting.
- **Fallback ladder** (say which rung you're on): `vitrinka-publisher` agent →
  (agent type unavailable — Codex ships skills only) inline, same contracts,
  straight from this file.

## Capture laws (every intent)

- **`.vitrinka/` is machine-local** and ignores itself through its own
  `.gitignore`, which the CLI writes — never add vitrinka lines to the repo's
  `.gitignore`. Ad-hoc output lives under `.vitrinka/scratch/<topic>/`, never
  a root-level `.screenshots-<topic>` dir or loose repo-root files.
  `.vitrinka/screenshots/.active` is the ON marker; its absence is OFF.
- **The board URL is the server-returned `url`** (it carries
  `/w/<workspace>`) — never hand-compose `{base}/boards/<slug>`. Slug =
  set-key: re-imports of the same set update the same board.
- **`--src` is the highest-value field** — the implementing file + 1–2 key
  components as repo-relative paths; an annotation on the shot then
  dispatches with exact file targets. `--state` records what a reproducer
  needs.
- **Web captures are 2× — always.** Native sim/device captures are already
  native-res — never downscale them.
- `--open <deeplink>` does navigate + wait + capture — never chain shell
  sleeps. Snap pushes detached — never wait or poll.
- **Read the saved image to verify** — right screen, right state.
  Non-delegable.
- **Full-page**: the viewport shot is the PRIMARY card (wires anchor in the
  chrome); a content-only companion shot only when the main content
  genuinely overflows; never scroll-and-stitch.
- Never commit shots. Write auth: `VITRINKA_TOKEN` env or `vitrinka auth
  token` — never echo it. Never run `vitrinka update` unprompted or repeat
  the offer.

## Board laws (session + journey wrap-up)

Per-kind payload contracts: the `docs` MCP tool; kind index + doctrine:
`references/card-kinds.md`. One `compose_board` call per coherent unit,
`get_templates` first, never invent card shapes.

- **Steps ARE the walkthrough**: ONE `section` per journey/area, a numbered
  `step` per screen with `status` and `image: {project, branch, selector,
  file}` naming the shot in THIS session's set. Never keep a serpentine flow
  of raw shots next to a steps section — skip `board-from-set` or remove the
  duplicate row through `update_cards {remove:[…]}` (anyone else's cards:
  `409 needs_confirm` → repeat with `confirm:<token>` + `reason`).
- **Live annotate→fix loop on a single screen** stays a real shot card —
  pixel-space crops and face versioning only exist on shot/media cards.
  pin: e2e/board-v5.spec.ts#lightbox from the deck: full image, version filmstrip after swap, ⌖ target
- **"Review these screens and annotate what's off"** is the `annotate` tool
  (native staged annotations with regions — `get_card_image` per screen
  first), never a `finding`/document card and never `highlight`; docs topic
  `annotation`.
- **Every board ends with ONE summary `callout`** — verdict, counts, links,
  what was NOT covered; later passes UPDATE it, never stack a second.
  Statuses live on the cards (`step.status`).
- **Iteration = next pass** (`pass: "next"`), never mixed takes.
- **Report the spend**: `usage: {tokens, effort}` on every `create {kind:"board"}`,
  `compose_board` and `update_cards` — not verified or billed.
- **The listener is yours**: after the wrap-up, arm it per the listen skill,
  announce `⏳ listening — annotate away`, END the turn.

## Journey laws

- **`--target` is the clicked element's bbox in IMAGE px — measured, never
  eyeballed** (× `devicePixelRatio` on retina, at the shot's scroll state).
- `--next <LABEL>` names the target shot's `--label`; a fabricated chain
  edge into a branch target, or back into its source, is suppressed. One
  screen appears once; branches from anywhere point at its label.
- **The tree IS the deliverable** — never convert a journey into a steps
  section (steps are for QA walkthroughs; the signpost map is for
  understanding the flow).
- Without the CLI: `compose_board` edges take `fromRegion`/`toRegion`
  `{x,y,w,h}` in image px and an optional `rel: "subtask" | "blocks" |
  "refs"` — canvas relationships, not the task engine's `task_links`.

## Walkthrough laws

- Reader-facing `--action`/`--title`/`--note`, in the client's language and
  voice; ONE intro `text` card, a `callout` per caveat.
- A share link (`share_board` / `vitrinka board share`) shares the WHOLE
  board — never mint on one that carries drafts the client must not see.
  Hand the share URL bare on its own line.
- Sandbox/demo org for any shot listing tenant data; mint-then-revoke any
  credential that appears on screen.

## QA-plan laws (every intent)

- **Test results never come through this skill.** Runner output goes through
  `vitrinka qa run -- <test command>`; an exploratory session through
  `vitrinka qa usertest start · case · snap · verdict · finish`. This skill
  keeps only the free-form walkthrough: a client-facing story, a design
  review, screens with no verdict.
- **Resolve the target BEFORE dispatching the publisher** (`vitrinka task
  resolve-qa`). Exit 4 = no qa task: publish UNLINKED and say so in the
  hand-back. Never create a qa task or a journey from a publish.
- **The publisher stamps the board once** (`add_task_ref {kind: "board",
  meta: {board: true}}`) and links sections to `journey` children by
  `fields.key`, else EXACT title; an unmatched section is listed under
  `warnings`, never force-matched.
- **Verdicts are never a walkthrough's** — a finding worth a verdict is an
  exploratory case whose `finish` files the bug.
- On a bound task the hand-back is the handoff skill's `rendered` block.

## Gotchas

- `VITRINKA_TOKEN` or the OS keyring is always required. A failed push writes
  `.vitrinka/screenshots/.vitrinka-offline` — warn once, keep capturing.
- Desktop app: test the `~/.config/vitrinka/desktop-app` flag file, never
  probe /Applications.
