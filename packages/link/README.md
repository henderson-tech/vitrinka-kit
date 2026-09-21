# @vitrinka/link

The device link both vitrinka recorders authenticate with: the recorder asks
the server for a short code, the tester approves it in vitrinka (same device
via a link, or another device via the server-rendered QR), and the recorder
receives an ingest-only `vkr_` token. No baked secrets, no QR library.

```ts
import { startLink, pollLink, LinkExpired } from '@vitrinka/link';

const start = await startLink('https://app.vitrinka.ai/w/acme', { label: 'Safari on macOS · app.example.test' });
start.user_code;  // 'ABCD-EFGH' — show it
start.verifyUrl;  // open on the same device
start.qrUrl;      // <img src> for the desktop→phone path (SVG from the server)
const linked = await pollLink(start.base, start.device_code, { interval: start.interval });
linked.token;     // 'vkr_…' — store it, send it as the bearer
```

Doors (at the base URL's origin): `POST /api/v1/cli/auth {kind:"recorder",label}` →
201 `{device_code, user_code, verify_path, verify_url?, qr_path, interval,
expires_in}`; `POST /api/v1/cli/auth/claim {device_code}` → 202 pending ·
200 `{token, workspace, label, expires_at}` · 404 expired (`LinkExpired`).
A 401 from any session door means the token is dead: forget it and link again.
