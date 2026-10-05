# @vitrinka/link

## 0.1.3

- **`pollLink` survives transient failures.** A claim whose fetch rejects
  with a network `TypeError`, or that answers 5xx, 408 or 429, no longer
  rejects the poll: the next claim waits a doubling backoff (capped at
  30s, at least a readable `Retry-After`), and a 202 restores the normal
  cadence. The poll still ends on 404/410 (`LinkExpired`), a workspace
  mismatch, any other 4xx (`LinkError`) and abort. New `expiresIn` option
  (pass `LinkStart.expires_in`; default 600s): once failures outlast it,
  the poll rejects with `LinkExpired`. New `now` test seam beside `sleep`.

## 0.1.2

- **`@vitrinka/link/dock`.** The recorder HUD's snap math, shared by the
  web and Expo recorders: `settle` (six spots, velocity-projected flick,
  side-edge tuck), `spotRect`, `neighbour` (arrow keys), `untuck`,
  `parsePlace` (validated stored position).

## 0.1.1

- **Workspace hint.** `linkWorkspace(base)` reads the `<slug>` of a
  `/w/<slug>` base; `startLink(base, { workspace })` appends
  `workspace=<slug>` to `verifyUrl` and `qrUrl` so the approve page
  preselects it (the start body stays `{kind, label}`), and
  `pollLink(base, code, { workspace })` rejects a claim pinned to any other
  workspace with `LinkWorkspaceMismatch` — its token is never returned. It
  fails closed: a claim that names no workspace is refused too. A base
  without `/w/<slug>` behaves as before.
- `Linked` matches the claim the server sends: `expires_in` (seconds), not
  the never-sent `expires_at`.

## 0.1.0

- Initial release: `startLink`, `pollLink`, `linkOrigin`, `isUnauthorized`,
  `LinkExpired` — the device-link flow shared by `@vitrinka/web` and
  `@vitrinka/expo`.
