# @vitrinka/web

The vitrinka toolkit for React DOM apps — today, the **journey recorder**:
record a manual-testing session straight from the app under test into a
vitrinka board. The web sibling of [`@vitrinka/expo`](../expo) and of the
browser extension: same wire protocol, same redaction engine, no extension
to install.

What a session carries: the **rrweb DOM stream** (the keyframe — no
screenshots), **clicks** (selector, text, rect), **navigation**, **network**
(fetch + XHR, headers + bodies redacted), **console errors**, and the
**notes and annotations** you type in the pill. Everything is redacted by
[`@vitrinka/redact`](../redact) before it is buffered; the full contract is
[`docs/PROTOCOL.md`](../../docs/PROTOCOL.md).

## Install

```bash
bun add @vitrinka/web rrweb
# or: npm i @vitrinka/web rrweb
```

Peer deps: `react` ≥ 18, `react-dom` ≥ 18, `rrweb` ^2.

## Mount (Next.js app router)

```tsx
// app/layout.tsx
import { VitrinkaRecorderRoot, VitrinkaRecorderPill } from '@vitrinka/web/recorder';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <VitrinkaRecorderRoot
          url={process.env.NEXT_PUBLIC_VITRINKA_URL}
          recorderKey={process.env.NEXT_PUBLIC_VITRINKA_KEY}
          appVersion={process.env.NEXT_PUBLIC_APP_VERSION}
        >
          {children}
          <VitrinkaRecorderPill />
        </VitrinkaRecorderRoot>
      </body>
    </html>
  );
}
```

`VitrinkaRecorderRoot` installs the capture lanes; `VitrinkaRecorderPill`
renders the HUD into its own shadow host on `<html>` (top layer, never inside
your DOM). **When `url` is empty the root renders its children and starts
nothing** — a build without the URL carries an inert recorder.

**No key is needed.** Dev/preview builds set only `NEXT_PUBLIC_VITRINKA_URL`;
testers **link their device from the pill**: the pill shows **Link
recorder**, the sheet shows a short code, **Open vitrinka** (approve on this
device) and a QR (scan from your phone); once approved the server mints an
ingest-only `vkr_` token, stored in `localStorage` under
`vitrinka.recorder.link`, and recording starts. A `url` addressing
`/w/<slug>` preselects that workspace on the approve page; a token approved
into another workspace is discarded and the sheet says which one to pick.
**Unlink** in the ⋯ menu forgets it — so does a 401 from the server. `recorderKey` (an admin-minted
`vkr_` key) is for CI, e2e and unattended builds only; when passed it wins
over the link. The prop is `recorderKey`, not `key`: React reserves `key`
and never delivers it to a component.

Navigation is observed through `history.pushState` / `replaceState` /
`popstate`, which covers Next, React Router and friends. A router that
navigates without History can feed its pathname instead:

```tsx
import { usePathname } from 'next/navigation';
import { useRecorderRoute } from '@vitrinka/web/recorder';

function RouteFeed() {
  useRecorderRoute(usePathname());
  return null;
}
```

Vite and plain React work the same way — pass `url` / `recorderKey` from
`import.meta.env` (the `NEXT_PUBLIC_*` fallback only applies where a
bundler inlines `process.env`).

### Env vars

| Var | What |
|---|---|
| `NEXT_PUBLIC_VITRINKA_URL` | Your vitrinka server, e.g. `https://app.vitrinka.ai` |
| `NEXT_PUBLIC_VITRINKA_KEY` | Optional — CI / unattended only. A **`vkr_` recorder key** minted in vitrinka under Settings → project → Recorder keys: project-pinned, origin-allowlisted, valid only on the session routes — never a `vkp_`/`vks_` API key. Testers link instead. |
| `VITRINKA_RECORDER_LANE` | The build's lane for the guard below (`development`, `preview`, …) |

### The build guard

A production build must never ship the recorder by accident. Wrap your Next
config:

```js
// next.config.js
const { withVitrinkaRecorder } = require('@vitrinka/web/next');
module.exports = withVitrinkaRecorder({ /* your config */ });
```

`next build` (`NODE_ENV=production`) then **refuses** when a baked
`NEXT_PUBLIC_VITRINKA_KEY` is set and `VITRINKA_RECORDER_LANE` is not one of
the allowed lanes — the URL alone is allowed everywhere (dev/preview builds
set only the URL; testers link from the pill; a key is for CI) (default `development`, `preview`; override with
`allowedLanes`, and the var names with `laneVar` / `keyVar`). Unset the key
for the production lane, or set the lane on the preview one. The config is
returned unchanged otherwise.

