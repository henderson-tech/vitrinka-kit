---
name: tasks
description: "Use when working a project's task engine or release from the repo — '/tasks [list|intake|file|epic|rule|release]', 'file a task', 'find the X epic', 'plan the epic', 'triage intake', 'sprint start', 'add an automation rule', 'cut the release', 'write the release notes'."
metadata:
  vitrinka-contract: "2026-09-15"
---

# tasks

The verbs are the MCP generic verbs (`list · get · create · update · delete · search {kind}`; `docs {topic:"kind:task"}` per kind, `docs {topic:"tasks"}` for the engine) and the CLI (`vitrinka task|sprint|intake|project --help`). This skill holds only the laws the verbs do not print. Pickup, spot and hand-back are the `work` skill.

## Vocabulary

- State groups `backlog · unstarted · started · completed · cancelled` are universal; a project's states are keys inside them and `status` derives from the group.
- `list {kind:"state"}` before writing `state`; `list {kind:"field"}` before writing `fields`.
- Types `task · bug · story · epic · todo · qa · journey · meeting · watch · initiative` are ONE generated enum; engineering work is a `task`.
- An `initiative` sits above epics (top level or under another initiative; an epic may sit under one, or anywhere it could before): preset `budget · budget_currency`; its direct dated non-epic children are its checkpoints, its refs its documents.
- A Roadmap milestone is a task under an initiative with `dueAt`; `create {kind:"milestone"}` makes a release. `template: <key>` on `create {kind:"task"}` fills what you omit from a project template (`get {kind:"project_settings"}` lists them).
- An `epic` is the feature's whole record (children by `parentId`, or a whole list in one write as `children: [{title, children?}]` on create or update, ≤50 lines, ≤3 deep; preset `outcome · non_goals · gates · decisions · ledger_state · waiting_on · next_action`).
- A `qa` task is the feature's test plan (`scope · roles · verdict · coverage`); a `journey` is one user path in it (`key · role · route · flow · steps · expected · verdict · test`); author `flow`, never `steps`.
- A `meeting` is promoted from the diary; a `todo` is the `me` skill's shape.
- Tick a gate (`gates`, `decisions`) `done` WITH `evidence`, never bare; `kind` says who resolves it: `human` (waits on `who`, else assignee, else reporter), `action`, `date` (auto-ticked at `at`).
- `labels` on `create {kind:"task"}` sets, on `update {kind:"task"}` REPLACES; `label_task {add, remove}` increments when another agent may be labelling.
- `update {kind:"label", project, label, name | colour}` renames or recolours one label project-wide (its tasks keep it); `delete {kind:"label"}` strips it from every task; both need `label.manage` (Product manager and above); never rename into or out of `eve-*`.
- `eve-*` labels fire Eve flows and spend credit; never use them for bookkeeping.
- Refs are evidence: `session · shot · board · file · pr · run · commit`, typed documents `transcript · conversation · brainstorm · plan · handoff · decision · distill · brief · notes`, and `final`.
- Never attach `commit` or `pr` refs by hand: the GitHub App attaches them (`Vitrinka-Task:` trailer, `vt-<id>` branches).
- A PR claims a task by branch or title key or a closing keyword in its body (a bare mention only links); a merged claiming PR completes a task only when no open checklist item or other claiming PR remains, never an epic.
- A `file` ref is a URL, never a path: `vitrinka task upload <id> <files…>` streams disk, `upload_task_file` takes inline text `content` or a public https `url` the server downloads (any type); a file that lives only in the chat is dropped on the task's `url` by its person.
- `complexity` (trivial · junior · medior · senior · architect · research — the reasoning, never a person) and `size` (XS–XXL) are separate; "" is unestimated, never trivial (docs `guide:estimating`).
- `readers` are the roles a task is written for, `fields.for` whose problem it solves, `audience` who should see it: a filter, never access.
- `environment` is where a task was seen (dev, demo, production or a host); a report or session fills it from the project's domain rules, `f.environments` narrows by it.
- ONE owner task per external issue (GitHub, GitLab, Jira); a second attach answers `link_owned`; attach with `add_task_ref {kind: "external", ref: <url>}`, `vitrinka task links add <id> <url>` or `links` at creation (`docs {topic: "guide:external-links"}`).
- Before filing for an issue run `vitrinka task find <url>` (or `search {q: <url>, mode:"resolve"}`); it is exact, never a ranked guess.
- Before filing anything run `search {mode:"similar", project, q: <draft title>}` and link, extend or follow a match instead of filing a twin.
- Attachments are versioned, never replaced: the same filename is the next version, `versionOf` names the lineage, a `distill` carries `derivedFrom`; never delete a version to clean up. `delete {kind:"task_ref", id, ref}` removes a wrong attachment.
- Write a `hint` on everything you attach; `meta.tokens` tells the next reader the price.
- Bodies reference by grammar, never URL: `<PREFIX>-<id>`, `vt-<id>`, `#<id>`, `owner/repo#123`, a repo path (`internal/web/foo.go:64`), an attachment's filename.
- An unknown argument is a 400 naming the key and the accepted set: fix the call, never retry the same shape.
- CLI reads describe their shape (`<verb> --help --json` → `.data.dataShape`); every task verb takes any spelling (`42`, `VIT-42`, `<ws>/42`, the URL); never pipe `--json` into a guessed jq path.
- MCP gone: make the same write with its CLI verb (`task comment · update · create · label · upload · handback`, `me todo add · done`, `board compose <board> --file -`), the task spelled `<workspace>/<id>`.
- Offline, the CLI queues the write in the outbox (exit 0, `data.queued`) and replays it once; never re-send it; `vitrinka outbox list` shows what waits and what was parked.

