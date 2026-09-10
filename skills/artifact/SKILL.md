---
name: artifact
description: Author content on vitrinka — a standalone interactive document (report, analysis, dashboard), a Confluence-grade page card, an architecture diagram, or a whole living-docs board. Use for "artifact", "vitrinka this", "publish this analysis/report", "make this a page/diagram", "document this repo". Capturing UI work is publish.
metadata:
  vitrinka-contract: "2026-08-30"
---

# artifact — one skill, four authored surfaces

Everything *authored* lands here; everything *captured* (screenshots,
journeys, sessions) is the **publish** skill. Pick the surface, read its
reference, share the core below.

**The element model:** board and artifact are one thing. Every
authored unit is an **element** (`{kind, payload}` — chart, table, prose,
diagram, mockup, doc, …), the SAME shape as a board card's content; a
standalone artifact is the solo view of one element (`/a/<card>`), and a
semantic push mints/updates a `doc` card on the project's artifacts board —
the push response carries both URLs (field names:
`../publish/references/wire-fields.md`). The vocabulary is **canonical-only**:
the strict element door rejects legacy shapes and retired kind names; look
every shape up, never recall it.
pin: e2e/render-audit.spec.ts#the solo view mounts the board's own faces for every card kind
pin: e2e/render-audit.spec.ts#a fully canonical document mints its doc card and the solo view paints every block, nested diagram included

| Surface | Deliverable | Reference |
|---|---|---|
| **standalone** | self-contained interactive page — report, analysis, review, dashboard, showcase | `references/standalone.md` |
| **page** | Confluence-grade living document card on a board, markdown-native, repo-file-backable | `references/pages.md` |
| **diagram** | ONE architecture diagram card — server-laid-out, refreshable from repo truth | `references/diagram.md` |
| **docs board** | a repo's living documentation board — diagrams + pages + deep links, orchestrated | `references/docs.md` |

Routing when the ask is ambiguous:

- A composed *document to share* (report, analysis, comparison) → **standalone**.
- Prose that lives *on a board* beside other cards, or that mirrors a repo
  markdown file → **page**.
- "Diagram this / how does X fit together", one system picture → **diagram**.
- "Document this repo / living docs / keep the docs in sync" → **docs board**
  (it composes the diagram + page references; read those for payload
  vocabulary, it owns the end-to-end flow).
- UI work in progress, flows, "screenshot as I go" → not here; **publish**.

Sharing a finished artifact with outside people: `share_board` with
`cardId` (the id in the element's `/a/<id>` URL) or `vitrinka board share
<board> --card <id>` mints a link that OPENS on that element as a document
on the public share origin; the human twin is the ⇗ share action in the
solo view's head. The link still grants the whole board the element sits on
(the recipient can switch to the canvas), so an artifact meant for outside
eyes lives on a board with nothing private beside it. Hand the URL over bare
on its own line.

## Shared core (all surfaces)

- **Doors.** MCP for board discovery, composition, edits and arrange; the
  `vitrinka` CLI for set imports and artifact pushes; direct HTTP only for an
  operation neither exposes. One workspace/project/board per task — check
  it on every receipt. A receipt or `render.png` proves placement, not
  readable fit: read the board back and name what you did not check. A
  renderer failure keeps its semantic source and is reported as a defect,
  never replaced by a raster/base64 figure or a hand-grown rectangle.
- **Edit existing elements by reference.** `read_element {id}` returns a
  paginated outline with content revision and payload-relative JSON Pointer
  paths. Retrieve only the needed values with `{id,paths:[...]}`; previews
  are not full source. For an AI-layer canonical element, `edit_element
  {id,revision,edits:[{op:"replace",path:"/elements/2/payload/md",value:"…"}]}`
  retains all other content and runs the normal validator/layout. `add`
  inserts an array item (`-` appends), `remove` omits value. Edits are ordered;
  indexes are safe only for the revision read. A 409 means re-read affected
  content and reconcile, never blindly retry. The receipt carries the next
  revision. Outline pagination must stay on one revision or restart.

- Vitrinka is **an authenticated service** (default base `https://app.vitrinka.ai`;
  self-hosted deployments set `VITRINKA_URL`). `vitrinka auth login` mints
  your token; `VITRINKA_TOKEN` or the OS keyring is always required — never
  echo it; feed Bearer headers via stdin
  (`printf 'Authorization: Bearer %s' "$TOKEN" | curl -H @- …`), never argv.
- **The deploy documents itself.** Element payload contracts, component
  props, doc.json block shapes, chart forms and the runtime shelf are served
  by the deployment's own layered docs tree — the `docs` MCP tool
  (`artifact_docs` is its alias) or `vitrinka docs <topic>` (no topic → the
  index — `docs {family:"element"}` narrows it to one layer; three
  families: element / board / artifact, `family:topic` disambiguates
  collisions) — generated from the validator and kit the
  deploy actually runs, so it never drifts. Look up, don't recall; the
  references here carry workflow and laws, never prop tables.
- **Report the spend behind every composition**: pass `usage: {tokens,
  effort}` on `create_board`, `compose_board` and `update_cards` — your own
  rough estimate of what the call cost you that the server cannot see
  (thinking + reading the source material; `effort` low | medium | high).
  A schema-validated self-report; estimates are not verified or billed. It lands in the
  workspace's agent calls ledger, which the `query` tool / `vitrinka query`
  reads back as SQL.
- **A board that belongs to a task** (a task, epic or subtask is in context):
  stamp it once with `add_task_ref {id, kind:"board", ref:"<slug>"}` (no
  `cardId`) so the board's breadcrumb — and every `/a/<id>` element on it —
  reads `PRO-12 · title ↗` back to the task; `GET /boards/{slug}/tasks` lists
  what a board belongs to.
- **Hand back only server-returned URLs**: a board's `url` field carries
  `/w/<workspace>` — never hand-compose `{base}/boards/<slug>`; a standalone
  artifact hands back the URL `vitrinka push` prints. The link goes in your
  final summary, always.
- **Delegation**: compose-heavy authoring (standalone doc.json/components, docs-board
  narrative) can run in the `vitrinka-publisher` agent, dispatched in the
  background — brief it with this skill's base directory and the surface's
  reference path; it returns the live URL. Capture never delegates (there is
  none here); on runtimes without the agent (Codex), work inline from the
  same references.
- **Apply publisher write-backs**: when the publisher returns `writebacks`,
  validate every `ref` as a safe repo-relative path in the active worktree,
  replace it with the complete supplied `md`, commit and push it with the
  current work, then refresh the matching repo-backed card from pushed
  content. If any item cannot be applied safely, report it and do not claim
  the artifact is complete. `writebacks: none` needs no repo action.
- Boards are live: after creating a board (docs board included), arm the
  listener yourself per the listen skill — a subagent can never arm the
  parent's monitor. A standalone artifact is a page, not a board — nothing to
  listen to.
