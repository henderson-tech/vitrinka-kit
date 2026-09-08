# Surface: diagram — one diagram, laid out by the server

A diagram card is a whole system page in ONE card. You send **semantics** —
nodes, groups, lanes, ports, edges — and a native Go engine (Sugiyama layered
layout + orthogonal routing + first-class ports) computes every rectangle and
every route. **Never send coordinates or `payload.geo`**; the server owns
geometry. Human edits (moves, relabels, added notes) live in `payload.overrides`
keyed by stable id and **survive every re-layout** — so you keep updating the
semantics freely and human work is never clobbered.

Two ways in. Pick by what you have:

- **(a) Repo truth** — a real docker-compose / OpenAPI spec / SQL DDL is checked
  in, or a live Postgres exists. Import it so the card is **↻-refreshable** with
  a stored `source` + `rev` (git SHA). This is what makes the board living
  documentation, not a snapshot.
- **(b) A described system** — no artifact exists; you know the architecture.
  Author the semantic v2 payload directly via `compose_board`.

## Path (a) — import repo truth (refreshable)

Detect and import the raw artifact. The card stores `payload.source = {kind,
ref, rev, blob}`; a later ↻ (or `/refresh`) re-parses it → new semantics by
stable ids → relayout → overrides survive.

1. **Detect** the source in the repo:
   - `docker-compose.yml` / `compose.yaml` → `kind: compose` (service nodes with
     image/replicas/port maps, `depends_on` edges, `networks` groups)
   - `openapi.{json,yaml}` / swagger spec → `kind: openapi` (endpoint nodes
     grouped by tag)
   - `schema.sql` / `*.ddl` / a migrations dir's CREATE TABLE dump → `kind:
     sqlddl` (entity nodes + FK crow's-foot edges; Postgres/SQLite dialects)
   - a live Postgres you can reach → `kind: pgschema` via `vitrinka schema push`
2. **Import via the CLI** (handles base-URL + token; kind auto-detected from
   name/content):
   ```bash
   vitrinka import docker-compose.yml --board <slug> --kind auto --title "Services"
   ```
   Or the raw endpoint — `POST /api/v1/boards/{slug}/import`
   `{kind, source, ref, rev?, title?, x?, y?}` (always needs an
   `Authorization: Bearer` header fed via stdin — never inline the token;
   `printf 'Authorization: Bearer %s' "$TOKEN" | curl -H @- …`). `x`/`y` omitted
   = free placement. Parse failure is a loud 400 naming the offending
   line/element — never a partial import.
3. **Stamp the revision** so refresh is auditable: pass `rev` = the git SHA
   (`git rev-parse --short HEAD`) and `ref` = the filename/url.
4. **Live Postgres**: `vitrinka schema push --db postgres://… --board <slug>` —
   introspects LOCALLY via `psql`; the connection string never leaves the
   machine, only the parsed schema JSON is posted (`kind: pgschema`).
5. **Refresh** after the source changes: `POST /api/v1/cards/{id}/refresh
   {source:<new contents>, rev:<new SHA>}` (or `{}` to re-parse the stored blob).
   Ids derive from source names (table, `method+path`, service) so overrides
   re-apply; a dropped table loses its node, a new one appears, pins stay put.

## Path (b) — author the semantic v2 payload

`compose_board {cards:[{kind:"diagram", payload:{…}}]}` — ONE card, batch-or-bust,
intent not coordinates. The full vocabulary:

**Top level**: `kicker?`, `title`, `dir:"TD"|"LR"` (default TD), `legend?:
[{style,label}]`, and the graph — `lanes?`, `groups?`, `nodes`, `edges`.

**Nodes are typed** (`type`, default `box`), each id-stable (server stamps `n1`,
`n2`… onto id-less ones):

| type | fields |
|---|---|
| `box` / `note` | `title`, `body?`, `chips?`, `icon?`, `shape?`, `tone?` |

`chips` are OBJECTS — `[{text, tone?}]` — never bare strings and never
`{label}` (either silently drops the chip).
| `entity` (DB table) | `columns:[{name, type?, pk?, fk?:"table.col", unique?, nullable?}]` — each column is a port; an `fk` implies a crow's-foot column-to-column edge when you don't declare one |
| `endpoint` (API route) | `method`, `path`, `codes?:[int]`, `tag?` |
| `service` (deployment) | `image?`, `replicas?`, `mappings?:[{host, cont, proto?}]` (renders a port strip `443→8080`) |

`icon?` works on EVERY node type: any classic Lucide icon name (e.g.
`"database"`, `"server"`, `"lock"`) renders a real glyph before the title; a
short emoji string still works as a text prefix.

**Ports** — first-class anchors: `ports:[{id, label?, side?:"top|right|bottom|left",
order?}]`. Edges reference `"nodeId.portId"`; undeclared sides auto-face the
counterpart.

