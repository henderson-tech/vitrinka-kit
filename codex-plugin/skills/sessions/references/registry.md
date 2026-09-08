# .vitrinka testing manifests — schemas

Two git-tracked JSON files in the repo's `.vitrinka/` home (pipeline decisions
D5/D7: the repo manifest is the source of truth; server session stamps are the
visibility layer). Both are owned by the fix / generate-test stages (this
directory); humans review them in PRs like any code.

Editing rules: read-modify-write the whole file, keep keys sorted where shown,
never delete another journey's entry, and commit manifests in the SAME commit
as the test files they describe.

**Gitignore gate (fail loud, never skip):** before the commit, run
`git check-ignore .vitrinka/sessions.json .vitrinka/journeys.json
.vitrinka/project.json` — WITHOUT `-v`: verbose mode also prints negation
matches (`!.vitrinka/sessions.json`) for correctly allowlisted files, so
"any -v output" misreads a healthy repo as broken. Plain `check-ignore`
prints only genuinely ignored paths (exit 0); silence + exit 1 is the
healthy state. Any printed path means the repo ignores `.vitrinka/`
wholesale and the D5/D7 truth rule is inverted (server stamps would exist
with no git source of truth). Do NOT silently fall back to server-only
stamps and do NOT `git add -f`. Fix the repo's `.gitignore` first, in the
same branch: ignore only the scratch contents and allowlist the manifests —

```gitignore
.vitrinka/*
!.vitrinka/sessions.json
!.vitrinka/journeys.json
!.vitrinka/project.json
```

— then commit the manifest. (Shots/artifacts/scratch under `.vitrinka/`
stay local; only the manifests + config are tracked.)

## `.vitrinka/journeys.json` — the journey registry

What journeys exist, which test files realize them, which reusable blocks they
compose, and where they came from. The consolidation verdict (extend | update |
new | skip) is computed against this file + a repo test scan.

```json
{
  "version": 1,
  "journeys": {
    "orders-create": {
      "title": "Create an order from the dashboard",
      "framework": "playwright",
      "tests": ["e2e/orders-create.spec.ts"],
      "blocks": ["e2e/blocks/login.ts", "e2e/blocks/nav.ts"],
      "routes": ["/orders", "/orders/new"],
      "status": "active",
      "sources": [
        { "session": 7, "board": "acme-session-7", "addedAt": "2026-07-25" }
      ],
      "issues": [],
      "task": 421,
      "updatedAt": "2026-07-25"
    }
  },
  "blocks": {
    "e2e/blocks/login.ts": {
      "intent": "authenticate as a test user",
      "framework": "playwright",
      "usedBy": ["orders-create"]
    }
  }
}
```

- **Journey id** = kebab-case user intent. NEVER session-derived
  (`session-7-flow` is forbidden — journeys outlive sessions).
- `framework`: `playwright` | `appium`. A cross-surface journey appears once
  per framework with a `-web`/`-app` suffix only when the flows genuinely
  differ; otherwise one id, two entries in `tests`.
- `status`: `active` (ran green) | `draft` (emitted, not yet green — blocker
  in `issues`) | `expectedFail` (asserts correct behavior blocked by a known
  open bug; link it) | `retired` (superseded — keep the entry, drop the file).
- `sources` accumulates every recording that shaped the journey — the dedup
  signal for `skip` verdicts.
- `task` (optional) is the `journey` task of the same `key` in the feature's
  QA plan (feature lifecycle D2): the id is shared both ways — the task's
  `fields.key` names this entry, this entry names the task, and the task's
  `fields.test` carries `tests[0]`. Absent when the repo has no plan.
- `blocks` is the reusable-block index (D6): shared page interactions journeys
  compose. `usedBy` is maintained on every write; a block with an empty
  `usedBy` is flagged by `--audit`, never auto-deleted.

## `.vitrinka/sessions.json` — processed-state ledger

Which recorded sessions this repo has already worked, and what came out of
them. Keyed by server session id (string, JSON keys).

```json
{
  "version": 1,
  "sessions": {
    "7": {
      "board": "acme-session-7",
      "triagedAt": "2026-07-25T10:12:00Z",
      "fixBranch": "fix/session-7",
      "fixPr": "https://github.com/acme/shop/pull/412",
      "testedAt": "2026-07-25T14:03:00Z",
      "testBranch": "test/session-7",
      "testPr": "https://github.com/acme/shop/pull/413",
      "journeys": ["orders-create", "orders-cancel"],
      "notes": "2 issues punted to user (other-repo)"
    }
  }
}
```

- `triagedAt`/`fixBranch`/`fixPr` — written by the fix stage at close-out.
- `testedAt`/`testBranch`/`journeys` — written by generate-test at close-out.
  `testBranch` is the durable pointer written in the SAME commit as the tests
  (a commit cannot embed its own hash); `testPr` is added once the PR exists —
  in the branch's next commit, or the PR URL alone via the server stamp.
- A session present with `testedAt` is DONE for the pipeline; the retrieval
  autopilot (phase 3) skips it. Absent or fix-only entries are pending work.

## Server stamps (visibility mirror)

After writing the manifests, mirror the state to the server so the /sessions
page shows chips:

```
PATCH /api/v1/sessions/{id}
{"pipeline": {"triaged": "<ISO>", "fixPr": "<url>"}}          # fix stage
{"pipeline": {"tested": "<ISO>", "journeys": [...], "testPr": "<url>"}}  # generate-test
```

Stamps merge key-wise (null deletes); they never touch session activity or
auto-close timing. The repo manifest remains the truth — on any disagreement,
fix the stamp to match git, never the reverse.
