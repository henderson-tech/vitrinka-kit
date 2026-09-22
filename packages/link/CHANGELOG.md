# @vitrinka/link

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
