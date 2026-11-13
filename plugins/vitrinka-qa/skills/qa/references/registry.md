# Journeys and sessions — where the record lives

The task engine is the truth for both: a **journey** is a `journey` task
whose `fields.key` is its registry key, and a **session** is the recorded
session on the server with its `meta.pipeline` stamps. Nothing under
`.vitrinka/` is committed — the directory is machine-local and ignores
itself — so a `.vitrinka/journeys.json` or `.vitrinka/sessions.json` you find
there is at most a local cache from an earlier run: read it for speed, never
trust it over the server, never `git add` it.

## The journey registry — `journey` tasks

What journeys exist, which test files realize them, and where they came from.
The consolidation verdict (extend | update | new | skip) is computed against
this set + a repo test scan.

Read doors:

- `vitrinka task resolve-qa --json` (the branch's `vt-<id>`, or `--task
  <epic|qa>`) → `get {kind: "task", id: "<workspace>/<qa>", include:
  ["children"]}` — the feature's QA plan with its `journey` children. No
  plan for this branch → the project-wide read below.
- `list {kind: "task", project, f: {types: ["journey"]}, fields: "full"}` —
  every journey of the project when no plan is bound; `search {kind:
  "task", q, project}` for one by intent.

Per journey task:

- `fields.key` — the registry key: kebab-case user intent. NEVER
  session-derived (`session-7-flow` is forbidden — journeys outlive sessions).
- `fields.test` — the primary spec path (`e2e/orders-create.spec.ts`);
  written by generate-test through `update {kind: "task", id, fields}`.
- `fields.route` / `flow` / `expected` / `role` — the walk itself (the
  `vitrinka-pm:tasks` skill's "Journeys" recipe).
- refs — `add_task_ref {id, kind: "session", ref: "<session board slug>"}`
  accumulates every recording that shaped the journey; the dedup signal for
  `skip` verdicts. Board refs carry `meta.section`.
- `fields.verdict` — `untested` (emitted, not yet run) | `pass` (ran green)
  | `fail` (asserts correct behavior blocked by a known open bug — link the
  bug in a comment) | `partial`. A superseded journey is cancelled (keep the
  task, drop the file); its status, not a verdict, says so.
- A cross-surface journey appears once per framework with a `-web`/`-app`
  suffix only when the flows genuinely differ; otherwise one key, two spec
  paths (`fields.test` holds the primary; the second rides a `file` ref).
- Reusable blocks (`e2e/blocks/login.ts` …) are a repo concern: derive the
  block index from the test scan; a block no journey imports is flagged in
  the close-out, never auto-deleted.

A journey the recording proved but the plan lacks is NOT created by
generate-test — list it under "plan gaps" so the tasks skill's "Journeys"
recipe adds it under the qa task.

## The session ledger — `meta.pipeline` on the recorded session

Which recorded sessions this repo has already worked, and what came out of
them. `search {q: "<project>", groups: ["sessions"], project, limit: 50}`
lists candidates (status + board slug per row); `get {kind: "session", id |
board}` returns one session with its stamps under `session.meta.pipeline`.
Stamps are written through ONE door:

```text
update {kind: "session", id, pipeline: {triaged: "<ISO>", fixBranch: "fix/session-7", fixPr: "<url>"}}                       # fix stage
update {kind: "session", id, pipeline: {tested: "<ISO>", testBranch: "test/session-7", journeys: [...], testPr: "<url>"}}   # generate-test
```

Stamps merge key-wise (null deletes); they never touch session activity or
auto-close timing.

- `triaged`/`fixBranch`/`fixPr` — written by the fix stage at close-out.
- `tested`/`testBranch`/`journeys` — written by generate-test at close-out.
  `testBranch` is the durable pointer (a commit cannot embed its own hash);
  `testPr` is added once the PR exists. `journeys` names the keys the
  server records as `observed` runs on each matching plan.
- A session with `tested` is DONE for the pipeline; the retrieval autopilot
  skips it. Absent or fix-only entries are pending work.
- A stamp missing after a stage ran is a bug to fix now — the server IS the
  record; there is no repo file to fall back on.
