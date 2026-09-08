---
name: resolve
description: "Resolve a board's accumulated annotation backlog — one queue fetch, group by root cause into functional blocks, fix block-by-block, close every item with proof. Invoke as /vitrinka:resolve [board-slug] FROM THE APP'S REPO; continuous live servicing is /vitrinka:listen."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:resolve — work a board's backlog properly

You are resolving an ACCUMULATED backlog: the user swept their app, dropped
dozens of annotations on a board, and handed you the whole set. The failure
modes this skill exists to prevent, in order of cost:

1. **Fixing annotations one-by-one in board order** — a 65-item board is
   usually 8–12 real workstreams; five items saying "use the glass chips here"
   are ONE rollout, not five fixes.
2. **Fetching everything up front** — `get_annotation` × 65 and full-board
   scrapes burn tens of thousands of tokens for briefs you mostly don't need.
3. **Reading crop images into the main context** — screenshots are the most
   expensive tokens you can spend, and you'll need the context later for code.
4. **Fixing without resolving** — a fixed annotation the board still shows as
   open is unfinished work. Every item ends with proof + status.

Argument: a board slug (`/vitrinka:resolve testing-11-7`). Without one,
auto-scope to this repo + branch the same way `/vitrinka:listen` does. NEVER
call `list_work` unscoped — the global firehose contains other sessions' work.

## Phase 0 — one call for the whole picture

`list_work({ board, status: "open" })` (or `{ project, branch, status: "open" }`).
One call. It returns every work item: `id`, `intent`, full `prompt`, `cropUrl`,
`covered` cards, status. That is the complete triage input.

- Pass `status: "open"` — unfiltered, the queue also returns `staged` items
  (drafts the user hasn't dispatched yet — "Send to Claude" is the send button;
  NEVER work a staged item), plus `resolved`/`in_review` history and `working`
  items another live session has claimed. Open is yours; the rest is not.
- Do NOT loop `get_annotation` over the queue. Most prompts are
  self-sufficient; enrichment is Phase 2, selective and batched.
- Do NOT `scrape_board` for a backlog pass. The full digest is tens of KB and
  its journey/section map adds nothing to per-annotation work. Reach for it
  (with `section`) only when an annotation explicitly concerns journey
  ordering or a whole section.

## Phase 1 — triage every item from the prompt alone

Classify each item BEFORE fetching anything else:

| Class | Signal in the prompt | Enrichment needed |
|---|---|---|
| **Self-contained** | Names files/routes/components (`apps/client/...`, `/marketplace-filters`), the action is unambiguous | none — the prompt IS the brief |
| **Ambiguous target** | "this", "here", "this screen", no file named | crop (batched, Phase 2) |
| **Referenced** | Contains `⌖E…` tokens | `get_annotation` — refs are deliberate user pointing and rank ABOVE the implicit crop context; each ref carries its own `cropUrl` |
| **Conversational** | A thread already exists / prompt was revised | `get_capsule` — latest revision + thread tail, cheaper than `get_annotation`; escalate to the full brief only for file attachments |

Respect the `intent` semantics — they change the deliverable:

- `fix` / `refactor` / `redesign` → code change. `redesign` additionally means
  invoke the repo's design skills, not a minimal patch.
- `investigate` → the deliverable is an ANSWER (posted via `reply`). Code only
  if the investigation surfaces a real defect — then say what you found first.
- `reshoot` → **NO code changes.** Re-capture the screen per the capsule
  protocol and `attach_after`. That's the whole job.

## Phase 2 — group into functional blocks

Group by ROOT CAUSE / component / subsystem — never by board order or id:

- **Same pattern requested N times** ("use ChipGroup like screen X" on five
  screens) → one rollout block.
- **Same component or theme token** (backgrounds, cards, sheet chrome,
  keyboard handling) → one standardization block; these often subsume
  screen-local items filed separately.
- **Same screen/flow** (`covered` card ids and route mentions are the grouping
  signal `list_work` already gave you) → one block per flow.
- **Server-side vs client-side vs other-repo** — separate blocks; flag
  other-repo items to the user instead of silently absorbing them.

Target 3–8 items per block, cross-cutting blocks FIRST (they change what the
screen-local items even mean). Record the block map in your task tracker with
the annotation ids in each block — that map is the session's spine.

Now do the batched enrichment for everything flagged in Phase 1: spawn **ONE
subagent** with the full list of ambiguous ids. It fetches crops + ref crops
(`get_annotation` for refs/threads, direct crop URLs otherwise) and returns
TEXT: `id → screen identification (quote visible labels verbatim) → what the
markup circles → what each ⌖E ref points at`. Images never enter your context;
the subagent's text findings are all you carry forward.

