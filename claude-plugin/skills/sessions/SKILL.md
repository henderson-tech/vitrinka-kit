---
name: sessions
description: "The recorded user-testing pipeline — discover pending sessions, fix their issues, generate journey e2e tests, verify with a run traced onto the session board — plus archiving and continuing coding-agent sessions behind tasks. Use for processing a recorded session or its backlog (single-stage fix/test runs route in the body), or for `vitrinka qa session archive|continue`."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka:sessions — the pipeline autopilot

The recorder keeps producing sessions; this skill keeps consuming them. It
is an ORCHESTRATOR over two stage engines, `references/fix.md` (session →
shipped fixes) and `references/generate-test.md` (session → journey tests +
registry), closing with a verified e2e run traced back to the board.

Procedure: `docs {topic: "guide:sessions-pipeline"}` (CLI `vitrinka docs
guide:sessions-pipeline`) — Phases 0–4 and the archive/continue sequence.

Arguments: optional — a session board slug/URL or id for just that one;
without it, every pending session, oldest first. A trailing `fix` or `test`
runs ONLY that stage (its reference end to end, its own worktree and stamp
rules). Run FROM THE APP'S REPO.

## Laws

- **`vitrinka.config.json` at the repo root is the ONE project rules map**
  (schema: `references/project.md`): project, worktree command + variant
  rule, run + readiness checks, e2e per framework, frameworks per surface.
  Missing or incomplete ⇒ STOP and map it WITH the user, then commit it.
  Derive what the repo answers; ask only the rest.
- **The `meta.pipeline` stamps on the server ARE the ledger** (shape:
  `references/registry.md`). No repo file mirrors them; a
  `.vitrinka/sessions.json` left by an older run is a local cache, never
  consulted over the server, never committed.
- **Pending** = status `done`, projected (`boardSlug` set), no `tested`
  stamp; `triaged` without `tested` resumes at the test stage.
- **Machine-driven runs are excluded**: `environment` `sim` or tag `ai` is
  an agent's own dev-loop recording — never pipelined unless the user names
  it as the argument.
- **One session at a time, oldest first, in its own worktree.** Concurrent
  fix batches get their own worktrees off one base; the session's worktree
  is the INTEGRATION tree — never four agents in one tree.
- **Digest once**: ONE `get {kind:"session", id}` feeds both stages. Test generation
  requires the full journey — an issues view is not coverage evidence.
- **Ship only after the verification run**: fixes and tests stay committed
  locally on the session's branch until the targeted journeys ran green (or
  explained) against a stack that passed its readiness check. One branch
  per session; backfill the `testPr` stamp once the PR exists.
- **The verification pass lands on the SESSION board** as the next pass of
  its existing pass-chain (`compose_board {board, journey: <pass-chain
  key>, pass: "next"}`, one `step` card per journey) — never on a different
  board.
- **Failures are work, not noise**: a failing NEW test loops back to its
  emitter (fix it or mark `expectedFail` with the linked issue — never
  delete); a failing EXISTING test after your fixes is your regression.
- Before the hand-back on a bound task, run the `handoff` skill
  (`hand_back`) — the chat block is its `rendered` output.

## Coding-agent sessions — archive and continue

Your transcript (Claude Code, Codex), kept behind the task it worked.

```text
vitrinka qa session archive on|off|status
vitrinka qa session archive <transcript.jsonl> --task <id> [--hint "load when …"] [--version-of <ref>]
vitrinka qa session continue <task-id> [--ref <distill-ref>]
```

- **What is archived**: the raw harness JSONL, untouched in shape, as a
  `transcript` ref on the task with a normalized index in `meta`
  (`harness · turns · tools · started · ended · tokens`, plus `filename`).
  Same filename on the same task = a new VERSION, never a replacement.
- **The gate is hard**: a credential (JWT, provider API key, bearer header,
  checksum-verified IBAN, a credential-shaped value under a sensitive JSON
  key) REFUSES the upload — exit 3, no flag past it; rotate the secret and
  archive again. E-mails, phone numbers and long opaque runs are masked in
  place as `▮▮▮ [redacted-<type>]`.
- **Paths are portable**: an absolute path under a git checkout becomes
  `//vitrinka:repo:git@github.com:Org/Repo.git/<rel>`, one under `$HOME`
  becomes `//vitrinka:home/<rel>`; the reading CLI maps them back to ITS
  checkouts, and an unresolved placeholder stays as-is.
- **The auto-archive never fails a session**: the `SessionEnd` hook exits 0
  always and does nothing unless `archive on` was run on this machine AND
  the transcript named a task (`vitrinka task start <id>`, else the last
  `vt-<id>` marker). Bind the run first; attach a `hint`.
- **Continue prints an OFFER, never runs it**: the native resume is printed
  only when the transcript's `harness` is the one this shell runs under.
  Without a distill it prints the transcript index — label the task
  `eve-distill` or ask via `ask_task`.

## Autonomy contract

- The FIRST run's project-mapping questions are the only planned user
  interaction; everything after runs autonomously. Surface hard blockers
  (missing credentials, dead dev stack, other-repo issues) in the close-out
  rather than stalling mid-queue — move to the next session.
- Respect the engines' economy rules (they cap subagents at ≤4 per phase);
  this skill adds NO subagents of its own beyond what they specify.
- Never process a `recording` session; never regenerate a `tested` session
  without an explicit ask.

## Red flags — STOP

- You are about to start pipeline work with no `vitrinka.config.json` and
  no user confirmation of the derived map.
- Two sessions being worked in parallel, or work happening outside the
  session's worktree.
- Tests launched before the readiness check passed.
- A verification pass composed onto a DIFFERENT board than the session's.
- The session's `tested` stamp is set but you're regenerating anyway.
