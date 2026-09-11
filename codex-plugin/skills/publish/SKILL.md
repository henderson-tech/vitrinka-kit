---
name: publish
description: Capture and publish UI work on vitrinka — sticky screenshot sessions, branching journey maps, client-facing walkthroughs, board and testing-suite organization. Use for "publish", "screenshot", "journey", or any capture/visualize-UI ask. Authored documents, pages, diagrams, and docs boards are the artifact skill.
metadata:
  vitrinka-contract: "2026-08-30"
---

# publish — one skill, four intents

Everything *captured* lands here; everything *authored* (standalone documents,
pages, diagrams, docs boards) is the **artifact** skill. Pick the intent
first, follow its section, share the core below.

| Intent | Deliverable | When |
|---|---|---|
| **session** | testing board that fills live | sticky capture while building — "screenshot this as I go" |
| **journey** | signpost flow map — screens wired by *what was clicked* | visualize a user journey: multi-step, branching, full-page |
| **walkthrough** | client-facing annotated walkthrough | outsiders will read (and annotate) the journey |
| **board** | a deliberately organized board / testing-journey suite | board management, not capture → `references/board.md` |

When the ask is ambiguous, default: UI work in progress → **session**; a flow
with named steps/paths → **journey**. Escalate session → journey mid-stream
whenever branching shows up — same set, same board slug.

## Delegation — capture is yours, publishing is the agent's

**Capture stays in this session; composition runs in the plugin's
`vitrinka-publisher` agent.** You just wrote the code — `--src`, `--state`,
and `--action` quality depend on that knowledge, so you drive the app and
snap. Everything compose-shaped then delegates: the structure pass, steps
sections, summary card, walkthrough narrative, board suites.
Dispatch via the Agent tool, `subagent_type: "vitrinka-publisher"`, in the
**background** (the default) — keep working; the completion notification
carries the result.

- **Stays inline**: the one-command initial import (`board-from-set` /
  `journey-from-set`) — a single idempotent CLI call; run it yourself so the
  user gets the URL the moment the board exists. Incremental re-runs of the
  same command too.
- **Brief the agent fully** — it starts with zero context: the intent, this
  skill's base directory (so it Reads the intent's section +
  `references/card-kinds.md` itself), repo root + set root, what was captured
  (labels, declared branches, narrative), board slug/project/subgroup + meta,
  the summary verdict you want, and — on update passes — what changed.
- **When the notification lands**: relay the server-returned URL to the user
  and inspect `writebacks`. For each write-back, validate that `ref` is a safe
  repo-relative path in the active worktree, replace it with the supplied
  complete `md`, commit and push it with the current work, then refresh that
  repo-backed card from the pushed content. If a write-back is unsafe or
  cannot be applied, report it and do not claim the publish is complete. Once
  write-backs are settled, arm the listener YOURSELF (the listen skill) — a
  subagent can never arm the parent's monitor. Never fabricate or predict the
  URL while waiting.
