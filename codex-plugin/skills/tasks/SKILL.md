---
name: tasks
description: "Work a project's task engine from the repo — file and triage intake drafts, plan an epic, comment, label, rank, link, bulk-move, search, attach and read versioned files, ask Eve about a task, sprint start/complete, and author automation rules (dry-run first). Invoke as /vitrinka:tasks [list|intake|file|epic|rule] FROM THE APP'S REPO; the same verbs exist as MCP tools and `vitrinka task|sprint|intake`."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:tasks — the task engine, agent side

Tasks are a relational engine (PM overhaul 2026-09-03): configurable states in
five fixed groups, item types, labels, comments with @mentions, a manual rank,
multi-assignee, typed attachments (session · shot · board · file · pr · run),
an **intake** lifecycle for proposals, a durable `task_events` ledger, saved
filter views, rules, and a per-project Jira mirror. Boards only ever carry a
projection card of a task. Everything below is one MCP tool or one CLI verb;
there is nothing an agent can do that a human cannot see and undo.

## Vocabulary

- **State groups** are universal: `backlog · unstarted · started · completed ·
  cancelled`. A project's **states** (`list_states`) are keys inside those
  groups; every project starts with the six legacy statuses as states, so
  `status` still works and is derived from the state's group.
- **Types**: `task · bug · story · epic · todo · qa · journey` — the ONE
  enum, generated into every MCP schema from `store.TaskTypes` (`type` on
  create/update, `appliesTo` on fields, `types` in the filter). An `epic`
  is a container (children by `parentId`, the feature preset), a `story` a
  user-facing slice, a `bug` a defect, a `task` engineering work; a parent
  task rolls its children up. A `qa` task is a feature's TEST PLAN (child
  of the epic, the `qa` preset: `scope · roles · verdict · coverage`), a
  `journey` one user path inside it (child of the qa task, the `journey`
  preset: `key · role · route · steps · expected · verdict · test`) — see
  "The feature lifecycle" below. Each type has a fixed icon + colour (overridable per
  project in Settings → Projects) so the list reads at a glance. A `todo` is a personal reminder with a moment (milestone,
  trigger, clock) — the `me` module's `/vitrinka:todo`, `todo-list`,
  `todo-done`, `todo-milestone` and `remind` skills own that shape
  (`vitrinka todo|schedule`); file engineering work as `task`.
- **Labels** have three doors, all REST twins: `labels` on `create_task`
  (the initial set) and on `update_task` (REPLACES the set), and
  `label_task {id, add, remove}` for increments — the one to use when
  another agent may be labelling too. Labels are created on demand by
  name (`list_labels` to see them). **`eve-*` is a reserved namespace**:
  those labels are Eve triggers wired to built-in rules (`eve-distill`,
  `eve-summarize` — see "Asking Eve"); never invent an `eve-*` label for
  your own bookkeeping.
- **Unknown arguments are a 400**, not a silent drop: the MCP checks every
  top-level key against the tool's schema before dispatch and names the
  key and the accepted set; the `agent_calls` row records the rejection.
  Read the error, fix the call — never retry the same shape.
- **Rank** is a string; `rank_task {before, after}` moves, `list_tasks` with
  the filter document `{order: "rank"}` reads it.
- **Refs** attach a task to the evidence: `add_task_ref {kind, ref, meta}`.
  Kinds: `session · shot · board · file · pr · run · commit` for evidence,
  the typed attachments `transcript · conversation · brainstorm · plan ·
  handoff · decision · distill`, and `final` (the composed feature page,
  versioned). A `commit` ref is `owner/repo@sha` and is attached by the
  GitHub App's `push` event for every commit whose message names the task
  (`Vitrinka-Task:` trailer or subject prefix — the per-repo hook
  `vitrinka project setup` installs writes them); never add one by hand. A `pr` ref is `owner/repo#n`; the GitHub
  App webhook attaches it for branches or PRs carrying `vt-<id>`, and
  `meta.merged = true` completes the task through a built-in rule. A
  `file` ref is a URL, never a path: a path on your machine opens nowhere
  else and the door refuses it (422). Put the file in workspace storage
  instead — `vitrinka task upload <id> <files…>` streams anything from
  disk, `upload_task_file {id, filename, content, kind?, hint?,
  versionOf?}` takes small text inline (1 MiB, `.md .txt .json .csv .html
  .yaml .log .diff .patch`) — and the ref lands as
  `https://…/uploads/tasks/<id>/<rand>.md` with `meta {filename, mime,
  size, sha256, hint?, tokens, harness?}`, shielded from retention for as
  long as the task lives. Evidence serves as a download (attachment, never
  inline HTML) — it opens from any machine, it does not render in the tab.