## Using the pill

Idle, the HUD is a 28px glass puck: a hollow ring until the device is linked
(**Link recorder**), a muted dot once it is (**Start recording** — the session
title is `document.title`, or the `title` prop); the label slides out on hover
or focus. Recording, it rests as a dot + timer capsule (**Recorder controls**)
that unfolds into the tools on hover, focus or tap and folds back 2.5s after
you leave (keycaps show on hover):

| Control | Shortcut | What |
|---|---|---|
| ⏸ Pause / ▶ Resume | ⌥⇧P (Alt⇧P) | freezes the clock and capture |
| ✎ Note | ⌥⇧N | the note sheet — Enter sends, ⇧Enter newline, Esc / ✕ / click-outside cancel (the draft survives a cancel) |
| ⌖ Annotate | ⌥⇧A | click an element or drag a region, then describe it; `board` (an annotation on the board) or `task` (also filed as an intake draft) |
| ⋯ | | **Open board** (the server-minted link) · **Stop recording** · **Unlink** · **Move to** |

Move it anywhere: drag the puck or capsule and it lands on one of six spots
(corners, top and bottom centre) — a flick lands where it is thrown; push it
past a side edge and it tucks into a 6px tab (**Show recorder** brings it
back). Arrow keys on the focused handle and **Move to** do the same without a
drag; the spot is remembered per site. Sheets (≤ 288px) open toward the
middle of the page from wherever it sits; on a phone they are a bottom sheet
above the keyboard and the link sheet drops the QR.

The sync glyph is honest: ✓ means the server confirmed it holds everything
captured; a second line unfolds only for a backlog, an outage (`offline ·
N held · retrying` — nothing is dropped, the tail is kept in `localStorage`)
or a session the server closed. Stop drains first and refuses while the
server is unreachable — stop again once online.

The sheet renders inside the topmost open dialog when one exists, so a
Radix focus trap or a `<dialog>.showModal()` never fights it, and nothing
you do on the pill reaches the page (a "close on outside click" never fires
because of the recorder).

## Driving it from code

`window.__vitrinkaRecorder` — for agents and tests:

```ts
await __vitrinkaRecorder.start({ title: 'checkout', tags: ['ai'] });
__vitrinkaRecorder.note('price flashes on hover');
const { boardUrl } = await __vitrinkaRecorder.stop();
__vitrinkaRecorder.status(); // { recording, sessionId, elapsedMs, queued, synced, … }
```

## What is captured, exactly

| Lane | Event `kind` | Payload |
|---|---|---|
| rrweb | `rrweb` | `{count}` + `blobKey` — the batch itself is uploaded as a chunk; inputs always masked, all text under a `maskAllText` policy; images recorded by URL, never inlined (inlining would alter the page's own `<img>`) |
| clicks | `click` | `{selector, text, rect, route}` |
| navigation | `nav` | `{url, route, spa}` |
| network | `net` | `{method, url, status, ms, reqHeaders, resHeaders, reqBody, resBody, via}` — redacted, capped at 64 KiB per body; the recorder's own uploads are never recorded |
| console | `console` | `{level: 'error', text}` |
| notes | `note` | `{text, route}`; annotations add `{rect, selector, annotate: true, task?}` |

Data goes to your vitrinka server only. Details, the redaction rules and the
policy fetch: [`docs/PROTOCOL.md`](../../docs/PROTOCOL.md).

## Storage

The undelivered tail lives in `localStorage` (a recording survives a reload
of its tab). Where that is unavailable (private mode, a storage-disabled
profile) the recorder falls back to memory and says so once; plug your own
synchronous driver with `configureRecorderStorage()` before mounting.

## Development

```bash
bun run --filter '@vitrinka/redact' build   # the workspace dep resolves through build/
bun run --filter '@vitrinka/web' typecheck
bun run --filter '@vitrinka/web' test       # bun test src
bun run test:e2e:web                        # one headless Chromium spec (packages/web/e2e)
```

A release is a tag: bump `version` here (and `RECORDER_VERSION` in
`src/recorder/session.ts`), merge, then `git tag web-vX.Y.Z && git push
origin web-vX.Y.Z`.
