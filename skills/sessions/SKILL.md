---
name: sessions
description: "The recorded user-testing pipeline — discover pending sessions, fix their issues, generate journey e2e tests, verify with a run traced onto the session board — plus archiving and continuing coding-agent sessions behind tasks. Use for processing a recorded session or its backlog (single-stage fix/test runs route in the body), or for `vitrinka session archive|continue`."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:sessions — the pipeline autopilot

The recorder keeps producing sessions; this skill keeps consuming them. It is
an ORCHESTRATOR — the real work lives in its two stage engines,
`references/fix.md` (session → shipped fixes) and
`references/generate-test.md` (session → journey tests + registry); this
skill discovers what's pending, prepares the ground (project rules, worktree,
dev stack), sequences the two engines, and closes with a verified e2e run
traced back to the board.

Arguments: optional — a session board slug/URL or id to process just that
one; without it, process every pending session for this project, oldest
first. A trailing `fix` or `test` runs ONLY that stage on the named session
(read that stage's reference and follow it end to end — its own worktree,
ledger, and stamp rules apply; skip the pipeline's other phases).
Run FROM THE APP'S REPO.

## Phase 0 — project rules (first run maps them)

Read `.vitrinka/project.json` (schema: `references/project.md`). If it is
missing or incomplete, STOP and map it WITH the user before any pipeline work
— one interactive round (AskUserQuestion or terminal), then commit the file so
every future run and teammate inherits it:

- **project** — the vitrinka project slug (must match the recorder's).
- **worktree** — the command that creates a work-ready worktree, and the rule
  for variants (e.g. a monorepo's `wk:create:sim` web-only vs `wk:create:full` when
  the journey includes the mobile app). Fallback: plain `git worktree add`.
- **run** — how to start the dev stack(s) the tests drive, per surface, and
  the readiness check (URL/port/log line).
- **e2e** — per framework: how to run the suite (command, cwd, env), where
  tests live, how a single spec is targeted.
- **frameworks** — which surfaces exist (web → playwright, expo → appium) and
  how each shows up in a session (web → `facets.hosts` entries, mobile →
  `session.meta.platform` ios/android).

Derive everything derivable (configs, scripts, lockfiles, CLAUDE.md) and ask
ONLY what the repo can't answer — typically the worktree variant rule and the
dev-stack readiness quirks. Confirm the derived map with the user on first
run; thereafter trust the file (re-map on demand when it drifts).

## Phase 1 — discover pending sessions

1. `GET /api/v1/sessions?project=<project>&limit=200` — every recorded
   session with its `meta.pipeline` stamps.
2. Read `.vitrinka/sessions.json` — the repo ledger (TRUTH; schemas in
   `references/registry.md`).
3. Pending = status `done`, projected (`boardSlug` set), and not `testedAt`
   in the ledger. A session with `triagedAt` but no `testedAt` resumes at the
   test stage. Disagreement between stamps and ledger → trust the ledger, fix
   the stamps.
4. **Exclude machine-driven runs**: skip any session whose `environment` is
   `sim` or whose tags include `ai` — those are an agent's own dev-loop
   recordings (the app repo's own `bun run rec:start`), not user-testing findings.
   Pipelining them means opening issues against half-built work and
   generating journey tests from flows that were mid-change. Filter on
   `environment` from the list response rather than fetching
   `/sessions/{id}/tags` per row — the field is already there, the tag is the
   human-facing search lever. Process one deliberately only if the user names
   it as the argument.
5. Report the queue (id, title, board, age, state) before working it. Skip
   `recording`/`stalled` sessions — they're still being captured; note
   deleted ones only if the ledger references them.

## Phase 2 — per session: prepare, fix, test

For each pending session, oldest first, ONE at a time (pipeline runs are
heavyweight — parallel sessions fight over dev stacks and the registry):

1. **Digest once**: `get_session {id}` — reuse it for both stages below;
   don't let each stage re-fetch.
   A **fix-only** run can start with `{id,view:"issues"}` and retrieve the
   necessary evidence steps with `{id,seqs:[...]}`. Recorder notes, issues, vitals,
   facets and totals remain; `coverage` names omitted steps. Test generation
   requires the full journey — an issues view is not coverage evidence.
2. **Worktree**: create via the project.json worktree command; pick the
   variant from the digest's `session.meta.platform` (ios/android ⇒ full).
3. **Fix**: run the fix stage (`references/fix.md`, its phases 2–4) inside the
   worktree with the digest in hand. It batches issues (5–10 per subagent,
   ≤4), fixes, closes annotations, writes `triagedAt` + stamps.
   No open issues ⇒ skip cleanly.
   Sweeping MANY sessions into one shared fix round (one PR for a backlog)?
   The batch map spans sessions, but the fix stage's isolation law is
   unchanged: concurrent batches get their own worktrees off one base, the
   worktree above is the INTEGRATION tree (hotspot intents, add-only locale
   merge, reconciliation, gates) — never four agents in one tree.
4. **Tests**: run the generate-test stage (`references/generate-test.md`, its
   phases 1–5) in the same worktree — verdicts, blocks, emission, manifests, `testedAt` stamp.
   Everything stays committed LOCALLY on the session's branch — shipping
   happens after Phase 3's verification run, never before it.

## Phase 3 — verified run, traced to the board

After the session's tests exist:

1. Spin the dev stack(s) + e2e runtime per project.json `run`/`e2e`; wait for
   readiness checks — never launch tests against a half-up stack.
2. Run the session's touched journeys (targeted specs), then the affected
   suite if the project rules call for it. Capture per-journey results and
   failure artifacts (runner traces/screenshots).
3. Trace the run onto the SESSION BOARD as the next pass —
   `compose_board {board: <session board>, journey: <pass-chain key>, pass:
   "next"}` with one `step` card per journey (result, duration, spec file) and
   a heading noting commit + date. The pass lands beside the original
   recording, so before/after reads at a glance. Use the board's existing
   pass-chain key (`scrape_board` sections show it); a session board that
   never had a chain gets one named after its journey section.
4. Failures are work, not noise: a failing NEW test loops back to its emitter
   (fix the test or mark `expectedFail` with the linked issue — never delete);
   a failing EXISTING test after your fixes is a regression YOU introduced —
   fix it before shipping. Loop run→fix→run until green or explained.
5. **Ship**: only now — one branch per session, push and open the PR per the
   repo's conventions (fixes + tests + manifests + a green run tell the
   session's story); backfill `testPr` per the registry schema.

## Phase 4 — close out

- Ledger + stamps final (`triagedAt`, `testedAt`, PRs, journeys).
- Per session: PR URL, board URL (with the new pass), fix summary, verdict
  table outcome, e2e run result.
- Queue summary: processed / skipped (with reasons) / remaining.
- Before the hand-back on a bound task, run the `handoff` skill (`hand_back`) — the chat block is its `rendered` output.

## Coding-agent sessions — archive and continue

A different kind of session: YOUR transcript (Claude Code, Codex), kept
behind the task it worked so a colleague — or you, next week — can pick it
up. Contract:

- **What is archived**: the raw harness JSONL, untouched in shape, as a
  `transcript` ref on the task with a normalized index in `meta`
  (`harness · turns · tools · started · ended · tokens`, plus `filename`).
  Same filename on the same task = a new VERSION, never a replacement.
- **The gate is hard**: `vitrinka session archive` scans every line before
  a byte leaves the machine. A credential (JWT, provider API key, bearer
  header, checksum-verified IBAN, a credential-shaped value under a
  sensitive JSON key) REFUSES the upload with the findings listed — exit
  3, no flag past it; fix the source (rotate the secret) and archive
  again. E-mails, phone numbers and long opaque runs (screenshot bytes,
  hashes) are masked in place as `▮▮▮ [redacted-<type>]`.
- **Paths are portable**: every absolute path under a git checkout becomes
  `//vitrinka:repo:git@github.com:Org/Repo.git/<rel>` (origin, normalized
  — the full remote disambiguates two repos of one name; a worktree's path
  resolves through its main checkout's origin) and a path under `$HOME`
  outside any checkout becomes `//vitrinka:home/<rel>`. The reading CLI
  maps them back to ITS checkouts: the current repo, then the project's
  declared `repos` as rename aliases, then a walk of `~/Work` (depth 4);
  `VITRINKA_RESOLVE_RENAMES=1` also asks `gh api` for a moved repo. An
  unresolved placeholder stays as-is — it names exactly what is missing.
- **Automatic at session end**: `vitrinka install` registers a Claude Code
  `SessionEnd` hook (`vitrinka session archive --auto`, marker
  `# vitrinka:session-archive` in `~/.claude/settings.json`). It does
  nothing unless `vitrinka session archive on` was run on this machine AND
  the transcript named a task — the last `vitrinka task start <id>` wins,
  else the last `vt-<id>` marker. It never fails a session: exit 0
  always, outcome in `~/.config/vitrinka/session-archive.log`. Codex and
  OpenCode have no session-end hook yet: archive after the fact.
- **Continue**: `vitrinka session continue <task> [--ref <id>]` prints the
  task's latest `distill` ref as a `/continue`-shaped brief (title, short
  link, the digest, which transcript version it derives from). Without a
  distill it prints the transcript index and says so — label the task
  `eve-distill` or ask through `ask_task`. When the transcript's `harness`
  is the one this shell runs under, it ALSO downloads the JSONL, resolves
  the placeholders to this machine, writes it to a temp file and prints
  the native resume (`cp … && claude --resume <id>` / `codex resume
  <id>`) as an OFFER — never run for you.

```text
vitrinka session archive on|off|status
vitrinka session archive <transcript.jsonl> --task <id> [--hint "load when …"] [--version-of <ref>]
vitrinka session continue <task-id> [--ref <distill-ref>]
```

Bind the run first (`vitrinka task start <id>` — the `tasks` skill) so
the archive knows its task; attach a `hint` so the next reader knows when
the 48k-token transcript is worth loading.

## Autonomy contract

- The FIRST run's project-mapping questions are the only planned user
  interaction; everything after runs autonomously. Surface hard blockers
  (missing credentials, dead dev stack, other-repo issues) in the close-out
  rather than stalling mid-queue — move to the next session.
- Respect the engines' economy rules (they cap subagents at ≤4 per phase);
  this skill adds NO subagents of its own beyond what they specify.
- Never process a `recording` session; never regenerate a `testedAt` session
  without an explicit ask.

## Red flags — STOP

- You are about to start pipeline work with no `.vitrinka/project.json` and
  no user confirmation of the derived map.
- Two sessions being worked in parallel, or work happening outside the
  session's worktree.
- Tests launched before the readiness check passed.
- A verification pass composed onto a DIFFERENT board than the session's.
- The ledger says tested but you're regenerating anyway.
