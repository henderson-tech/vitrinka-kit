# Stage: fix — from recording to shipped fixes

For a plain annotation backlog with no recorded session, this stage does not
apply — that is `/vitrinka:resolve`.

A human tested the app while the journey recorder captured everything: screens,
clicks, the network, console errors, Web Vitals, and their ⌖ annotations. Your
job is to turn that session into fixed code and a closed board. The failure
modes this skill exists to prevent:

1. **Traversing the raw session** — `/events` streams and board scrapes are
   10–100× the tokens of the digest. ONE `get_session` call is the whole read.
2. **Fixing issue-by-issue in timeline order** — a session's 30 issues are
   usually 3–6 real workstreams. Five 500s from one endpoint are ONE fix.
3. **One subagent per issue** — an agent that spends its whole session on one
   item wastes the repo orientation it paid for. A batch is 5–10 issues.
4. **Fixing without closing** — every annotation ends with proof + status;
   every non-annotation issue ends verified or explained.
5. **Parallel batches in ONE shared tree** — concurrent writers silently wipe
   each other's changes (locale catalogs twice in one real run), break every
   batch's gates ("the tree is moving under us"), and tempt shared-tree `git
   stash`. Parallel batches get their own worktrees and meet again in a merge.

Input: a session board slug or URL (`/vitrinka:sessions acme-session-7 fix`,
or the full `https://…/boards/acme-session-7` link) or a numeric session id.
Run FROM THE APP'S REPO — the one the session tested.

## Phase 0 — one call for the whole session

`get_session({ board: "<slug>" })` (or `{ id: N }`). The digest returns:

- `steps` — the screen walk: route, title, action, notes, `cardId`, and
  `issueRefs` into the issues list. An entry with `count` > 1 is a folded run
  of bare clicks on one screen; its `seqs` array lists the exact member shot
  seqs (shot seqs are NOT contiguous — only `seqs` members are valid
  `session.shotUrlTemplate` substitutions) and folds carry no `cardId`.
  Annotated/failing steps are always their own entry, with `shotUrl`/`cardId`
  intact (or the template + their `seq`).
- `issues` — ALREADY deduped across steps:
  - `annotation` — a human ⌖ snap or board annotation, with LIVE
    `status`/`assignee`/`annotationId`/`region`. **Open annotations are the
    user's explicit asks — they rank first.**
  - `network` — a ≥400 response, deduped on method+path+status, with `count`
    and the `steps` it fired on.
  - `console` — a console error, deduped on message.
- `vitals` — LCP/CLS/INP per route (perf regressions are issues too when
  egregious; otherwise note them in the summary, don't chase them).
- `facets` — routes/hosts/issueKinds with counts: your grouping input.

Do NOT follow up with `scrape_board`, `/events`, or per-annotation fetches
here. The digest is the triage input, complete by design.

## Phase 1 — worktrees first (fork → isolate)

All fix work starts in worktrees — never in the user's checkout:

1. If the repo maps its own worktree command (check `.vitrinka/project.json`,
   the repo's CLAUDE.md, or its `wk:*` scripts — e.g. a monorepo's
   `wk:create:sim` / `wk:create:full`), use THAT. Pick the full/mobile variant
   when the session's `session.meta.platform` (ios/android — the mobile
   signal; `facets.hosts` only lists real web hosts) shows the mobile app was
   part of the journey.
2. Otherwise `git worktree add .worktrees/session-<id> -b fix/session-<id>`.

**One worktree per PARALLEL batch.** When Phase 2 yields more than one batch
running concurrently:

- The worktree above becomes the INTEGRATION tree (its branch becomes the
  PR). Add one lightweight worktree per batch —
  `.worktrees/session-<id>-<batch>` on `fix/session-<id>-<batch>` — ALL
  forked from the same base commit; verify with `git worktree list` before
  dispatching anything.
- Batch worktrees get dependencies only. Infra / DB / simulator boot happens
  ONCE, in the integration tree, at Phase 4 — never per batch.
- A single batch (or batches explicitly sequenced) works directly in the
  integration tree; the split is for concurrency, not ceremony.