## Doors

- Watch: `create {kind:"task", type:"watch"}` when repeated source observations must produce evidence and prepared work; drive it with `update_watch` ops `intent`, `draft`, `plan`, `arm`, `pause`, `resume`, `cancel`, `check`; read `get_task {id, view:"watch"}`.
- A watch draft or saved plan authorizes nothing: arm exactly the revision you reviewed; an edit needs arming again; follow-up work lands in Intake, never auto-accepted.
- Project settings: `get` / `update {kind:"project_settings"}`; read before writing; omitted fields stay; `domains`, `apps`, `types`, `commits` replace their whole section; empty `historyTheme` restores the house look; empty `types` clears overrides.
- Intake is the ONLY way a draft becomes a task: `propose_tasks` (deduped; `list {kind:"intake"}` shows the verdict) → a human's `intake_verdict`, or the work itself (a session run on a draft or a PR claiming it accepts it).
- Never start a run on a draft you only meant to read.
- The pending queue reads across every project or one, by `group` (`stale` · `plan` · a source kind), `view: "summary"` for counts; a batch verdict is ONE `intake_verdict {ids}` call.
- Never file a task and a draft for the same finding.
- Never accept your own drafts unless the user asked you to triage; withdraw a moot one with `intake_verdict {verdict: "decline"}` from the same credential.
- Plan proposals (`list {kind:"intake", group:"plan"}`, `proposal_verdict`) follow the same rules.
- Read counts with `summarize_tasks`; rows with `list {kind:"task", f}` (states, groups, types, categories, origins, admission, priorities, assignees, reporters, labels, environments, sprint, milestone, parent (+`descendants`), intake, due · start · created · updated spans, text, fields, order, sort `[{key, dir}]`) or `ask` (Eve compiles it into `f`; page on with `compiled` as `f`).
- `search {kind:"task"}` narrows by type, state, parent or `epic` (any depth), `within` for one task's tree; `get {kind:"task", id, include:["tree"]}` reads an epic's whole workspace in one call (every level, rank order, `parentId` per row); `search {board}` with no q for the tasks a board belongs to; `search {q, across: true}` for every workspace.
- `get {kind:"brief"}` before planning anything in a project.
- `read_task_ref` under a `budget` or with a `question`; a picture answers as an image fitted to the budget, another binary as a diagnosis naming the task's `url`; never a transcript blind.
- `ask_task {id, question}` for a cited answer over one task, `ask_task {project, question}` for an open question; it spends AI credits, never use it to find ONE task.
- The feature lifecycle hangs on the epic: `brainstorming` files it; at merge the QA plan is drafted as ONE family (a `qa` draft and its `journey` drafts) in one `propose_tasks` batch.
- One open plan per epic: a newer draft supersedes the pending one; a live plan takes new journeys as drafts under it; a second plan beside it is refused.
- Admit a family with ONE verdict: `intake_verdict {id, verdict, family: true}` (`vitrinka intake accept <id> --family`); `vitrinka task resolve-qa` finds the plan (`pending` = waiting on that verdict).
- Every pass is a run on the plan (`publish_run`, a `qa usertest` or `listen pair` pass, a session stamped with journey keys); `qa_board` reads it whole; `vitrinka task final <epic>` / `compose_final` composes the final artifact; a `story` revising another links `supersedes`.
- Categories (`list {kind:"category"}`) are permanent; epics are finite outcomes; `origin` records who requested work; never guess a historical Unknown.
- Children and follow-ups inherit approved scope (`create {kind:"scope_resolution"}` resolves it without a task); verified bugs use coverage, ambiguous matches ask, unverified bugs and enhancements enter Intake.
- Bind the session to a sprint or none (`update {kind:"session_scope"}`) before creating a feature (`vitrinka sprint --help`).
- Sprint transition: read bounded members → `create {kind:"sprint_transition_preview"}` with the chosen carry → apply that exact preview with a stable `requestId` (`create {kind:"sprint_transition"}`); a stale version means reread; no implicit carry or deletion.
- Readiness (`get {kind:"scope_readiness"}`): Before/Ship obligations block shipment, After obligations block closure; deferral needs an owner and a typed trigger.
- Cite evidence with `create {kind:"candidate_evidence", verified: false}`; never verify it or declare shipment; a cut release is not a deployment.
- `get {kind:"overview", project}` answers what is built and building (`after`, `chapters: <chaptersNext>` page on); `get {kind:"copilot", project}` what needs doing; `get {kind:"cockpit", project, id}` one sprint; `get {kind:"roadmap", project}` when each initiative and epic lands.
- Bugs: `list {kind:"bug", project?, q, sort, state, source, filed: "me"}`; a tester's verdict is `create {kind:"retest", id, verdict, note?}`, never `update {kind:"task"}`.
- `get {kind:"project_graph", project, node: "task:12"}` reads one node's recorded relations (first 100, `more`, `total`); nothing is inferred. `lens: "work"` reads the mind map: work items, `person:<id>` assignees and reporters, and `fields` values; `states`/`types`/`people` filter.
- `get {kind:"history_chapter"}` reads a chapter; `update` rewrites its narrative or pins its cover; `create {kind:"history_edition"}` exports chapters; merged work reaches `shipped` only through `vitrinka project deploy-mark <env> <sha>`.
- `list {kind:"change", project, f}` pages each PR merged to the default branch; `get`/`update {kind:"change"}` read and reword one (an edit pins it); `create {kind:"change", project, fields: {kind, title, …}}` appends one; a PR body's `## Changelog` section is used as written.
- Rules: `create {kind:"rule", project, name, ast, enabled?}` creates it DISABLED unless `enabled: true`; ALWAYS `dry_run_rule {id, events?, ast?}` and show what would have fired before enabling.
- The AST vocabulary and a stored rule's enable switch have no door: say so and leave the switch to a person in the PM app.
- Jira mirror: the truth side wins; never fix a conflict by editing the losing side.
- Transfer: `transfer_project {project, to, dryRun}` (`vitrinka project transfer --to <workspace> [--dry-run]`); dry-run first, show the report and the `merge` renames (`docs {topic: "project-transfer"}`).
- Never recreate a task in another project: `update {kind:"task", id, project}` moves one, `bulk_update_tasks {ids, patch: {project}}` up to 200; the target must exist (422); the subtree moves along; keys remap; `project` applies first.
- `merge_project {project, into}` folds a project into another of the SAME workspace; a missing `dryRun` IS a dry run; read the report; the apply is an owner's call (agent token → 403): hand them `vitrinka project merge <old> --into <new> --apply`.
- Favorites: `my_favorites {scope?, folder?}` reads the caller's bookmarks; `favorite` / `unfavorite {entityType, entityId | entityKey, scope?, folder?, at?}`; folders are kind `favorite_folder` on create · update · delete; contract `docs {topic: "guide:favorites"}`. Star only what the user asked to keep close (CLI `vitrinka fav list|add|rm`, `vitrinka fav folder add|rename|mv|rm`).
- Comments: `create {kind:"comment", id, body}` (`@name` reaches that person, `@eve` asks Eve, `parentId` replies in a thread); `list {kind:"comment", id}` pages them; `update {kind:"comment", id, body}` and `delete {kind:"comment", id}` act on your own (an admin on any); `get {kind:"inbox", why?: "mentioned"|"held", before?: <nextBefore>}` is what happened to my tasks; `update {kind:"follow", id, following}` follows a task or stops (a card's `follows: true` is one only followed).

## Release (`/tasks release [status|refresh|cut|notes]`)

- The ONE door is `vitrinka project release` from a checkout bound to the project (`vitrinka.config.json`, else `--project <slug>`); `--json` for the envelope.
- The release track has no MCP tool: without the CLI, stop and say so; an unknown flag means an old CLI: `vitrinka update`.
- The rolling release spans every repository in it, each contributing PRs merged into its branch since its window start; a cut freezes the page and opens the next window.
- Releases are markers on the project's Timeline (`list {kind:"change"}`); `update {kind:"milestone", archived}` archives or restores one.
- Stats and the merge timeline are computed by the server, never by the model; entries link only PRs the server swept, at most ONE screenshot and up to three boards; up to 24 boards portal in.
- Publish current screens (`publish`, `qa usertest`) BEFORE refreshing: the best 24 ranked shots go to Eve.
- `status` (default): per repository branch, start..head, PR count, last sweep, board URL, cut history; no release yet: offer the first refresh.
- `--refresh` re-sweeps and asks Eve to rewrite her cards (never human ones); hand over the board URL, never poll.
- The first refresh names each repository: `--repo <owner>/<name>[:<branch>][@<start>]`; branch = the branch PRs merge INTO (default branch if omitted); start = a commit SHA or RFC 3339 instant; later refreshes and the next release need no flags.
- Trunk flow start: the commit the last shipped release was cut from.
- Integration-branch start, in EACH repository: `f=$(git rev-list --first-parent --reverse origin/<branch> ^origin/<from> | head -1) && git rev-parse "$f^1"`; ask the user when the line is unclear.
- Never `git merge-base` for a start: it jumps forward once `<from>` merges back and drops PRs.
- After the first refresh show the user each repository's start and PR count.
- Until the first cut `--repo …@<start>` corrects a start; after a cut passing a start is refused.
- A repository bound later joins only when a refresh lists every repository with `--repo`.
- `--until <full sha>` pins the primary repository's window end; check `headSha` equals the deployed commit before cutting (`release_until_unknown`, `release_until_outside`).
- A window starts AFTER its start commit.
- `hasDoc` with `docHeadSha` != `headSha` is a stale page.
- Read failures and fix the call: `release_start_required`, a repository not bound, the GitHub App not connected or unable to read.
- Confirm a cut with the user first: `vitrinka project release --cut --yes [--title …] [--version …]`; cutting twice is refused; refused until a sweep completed and while a listing was truncated.
- `--expect-head <sha>` cuts only while the head is the commit you checked; `release_head_mismatch` means nothing was cut.
- Share a frozen board without sign-in: `vitrinka board share <slug>` or `share_board`.
- Notes are a doc.json artifact per release; look up every shape (`docs {topic:"artifact:docjson"}`, `docs {topic:"element:gallery"}`, `docs {topic:"element:chart"}`), never recall it.
- Notes register: `payload.direction: "release"`, `payload.accentColor`, `payload.accent` (the title phrase lit), `payload.intro` (3–4 sentences), `payload.chips` (version, window, PR count).
- Notes shape: chapters are top-level sections labelled `01 · Booking`; features are nested sections labelled `✨ New · for <who>` (🐛 Fixed, 🔧 Improved).
- Screens are a `gallery`, never stacked figures: `bento` for 3–6, `carousel` for many, `masonry` when the whole image matters.
- Pick screens from `scrape_board` image cards with `vs` ≥ 60, one per `dup` group (the card whose `id` equals `dup`); phone shots never beside desktop ones; no `vs` yet means scrape again later, never guess.
- A before/after number is a `chart` with `viz: "compare"` and `better`, never a prose claim or hand-toned delta.
- Tag elements `audience`: `public`, `technical`, `internal`; untagged is everyone.
- `==highlight==` marks ONE phrase per feature.
- Link the notes after `vitrinka board push`: `vitrinka project release --notes <project>/<branch>/<key>`; `--notes-clear` unlinks; refused: `kind_mismatch`, `foreign_workspace`, no rolling release, a trashed document.
- A large push fails only when bytes stop moving (`timeout`, 60 s idle); set `VITRINKA_UPLOAD_IDLE=3m` for a pausing link.
- Hand back the board as `[<board title>](<url>)` over the exact `url`; on a bound task finish with `work handoff`.
