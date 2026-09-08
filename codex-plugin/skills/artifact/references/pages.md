# Surface: page — living document cards

A `page` card is a Confluence-grade document on the board: headings, lists,
tables, code, callouts, images, dividers, card embeds — block-edited in place by
humans, read-only through share links, and **read/written by agents as
markdown**. The board stores ProseMirror as the editor truth and a
server-maintained markdown mirror; you only ever touch the markdown.

## Compose / update

`payload.md` is the durable, agent-native truth (≤256 KiB) and the ONLY field
you send (envelope: `docs {topic:"element:page"}`). **Never send `payload.pm`
or `payload.pmStale`** — those are the client editor's concern; the server
maintains them and does NO markdown↔ProseMirror conversion. This file's
round-trip vocabulary below is editor behavior, not schema — it lives here.

```json
compose: {"cards":[{"kind":"page","payload":{"md":"# Architecture\n\nThe **eve** service orchestrates subagents.\n\n> [!INFO]\n> Postgres is the durable store.\n\n## Services\n\n| name | replicas |\n| --- | --- |\n| eve | 2 |\n"}}]}
```

- **Update** with `update_cards` carrying a new `md` (whole-payload replace),
  exactly like editing your own text card. Composing a new `md` marks the
  editor mirror stale (`pmStale`): a human opening the card re-parses your
  markdown, then their block edits round-trip back to markdown you read again.
- **Remove** a stale page with `update_cards {remove:[id]}`: pages you
  created go straight to the trash; anyone else's answer `409 needs_confirm`
  with a `preview` — read it, repeat the same ids with `confirm:<token>` and a
  `reason` (≥ 20 chars). Soft removal; the operator restores from
  HISTORY/Trash.
- **Confluence parity**: humans block-edit the same card. `pmStale` semantics
  mean **the agent's markdown always wins the read face until a human re-edits**
  — so re-composing `md` is safe; you won't stomp uncommitted human blocks
  silently (the server flags the stale mirror instead).
- Markdown that round-trips: GitHub admonition callouts (`> [!INFO]`, tones
  info/warn/danger), tables, task lists (`- [ ]`), fenced code, images (board
  upload URLs), dividers.
- **Inline marks that round-trip**: `==highlight==`, `<u>underline</u>`,
  `<sub>x</sub>`, `<sup>x</sup>` (bold/italic/`code`/strike are standard). These
  are the ONLY inline HTML tags parsed — everything else stays literal text.
- **Block vocabulary that round-trips** (`:::` directives — write them exactly;
  an unknown `:::name` degrades to plain text, never an error):
  - **Expand / collapse** — a collapsible section with a summary line:
    ```
    :::expand What the gateway does
    The gateway terminates TLS and routes by host.
    :::
    ```
  - **Layout / columns** — 2–3 columns; OUTER fence is 4 colons, inner `:::col`
    is 3; optional ratio (`1:1`, `1:2`, `2:1`, `1:1:1`):
    ```
    ::::layout 1:2
    :::col
    Narrow sidebar.
    :::
    :::col
    Wide main column.
    :::
    ::::
    ```
  - **Status lozenge** (inline) — `[!status <tone>](<label>)`, tones
    grey/red/yellow/green/blue/purple: `Ship state [!status green](shipped).`
  - **Date chip** (inline) — `[!date](YYYY-MM-DD)`: `Due [!date](2026-07-16).`
  - **Table of contents** — a live heading outline (never stored content):
    ```
    :::toc
    :::
    ```
  - **Tables** — a plain GFM pipe table stays plain; keep writing those. Extras
    (merges, cell tones, header column, numbered gutter, width) wrap the SAME
    GFM table in a `:::table {attrs}` fence. Cells are addressed A1-style (column
    letter + 1-based row, header = row 1). Attrs:
    - `header-col` — style the first column as a header.
    - `numbered` — a view-only auto-numbered gutter (adds NO column to the grid).
    - `width=wide` | `width=full` — table sizing (default is content width).
    - `merges="A1:B1,C2:C3"` — merged spans; the covered cells stay
      present-but-EMPTY in the GFM grid.
    - `tones="B2=green,C1=red"` — quiet cell tones
      (grey/red/yellow/green/blue/purple).
    - `colwidths="120,240,-"` — per-column pixel widths (`-` = auto); only
      emitted when a column was explicitly resized.
    ```
    :::table {header-col numbered width=full merges="A1:B1" tones="B2=green"}
    | Region | Q1 |
    | --- | --- |
    | EU | 12 |
    :::
    ```
    Malformed attrs degrade to a plain table — never a crash.
  - **Multi-block cells** — a cell may hold more than one line. Blocks join with
    a literal `<br>` inside the GFM cell; bullet/ordered lists serialize as
    `• item<br>• item` / `1. item<br>2. item`. On read, `<br>` inside a cell
    splits back into separate paragraphs (byte-stable for paragraphs; lists come
    back as bulleted paragraphs — semantic, not byte, stability). Content is
    NEVER dropped: a cell that can't fully round-trip (nested table, code)
    degrades to readable text rather than vanishing.
    pin: e2e/page-blocks.spec.ts#every block round-trips md → editor → md (expand/layout/col/status/date/toc)