## Phase 2 — group into domain batches

Group by ROOT CAUSE and subsystem, never by timeline order:

- A repeated network failure (`count` > 1) is one server-side or API-client
  fix, regardless of how many screens it stained.
- Annotations on the same route/screen (`facets.routes`, step `cardId`s) fold
  into one batch with that screen's console/network issues — they usually share
  a cause.
- Cross-cutting asks ("all sheets should…") come FIRST; they change what the
  screen-local items mean.
- Server-side vs client-side vs other-repo → separate batches; flag other-repo
  issues to the user instead of silently absorbing them.

Target **5–10 issues per batch, ≤4 batches**. More issues than that fits →
bigger batches, not more agents. Record the batch map (issue → batch) in your
task tracker — it is the session's spine.

With the batch map, declare the **shared hotspots** — files two batches would
both touch, or that a generator owns: locale/i18n catalogs, OpenAPI specs +
generated API clients, lockfiles, snapshot baselines. Hotspots are
orchestrator-owned: no PARALLEL batch edits them directly (Phase 3 gives
those batches an intent channel instead), and integration applies them
exactly once (Phase 3½). A single batch — or one explicitly sequenced in the
integration tree — edits hotspots directly like any other file: there is no
concurrent writer to protect against and no Phase 3½ to apply intents for it.

Enrichment happens ONCE, batched: if batches contain ambiguous annotations
("this", "here"), spawn ONE subagent with all their crop/shot URLs
(`shotUrl`, annotation `region`) to return TEXT findings — images never enter
your context. Crop/shot URLs are relative and always need the Bearer
token from `$VITRINKA_TOKEN` / `vitrinka token` via stdin
(`printf 'Authorization: Bearer %s' "$TOKEN" | curl -H @- <url>`), never
inline in argv.

## Phase 3 — one subagent per batch

Claim every annotation in the batch map BEFORE dispatching: `set_status {id,
status:"working"}` — board pins flip amber and other listeners won't grab
them. Claims belong to the ORCHESTRATOR alone; batch agents never touch
annotation status. "annotation is not open — another session already claimed
it" is not a skip signal — find the owning session and reconcile before any
batch works that item. A 409 "cancelled" means the user withdrew it: drop it
(and revert its changes, if any).

Dispatch up to 4 subagents (inherit the session model — never pin a cheaper
one), each with a pin-pointed brief:

- The batch's issues verbatim (text, routes, counts, step context, annotation
  ids), the enrichment findings, and ITS OWN worktree path.
- The hotspot list, with the contract (isolated parallel batches only —
  a batch working the integration tree edits hotspots directly): NEVER edit
  a hotspot. Emit intents instead — locale additions as a fragment file
  (`<worktree>/.batch-intents/locale-keys.json`, complete pairs for every
  language), a generator need as `regenerate: [api:generate]` in the report.
  A committed hotspot is a failed batch.
- The repo's check commands (typecheck/lint/tests) — the agent runs them in
  its own tree before reporting; green there is meaningful precisely because
  nothing moves underneath it.
- Deliverable: path-scoped commits on the batch branch + ONE STRUCTURED
  report as its final message (never chat pings or resends): per-issue
  verdict (fixed / needs-user-input / other-repo / not-reproducible) with
  file refs, the full file list, gate exit codes verbatim, intents, and
  cross-batch flags.

The main thread stays the orchestrator: collect reports, resolve
cross-batch conflicts, keep the batch map current. Batches explicitly
sequenced (sharing a subsystem) run one after another in the integration
tree; everything concurrent runs isolated.

## Phase 3½ — integrate (parallel batches only)

Merge each batch branch into the integration worktree, sequentially. A
conflict here is the system WORKING — two batches genuinely disagreed;
resolve it deliberately. What a shared tree made a silent clobber is now a
visible merge.

Then apply the hotspot intents exactly once:

- Locale fragments via an ADD-ONLY merge: insert every batch's keys, never
  delete or overwrite an existing key. Then reconcile — every key any batch
  declared exists in ALL catalog files, and every translation lookup in the
  merged diff resolves. Parity gates cannot catch a key missing from every
  file at once; only this reconciliation can.
