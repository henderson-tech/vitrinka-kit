# The vitrinka runtime shelf — built-in libraries for no-build artifacts

The server vendors a pinned, immutable library set at `/vendor/…` so an
artifact (full `html` document or a scaffolded report) uses real libraries
WITHOUT bundling, CDNs, or token-expensive hand-rolled code. Everything is
CORS-enabled and CSP-compatible (artifact iframes are opaque-origin — /vendor/*
responds with Access-Control-Allow-Origin: *; no cookies or same-origin capabilities). **Verify against the deployed server, not cached
pin: internal/web/vendor_test.go#TestVendorRoute
docs: `GET /api/v1/runtime`** returns `{cli, libs: {name: version}, cardKinds}`
for exactly this deploy.

## Import map names (defined by every artifact scaffold)

| Name | What |
|---|---|
| `react`, `react-dom/client`, `htm` | React 19 singletons + htm tagged templates |
| `zipstore-1` | client-side zip builder (download-all) |

## Direct-import bundles (relative-path internals, no map entry needed)

| Import | What |
|---|---|
| `/vendor/recharts.mjs` | **Recharts 2** — the React chart library you already know: `LineChart, BarChart, AreaChart, PieChart, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, …`. Write it exactly like upstream Recharts. |
| `/vendor/tanstack-table.mjs` | **TanStack Table 8** (headless) — `useReactTable, getCoreRowModel, getSortedRowModel, flexRender, …`; style rows with Tailwind utilities. |
| `/vendor/motion.mjs` | **motion/react 12** — `motion, AnimatePresence, useAnimate, …` for animated prototypes. |
| `/vendor/hljs.mjs` (+ `<link rel="stylesheet" href="/vendor/hljs.css">`) | highlight.js common build (~40 grammars), theme-aware light/dark: `hljs.highlightElement(el)` / `hljs.highlight(code, {language})`. |
| `/vendor/katex.mjs` (+ `<link rel="stylesheet" href="/vendor/katex.css">`) | KaTeX with fonts inlined: `katex.render("c = \\sqrt{a^2+b^2}", el)`. |
| `/vendor/apiref-1.mjs` | OpenAPI reference renderer: `ApiRefBody({spec})` React component + `parseSpec(spec)`; the same renderer the board's `api` card uses. |
| `/vendor/xyflow-react.mjs` (+ its css) | React Flow 12 for node/edge canvases. |
| `/vendor/uplot.mjs` | uPlot canvas engine (huge series; viz cards use it). |

## Choosing the right tool

- **Chart on a BOARD** → `chart` card (`line/area/bars/pie/donut/scatter/heatmap/…`,
  ~100-300 tokens, server-faced; see `docs chart`). **Chart INSIDE an artifact** → Recharts.
- **UI mockup** → the `mockup` card, or a tw4 artifact with raw utilities;
  **UI with real controls** (forms, tabs, dialogs, tables) → hand-rolled on
  Tailwind utilities (kit-1/kit-2 were retired in the element unification).
- **API documentation** → the `api` CARD (send the whole OpenAPI JSON as
  `payload.spec` — see card-kinds.md); reach for `apiref-1.mjs` directly only
  inside a larger artifact page.
- tw4 (`body` + `runtime:"tw4"`) artifacts are static markup — no `<script>`
  runs. Anything needing the libraries above ships as a full `html` document
  with the scaffold import map (`vitrinka artifact-init` writes it).

Immutability contract: `/vendor` files are pinned + immutable-cached except the mutable engines on the
server's no-cache list (`board-1`, `kit-3`, the editors — they improve every
published artifact retroactively per deploy); other first-party modules version
by filename (`apiref-1`, `tanstack-table`) — behavior changes ship as new files,
published artifacts keep importing what they were born with.
pin: internal/web/vendor_test.go#TestVendorRoute