- **Attachments are a versioned document store** — nothing is ever
  replaced. The same task + kind + `meta.filename` uploads as a new
  `version` (1…n); `versionOf: <refId>` names the lineage explicitly.
  `get_task {include:[refs]}` and `GET /tasks/{id}/refs` list the LATEST
  per lineage (`?history=1` for every version). A `distill` carries
  `derivedFrom {id, version}` — the exact source version it digests, so
  staleness is visible: a distill derived from transcript v2 when v3 exists
  is out of date. Write a `hint` on everything you attach ("load when
  resuming the auth work", "read before touching the migration"): the
  index is what the next agent reads, and `tokens` tells it the price.
- **Every task carries its ONE link**: `url` (the project page with the task
  panel open, workspace-scoped) comes back from `create_task`, `get_task`,
  `update_task` and every list row — hand it back exactly as returned when
  you file something; never guess, shorten or compose a route.
- **Custom fields** are per-project typed definitions (`list_fields`: key,
  kind, options, `appliesTo`) whose VALUES ride the task as `fields:
  {key: value}` on `get_task`, `create_task` and `update_task` (partial
  merge — pass only the keys you change, `null` deletes). Kinds and value
  shapes: `text · longtext · url` string · `select` one of the options ·
  `multiselect` string[] · `checklist` `[{name, done, evidence?}]` ·
  `number` · `date` "YYYY-MM-DD" · `relation` a task id. A definition
  applies only to its `appliesTo` type; every project carries the
  **feature preset on epics** — `outcome`, `non_goals`, `gates` and
  `decisions` (checklists: tick `done` WITH `evidence`), `ledger_state`
  (`scheduled` by default · `active · waiting · superseded · closed`),
  `waiting_on`, `next_action`. The filter document takes `fields:
  {key: value}` for select/multiselect. Defining fields
  (`create_field · update_field · delete_field`) is admin-only.
- **Intake drafts** are tasks with `intake = pending`. They never appear in
  normal lists; `list_intake` shows them with a dedupe verdict
  (`new | likely-duplicate` + candidate tasks and trigram scores).

## Filing work

- **You are sure it is a task** → `create_task` (or `vitrinka task create`).
  Attribution rides your token; never pass `reporter` unless you replay
  history with an admin token.
- **You are proposing** — a session distilled into findings, a "file these"
  from a chat, an annotation → `propose_tasks {project, source, drafts}`.
  The pipeline dedupes each draft against open tasks and stores the verdict;
  a human (or an agent token) accepts, declines or merges with
  `intake_verdict`. Say which drafts came back `likely-duplicate` and of what.
- **Filing from a bug report** happens on approve without you: the report
  becomes an accepted `bug` task, then the tracker ticket mirrors it.
- **Filing from a board card** is the human's door — the card's context
  menu "File a task from this card" (`POST /api/v1/cards/{id}/task`): the
  draft carries a board ref pinned to the card (`meta.cardId`, the panel's
  Evidence row links back), and an accepting reviewer gets the task
  projected onto the same board as a live task card. The agent-side twin is
  `propose_tasks` + `add_task_ref {kind:"board", ref, meta:{cardId}}`; the
  reverse hand (task → canvas) is the task panel's "Pin on <board>" or
  `POST /api/v1/boards/{slug}/task-cards {taskId}`. A whole board belongs
  to a task through `add_task_ref {kind:"board", ref, meta:{board:true}}`
  (a bare cardId-less ref counts too; meta merges, so a card-level ref keeps
  its cardId) — the board's breadcrumb then leads back to it, and `GET
  /api/v1/boards/{slug}/tasks` lists a board's tasks (explicit links as
  themselves, card-level ones as their top-most ancestor, `direct` +
  `linked`); the crumb's "Link task" is the human's twin.

## Planning an epic

An epic is a tree the engine holds, not a document you keep in your head.
Read `get_brief` first, then build it in this order and read it back:

1. `create_task {type:"epic", title, body, labels, fields}` — the title
   is a sentence, never an id prefix or a kebab slug (`create_task` lints
   that and says so); fill the feature preset (`outcome`, `non_goals`,
   `gates`, `decisions`) instead of restating it in the body.
2. Children: `create_task {parentId: <epic>, type: task|story|bug,
   title, labels}` per slice — one task per deliverable, sized for one
   session. `todo`s are personal; they are not planning.
3. Order and dependencies: `create_task_link {from, to, rel:"blocks"}`
   for hard ordering, `relates` for context; `rank_task` for the working
   order inside a state.
4. Labels: the initial set on create, increments with `label_task {id,
   add:[…]}`; `eve-*` only when you WANT Eve to act.
5. Schedule: `update_task {sprintId | milestoneId}` on the children (an
   epic itself is rarely in a sprint).
6. Materials: the brainstorm log, the decision log and the plan go on the
   EPIC as attachments (`upload_task_file {kind: brainstorm|decision|plan,
   hint}`), never only on a board.
7. Read it back: `get_task {id:<epic>, include:[children, links, refs]}`
   — the children with their state, the link graph and the attachment
   index in one bounded call — and hand the epic's `shortUrl` back.

**Reading attachments progressively**: the index (`include:[refs]`) is
free — kind, hint, tokens, version, derivedFrom. Load bytes only when the
hint says the work needs them and `tokens` fits the budget:
`read_task_ref {id, ref, budget}` returns raw content under the budget;
over it, or with a `question` ("what did we decide about retries?"), Eve
distills that ONE version — the reply is `{distilled: true, content,
citations: [{ref, version, at, quote}]}` and nothing is stored (file it
yourself with `upload_task_file {kind: "distill"}` when it should stay).
Without an AI backend the door returns the head and `truncated: true` (a
question answers 501 carrying that head) — say so rather than guessing
the rest.

## Working a task

1. `get_task {id, include:[refs, comments, events, links]}` for the row
   plus each bounded page you actually need (the bare row by default);
   `list_comments` pages the conversation further, `GET /tasks/{id}/events`
   the history. Materials you produce while working it (a decision log, a
   handoff, a report) go on the task, not on a board first: `vitrinka task
   upload` or `upload_task_file` with the right `kind` and a `hint`.
2. Move it with `update_task {state}` (or `status`), assign, date, estimate.
   `bulk_update_tasks {ids, patch}` moves up to 200 in one transaction —
   all or nothing.
3. Talk on it with `create_comment`; `@name` reaches that person's My work.
4. Relate it: `create_task_link {rel: blocks|relates|duplicates|supersedes|custom}`;
   `delete_task_link` by link id. `supersedes` is the revision rel (a
   story that revises an earlier story — "The feature lifecycle").
5. Bind your run to it: `vitrinka task start <id>` (or `POST /tasks/{id}/runs
   {sessionId}`) the moment you pick a task up, and `vitrinka task stop <run>
   --summary …` when you put it down. A live run is how the team SEES you
   on the plan: the brief's NOW row and the task card say `claude-code · 41m`,
   the people rail lists you beside the humans with what you hold, and the
   Thread tab reaches your session. A run left open is ended by the server's
   sweep after 12 h of silence.

## The feature lifecycle

One epic is the feature's whole record — brainstorm, decisions, PRs, QA
plan, sessions, commits, final artifact, revisions — and every recipe
below hangs its output on it. The brainstorming skill files the epic
(brainstorm board as a `board` ref, decision log as a `decision` ref);
`/prm` attaches the PR and, at merge, runs **QA plan**; the publisher and
`usertest` link boards and sessions to the journeys (`vitrinka task
resolve-qa`); the final artifact and revisions close the loop.

### QA plan (at `/prm` merge — the implementer drafts, Eve refines, a human accepts)

1. Find the epic: the branch's `vt-<id>` → `get_task` → climb `parentId`
   to the `epic`. An epic with an OPEN `qa` child already has a plan
   (`vitrinka task resolve-qa --task <epic>` exits 0): add journeys to it
   (below), never a second qa task.
2. Draft from three sources you already hold: the decision log
   (`docs/specs/*-decisions.md`), the merged diff, the e2e specs the PR
   added or changed. ONE `qa` draft + one `journey` draft per user-visible
   path — a journey is what a tester walks (3–12 steps), keyed like the
   sessions registry (`.vitrinka/journeys.json` ids, kebab-case intent),
   with `role` from the qa task's `roles`, the `route` it starts on, the
   `steps` checklist, the `expected` outcome and the `test` spec path when
   one exists:
   ```json
   propose_tasks {
     "project": "fixit",
     "source": { "kind": "qa-plan", "ref": "FixIt-Technologies/vitrinka#612" },
     "drafts": [
       { "key": "plan", "type": "qa", "title": "QA plan — Feature lifecycle", "parentId": 392,
         "fields": { "scope": "commit hook, publisher auto-link, QA plan step", "roles": ["admin", "member"] } },
       { "key": "commit-trailer", "parentKey": "plan", "type": "journey",
         "title": "A commit on a vt- branch carries the trailer",
         "fields": { "key": "commit-trailer", "role": "member", "route": "/p/fixit?task=401",
                     "steps": [ { "name": "commit on feat/vt-401-x" }, { "name": "open the task's Delivery row" } ],
                     "expected": "the commit appears as a commit ref within a minute", "test": "e2e/commit-hook.spec.ts" } }
     ]
   }
   → { "drafts": [ { "id": 430, "key": "plan", … }, { "id": 431, "key": "commit-trailer", … } ] }
   ```
   (ONE call: every draft may carry a `key`; a journey names its qa draft
   with `parentKey` — an earlier draft of the same batch — while the qa
   draft's `parentId` is the epic. `parentId` is always a task id, live or
   a still-pending intake row; never a position. Declining the qa draft
   declines its pending journeys; accepting a journey accepts a pending
   qa draft first. `steps` are checklist items — `name` only, `done` stays
   false.) The pipeline dedupes, Eve's `pm-qa-plan` flow refines
   steps/expected and may ADD journeys when a backend is configured
   (fail-open — the drafts are usable as filed), and a human accepts from
   the intake queue. A `qa-plan` batch answers only after Eve's pass, so
   the call may block up to 60 s. Never accept your own QA plan.
3. Hand back the qa task's `shortUrl` and stop there: the qa board is
   composed AFTER the human accepted the plan.

### Journeys (working the plan)

- **The board**: `qa_board {id: <qa task>}` (`POST /tasks/{id}/qa-board`)
  creates or returns the qa task's ONE board in the `testing` subgroup —
  a "Plan" section holding the living journey diagram
  (`payload.source {kind: "journeys", task}`; lanes = roles, nodes =
  journeys with verdict tone, edges = order + `blocks`) and one section
  per journey named after its title. It answers `{board: {slug, url},
  diagramCardId}`; usertest and session boards attach beneath as refs,
  never replace it. From a terminal: `vitrinka task qa-board <id>` (the
  board URL on stdout, `--json` for the reply).
- **Verdicts** live on the journey: `update_task {id, fields: {verdict:
  pass|fail|partial}}`; the qa task's `coverage` checklist and `verdict`
  roll up from its journeys on read — never write them.
- **Evidence**: a recorded session → `add_task_ref {id: <journey>, kind:
  "session", ref: <session board slug>}`; a board section →
  `add_task_ref {kind: "board", ref: <slug>, meta: {section: "<title>",
  journey: <journeyId>}}` (the publisher does both when it can resolve
  the journey by registry `key`, else exact title).
- **A failing journey files its bug**: `propose_tasks {source: {kind:
  "journey", task: <journeyId>}, drafts: [{type: "bug", …}]}` (or
  `create_task` when the user is sure), then `create_task_link {from:
  <bug>, to: <journey>, rel: "blocks"}` — the diagram paints that edge and
  the verdict stays `fail` until the bug closes.
- **Editing a journey** IS editing the task: `update_task {title, fields:
  {steps, expected, route}}`; the diagram node's inline edit is the
  human's twin (`PATCH /cards/{id}/journey-node {journey, title?,
  steps?}`) and writes the same row. After a batch of edits,
  `refresh_card {id: <diagramCardId>}` redraws the diagram from the
  tasks; positions a human dragged survive.
- **Adding a journey later** (a PR extends the feature): a further
  `journey` draft under the existing qa task through the same
  `propose_tasks {source: {kind: "qa-plan", ref}}` door — never a second
  qa task for the same feature.

### Revisions (months later)

A revision is a `story` under the SAME epic, `create_task_link {from:
<new story>, to: <old story>, rel: "supersedes"}`, with its own `qa`
child (the QA plan recipe, `parentId` the story) — the feature's history
stays in one record. `ask_task {id: <epic>, question}` reads the epic's
descendants by default (`scope: "tree"`, bounded, newest first); pass
`scope: "task"` for the row alone.

### Final (the feature record)

`compose_final {epic}` (`POST /tasks/{epic}/final`) composes the
`feature` board — Outcome · Decisions (log + brainstorm board portals) ·
Architecture (diagrams refreshed) · Journeys (diagram + verdicts) ·
Delivery (PRs, commits, releases) · Revisions — and the readable `page`,
deterministically from the epic's refs; Eve's `pm-final` narration is
added when a backend is configured (fail-open). The page lands on the
epic as a versioned `final` ref: re-running bumps the version, never
replaces. Run it when the epic closes and again after each revision;
hand back the board URL the door returns. From a terminal: `vitrinka
task final <epic>` (prints the board URL and the final ref version).

## Finding work

- `summarize_tasks {project, groupBy, f}` computes exact counts on the server,
  grouped by canonical `state` key (default), `type`, or `priority`. Use it for
  counts and status reports instead of listing every task and counting in the
  model. It uses the same filter document as `list_tasks`, excludes pending
  intake unless requested, and refuses more than 100 groups instead of silently
  truncating. Read actual task rows only for the details the report needs.
- `search_tasks {q}` — FTS5 over titles and bodies, relevance-ranked, with
  snippets. `list_tasks` narrows by status/assignee/sprint/parent and takes
  the **filter document** (`f`: states, groups, types, priorities,
  assignees, labels, sprint, milestone, parent, intake, due/start spans,
  text, order, group/subgroup) — the same document saved views store
  (`list_views`).
- `my_work` — the caller's assigned · created · mentioned · overdue, across
  projects, 50 each.
- `get_brief {project}` — **read this before planning anything in a
  project.** The project home as one bounded document: `now` (overdue ·
  the caller's in-motion work · blocked, each with a `why` line and its
  live `runs`), `next` (what to pick up), `blocked` (with blockers),
  `since` (what changed since the caller last looked — counts + events),
  `people` (humans AND agents with what each holds), the sprint ledger,
  Eve's cached `narration` and the pending plan `proposals`. It replaces
  listing a project and reasoning over the rows.
- `list_proposals {project}` / `proposal_verdict {id, verdict}` — Eve's
  plan proposals (`split` · `reorder` · `estimate` · `close` · `merge`) wait
  as intake drafts with source `eve:plan`; accept applies the change through
  the engine, decline closes it. Give a verdict only when the user asked you
  to triage; never accept your own proposals.

## Asking Eve

- `ask_task {id, question, intent?}` — the one question door over a
  task's WHOLE corpus: row, fields, comments, events, every attachment
  version, linked boards and the PR through the connector. The answer
  carries citations `[{ref, version, at, quote}]`; relay the citation, not
  just the prose, when the user asks "why". `intent` is optional free text
  (default `developer`; suggested `developer · product · qa · reviewer ·
  onboarding`) — it shapes the answer and lands in the ledger beside your
  actor. Inert without an AI backend (the door says so; do not loop).
- **Trigger labels** are rules, not a second automation engine — put them
  on through `label_task {add: ["eve-distill"]}`: `eve-distill` runs once
  per label add and writes a `distill` ref (`distill.md` lineage, derived
  from the latest transcript/PR version, hint and tokens stamped) plus ONE
  eve comment with the run link — a re-add is the next VERSION, never a
  replacement; `eve-summarize` keeps a live summary (`summary.md` lineage,
  `meta.mode = summary`) while the label is on: every task event re-fires
  it, coalesced per task in a 5-minute quiet window, capped at 20 runs per
  project per UTC day — one "✦ Eve summarize paused: daily budget reached"
  comment when the cap hits; remove the label when the task settles. While
  a flow runs the task carries a live run by actor `eve` ("Eve is working
  on …"). The `eve-*` namespace is reserved: a user rule that adds or
  removes one is refused (400). Eve reads and writes refs and comments
  ONLY — never code, never a state change, never a PR comment.
- `vitrinka session continue <task>` prints the latest distill as a
  `/continue`-shaped brief — the thing to read before picking up someone
  else's session (the `sessions` skill has the archive side).

## Sprints

`create_sprint`, then `POST /projects/{p}/sprints/{id}/start`;
`…/complete {carry: next|backlog, next?}` closes it and carries unfinished
tasks. Sprints are history: no delete, ever.

## Automation

Rules are typed documents — `{trigger, conditions, actions}`, vocabulary at
`GET /api/v1/rules/schema`. Author one from a request in natural language,
then ALWAYS `dry_run_rule` and show what would have fired over the last
events before enabling it (`PATCH /rules/{id} {enabled: true}`). Four
built-ins ship enabled and need no AI backend: `stale-nudge`,
`auto-archive-completed`, `due-tomorrow-reminder`, `merged-pr-completes`.
Rule actions run as `rule:<name>` and never re-trigger rules. Creating or
enabling a rule is admin-only (a member token gets 403); dry-run is open to
members inside the rule's own project.

## Mirror

A project may mirror into Jira (`GET|PUT /projects/{p}/mirror {connector,
truth: local|remote, config.stateMap}`, `POST …/mirror/sync`). The truth
side wins every conflict; the ledger records what was overwritten as a
`mirrored` event. Do not "fix" a conflict by editing the losing side — say
which side is truth and let the next sync settle it. Binding the mirror and
running a sync are admin-only.

## Moving a project between workspaces

`transfer_project {project, to, dryRun, archiveSource, merge}` / `vitrinka
project transfer <project> --to <workspace> [--dry-run] [--archive-source]
[--merge]` copies everything the project owns (sets, boards, sessions,
reports, releases, the PM engine, blobs) into a workspace the caller also
OWNS — `to` is the destination, never the caller's tenant. Dry-run first and
show the report; the copy is idempotent (re-runs report `skipped`), a
colliding board slug or set key is a 409 naming it, and nothing is deleted:
`archiveSource` only stamps the source boards archived. When the destination
ALREADY has a project of that slug, `merge` reconciles instead of refusing:
vocabulary (states, labels, fields, sprints, milestones, views, rules) maps
onto the destination's rows of the same key (`merged` per table), content is
appended with fresh ids, and a colliding board slug or set is renamed on the
way in (`<slug>-from-<workspace>`; the report's `renamed` lists each) — show
the dry-run renames before running it. Doctrine: `docs` topic
`project-transfer`.

## CLI

```text
vitrinka task list [--state a,b] [--group started] [--order rank] [--text …]
vitrinka task get|create|update|comment|rank|search|delete|mine
vitrinka task label <id> --add a,b --remove c · task link <from> <to> --rel blocks
vitrinka task start <id> [--session id] [--summary …] · task stop <run> [--summary …]
vitrinka task resolve-qa [--task <id>] [--json]   # the qa task a publish belongs to (exit 4 = none: publish unlinked, say so)
vitrinka task qa-board <id> · task final <epic>   # the qa task's board · the epic's final artifact (board URL on stdout)
vitrinka project commits [--subject on|off]      # commit convention: trailer always, subject prefix per project
vitrinka workspace commit-prefix [bracket|bare|colon]   # the prefix style, workspace-wide (admin+)
vitrinka task upload <id> <files…>          # any bytes → file ref (new version on the same name)
vitrinka session archive <transcript.jsonl> --task <id> [--hint …]   # redacted, portable paths
vitrinka session continue <id>              # latest distill as a /continue brief (+ native resume offer)
vitrinka brief [--project p]              # now · next · blocked · since · people · Eve suggests
vitrinka task field get <id> [key] · task field set <id> <key> <value|json>
vitrinka project fields list|add <key> <label> --kind …|update <key>|remove <key>
vitrinka project transfer <project> --to <workspace> [--dry-run] [--archive-source] [--merge]
vitrinka sprint list|create|start|complete --carry next|backlog
vitrinka intake list|accept|decline|merge --into <id>|propose
```

## Never

- Never file a task and a draft for the same finding — one door per item.
- Never accept your own intake drafts unless the user asked you to triage.
- Never enable a rule without a dry-run in the transcript.
- Never bypass `status`/`state` validation by inventing keys; `list_states`
  first. Same for custom fields: `list_fields` before writing `fields`, and
  never tick a gate `done` without its `evidence`.
- Never load a transcript blind: read the index, then `read_task_ref` under
  a budget or with a `question`. Never put an `eve-*` label on a task for
  bookkeeping — it fires a flow and spends credit.
- Never overwrite an attachment: upload the new version and let the
  lineage carry the history; never delete a version to "clean up".
