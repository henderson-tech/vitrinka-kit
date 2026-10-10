---
name: tasks
description: "Use when working a project's task engine from the repo — '/tasks [list|intake|file|epic|rule]', 'file a task', 'find the X epic', 'file this under the X epic', 'plan the epic', 'triage intake', 'sprint start', 'add an automation rule'."
metadata:
  vitrinka-contract: "2026-09-15"
---

# tasks — the task engine, agent side

The verbs are the MCP generic verbs (`list · get · create · update · delete
· search {kind}`; `docs {topic:"kind:task"}` is the per-kind contract, `docs
{topic:"tasks"}` the engine's) and the CLI (`vitrinka task|sprint|intake|
project --help`). This skill carries only the laws the verbs do not print.
Ids are per-workspace: `"<workspace>/<id>"` on every id-only call, or
`workspace` beside a bare id.

## Vocabulary laws

- **State groups** `backlog · unstarted · started · completed · cancelled`
  are universal; a project's states (`list {kind:"state"}`) are keys inside
  them and `status` derives from the group. `list {kind:"state"}` before
  writing `state`; `list {kind:"field"}` before writing `fields`.
- **Types** `task · bug · story · epic · todo · qa · journey · meeting` are
  ONE generated enum. An `epic` is the feature's whole record (children by
  `parentId`, the feature preset `outcome · non_goals · gates · decisions ·
  ledger_state · waiting_on · next_action`); a `qa` task is its test plan
  (`scope · roles · verdict · coverage`), a `journey` one user path inside
  it (`key · role · route · flow · steps · expected · verdict · test` —
  author `flow`, never `steps`); a `meeting` is promoted from the diary; a
  `todo` is the `me` skill's shape. Engineering work is a `task`.
- **Gates** (`gates`, `decisions` checklists) are ticked `done` WITH
  `evidence`, never bare; `kind` says who resolves one — `human` (waits on
  `who`, else the assignee, else the reporter), `action`, `date`
  (auto-ticked at `at`).
- **Labels**: `labels` on `create {kind:"task"}` sets, on `update
  {kind:"task"}` REPLACES, `label_task {add, remove}` increments (use it
  when another agent may be labelling). `eve-*` is a reserved namespace:
  those labels fire Eve flows and spend credit — never for bookkeeping.
- **Refs** are the evidence: `session · shot · board · file · pr · run ·
  commit`, the typed documents `transcript · conversation · brainstorm ·
  plan · handoff · decision · distill · brief · notes`, and `final`.
  `commit` and `pr` refs are attached by the GitHub App (`Vitrinka-Task:`
  trailer, `vt-<id>` branches; `meta.merged` completes the task) — never by
  hand. A `file` ref is a URL, never a path: `vitrinka task upload <id>
  <files…>` streams disk, `upload_task_file` takes inline text.
- **External links** name the issue a task tracks (GitHub, GitLab, Jira —
  ONE owner task per issue; a second attach answers `link_owned` with the
  owner) and the Confluence pages it refers to: `add_task_ref {kind:
  "external", ref: <url>}`, `vitrinka task links add <id> <url>`, or
  `links` at creation. Before filing a task for an issue, `vitrinka task
  find <url>` (or `search {q: <url>, mode:"resolve"}`) names the task that
  already tracks it — exact, never a ranked guess. Contract: `docs {topic:
  "guide:external-links"}`.
- **Attachments are versioned, never replaced**: the same filename is the
  next version, `versionOf` names the lineage, a `distill` carries
  `derivedFrom`. Write a `hint` on everything you attach; `meta.tokens`
  tells the next reader the price. Never delete a version to clean up.
- **Every task's `url` is its ONE link** — in chat a masked link labelled
  by its `key` (`[VIT-12](<url>)`) over the url exactly as returned; never
  compose, shorten or guess a route. Bodies reference by grammar, not URL:
  `<PREFIX>-<id>` / `vt-<id>` / `#<id>` for tasks, `owner/repo#123` for
  PRs, a repo path (`internal/web/foo.go:64`), an attachment's filename.
- **Unknown arguments are a 400** naming the key and the accepted set —
  read the error, fix the call, never retry the same shape.
- **CLI reads describe their own shape**: `<verb> --help --json` →
  `.data.dataShape`; every task verb takes any spelling (`42`, `VIT-42`,
  `<ws>/42`, the URL); an epic's children are `task list --parent <id>`.
  Never pipe `--json` into a guessed jq path.
- **The MCP gone is never a skipped write**: when the vitrinka tools vanish
  or cannot connect, make the same write with its CLI verb (`task comment ·
  update · create · label · upload · handback`, `me todo add · done`,
  `board compose <board> --file -` with compose_board's arguments), the
  task spelled `<workspace>/<id>`. An unreachable deployment queues it in
  the outbox (exit 0, `data.queued`); it replays exactly once before the
  next CLI call that reaches the server. Never re-send it by hand:
  `vitrinka outbox list` shows what waits and what the server parked, and
  why. An operation with neither an MCP tool nor a CLI verb has no door:
  say so, never a raw request.

## The doors

- **Project settings**: `get` / `update {kind:"project_settings"}` share the
  human settings door. Read before writing: omitted fields stay; `types`
  and `commits` replace their whole section. Empty `historyTheme` restores
  the house look; empty `types` clears overrides.
- **Intake is the ONLY way a draft becomes a task**: `propose_tasks`
  (deduped, `list {kind:"intake"}` shows the verdict) → a human's
  `intake_verdict`, or the work itself: a session run on a draft, or a PR
  claiming it, accepts it — so never start a run on a draft you only meant
  to read. The pending queue reads uncapped across every project or one,
  by `group` (`stale` · `plan` · a source kind), with `view: "summary"` for
  the counts alone; a batch verdict is ONE `intake_verdict {ids}` call.
  Never file a task and a draft for the same finding; never accept your
  own drafts unless the user asked you to triage — but DO withdraw one you
  filed once it is moot (`intake_verdict {verdict: "decline"}` from the
  same credential; accept and merge stay an admin's or agent token's). Plan
  proposals (`list {kind:"intake", group:"plan"}` / `proposal_verdict`)
  follow the same rule.
- **Pickup · spot · hand back** keep the tree true without end-of-session
  bookkeeping: `get {kind:"task", view:"pickup"}` before touching code
  (pickup skill), `spot` the moment you will not do something (spot skill),
  `hand_back` to end (handoff skill — its `rendered` block IS the chat
  hand-back; next steps land as steps and gates ON the task, a child only
  for work that needs its own session). Status moves by itself (run → in
  progress, PR → in review, merge → done); `update {kind:"task", status}`
  only to correct.
- **Reading**: `summarize_tasks` for counts; `list {kind:"task", f}` with
  the filter document (states, groups, types, categories, origins,
  admission, priorities, assignees, labels, sprint, milestone, parent,
  intake, due · start · created · updated spans, text, fields, order, sort
  [{key, dir}]) for rows, or `ask` (a phrase Eve compiles into `f`; page on
  with the reply's `compiled` as `f`); `search {kind:"task"}` narrowed by
  type, state, parent or `epic` (any depth), `within` for every match in
  one task's tree; `search {board}` with no q for the tasks a board likely
  belongs to; a refused type, state or project names the allowed values.
  `get {kind:"brief"}` before planning anything in a project;
  `read_task_ref` under a `budget` or with a `question` — never a
  transcript blind; `ask_task {id, question}` for a cited answer over the
  task, `ask_task {project, question}` for an open question ("what blocks
  4.0.0?") with the task urls it rests on — AI credits, never to find ONE
  task.
- **The feature lifecycle** hangs on the epic: the brainstorming skill
  files it (board + decision refs); the PR attaches as a `pr` ref and at
  merge the QA plan is drafted as ONE family — a `qa` draft and its
  `journey` drafts (one per user path) in one `propose_tasks` batch; one
  open plan per epic (a newer draft supersedes the pending one; a live plan
  takes new journeys as drafts under it, and a second plan beside it is
  refused). The reviewer admits a family with ONE verdict: `intake_verdict
  {id, verdict, family: true}` · `vitrinka intake accept <id> --family`.
  `vitrinka task resolve-qa` finds the plan (`pending` = still waiting on
  that verdict). Every pass is a run on the plan — `publish_run`, a
  usertest or pair pass, a session stamped with journey keys (`observed`) —
  and the plan reads whole on its board (`qa_board`); `vitrinka task final
  <epic>` / `compose_final` composes the final artifact; a later `story`
  that revises another links `supersedes`.
- **Scope**: categories (`list {kind:"category"}`) are permanent
  vocabulary; epics are finite outcomes. `origin` records who requested
  work, independently of the filing actor; never guess historical
  Unknown. Admission uses existing Intake. Children and follow-ups inherit
  approved scope (`create {kind:"scope_resolution"}` resolves it without
  creating a task); verified bugs use coverage, ambiguous matches ask,
  unverified bugs and enhancements enter Intake.
- **Sprints** (`vitrinka sprint --help`) allow optional dates and
  concurrent active scopes. Bind the session explicitly to a sprint or none
  (`update {kind:"session_scope"}`) before feature creation. Read bounded
  members → `create {kind:"sprint_transition_preview"}` with the selected
  carry → apply that exact preview with a stable `requestId` (`create
  {kind:"sprint_transition"}`); a stale version means reread and review.
  No implicit carry or deletion.
- **Readiness** (`get {kind:"scope_readiness"}`): required Before/Ship
  obligations block shipment; After obligations block closure. Deferral
  needs an owner and typed trigger. Candidates bind exact repository
  revisions/builds; a cut release is not deployment. Agents may cite
  evidence (`create {kind:"candidate_evidence", verified: false}`), never
  verify it or declare shipment. Now and history work without Eve.
- **Copilot** answers "where are we": `get {kind:"copilot", project}` is
  the project Overview (Eve's brief and moves, needs you, gating bugs,
  next, active sprints); `get {kind:"cockpit", project, id}` is one
  sprint's panels. Both work without Eve.
- **History** answers "what happened": `get {kind:"history_chapter"}` is
  one chapter's spread (cover, narrative, numbers, boards, documents);
  `update` rewrites its narrative or pins its cover; `create
  {kind:"history_edition"}` exports chapters as a doc artifact. Merged work
  reaches `shipped` only through production deploy marks (`vitrinka
  project deploy-mark <env> <sha>`).
- **Rules** are typed `{trigger, conditions, actions}` documents: `create
  {kind:"rule", project, name, ast, enabled?}` (admin) creates one DISABLED
  unless `enabled: true`; ALWAYS `dry_run_rule {id, events?, ast?}` (writes
  nothing) and show what would have fired before enabling. The AST
  vocabulary and the enable switch of a stored rule have no MCP or CLI
  door: say so, and leave the switch to a person in the PM app.
- **Mirror** (Jira): the truth side wins every conflict; never "fix" a
  conflict by editing the losing side.
- **Transfer** (`transfer_project {project, to, dryRun}`, CLI `vitrinka
  project transfer --to <workspace> [--dry-run]`): dry-run first, show the
  report and the `merge` renames; doctrine `docs {topic:
  "project-transfer"}`.
- **Moving tasks between projects**: never recreate a task elsewhere (it
  loses history, comments, attachments). `update {kind:"task", id,
  project}` moves one, `bulk_update_tasks {ids, patch: {project}}` up to
  200 in one transaction; the target must exist (unknown slug → 422); a
  task moves WITH its subtree; state, labels, fields, sprint and milestone
  remap by key (missing keys are created in the target, the source
  vocabulary untouched); `project` applies first, so a `state` or `fields`
  in the same patch resolves against the target.
- **Merging a whole project**: `merge_project {project, into}` folds one
  project INTO another of the SAME workspace (tasks with history, boards,
  sets, sessions, reports, releases, memory; the source becomes an alias so
  old links keep working; a clashing custom field is renamed
  `<key>_from_<source>`). A missing `dryRun` IS a dry run — read the report
  first; the apply is an owner-person's call (agent token → 403): hand the
  human `vitrinka project merge <old> --into <new> --apply`. Another
  workspace is `transfer_project`.
- **Favorites**: `my_favorites {scope?, folder?}` is the caller's bookmark
  tree (roots `personal` and `workspace`, folders nested, rows {kind, id,
  key, title, url, project}) — read it at pickup to see what the person
  keeps close. `favorite` / `unfavorite {entityType, entityId | entityKey,
  scope?, folder?}` star through the ★ button's door; starring again
  re-files, never duplicates. Star only what the user asked to keep close —
  a bookmark is theirs, never a note. CLI: `vitrinka fav list|add|rm`.
- **Comments**: `create {kind:"comment", id, body}` talks on a task;
  `@name` reaches that person's My work, `@eve` asks Eve and her answer
  lands as a reply under your comment; `parentId` replies inside a
  comment's thread (any depth); `list {kind:"comment", id}` pages them
  oldest first, `vitrinka task get <id>` reads them with the task.
