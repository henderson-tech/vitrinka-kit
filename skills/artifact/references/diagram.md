# Surface: diagram — one diagram, laid out by the server

A diagram card is a whole system page in ONE card. You send **semantics** —
nodes, groups, lanes, ports, edges — and the server computes every rectangle
and route. **Never send coordinates or `payload.geo`.** Human edits (moves,
relabels, added notes) live in `payload.overrides` keyed by stable id and
**survive every re-layout**.

Two ways in:

- **(a) Repo truth** — a checked-in docker-compose / OpenAPI spec / SQL DDL,
  or a live Postgres. Import it so the card is **↻-refreshable** with a stored
  `source` + `rev` (git SHA).
- **(b) A described system** — no artifact exists. Author the semantic v2
  payload directly via `compose_board`.

## Path (a) — import repo truth (refreshable)

The card stores `payload.source = {kind, ref, rev, blob}`; a later ↻ (or
`/refresh`) re-parses it → new semantics by stable ids → relayout →
overrides survive.

1. **Detect** the source:
   - `docker-compose.yml` / `compose.yaml` → `kind: compose` (service nodes
     with image/replicas/port maps, `depends_on` edges, `networks` groups)
   - `openapi.{json,yaml}` / swagger spec → `kind: openapi` (endpoint nodes
     grouped by tag)
   - `schema.sql` / `*.ddl` / a migrations dir's CREATE TABLE dump → `kind:
     sqlddl` (entity nodes + FK crow's-foot edges; Postgres/SQLite dialects)
   - a live Postgres → `kind: pgschema` via `vitrinka board diagram schema push`
2. **Import via the CLI** (kind auto-detected from name/content):
   ```bash
   vitrinka board diagram import docker-compose.yml --board <slug> --kind auto --title "Services"
   ```
   Raw: `POST /api/v1/boards/{slug}/import` `{kind, source, ref, rev?,
   title?, x?, y?}` (`Authorization: Bearer` fed via stdin — never inline the
   token; `printf 'Authorization: Bearer %s' "$TOKEN" | curl -H @- …`).
   `x`/`y` omitted = free placement. Parse failure is a loud 400 naming the
   offending line/element — never a partial import.
3. **Stamp the revision**: `rev` = the git SHA (`git rev-parse --short
   HEAD`), `ref` = the filename/url.
4. **Live Postgres**: `vitrinka board diagram schema push --db postgres://…
   --board <slug>` — introspects LOCALLY via `psql`; the connection string
   never leaves the machine, only the parsed schema JSON is posted.
5. **Refresh** after the source changes: `POST /api/v1/cards/{id}/refresh
   {source:<new contents>, rev:<new SHA>}` (or `{}` to re-parse the stored
   blob). Ids derive from source names (table, `method+path`, service) so
   overrides re-apply; a dropped table loses its node, a new one appears,
   pins stay put.

## Path (b) — author the semantic v2 payload

`compose_board {cards:[{kind:"diagram", payload:{…}}]}` — anchored by
relation, never coordinates.

**Top level**: `kicker?`, `title`, `dir:"TD"|"LR"` (default TD), `legend?:
[{style,label}]`, and the graph — `lanes?`, `groups?`, `nodes`, `edges`.

**Nodes are typed** (`type`, default `box`), each id-stable (the server
stamps `n1`, `n2`… onto id-less ones):

| type | fields |
|---|---|
| `box` / `note` | `title`, `body?`, `chips?`, `icon?`, `shape?`, `tone?` |
| `entity` (DB table) | `columns:[{name, type?, pk?, fk?:"table.col", unique?, nullable?}]` — each column is a port; an `fk` implies a crow's-foot column-to-column edge when you don't declare one |
| `endpoint` (API route) | `method`, `path`, `codes?:[int]`, `tag?` |
| `service` (deployment) | `image?`, `replicas?`, `mappings?:[{host, cont, proto?}]` (renders a port strip `443→8080`) |

`chips` are OBJECTS — `[{text, tone?}]` — never bare strings and never
`{label}` (either silently drops the chip).

`icon?` works on EVERY node type: any classic Lucide icon name
(`"database"`, `"server"`, `"lock"`) renders a real glyph before the title;
a short emoji string still works as a text prefix.

**Ports** — `ports:[{id, label?, side?:"top|right|bottom|left", order?}]`.
Edges reference `"nodeId.portId"`; undeclared sides auto-face the
counterpart.

**Edges**: `{from, to, style?, label?, card?}`. `from`/`to` are node ids or
`"node.port"`. `style` ∈ `public|mesh|internal|outbound` (edges have NO
`accent` — that is a node/group `tone` value only; the server 400s it);
`card` is cardinality (`"1..n"`, `"1..1"`) → crow's-foot.

**Grouping** — `lanes` are swimlane bands (one row each, top-to-bottom);
`groups` are bordered clusters (`tone?`, nestable ≤3 by putting `groups`
inside `groups`). **Containment IS membership — the only membership**: a
lane holds its `nodes`/`groups` inline, a group holds its `nodes`/`groups`
inline; ids exist only so `edges` can reference nodes. Top-level
`nodes`/`groups` are for laneless diagrams — a laned diagram keeps everything
inside its lanes. Every lane and nested group must have members (an empty
container is a 400). `children`/`parent` is rejected.

**The server repairs mechanical slips** and reports each fix in the
response's `payload.repairs`: `label`/`name`→`title` on nodes and groups,
`title`→`label` on lanes, edge `source`/`target`→`from`/`to`, an edge
endpoint written as a node's title (resolved when exactly one node matches),
a lone object where an array belongs, an entity column written as one string
(`"id uuid pk"` parses to `{name, type, pk}`). Emit the contract; don't rely
on repairs. Ambiguity still 400s with the exact fix.

**Tones/styles carry meaning**: `public` (edge from the internet), `mesh`
(private network / VPN link), `internal` (in-cluster), `outbound`
(third-party), `accent` (highlight a domain group).

Full JSON examples (service architecture with lanes/groups, an ER pair where
`fk:"users.id"` alone draws the crow's-foot, mermaid passthrough — a payload
carrying `"mermaid":"<source>"` and no `lanes` converts server-side, loud
error naming any unsupported line): `docs {topic:"element:diagram"}` /
`vitrinka docs diagram`.

## Verify, then iterate — the quality loop

Every diagram write comes back **scored**. Beside `payload.repairs`:

- `metrics` — crossings, corridors, labelHits, labelOverflows, borderRuns,
  bends, minSegment, aspect, titlePx. Labels ellipsize at the 240px pill cap
  (~31 chars); `label-overflow` findings mean pinned geometry — take the
  verified drop-pin / shorten-label fix.
- `diagnostics` — causal findings, docspec envelope + `{code, evidence,
  fixes[], suppresses[]}`. Every entry in `fixes` is **verified**: the server
  re-ran the layout with that edit and quotes the measured delta (`set
  dir:"LR" — verified: aspect 3.40 → 1.80`). A `suppresses` list marks the
  finding as a root cause — fixing it clears those codes too.
- `render` — the card's PNG export URL. Fetch it and **look**. Content-
  addressed and cached: a re-fetch with `If-None-Match` (the response `ETag`)
  answers `304`.

The loop (same as `standalone.md`): after every write, read the diagnostics
AND fetch the render; apply at most **one** diagnosed fix per round (root
causes first — the `suppresses` holder); re-check; stop after **≤2
correction rounds** or when the finding count stops improving; report
leftovers truthfully — never call a diagram clean over open error findings.

`quality:"showcase"` in the payload opts **this write** into the strict
tier: error-severity composition findings become a rejecting 400 carrying
the same diagnostics. Use it for docs-board and deliverable diagrams. It is
consumed per write — never stored — so re-send it on each write you want
gated.

`metrics`/`diagnostics` persist in the stored payload: findings on a card
you didn't just write are its last write's score, not something to "clean
up" by hand.

## Updating a diagram

- **Re-compose** the semantics with `update_cards` (whole-payload replace) —
  the engine re-lays-out and human `overrides` re-apply by id. Keep ids
  stable across updates.
- **Imported cards refresh** via `/refresh`, not `update_cards` — the source
  is the truth.
  pin: internal/web/import_api_test.go#TestRefreshKeepsOverridesAndReparses
- **Never author `payload.geo` or coordinates.** `render =
  serverLayout(payload) ⊕ overrides`. A box in a specific place is a human
  override, not your job.

## Don't rationalize

- "I'll nudge this node's x so it lines up" → no. If the engine is wrong,
  the semantics (lane/group/edge) are wrong. Fix those.
- "I'll snapshot the compose file into a hand-authored diagram" → import it,
  so ↻ keeps it live. Hand-authoring is for systems with no checked-in
  artifact.
- "Point-to-point edges are simpler than ports" → ports are what make ER
  columns, service port strips and clean routing work. Use them.
