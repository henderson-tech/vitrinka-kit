---
name: tasks
description: "Work a project's task engine from the repo — file and triage intake drafts, plan an epic, comment, label, rank, link, bulk-move, search, attach and read versioned files, ask Eve about a task, sprint start/complete, and author automation rules (dry-run first). Invoke as /vitrinka:tasks [list|intake|file|epic|rule] FROM THE APP'S REPO; the same verbs exist as MCP tools and `vitrinka task|sprint|intake`."
metadata:
  vitrinka-contract: "2026-09-14"
---

# /vitrinka:tasks — the task engine, agent side

The verbs are the CLI (`vitrinka task|sprint|intake|project --help`) and
the MCP generic verbs (`list · get · create · update · delete · search
{kind}`; `docs {topic: "kind:task"}` is the per-kind contract). This skill
carries only the laws the verbs do not print.

## Vocabulary laws

- **State groups** `backlog · unstarted · started · completed · cancelled`
  are universal; a project's states (`list_states`) are keys inside them and
  `status` derives from the group. `list_states` before writing `state`;
  `list_fields` before writing `fields`.
- **Types** `task · bug · story · epic · todo · qa · journey · meeting` are
  ONE generated enum. An `epic` is the feature's whole record (children by
  `parentId`, the feature preset `outcome · non_goals · gates · decisions ·
  ledger_state · waiting_on · next_action`); a `qa` task is its test plan
  (`scope · roles · verdict · coverage`), a `journey` one user path inside it
  (`key · role · route · flow · steps · expected · verdict · test` — author
  `flow`, never `steps`); a `meeting` is promoted from the diary; a `todo` is
  the `me` skill's shape. Engineering work is a `task`.
- **Gates** (`gates`, `decisions` checklists) are ticked `done` WITH
  `evidence`, never bare; `kind` says who resolves one — `human` (waits on
  `who`, else the assignee, else the reporter), `action`, `date` (auto-ticked
  at `at`).
- **Labels**: `create_task.labels` sets, `update_task.labels` REPLACES,
  `label_task {add, remove}` increments (use it when another agent may be
  labelling). `eve-*` is a reserved namespace: those labels fire Eve flows
  and spend credit — never for bookkeeping.
- **Refs** are the evidence: `session · shot · board · file · pr · run ·
  commit`, the typed documents `transcript · conversation · brainstorm ·
  plan · handoff · decision · distill`, and `final`. `commit` and `pr` refs
  are attached by the GitHub App (`Vitrinka-Task:` trailer, `vt-<id>`
  branches; `meta.merged` completes the task) — never by hand. A `file`
  ref is a URL, never a path: `vitrinka task upload <id> <files…>` streams
  disk, `upload_task_file` takes inline text.
- **Attachments are versioned, never replaced**: the same filename is the
  next version, `versionOf` names the lineage, a `distill` carries
  `derivedFrom`. Write a `hint` on everything you attach; `meta.tokens`
  tells the next reader the price. Never delete a version to clean up.
- **Every task's `url` is its ONE link** — print it as returned, never
  compose, shorten or guess a route. Bodies reference by grammar, not URL:
  `<PREFIX>-<id>` / `vt-<id>` / `#<id>` for tasks, `owner/repo#123` for
  PRs, a repo path (`internal/web/foo.go:64`), an attachment's filename.
- **Unknown arguments are a 400** naming the key and the accepted set —
  read the error, fix the call, never retry the same shape.

## The doors

- **Intake is the ONLY way a draft becomes a task**: `propose_tasks`
  (deduped, `list_intake` shows the verdict) → a human's `intake_verdict`.
  Never file a task and a draft for the same finding; never accept your own
  drafts unless the user asked you to triage. Eve's plan proposals
  (`list_proposals` / `proposal_verdict`) follow the same rule.
- **Pickup · spot · hand back** keep the tree true without end-of-session
  bookkeeping: `get_task {view: "pickup"}` before touching code (pickup
  skill), `spot` the moment you will not do something (spot skill),
  `hand_back` to end (handoff skill — its `rendered` block IS the chat
  hand-back). Status moves by itself (run → in progress, PR → in review,
  merge → done); `update_task {status}` only to correct.
- **Reading**: `summarize_tasks` for counts; `list_tasks {f}` with the
  filter document (states, groups, types, priorities, assignees, labels,
  sprint, milestone, parent, intake, spans, text, order) for rows;
  `search_tasks` / `search` / `search_project` to find; `get_brief` before
  planning anything in a project; `read_task_ref` under a `budget` or with
  a `question` — never a transcript blind; `ask_task` for a cited answer
  over the whole corpus (relay the citation).
- **The feature lifecycle** hangs on the epic: the brainstorming skill files
  it (board + decision refs); `/prm` attaches the PR and at merge drafts the
  QA plan (a `qa` child with one `journey` per user path — `vitrinka task
  qa-board` for its board, `vitrinka task resolve-qa` to find it from a
  publish); `usertest` and `publish_run` write journey verdicts; `vitrinka
  task final <epic>` composes the final artifact; a later `story` that
  revises another links `supersedes`.
- **Sprints** are history: `create_sprint` → start → `complete {carry}`; no
  delete, ever.
- **Rules** are typed documents (`GET /api/v1/rules/schema`): ALWAYS
  `dry_run_rule` and show what would have fired before enabling; admin-only
  to create or enable.
- **Mirror** (Jira): the truth side wins every conflict; never "fix" a
  conflict by editing the losing side.
- **Transfer** (`transfer_project`): dry-run first, show the report and the
  `merge` renames; doctrine `docs` topic `project-transfer`.
- **Moving tasks between projects**: never recreate a task elsewhere (it
  loses history, comments, attachments). `update_task {id, project}` moves
  one, `bulk_update_tasks {ids, patch: {project}}` up to 200 in one
  transaction; the target must exist (unknown slug → 422); a task moves WITH
  its subtree; state, labels, fields, sprint and milestone remap by key
  (missing keys are created in the target, the source vocabulary untouched);
  `project` applies first, so a `state` or `fields` in the same patch
  resolves against the target.
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
- **Comments**: `create_comment` talks on a task; `@name` reaches that
  person's My work, `@eve` asks Eve and her answer lands as a reply under
  your comment; `parentId` replies inside a comment's thread (any depth);
  `list_comments {root}` reads one thread whole.
