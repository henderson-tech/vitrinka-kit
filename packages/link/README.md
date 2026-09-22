# @vitrinka/link

The device link both vitrinka recorders authenticate with: the recorder asks
the server for a short code, the tester approves it in vitrinka (same device
via a link, or another device via the server-rendered QR), and the recorder
receives an ingest-only `vkr_` token. No baked secrets, no QR library.

```ts
import { startLink, pollLink, linkWorkspace, LinkExpired, LinkWorkspaceMismatch } from '@vitrinka/link';

const base = 'https://app.vitrinka.ai/w/acme';
const workspace = linkWorkspace(base); // 'acme' — undefined for a bare origin
const start = await startLink(base, { label: 'Safari on macOS · app.example.test', workspace });
start.user_code;  // 'ABCD-EFGH' — show it
start.verifyUrl;  // open on the same device (…&workspace=acme preselects it)
start.qrUrl;      // <img src> for the desktop→phone path (SVG from the server)
const linked = await pollLink(start.base, start.device_code, { interval: start.interval, workspace });
linked.token;     // 'vkr_…' — store it, send it as the bearer
```

Doors (at the base URL's origin): `POST /api/v1/cli/auth {kind:"recorder",label}` →
201 `{device_code, user_code, verify_path, verify_url?, qr_path, interval,
expires_in}`; `POST /api/v1/cli/auth/claim {device_code}` → 202 pending ·
200 `{token, kind, workspace, label, expires_in}` · 404 expired (`LinkExpired`).
A 401 from any session door means the token is dead: forget it and link again.

A token only authenticates in the workspace it was approved into, so a
`/w/<slug>` base passes that slug as `workspace`: it rides the approve and QR
URLs as a `workspace=<slug>` preselect (never the start body), and a claim
approved into another workspace rejects with `LinkWorkspaceMismatch`
(`linked`, `expected`, a ready-to-show message) — the token is discarded.
