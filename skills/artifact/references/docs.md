# Surface: docs board — the documentation board orchestrator

Make a board the living documentation for an app: diagrams imported from real
sources (↻-refreshable), prose pages backed by repo markdown, and deep links
between a diagram node and its page both ways. This surface composes the
diagram and page surfaces — read `diagram.md` and
`pages.md` (this directory) for the payload vocabulary and the refresh/write-back
contracts; this one owns the end-to-end flow.

Run it **from the app's repo** (it needs repo access to find sources, stamp git
SHAs, and write pages back). NOT a CI job — refresh is manual (↻ / re-run), by
decision.

## Flow

1. **Find or create the docs board.** `list_boards {project}` first (a 409 on
   create means reuse — never suffix-mint a duplicate). Create fully-specified:
   ```
   create_board {slug:"<project>-docs", board_type:"docs", project,
     subgroup:"docs"}
   ```
   A docs board is born EMPTY — its sections (**Architecture / Database / API /
   Pages**) are created on demand the moment content targets them, so never
   pre-create empty frames; `docs` joins the sidebar canonical vocabulary.
   Hand-over
   uses the response's `url` field (carries `/w/<workspace>`) — never compose a
   `/boards/<slug>` path yourself.
2. **Scan the repo for truth sources**:
   - `docker-compose.yml` / `compose.yaml` → Architecture (`kind: compose`)
   - `openapi.{json,yaml}` / swagger spec → API (`kind: openapi`)
   - `schema.sql` / `*.ddl` / a migrations dir CREATE TABLE dump → Database
     (`kind: sqlddl`); or a live Postgres → `vitrinka schema push`
3. **Import each into its section.** One import per source — `--section` lands it
   inside the named frame — created on demand on docs boards, then grown to fit
   (+ neighbor displacement); `--rev` stamps the git SHA for refreshability.
   Section titles are exactly **Architecture / Database / API / Pages**
   (case-insensitive) — stick to that vocabulary so repeat runs reuse frames
   instead of minting variants.
   ```bash
   REV=$(git rev-parse --short HEAD)
   vitrinka import docker-compose.yml --board <project>-docs --section Architecture --rev "$REV"
   vitrinka import openapi.yaml        --board <project>-docs --section API          --rev "$REV"
   vitrinka import schema.sql          --board <project>-docs --section Database      --rev "$REV"
   ```
   The mapping: `compose`→Architecture, `sqlddl`/`pgschema`→Database,
   `openapi`→API. (Raw form — `POST /api/v1/boards/{slug}/import {kind, source,
   ref, rev, title, section}`, always send `Authorization: Bearer` via stdin,
   never inline the token; explicit `x`/`y` win over `section` so omit them.)
   Imports come back scored like any diagram write — run `diagram.md`'s
   quality loop (read `diagnostics`, eyeball `render`) on each one.
4. **Author pages** (via the page surface patterns): an **overview** page in the
   Pages section (what the system is, the domains, links into each diagram) plus
   **per-service / per-domain** pages as depth warrants. Repo-backed pages carry
   `payload.source {kind:"mdfile", ref, rev}` so they refresh with the repo.
5. **Wire deep links both ways**:
   - Page → node: markdown `[orders service](#E<elemNo>/orders)` in the overview.
   - Node → page: set the diagram node's `doc:<elemNo>` pointing at its page card
     (re-compose the imported diagram's overrides, or set it when hand-authoring).
   Grab each card's `elemNo` from the compose/import response or `scrape_board`.
6. **Hand over the board URL** — the server-authoritative `url` from the
   create/list response, in your final summary, always.

## Refresh on demand ("sync the docs board")

When the user asks to sync after code changed:

1. `list_sections {board}` / `scrape_board {board}` → the diagram + page cards
   and their ids.
2. For each imported diagram: re-read its source file, `POST
   /api/v1/cards/{id}/refresh {source:<new contents>, rev:<new SHA>}`. Ids derive
   from source names, so human overrides (pins, labels, notes) survive.
3. For each repo-backed page: refresh with the new file `md` + `rev`; if a human
   edited the board page, do the write-back loop first (board → repo file →
   commit → refresh) per `pages.md` (this directory).
4. Report what changed (added/dropped tables, new endpoints) and re-hand the URL.

## Token economy

| Instead of | Do |
|---|---|
| Scraping the whole board to find cards | `list_sections {board}` — sections, card ids, counts |
| A fresh diagram per sync | `/refresh` the imported card — overrides survive |
| Re-uploading page prose per edit | repo-backed page + `/refresh {source, rev}` |
| Pre-creating empty section frames | target `--section` — the frame is created when content lands |
| Guessing the board path | the server `url` field |

## Don't rationalize

- "I'll snapshot the compose file into a static diagram" → import it so ↻ keeps
  it live. A docs board that drifts is worse than none.
- "I'll create the board bare and organize later" → `board_type:"docs"` +
  `project` + `subgroup:"docs"` at birth, or the board is homeless.
- "CI should auto-sync this" → out of scope (decision #6). Refresh is manual.
- "I'll wire links one direction" → both. A node points at its page; the page
  names its node. That reciprocity is the point.
