---
name: release
description: "Drive a project's vitrinka release from the repo — sweep merged PRs into the rolling next-release board, watch Eve, vitrinka's AI reviewer, write the page, or cut the release. Invoke as /vitrinka:release [refresh|cut|status] FROM THE APP'S REPO; first ever run needs a start point."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:release — sweep, watch, cut

A project's releases live on `releases` boards: a rolling **next-release** board accumulates everything merged
since the last cut, Eve's release-writer turns the PR window into the page
(hero + ✨/🐛/🔧 sections + stats + linked boards), and **cut** freezes the
board and opens the next window. The server does all of it — this skill just
drives the three verbs from the terminal and knows the project's identity.

Base URL: `VITRINKA_URL` (self-hosted deployments) or `https://app.vitrinka.ai`.
Vitrinka is an authenticated service: all calls are the raw API with the
workspace token (`vitrinka auth login` mints it; `VITRINKA_TOKEN` or the OS
keyring is always required — the same auth the publish skill uses).
Resolve the project the way the publish skill does: the repo's `.vitrinka/`
config or the directory name — ask only when genuinely ambiguous.

## status (default verb)

`GET {base}/api/v1/projects/{project}/release` → print the window compactly:
PR count, base→head short SHAs, last sweep time, board link (the `boardUrl`
field — server-authoritative, never hand-compose), plus cut history one line
each. No state (404/empty): say the project has no release track yet and offer
the first refresh.

## refresh

`POST {base}/api/v1/projects/{project}/release/refresh` body `{}`.

- **First ever run** (no release row yet): the server needs a window start —
  pass `{"baseSha": "<sha>"}` (a released commit, e.g. the last version-bump
  tag/commit) or `{"since": "<RFC3339>"}`. Suggest a sensible start from
  `git log` (the newest `release(...)`/version-bump commit) rather than asking
  cold.
- The response is the swept state (202): the sweep is stored and Eve is
  writing asynchronously. Do NOT poll in a loop — check once after ~a minute
  if the user wants confirmation, or just hand over the board URL; the page
  appears when Eve answers.
- A refresh REGENERATES Eve's cards in place (it deletes exactly its own
  previous cards, never human ones) — safe to re-run whenever the window grew.

Requires the project's repo to be GitHub-App-bound (the commit-pills
connection). A 4xx naming a missing repo/installation means that binding is
absent — point the user at the GitHub connect flow, don't improvise.

## cut

Confirm with the user before cutting — it freezes the page and starts a new
window; cutting twice is rejected, not idempotent.

`POST {base}/api/v1/projects/{project}/release/cut` body `{}` (or
`{"title": "...", "version": "..."}` to override the document's own naming).
Print both returned boards: the frozen release (share it with
`shareAllowed`/vkl_ if the user wants it readable without a sign-in) and the fresh
next-release board.

## After any verb

Hand back the board URL bare on its own line (label line above ending with
":"), exactly like every vitrinka skill.
