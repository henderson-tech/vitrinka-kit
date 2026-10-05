# Contributing

Thanks for your interest in vitrinka-kit. Issues and pull requests are welcome;
note that the project is source-available under the
[Elastic License 2.0](LICENSE), not an open-source license.

## Development setup

Prerequisites: [Bun](https://bun.sh) ≥ 1.1 and Node ≥ 18.

```sh
bun install
bun run --filter '@vitrinka/expo' build   # bob build → packages/expo/build
bun run --filter '@vitrinka/expo' test
```

### Repository layout

- `packages/*` — npm packages under the `@vitrinka` scope. Each package owns
  its `README.md`, `CHANGELOG.md`, and tests.
- `apps/extension` — the Chrome extension (Manifest V3, no build step; `dist.sh`
  zips it for release). **Generated**: the product repo's `tools/export-kit`
  renders it from `vitrinka/apps/extension` and prunes anything else, so an
  edit made here is overwritten by the next export — open it against the
  product repo instead.

## Pull requests

- Keep changes scoped; one concern per PR.
- `bun run typecheck` and package tests must pass; CI runs both on every PR.
- Anything touching **what data a recorder captures or transmits** must update
  `docs/PROTOCOL.md` in the same PR — that document is a user-facing contract.

## Releases (maintainers)

npm packages release by tag: `<pkg>-vX.Y.Z` (`link`, `redact`, `web`, `expo`)
→ `release-<pkg>.yml` → `.github/actions/release-package` builds, tests and
publishes `@vitrinka/<pkg>` with provenance. The tag must sit on main and
match the package's version; a version already on npm is a no-op. Tag `link`
and `redact` first when `web` or `expo` depend on a new version of them.
Publishing authenticates through npm trusted publishing (one entry per
package naming its `release-<pkg>.yml`), with the `NPM_TOKEN` repo secret as
the fallback until every package carries an entry. A new package is one thin
`release-<pkg>.yml` plus its trusted-publisher entry. The extension releases
from the product repo (`release-extension.yaml`) on its manifest version.
