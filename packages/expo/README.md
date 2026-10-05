# @vitrinka/expo

The vitrinka toolkit for Expo apps. Today it ships one tool: the **journey
recorder** — record manual-testing sessions (screenshot keyframes, taps,
navigation, network calls, console errors, notes) from a real device straight
into a [vitrinka](https://vitrinka.ai) board.

What it captures and where it goes is documented in
[`docs/PROTOCOL.md`](../../docs/PROTOCOL.md); this package's source is public
precisely so you can verify it.

## Install

```sh
npx expo install @vitrinka/expo react-native-view-shot react-native-keyboard-controller react-native-safe-area-context expo-file-system expo-constants
```

All native dependencies are peers on purpose (your app's versions win). MMKV
and expo-router are **optional** — only needed if you import their subpaths.

## Wire it up

**1. Config plugin** (`app.json`) — the recorder's build guard. It refuses any
build where the ingest token could leak into a store bundle:

```jsonc
{
  "expo": {
    "plugins": [["@vitrinka/expo", { "allowedProfiles": ["development", "development-simulator"] }]]
  }
}
```

If you publish OTA updates from scripts, also set `updateLaneVar` to the env
var your update scripts export (e.g. `"updateLaneVar": "MYAPP_UPDATE_LANE"`) —
it is the reliable signal for refusing a token on a store-facing channel;
without it only best-effort argv scanning guards `eas update`. Prod-backed
test lanes use `laneMarkerVar`/`laneMarkerValues` (see `plugin/build-guard.js`).

**2. Metro strip** (`metro.config.js`) — one required line (config plugins
cannot modify metro config; the plugin verifies it is present):

```js
const { withRecorderStrip } = require('@vitrinka/expo/recorder/metro');
module.exports = withRecorderStrip(config);
```

**3. Mount** (your root layout):

```tsx
import { VitrinkaRecorderRoot, VitrinkaRecorderPill } from '@vitrinka/expo/recorder';
import { useExpoRouterRecorderRoute } from '@vitrinka/expo/recorder/expo-router';

export default function Layout() {
  const route = useExpoRouterRecorderRoute(); // or supply {pathname, lane} from your own nav
  return (
    <VitrinkaRecorderRoot route={route}>
      <Stack />
      <VitrinkaRecorderPill />
    </VitrinkaRecorderRoot>
  );
}
```

**4. Enable it** — only on builds that should record:

```sh
EXPO_PUBLIC_VITRINKA_URL=https://your-vitrinka.example   # the URL alone enables the recorder
```

Without it, the entire recorder is stripped from the bundle at compile time
— the gate folds to a no-op and the metro hook redirects the recorder's
modules to an empty stub.

**5. Link the device** — no secret is baked. The first time, a tester
taps the puck (**Link recorder**) and gets a short code, **Open vitrinka** (approve
on the same device) — or type the code in vitrinka on any other device. The
server mints an ingest-only `vkr_` token that the recorder stores
(`vitrinka.recorder.link`, through the storage driver) and uses from then on;
**Unlink** (long-press the puck, or the ⋯ menu) forgets it, and so does a 401 from the server. A URL
addressing `/w/<slug>` preselects that workspace on the approve page; a
token approved into another workspace is discarded and the sheet says which
one to pick.

Unattended builds (CI, machine-driven runs) can still bake a token:

```sh
EXPO_PUBLIC_VITRINKA_TOKEN=<vkr_ recorder key>   # admin-minted, ingest-only — never a workspace token
```

## The production-strip guarantee

Three layers, all shipped here:

1. **Gate** — the exported components check `EXPO_PUBLIC_VITRINKA_*` as inlined
   literals; without them the recorder code is provably unreachable.
2. **Metro stub** — `withRecorderStrip` redirects the recorder's entry modules
   to an empty stub on unconfigured builds, so Metro never bundles the subtree.
3. **Build guard** — the config plugin throws on any build/OTA-publish where a
   baked token is present outside your allowlisted profiles (the URL alone is
   never gated — it is not a secret) (see
   `plugin/build-guard.js` for the full semantics: forbidden OTA channels are
   checked first and have no escape hatch).

We recommend asserting the strip in your own repo against your real export
pipeline (bundle without recorder env; grep the output for `vitrinka`).

## Storage

The recorder's durable queue uses a synchronous storage driver. Default:
expo-file-system (zero extra installs). To use MMKV instead:

```ts
import { configureRecorderStorage } from '@vitrinka/expo/recorder/storage';
import { mmkvRecorderStorage } from '@vitrinka/expo/recorder/storage-mmkv';
configureRecorderStorage(mmkvRecorderStorage());
```

## License

[Elastic License 2.0](../../LICENSE).
