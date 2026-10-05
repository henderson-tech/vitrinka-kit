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
[`docs/PROTOCOL.md`](../../docs/PROTOCOL.md). Idle, the pill can also send
the last minute as a bug report ([Report a bug](#report-a-bug)).

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

One origin serving several apps by path (`/portal/`, `/designer/`, …)
can file each app's sessions into its own project: pass `project` per app.
Without it, the host's project rule decides; a recorder key's project pin
always wins, and a different `project` is refused.

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
title is `document.title`, or the `title` prop); the label and a ⋯ slide out
on hover or focus. Recording, it rests as a dot + timer capsule (**Recorder
controls**) that unfolds into the tools on hover, focus or tap and folds back
2.5s after you leave (a tooltip names each tool and its shortcut):

| Control | Shortcut | What |
|---|---|---|
| sync chip | | `synced` · `sending N` · `offline · N` · `ended` — readable without hovering |
| ⏸ Pause / ▶ Resume | ⌥⇧P (Alt⇧P) | freezes the clock and capture |
| ✎ Note | ⌥⇧N | the note sheet — Enter sends, ⇧Enter newline, Esc / ✕ / click-outside cancel (the draft survives a cancel); the pill says **Saved** |
| ⌖ Annotate | ⌥⇧A | click or tap an element, or drag a region (a finger too). While annotating, the page gets no press, move or hover, does not scroll, and selects no text. Then describe it: `board` (an annotation on the board) or `task` (also filed as an intake draft) |
| ■ Stop | ⌥⇧S | the pill asks **Stop & save?** (Esc / **Keep recording** cancels), shows **Saving…** with progress while the tail drains, then **Saved · Open board** until you dismiss it |
| ⋯ | | the linked account · **Report a bug** (below) · **Open this board** · **Recent** (this device's last five recordings, each linked to its board) · **Go to vitrinka** · **Size** S/M/L · **Technical details** · **Position** · **Unlink this device** (asks first) |

Move it anywhere: drag the puck or capsule and it lands on one of eight
spots (a 3×3 grid without the centre). A flick lands where it is thrown.
Push it past a side edge and it tucks into a 6px tab (**Show recorder**
brings it back). At middle left and middle right the recording pill stands
up into a vertical bar. Arrow keys on the focused handle and **Position** do
the same without a drag; the spot is remembered per site. Tooltips, the
menu and sheets (≤ 288px at M) open toward the middle of the page from
wherever the HUD sits: sideways from a vertical one. They flip and shift so
they never leave the viewport. On a phone, sheets are a bottom sheet above
the keyboard and the link sheet drops the QR.

The sync chip is honest: `synced` means the server confirmed it holds
everything captured. A backlog reads `sending N`. An outage reads
`offline · N` (nothing is dropped; the tail is kept in `localStorage`). A
session the server closed reads `ended`. A one-line detail also unfolds for
an outage or an ended session. Stop drains first and refuses while the server
is unreachable: the pill says so and offers **Retry**.

**Size** and **Technical details** are user preferences. For a linked device
they are stored in vitrinka (`GET`/`PATCH /api/v1/recorder/me`), so they follow
the user, and are cached on the device for an instant first paint and for
offline use. A key build, or a server without the route, keeps them on the
device only. Technical details shows events captured, queue and pending
chunks, the last sync and its state, the server's seq, the session id and
the recorder version.

The sheet renders inside the topmost open dialog when one exists, so a
Radix focus trap or a `<dialog>.showModal()` never fights it, and nothing
you do on the pill reaches the page (a "close on outside click" never fires
because of the recorder).

## Report a bug

**Report a bug** (⋯ menu) files what led up to a bug — no recording needed.

**The last minute.** While the pill is mounted and idle on a device that can
record (a recorder key or a linked device), it keeps the page's last minute
**in memory**: the rrweb DOM stream as two 30-second checkout windows (a clip
covers the last 30–60 s and always opens on a full snapshot), plus the
click, navigation, console and network events since the older window
opened. Caps: 4 MiB of serialized rrweb, 20 000 rrweb events, 500 lane
events; over a cap the older window goes. It runs the recording's own
redaction (masked inputs, your workspace policy — fetched once when the
buffer starts — scrubbed URLs, click text that never reads a value). Nothing
of it is written to storage or sent until you press Send; a reload, an
unlink or a recording start discards it.

**The report.** The sheet freezes the last minute as it opens (when that
holds no full snapshot — a window over a cap was dropped — it takes one of
the current screen first), asks what
went wrong (required) and offers **Mark on screen** — annotate mode's
element pick or region drag. Send files one short session under the pill's
credential: title `Bug report: <first line>`, `meta.kind: "report"` and
`meta.devicePixelRatio`; the buffered events with their original
timestamps; the rrweb windows as chunks; your description as an annotation
with `task: true` (the marked region, else the whole viewport); then done.
vitrinka renders stills from the clip, pins the annotation on the board and
files it as an intake draft. The pill says **Sending…**, then **Sent · Open
board** (it is in Recents too); a failure offers **Retry**, which resumes
the same report. During a recording, Report adds that task annotation to
the running session instead.

**Turning it off.** A host that cannot accept even in-memory capture passes
`flightRecorder={false}`:

```tsx
<VitrinkaRecorderRoot url={…} flightRecorder={false}>
```

Then nothing is captured until a recording starts, and Report a bug is
offered only during one.

## Driving it from code

`window.__vitrinkaRecorder` — for agents and tests:

```ts
await __vitrinkaRecorder.start({ title: 'checkout', tags: ['ai'] });
__vitrinkaRecorder.note('price flashes on hover');
const { boardUrl } = await __vitrinkaRecorder.stop();
__vitrinkaRecorder.status(); // { recording, sessionId, elapsedMs, queued, synced, … }
```

## The HUD on its own (`@vitrinka/web/hud`)

The HUD is driven only through a `HudController`. The in-page recorder is one
implementation; another host (the browser extension) mounts the same HUD with
its own:

```ts
import { mountRecorderHud, type HudController } from '@vitrinka/web/hud';

const unmount = mountRecorderHud(controller, { title: () => document.title });
```

`HudController` is a snapshot plus actions:

- `getSnapshot()` returns the same object until something changes;
  `subscribe(fn)` calls back after a change. The snapshot holds `linked`,
  `canUnlink`, `annotating`, `recording` (session, clock, sync), `account`,
  `prefs`, `recents`, `workspaceUrl`, `version` and, optionally,
  `canReport`.
- Actions: `start`, `togglePause`, `stop` (resolves `{boardUrl?}`, rejects
  while the server is unreachable), `note`, `annotate`, `setAnnotating`,
  `link`, `unlink`, `getMe`, `setPrefs` and `refreshRecents`; optionally
  `holdReport` and `report` — without them the menu has no **Report a bug**.

The full contract is in `src/recorder/hud/controller.ts`.

Without a bundler, `@vitrinka/web/hud.iife.js` (`build/hud.iife.js`) is the
same mount as one self-contained script with React bundled in:

```html
<script src="hud.iife.js"></script>
<script>const unmount = VitrinkaHud.mount(controller);</script>
```

## What is captured, exactly

| Lane | Event `kind` | Payload |
|---|---|---|
| rrweb | `rrweb` | `{count}` + `blobKey` — the batch itself is uploaded as a chunk; inputs always masked, all text under a `maskAllText` policy; the page URL each full snapshot carries is scrubbed of query/fragment secrets; images recorded by URL, never inlined (inlining would alter the page's own `<img>`) |
| clicks | `click` | `{selector, text, rect, route}` — `text` is never a form field's value, and empty at, inside or around `.rr-mask` / `.rr-block` and under `maskAllText` |
| navigation | `nav` | `{url, route, spa}` — `url` scrubbed of query/fragment secrets, the start URL included |
| network | `net` | `{method, url, status, ms, reqHeaders, resHeaders, reqBody, resBody, via}` — redacted, capped at 64 KiB per body; the recorder's own uploads are never recorded |
| console | `console` | `{level: 'error', text}` |
| notes | `note` | `{text, route}`; annotations add `{rect, selector, annotate: true, task?}` |

Data goes to your vitrinka server only. Details, the redaction rules and the
policy fetch: [`docs/PROTOCOL.md`](../../docs/PROTOCOL.md).

The HUD itself never enters a recording. Every surface sits under one 0×0
shadow host carrying rrweb's block attribute. rrweb 2 always leaves a
placeholder for a blocked node; this one is empty, so the replay shows no
box. The HUD's clicks, its requests to your server and its `vitrinka:` logs
are not captured.

## Storage

The undelivered tail lives in `localStorage` (a recording survives a reload
of its tab). Where that is unavailable (private mode, a storage-disabled
profile) the recorder falls back to memory and says so once; plug your own
synchronous driver with `configureRecorderStorage()` before mounting.

The session record is shared by every tab of the app: a tab opened during
a recording joins it, and a Start, pause or Stop in one tab reaches the
others through the driver's optional `watch(key, onChange)` (the
`localStorage` driver implements it with the `storage` event).

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