Crop URLs are relative paths and always need auth (an unauthenticated fetch
401s) — send an `Authorization: Bearer` header with the token
from `$VITRINKA_TOKEN` (fallback: the credential `vitrinka token` prints, same
order the CLI uses). Feed the header via stdin so the token never lands in a
process list: `printf 'Authorization: Bearer %s' "$TOKEN" | curl -H @- <url>`
— never paste the token inline into a command's arguments.

## Phase 3 — execute block by block

- **Claim first**: `set_status {id, status: "working"}` for each item in the
  block as you start it — the user's board pins flip amber live, and other
  sessions' listeners won't grab them. A **409 "cancelled"** from any call
  means the user withdrew that item mid-flight: revert its changes (surgical —
  that item's only), drop it from the block, don't reply to it.
- One block = one coherent commit (or a few, if server + client halves).
  Run the repo's checks (typecheck / lint / i18n) once per block, not per edit.
- When a prompt references an exemplar ("like the marketplace screen does"),
  READ the exemplar first and extract/reuse — do not re-implement beside it.
- `investigate` items in the block: verify the claim against code AND data
  before concluding — check the actual tables/logs, not just the component.
- Hold the line on scope: an annotation is a defect report, not permission to
  refactor the neighborhood.
- An item that genuinely needs the user's input: `reply` with the question,
  put it back with `set_status {status: "open"}`, list it in your end-of-run
  summary, and move on — the user's thread reply re-queues it. When the
  ambiguity is spatial ("which element?"), `highlight` a rectangle on the
  card so the question points at something.

## Phase 4 — verify, then resolve on the board

Verification (see the repo's testing conventions + the publish skill's
capture rules):

- Capture proof shots of every changed surface. **Hash-guard batches**: md5
  consecutive captures — identical hashes mean the app is stuck (splash,
  red-box, login) and the whole batch is garbage. Verify ONE probe frame via a
  subagent before capturing the rest.
- ONE verifier subagent per batch of shots, returning PASS/FAIL + quoted
  visible text per item. Never read the shots yourself.

Then close the loop — this is not optional, per item:

1. `attach_after` — the proof shot lands on the annotation's before/after rail.
2. `reply` — 1–3 lines: what changed, where (commit ref), anything punted.
   For `investigate`: the answer itself.
3. `set_status` → `in_review`. **Never `resolved`** — that state is the user's
   accept, taken on the board; the tool won't let you set it and trying is the
   tell that you skipped this file.

Batch these three calls per block, right after the block's verification —
not per-edit (noisy) and not all at session end (a crash loses the mapping).

## Token & API economy — the rules in one table

| Instead of | Do |
|---|---|
| `get_annotation` × N up front | `list_work` once; enrich only Phase-1 flagged items |
| `scrape_board` for context | the prompts + `covered` cards; scrape only per-section on demand |
| Reading crops in main context | ONE batched subagent returning text findings |
| Reporting NEW defects you noticed as document/`finding` cards | `get_card_image` per screen → ONE `annotate` batch (keys, regions, `agent`); they wait `staged` for the user's Accept |
| Fix → verify → reply per item | fix per BLOCK, verify per batch, resolve per block |
| Re-fetching an item to re-read its prompt | keep the Phase-2 block map in your task tracker |
| A verifier agent per screenshot | one verifier per batch, PASS/FAIL table back |

## Don't rationalize

- "I'll just start with annotation #1 and go down the list" → no. Triage +
  grouping first; order-of-filing is the least meaningful ordering available.
- "Fetching all briefs up front is thorough" → it's waste. The prompt text in
  `list_work` already contains the user's words; briefs add refs/threads/crops
  you only need for the ambiguous minority.
- "I'll quickly look at this one crop myself" → that's how contexts die. Batch
  it into the enrichment subagent with the rest.
- "The fix is done, I'll close out the board items later" → later never comes
  after a compaction. Attach + reply + in_review per block, while the mapping
  is fresh.
- "This investigate item is obviously a bug, I'll just fix it" → answer first,
  fix second. The user asked a question; the reply is the deliverable.
- "reshoot is basically a fix request" → it is explicitly NOT. Re-capture and
  attach; zero diffs.

## Red flags — STOP

- You are about to call `list_work` without `board` or `project`+`branch`.
- Your context contains a crop image.
- You've made 10+ edits with zero board items moved to `in_review`.
- You are about to work an item whose status is `staged` (an unsent draft) or
  `working` (another session's claim).
- Two consecutive proof shots hash identical and you're still capturing.
- An annotation names another repo and you're editing this one to compensate.