- **Images** — a bare `![alt](url)` stays bare; extras attach in a `{…}` suffix:
  `![alt](url){width=320 align=wrap-right caption="A gate"}`. `align` is
  center (default) / wrap-left / wrap-right / wide; `width` is a pixel number;
  `caption` is a quoted string. Human drag-drop / paste / picker uploads go to
  the board's upload store; the URL is board-relative (`/uploads/…`).
- **Files** (non-image) — a plain markdown link `[name](url)`; the editor shows
  it as a quiet file chip, but the md is just the link.
- **Code** — fenced blocks with a language tag round-trip as-is:
  ` ```python … ``` `.
- **Mentions** — `@[handle]` renders a quiet mention token and (on save) files a
  wire notification for that member. An unknown handle still renders. Members
  come from `GET /api/v1/boards/{slug}/members`.

## Page comments are ordinary annotations

A page comment is a normal board annotation, just anchored to a TEXT RANGE
instead of an image region: its `selector.quote` (plus a little prefix/suffix)
says WHERE in the page it points. You already see them via `list_work` /
`scrape_board` and reply/resolve them like any annotation — the quote tells you
which sentence the human meant. Comment highlights are NOT written into `md`
(they live in the editor's pm/yjs layer); if you re-compose `md` and keep the
quoted sentence, the highlight re-anchors automatically, and if you remove the
sentence the comment stays wire-only (never an error).

## Repo-file-backed pages (the living contract)

A page can mirror a repo markdown file, the same refreshable-source contract
diagrams use — so `docs/architecture.md` and its board card stay in sync.

- **Mark it backed**: set `payload.source = {kind:"mdfile", ref:"docs/x.md",
  rev:"<git SHA>"}` on the page card. `ref` is the repo-relative path; `rev` is
  the SHA the current `md` was read at (`git rev-parse --short HEAD`).
- **Refresh after a repo edit** (repo → board): read the new file contents, then
  `POST /api/v1/cards/{id}/refresh {source:<new md>, rev:<new SHA>}` — the server
  replaces `payload.md` and bumps `source.rev`. (Always send the `Authorization:
  Bearer` header via stdin — never inline the token: `printf 'Authorization:
  Bearer %s' "$TOKEN" | curl -H @- …`.)
  pin: internal/web/docs_boards_test.go#TestPageRefresh_ReplacesMarkdown
- **Write-back** (board → repo) is THIS skill's job — the server only stores and
  refreshes; it has no repo access. When a human edited the board page and you
  need the repo file to match:
  1. Read the current page markdown — `scrape_board {board}` (page cards return
     their `md`) or the card API.
  2. Write it to the repo file (`docs/x.md`).
  3. Commit with a conventional message; capture the new SHA.
  4. Refresh the card with `{source:<that md>, rev:<new SHA>}` so `source.rev`
     matches the commit — closing the loop.

## Deep links (page ↔ diagram)

- **Page → node**: markdown links `#E<elemNo>` fly to a card by its board
  E-number; `#E<elemNo>/<nodeId>` flies and highlights a specific diagram node.
  Write them as normal markdown links: `[orders service](#E7/orders)`. The read
  face intercepts them.
  pin: e2e/page-card.spec.ts#a page #E<n>/<nodeId> link flies to the diagram and pulses the node
- **Page → heading** (same scheme): `#E<elemNo>/<heading-slug>` flies to a page
  card and scrolls to a heading. The slug is the heading text lowercased with
  non-alphanumerics collapsed to `-` (e.g. `## Deep Section` → `deep-section`):
  `[jump](#E12/deep-section)`.
- **Node → page** (the reverse) is the diagram side: a node's `doc:<elemNo>`
  (+ optional `docAnchor`) renders a quiet ¶ affordance that flies to the page.
  Set that when composing the diagram (`diagram.md`, this directory) so a box points
  at its runbook and the runbook names the box.

## Don't rationalize

- "I'll send the ProseMirror JSON, it's more precise" → never. `md` only; the
  server owns `pm`.
- "The human edited the card, I'll just overwrite with fresh md" → for a
  repo-backed page, do the write-back loop (board → repo → commit → refresh) so
  the repo file and `source.rev` stay truthful. Blind overwrite loses the human
  block edits that were never committed.
- "I'll link to the card by its board URL" → use `#E<elemNo>` /
  `#E<elemNo>/<nodeId>` so the link flies within the board and survives renames.