- **Fallback ladder** (say which rung you're on): `vitrinka-publisher` agent →
  (agent type unavailable — e.g. Codex, which ships skills only) inline, same
  contracts, straight from this file.

All mechanics: `vitrinka <cmd>` (zero-dep TypeScript).

1. Git-ignore `.vitrinka/` (`.gitignore` or `.git/info/exclude`), then `mkdir -p .vitrinka/screenshots && touch .vitrinka/screenshots/.active`. Ad-hoc session output (QA sweeps, audit dumps, one-off shots) goes under `.vitrinka/scratch/<topic>/` — never a root-level `.screenshots-<topic>` dir or loose repo-root files; `vitrinka tidy` sweeps legacy litter in.
2. `vitrinka remote-init --root .vitrinka/screenshots` — mints the session's set (auto project+branch from git, sticky).
3. Set the journey header (re-run when your understanding sharpens):
   ```bash
   vitrinka meta --root .vitrinka/screenshots \
     --kicker "<MODE · FLOW>" --title "<display title>" --accent "<vivid tail>" \
     --intro "<1–2 sentences>" --chip "Persona=<who>" --chip "Motiv=<light|dark>"
   ```
4. Capture with `snap` (below), publish with `board-from-set` (session) or
   `journey-from-set` (journey), hand over the SERVER-returned board `url`
   (it carries `/w/<workspace>` — never hand-compose `{base}/boards/<slug>`).
5. Sticky: `.vitrinka/screenshots/.active` is the ON marker (survives compaction;
   re-check it if unsure). OFF on "stop screenshots": `rm .vitrinka/screenshots/.active`.

### Each capture

```bash
vitrinka snap <ios|android|macos|web> \
  [--file <path>] [--open <deeplink>] [--settle <s>] \
  --route "<url or nav path>" --label "<STAGE, 1-2 uppercase words>" \
  --title "<short state title>" --note "<1-2 lines: what & why>" \
  --action "<what you do on this screen to reach the NEXT shot>" \
  --src <implementing file> [--src <key component>] \
  --state "<seed user · role · notable app state>"
```

- Capture **after render** (post hot-reload), one shot per coherent change; when unsure, capture.
- **`--src` is the highest-value field** — you just navigated the code, so you KNOW the screen's implementing file + 1-2 key visible components (repo-relative paths). An annotation on this shot then dispatches with exact file targets. `--state` records what a reproducer needs. Optional: `--device <name>`, `--viewport WxH[@scale]`, `--hq` (marketing assets: no lossy re-encode, no resize).
- ios = `simctl` · android = `adb` · macos = `screencapture` · **web** = capture via Playwright/chrome-devtools MCP (or `bunx playwright screenshot`, use `127.0.0.1`), then adopt with `--file`.
- **Web captures are 2× — always.** A headless MCP browser defaults to `deviceScaleFactor: 1`, and a 1× shot (1440 source px) blurs on the board the moment a Retina reader zooms past ~100% — the card shows `1× CAPTURE · RECAPTURE AT 2×` and the reader reads it as broken. Playwright script: `browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })`; `bunx playwright screenshot --device "Desktop Chrome HiDPI"`; chrome-devtools MCP: `emulate` with `viewport: "1440x900x2"` (the third number is the DPR) before the shot. `--viewport 1440x900@2` on the snap records it. Native sim/device captures are already native-res — never downscale them.
- `--open <deeplink>` navigates + waits + captures in ONE command — never chain shell sleeps.
- snap prints saved path + `(shot N)` and pushes detached — never wait or poll.
- Then **Read the saved image to verify** — right screen, right state. Non-delegable.

### Full-page capture — inner-scroll pages, content only

Web apps often scroll INSIDE a container (sidebar + header fixed, content
overflows) — a naive viewport shot cuts the content, a naive `fullPage` shot
produces a dead sidebar column. The recipe (Playwright MCP, `--isolated`):

1. **Viewport shot first, always** — chrome visible; this is the PRIMARY card
   (click-targets live in the chrome, wires anchor here).
2. If the main content genuinely overflows, take a SECOND, content-only shot:
   find the main scroll container (`role=main` descendant, else the largest
   `scrollHeight > clientHeight` element that isn't `nav`/`aside`), expand it,
   element-screenshot it, restore:
   ```js
   // browser_run_code_unsafe
   async (page) => {
     const h = await page.evaluate(() => {
       const cand = [...document.querySelectorAll('main *, [role=main] *, main, [role=main]')]
         .filter((e) => e.scrollHeight > e.clientHeight + 40 && !e.closest('nav, aside'))
         .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
       if (!cand) return 0;
       cand.__prev = cand.style.cssText;
       cand.style.height = cand.scrollHeight + 'px';
       cand.style.overflow = 'visible';
       cand.setAttribute('data-vitrinka-full', '1');
       return cand.scrollHeight;
     });
     if (!h) return 'no inner scroll — viewport shot is complete';
     try {
       await page.locator('[data-vitrinka-full]').screenshot({ path, timeout: 7000 });
     } finally {
       await page.evaluate(() => {
         const el = document.querySelector('[data-vitrinka-full]');
         el.style.cssText = el.__prev; el.removeAttribute('data-vitrinka-full');
       });
     }
   }
   ```
   Adopt it as a companion shot (`snap web --file … --label "<STAGE> FULL"`).
3. **Degrade gracefully**: virtualized lists defeat the expand trick (blank
   rows) — keep the viewport shot only, never scroll-and-stitch.

## Intent: session — sticky capture → testing board

Today's default loop. After the **first** shot lands (and again when new
shots landed): `vitrinka board-from-set --root .vitrinka/screenshots` — idempotent,
serpentine layout with `--action`-labeled arrows, files under the project's
**testing** subgroup. Give the user the board URL as soon as it exists.

Structure pass at wrap-up — **delegate it to `vitrinka-publisher`** (see
Delegation above). The rules the agent follows: one `compose_board` call per coherent
unit (a single card is a batch of one, anchored by relation), fetch
`get_templates` first, never invent card shapes. The
per-kind payload contracts live in the `docs` MCP tool (canonical element
vocabulary — chart, table, mockup, doc, …); `references/card-kinds.md` keeps
the kind index + doctrine — the tool schema carries only the kind index:

- **Walkthrough / QA board — steps ARE the walkthrough**: ONE `section` per
  journey/area, a numbered `step` per screen with `status` and
  `image: {project, branch, selector, file}` naming the shot in THIS session's
  set. Do NOT keep a serpentine flow of raw shots next to a steps section
  (doubles every screen) — skip `board-from-set`, or remove the duplicate
  row with `update_cards {remove:[…]}`: cards you created go straight to the
  trash; anyone else's come back as `409 needs_confirm` with a `preview` —
  read it, then repeat the same ids with `confirm:<token>` and a
  one-sentence `reason` (≥ 20 chars). Removals are soft and the reason is
  visible: the operator restores from HISTORY or the drawer's Trash tab.
- **Live annotate→fix loop on a single screen**: keep that screen a real shot
  card — pixel-space crops and face versioning only exist on shot/media cards.
- **"Review these screens and annotate what's off"** is the `annotate` tool
  (findings as native staged annotations with regions on the shots —
  `get_card_image` per screen first), never a `finding`/document card and
  never `highlight`; docs topic `annotation`.
  pin: e2e/board-v5.spec.ts#lightbox from the deck: full image, version filmstrip after swap, ⌖ target
- **Every board ends with a summary card**: one `callout` (tone `success` when
  green) — verdict, counts, links, what was NOT covered. Later passes UPDATE
  it (`update_cards`), never stack a second.
- **Statuses live on the cards**: flip `step.status` via `update_cards`.
- **Iteration = next pass** (`{"journey":"<name>","pass":"next"}`), never
  mixed takes; `arrange {"mode":"compare"}` against the previous pass.
- **Report the spend behind every composition**: pass
  `usage: {tokens, effort}` on `create_board`, `compose_board` and
  `update_cards` — your own rough estimate of what the call cost you that
  the server cannot see (thinking + reading the shots and content;
  `effort` low | medium | high). The self-report is schema-validated;
  estimates are not verified or billed. It lands in the workspace's agent calls ledger,
  which the `query` tool / `vitrinka query` reads back as SQL.

Then **attach the listener AUTOMATICALLY** — follow the listen skill
(`/vitrinka:listen`; the plugin's `skills/listen/SKILL.md`): arm `vitrinka
watch`, announce `⏳ listening — annotate away`, END the turn.

## Intent: journey — signpost flow maps

The journey intent turns a walked flow into a **tree of screens wired by what
was clicked**: a screen with multiple paths becomes a *signpost* — each
outgoing wire leaves from the clicked element's outlined region on the shot.

Walk the flow like a user would, capturing each screen (shared core rules,
full-page recipe for overflowing content). The extra work per screen with
outgoing paths — declare its **branches**:

```bash
vitrinka snap web --file dash.png --label "DASHBOARD" --title "Home" \
  --next "SETTINGS"  --target '{"x":912,"y":24,"w":40,"h":40}'  --action "Click avatar" \
  --next "NEW-BOARD" --target '{"x":24,"y":88,"w":120,"h":36}' --action "Click + New board"
```

- `--next <LABEL>` names the target shot's `--label` — capture the target any
  time in the same set; labels resolve at import (a fabricated chain edge into
  a screen that's a branch target, or back into its source, is suppressed).
  Capture LINEAR continuations in walk order though — consecutive unbranched
  shots chain automatically. Each `--next` opens a group; the
  `--target`/`--action` that follow belong to it. 2+ branches = a signpost.
  `journey-from-set` prints `⚠ branch dropped` for any `--next` label that
  matched no shot — fix the label or capture the missing screen, re-import.
- **`--target` is the clicked element's bbox in IMAGE px — measured, never
  eyeballed.** From the live page: `el.getBoundingClientRect()` at the exact
  scroll state of the shot, × `devicePixelRatio` when the capture is retina.
  Same discipline as annotation bboxes: eyeballing drifts 20px and visibly
  misses; measure in the same MCP session that shot the screen.
- Screens on a linear run need no branches — consecutive shots chain
  automatically (with `--action` as the wire label), and a branch target
  starts its own path (no fabricated chain edge into it).
- One screen may appear once; branches from anywhere point at its label
  (diamonds and back-edges are fine — the layout places every screen once).

Publish: `vitrinka journey-from-set --root .vitrinka/screenshots` — imports the set as
a **journey tree** (left-to-right; linear runs stay in a lane; a signpost fans
its branches vertically in walk order; wires leave from the click-target
region, outlined on the screen and glowing with wire selection). It is
`board-from-set`'s sibling: same slug=set-key idempotency, same testing
subgroup. Re-tidy any time with `arrange {"mode":"journey"}` (MCP) after
adding screens or wires.

Agents without the CLI: `compose_board` edges accept
`fromRegion`/`toRegion` `{x,y,w,h}` directly — same image-px space.
Edges also accept `rel: "subtask" | "blocks" | "refs"`; the canvas shows
the relationship alongside `label`. Omit `rel` for an ordinary flow arrow.
These are canvas relationships, not the task engine's `task_links`.

Wrap-up: same structure-pass + summary + listener rules as session (the
structure pass delegates to `vitrinka-publisher`; the listener stays yours).
The tree
IS the deliverable — don't convert it into a steps section (steps are for QA
walkthroughs; the signpost map is for understanding the flow).

## Intent: walkthrough — client-facing journey docs

A journey board polished for outsiders, published as a share link.

1. Build the **journey** intent map first — full-page shots, branches, real
   `--action` labels written for a reader ("Klikněte na avatar" not "tap
   usr-menu-btn"). `--title`/`--note` carry the narrative; write them in the
   client's language and voice.
2. Add ONE intro `text` card (what this doc covers, who it's for) and a
   `callout` per caveat — one `compose_board` call, delegated to
   `vitrinka-publisher` along with the client-voice narrative polish.
3. Share: board sharing runs on the dedicated public origin
   (`share.vitrinka.ai` short links — see the share-links machinery). Mint
   with the `share_board` tool or `vitrinka board share <board> [--mode
   annotate] [--expires 7d]`. A link shares the WHOLE board — never mint on
   one that carries drafts the client must not see. Hand the client the
   share URL bare on its own line; annotations they leave route back to
   claude like any board (listener rules apply).
4. Prefer a sandbox/demo org for any shot listing tenant data; mint-then-revoke
   any credential that appears on screen — client docs travel.

## Linking to the QA plan (every intent)

A published board belongs to the feature's `qa` task and its sections to
that task's `journey` children; the link is inferred, overridden
explicitly, and never guessed:

1. **Test results never come through this skill.** A runner's output goes
   through `vitrinka run -- <test command>`; an exploratory session goes
   through `vitrinka usertest start · case · snap · verdict · finish`
   (usertest skill). Both create or extend the qa task, write verdicts,
   compose the qa board and attach the evidence themselves. The publisher
   agent keeps only the free-form walkthrough: a client-facing story, a
   design review, a set of screens with no verdict.
2. **Resolve the target BEFORE dispatching the publisher** — `vitrinka
   task resolve-qa [--task <id>] --json`. `--task` accepts a qa task or
   anything that owns or sits under one (an epic → its open qa child; a
   story → its epic's); without it the checkout's `vt-<id>` (branch, then
   `.worktrees/` path) resolves the same way. Exit 4 = no qa task: the
   walkthrough publishes UNLINKED and says so in the hand-back ("not
   linked — no qa task on this branch; `vitrinka task resolve-qa --task
   <id>` to link later"). Never create a qa task or a journey from a
   publish. Pass the answer's `qa.id` and the registry
   (`.vitrinka/journeys.json`, when present) to the publisher in its brief.
3. **On publish** (the publisher does this, once per board): `add_task_ref
   {id: <qa>, kind: "board", ref: <slug>, meta: {board: true}}`; then
   `get_task {id: <qa>, include: [children]}` and, per board section,
   match a `journey` child by its `fields.key` = the section's registry
   key (the section title is the journey id in `.vitrinka/journeys.json`,
   or the section's `meta.journey`), else by EXACT title →
   `add_task_ref {id: <journey>, kind: "board", ref: <slug>, meta:
   {section: "<section title>", journey: <journeyId>}}`. Recorded
   sessions imported into that section → `add_task_ref {id: <journey>,
   kind: "session", ref: <session board slug>}`. An unmatched section is
   listed under `warnings`, never force-matched.
4. **Verdicts are never a walkthrough's.** A walkthrough carries no
   verdict and files no bug; a finding worth a verdict is an exploratory
   case (`vitrinka usertest case … · verdict fail --note …`), whose
   `finish` files the bug draft `blocks`-linked to its journey.
5. Before the hand-back on a bound task, run the `handoff` skill (`hand_back`) — the chat block is its `rendered` output.

## Gotchas (all intents)

- Vitrinka is **an authenticated service**: `vitrinka auth login` mints your
  token; `VITRINKA_TOKEN` or the OS keyring is always required (self-hosted
  deployments set `VITRINKA_URL`). A failed push writes
  `.vitrinka/screenshots/.vitrinka-offline` — warn once, keep capturing; syncs are
  idempotent full-set uploads (`push --root .vitrinka/screenshots` to force).
- **A board that belongs to a task** — see "Linking to the QA plan" above:
  the publish resolves its `qa` task and stamps the board once with
  `add_task_ref {id, kind:"board", ref:"<slug>", meta:{board:true}}` so
  the board's breadcrumb — and every `/a/<id>` element on it — reads
  `ACME-12 · title ↗` back to the task; `GET /boards/{slug}/tasks` lists what
  a board belongs to. A task that is not a qa task (the user named a plain
  task, a bug) is stamped the same way, without sections.
- Shots transcode to WebP q85 (`brew install webp` if `cwebp` missing).
- Never commit shots. Write auth: `VITRINKA_TOKEN` env or
  `vitrinka token` — never echo it.
- Desktop app: if `~/.config/vitrinka/desktop-app` exists, `vitrinka open`
  opens boards in-app — test that flag file, never probe /Applications.
- Local gallery: `.vitrinka/screenshots/index.html`, kept current by snap.
- Update notices: a `vitrinka` command may print `update available X → Y ·
  run: vitrinka update` on stderr. Relay it to the user once and offer to run
  `vitrinka update`; never update unprompted or repeat the offer.
