---
name: release
description: "Use when driving a project's vitrinka release from the repo — '/vitrinka:release [refresh|cut|status]' from the app's repo, 'cut the release', 'refresh the release board', 'what is in the next release'."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka:release — sweep, watch, cut

A project's releases live on `releases` boards. The rolling **next release**
spans every repository in the release — on a new track, every GitHub
repository bound to the project (Settings → Projects → Repositories) — each
contributing the PRs merged into its **branch** since its own window start.
Eve writes the page from that window; **cut** freezes it and opens the next,
each repository starting where its part ended.

Drive it with `vitrinka project release` from a checkout bound to the project
(`vitrinka.config.json` names project and workspace); `--json` for the
envelope. An unknown command means an old CLI: `vitrinka update`.

## The page

- Hero (title, headline, story): Eve's prose.
- Stats strip (PRs merged, contributors, days in window) and merge timeline:
  computed by the server from the sweep, never by the model.
- ✨ New / 🐛 Fixed / 🔧 Improved: one entry per feature, grouping PRs across
  repositories; each entry links only PRs the server swept (each to its own
  repository), shows at most ONE screenshot, and links up to three boards.
- Made this sprint: portals to up to 24 boards the window touched (boards
  named `pr-<n>` first).
- Screenshot candidates are the project's newest shots inside the window, one
  per route, up to 24 — publish current screens (publish/usertest skills)
  BEFORE refreshing.

## status (default verb)

`vitrinka project release` — per repository: branch, start..head, PR count;
last sweep, board URL, cut history. No release yet: offer the first refresh.

## refresh

`vitrinka project release --refresh` re-sweeps every repository in the
release and asks Eve to rewrite her cards (never human ones). It returns once
the sweep is stored; Eve answers asynchronously — hand over the board URL, do
not poll.

- **First refresh** names each repository with its branch and start:
  `--repo <owner>/<name>:<branch>@<start>`, once per repository. Branch = the
  branch PRs merge INTO (omitted: the GitHub default branch). Start = a commit
  SHA or an RFC3339 instant.
- **Choosing the start.** Trunk flow: the commit the last shipped release was
  cut from. Integration branch: its first-parent fork point from the branch it
  was cut from — the line the release is compared against (ask the user when
  that line is unclear). In EACH repository:

  ```bash
  f=$(git rev-list --first-parent --reverse origin/<branch> ^origin/<from> | head -1) && git rev-parse "$f^1"
  ```

  Never `git merge-base`: once `<from>` is merged back into the branch, the
  merge-base jumps forward and every earlier PR silently drops out. After the
  first refresh, show the user each repository's start and PR count.
- Branches and starts are stored on the release: later refreshes, and the
  next release after a cut, need no flags.
- Until the first cut, `--repo …@<start>` again corrects a start; after a cut
  every start is the previous release's end and passing one is refused (409).
- A repository bound after the track started joins only when a refresh lists
  every repository with `--repo`; the refresh output names bound repositories
  not in the release.
- Failures name the repository: 422 `release_start_required` (no start), 422
  not bound (bind it under Settings → Projects), 404 GitHub App not connected,
  502 a repository the GitHub App cannot read.

pin: internal/web/releases_pipeline_test.go#TestReleaseMultiRepoSweepPersistsBranchAndStarts
pin: internal/web/releases_pipeline_test.go#TestReleaseRefreshRefusesBeforeCreatingState
pin: internal/web/releases_pipeline_test.go#TestReleaseFirstWindowStartCorrectable

## cut

Confirm with the user first — it freezes the page and opens the next window;
cutting twice is refused. `vitrinka project release --cut --yes [--title …]
[--version …]` prints the frozen board and the fresh one. Refused (409) until
a sweep has completed and while any repository's listing was truncated. Share
the frozen board without sign-in: `vitrinka board share <slug>`.

pin: internal/web/releases_pipeline_test.go#TestReleaseCutChainsEveryRepo

## Without the CLI

`GET {base}/api/v1/projects/{project}/release`, `POST …/release/refresh`
(body `{}` or `{"repos":[{"repo":"o/n","base":"<branch>","baseSha":"<sha>"}]}`),
`POST …/release/cut` (`{"title"?,"version"?}`). A token spanning several
workspaces also needs `X-Vitrinka-Workspace` (401 `workspace_required`
otherwise). Pipe the headers, never put the token in argv:
`printf 'Authorization: Bearer %s\nX-Vitrinka-Workspace: %s\n' "$(vitrinka auth token)" <workspace> | curl -sS -H @- …`.
No release yet: GET answers 200 `{"release":null,"history":[]}`. Refresh
answers 202, or 200 with `pushed:false` when Eve is not configured.

## After any verb

Hand back the board URL bare on its own line (label line above ending with
":"), exactly like every vitrinka skill. Before the hand-back on a bound task, run the `handoff` skill (`hand_back`) — the chat block is its `rendered` output.