**Edges**: `{from, to, style?, label?, card?}`. `from`/`to` are node ids or
`"node.port"`. `style` ∈ `public|mesh|internal|outbound` (drives marker +
line; edges have NO `accent` — that's a node/group `tone` value only, the
server 400s it); `card` is cardinality (`"1..n"`, `"1..1"`) → crow's-foot.

**Grouping** — `lanes` are swimlane bands (one row each, top-to-bottom);
`groups` are bordered clusters (`tone?`, nestable ≤3 by putting `groups` inside
`groups`). **Containment IS membership — the only membership**: a lane holds
its `nodes`/`groups` inline, a group holds its `nodes`/`groups` inline. Put a
thing inside its container and you're done; ids exist only so `edges` can
reference nodes. Top-level `nodes`/`groups` are for laneless diagrams — a laned
diagram keeps everything inside its lanes. Every lane and nested group must
have members (an empty container is a 400). There is no id-reference membership:
`children`/`parent` is rejected with a message pointing at this shape.

**The server repairs mechanical slips** — deterministically, and reports each
fix in the response's `payload.repairs`: `label`/`name`→`title` on nodes and
groups, `title`→`label` on lanes, edge `source`/`target`→`from`/`to`, an edge
endpoint written as a node's title (resolved when exactly one node matches), a
lone object where an array belongs, an entity column written as one string
(`"id uuid pk"` parses to `{name, type, pk}`). Don't rely on repairs — emit the contract —
but a slip won't cost you a retry loop. Ambiguity still 400s with the exact fix.

**Trust tones/styles** carry meaning — use them: `public` (edge from the
internet), `mesh` (private network / VPN link), `internal` (in-cluster), `outbound`
(third-party), `accent` (highlight a domain group).

### Worked examples

Full JSON examples (service architecture with lanes/groups, an ER pair where
`fk:"users.id"` alone draws the crow's-foot, mermaid passthrough — a payload
carrying `"mermaid":"<source>"` and no `lanes` converts server-side, loud
error naming any unsupported line) live in the docs tree: `docs
{topic:"element:diagram"}` / `vitrinka docs diagram`. Look them up there —
generated against the validator, never stale.

## Verify, then iterate — the quality loop

Every diagram write comes back **scored**. Beside `payload.repairs` the
response carries:

- `metrics` — the composition scores (crossings, corridors, labelHits,
  labelOverflows, borderRuns, bends, minSegment, aspect, titlePx). The engine
  widens LR rank gaps so every wire label the board paints fits between nodes
  (labels ellipsize at the 240px pill cap, ~31 chars); `label-overflow`
  findings mean pinned geometry — take the verified drop-pin / shorten-label
  fix.
- `diagnostics` — causal findings, docspec envelope + `{code, evidence,
  fixes[], suppresses[]}`. Every entry in `fixes` is **verified**: the server
  re-ran the layout with that edit and quotes the measured delta
  (`set dir:"LR" — verified: aspect 3.40 → 1.80`). A `suppresses` list marks
  the finding as a root cause — fixing it clears those codes too.
- `render` — the card's PNG export URL. Fetch it and **look** at the diagram.
  The render is content-addressed and cached server-side: an unchanged
  diagram is never rasterized twice, and a re-fetch with `If-None-Match`
  (the response `ETag`) answers `304` — so re-checking after a no-op write
  costs nothing.

The loop (the same "Verify, then iterate" discipline as `standalone.md`):
after every write, read the diagnostics AND fetch the render; apply at most
**one** diagnosed fix per round (root causes first — the `suppresses`
holder); re-check; stop after **≤2 correction rounds** or when the finding
count stops improving; report leftovers truthfully — never call a diagram
clean over open error findings.

`quality:"showcase"` in the payload opts **this write** into the strict tier:
error-severity composition findings become a rejecting 400 carrying the same
diagnostics. Use it for docs-board and deliverable diagrams. It is consumed
per write — never stored — so re-send it on each write you want gated.

`metrics`/`diagnostics` persist in the stored payload (board reads and
scrapes see them): findings on a card you didn't just write are its last
write's score, not something to "clean up" by hand.

## Updating a diagram

- **Re-compose** the semantics with `update_cards` (whole-payload replace) — the
  engine re-lays-out and human `overrides` re-apply by id. Keep ids stable across
  updates so pins/labels/notes survive.
- **Imported cards refresh** via `/refresh`, not `update_cards` — the source is
  the truth.
  pin: internal/web/import_api_test.go#TestRefreshKeepsOverridesAndReparses
- **Never author `payload.geo` or coordinates.** `render = serverLayout(payload)
  ⊕ overrides`. If you want a box somewhere specific, that's a human override,
  not your job.

## Don't rationalize

- "I'll nudge this node's x so it lines up" → no. The engine aligns ranks; if
  it's wrong, the semantics (lane/group/edge) are wrong. Fix those.
- "I'll snapshot the compose file into a hand-authored diagram" → import it, so
  ↻ keeps it live. Hand-authoring is for systems with no checked-in artifact.
- "Point-to-point edges are simpler than ports" → ports are what make ER columns,
  service port strips, and clean routing work. Use them.