- Run declared generators (api:generate etc.) ONCE on the merged tree; one
  dependency install if lockfiles changed.
- Re-run the full gate set on the integrated tree. Batch-tree green was
  necessary; integrated-tree green is the one that counts.

Cross-cutting tests — anything asserting across batch boundaries or on
hotspots — are written NOW, on the integrated tree, not inside batches.

When the merges are in and the integrated gates are green, retire the batch
worktrees: `git worktree remove .worktrees/session-<id>-<batch>` +
`git branch -d fix/session-<id>-<batch>` — merged branches are disposable,
and a stale path/branch pair makes a rerun's `worktree add … -b` fail on
both. A batch that FAILED keeps its worktree for inspection; say so (with
the path) in the closing report.

## Phase 4 — verify, close, report

Everything here runs on the INTEGRATED tree — boot infra/sim there, once.

- Proof shots of every changed surface (repo screenshot conventions;
  hash-guard batches — identical consecutive hashes mean the app is stuck).
  ONE verifier subagent per batch of shots, PASS/FAIL + quoted text back. A
  live FAIL goes back to its batch agent with the repro evidence — but the
  re-fix lands ON THE INTEGRATION TREE (point the agent there: its batch
  branch was merged in Phase 3½ and its worktree may already be gone; a fix
  committed to a dead batch branch never reaches what Phase 4 verifies).
  Re-verify, only then close.
- Per annotation: `attach_after` (proof) → `reply` (1–3 lines, commit ref) →
  `set_status` → `in_review`. Never `resolved` — that's the user's accept.
  Batch these right after each batch's verification, not at session end.
- Non-annotation issues: the closing summary lists each with its verdict and
  commit. Network issues re-checked live (the failing call now succeeds)
  before claiming fixed.
- Record the processed state (schemas in `registry.md`, this
  directory):
  1. Write/merge this session's entry in `.vitrinka/sessions.json`
     (`triagedAt`, `fixBranch`, `fixPr`, notes) and commit it with the fixes.
     If `git check-ignore` hits the manifest, the repo ignores `.vitrinka/`
     wholesale — STOP, fix the `.gitignore` to an allowlist (scratch ignored,
     manifests tracked; exact pattern in the registry doc) in the same
     branch, then commit. Server stamps alone are NOT an acceptable record.
  2. Stamp the server so /sessions shows progress:
     `PATCH /api/v1/sessions/{id}` body
     `{"pipeline":{"triaged":"<ISO now>","fixPr":"<url>"}}` (always send the
     Bearer token from `$VITRINKA_TOKEN` / `vitrinka token` via stdin,
     never argv).
- End with: batch map, per-issue outcomes, commits, anything punted to the
  user, and the board URL.

## Token & API economy

| Instead of | Do |
|---|---|
| `/events` stream or `scrape_board` | `get_session` once |
| `get_annotation` × N | digest issues already carry text+status; enrich only ambiguous ones, batched |
| Reading shots/crops in main context | ONE enrichment subagent returning text |
| One agent per issue | one agent per 5–10-issue batch, ≤4 batches |
| Fix → verify → reply per item | fix per batch, verify per batch, close per batch |
| Parallel batches in one shared tree | one worktree per batch; merge + reconcile once |
| Report resends + idle pings | one structured final report per batch |

## Red flags — STOP

- You are about to read `/api/v1/sessions/{id}/events` or scrape the board.
- Your context contains a screenshot.
- You planned more than 4 subagents, or a subagent brief contains one issue.
- You are editing the user's primary checkout instead of a worktree.
- Two batch agents are writing in the SAME worktree, or a gate fails on files
  the batch never touched ("the tree is moving under us") — stop and split.
- A batch edited or committed a declared hotspot, or ran a generator in a
  shared tree.
- `git stash` anywhere — batch trees don't need it, shared trees forbid it.
- A batch agent is calling `set_status` — claims are the orchestrator's.
- An issue names another repo and you're editing this one to compensate.
- 10+ edits and zero annotations moved to `in_review`.
