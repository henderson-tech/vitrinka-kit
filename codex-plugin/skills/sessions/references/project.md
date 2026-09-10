# `.vitrinka/project.json` — the project rules map

Committed, per-repo: everything the autopilot needs to
work THIS project without asking twice. Mapped interactively on the first
`/vitrinka:sessions` run — derive what the repo answers, ask the user the
rest, confirm, commit. Re-map on demand when the repo's tooling changes.

```json
{
  "version": 1,
  "project": "acme",
  "worktree": {
    "commands": {
      "sim": "bun wk:create:sim {name}",
      "full": "bun wk:create:full {name}"
    },
    "rule": "full when the session's journey includes the mobile app (expo app-ids in the digest hosts); sim otherwise",
    "fallback": "git worktree add .worktrees/{name} -b {branch}"
  },
  "run": {
    "web": {
      "cmd": "bun dev",
      "cwd": "apps/web",
      "ready": { "url": "http://127.0.0.1:3000/api/health", "timeoutSec": 120 }
    },
    "app": {
      "cmd": "bun start:dev-client",
      "cwd": "apps/client",
      "ready": { "log": "Metro waiting", "timeoutSec": 240 }
    }
  },
  "e2e": {
    "playwright": {
      "cmd": "bun playwright test",
      "cwd": "apps/web",
      "testsDir": "apps/web/e2e",
      "single": "bun playwright test {spec}"
    },
    "appium": {
      "cmd": "bun wdio run wdio.conf.ts",
      "cwd": "apps/client",
      "testsDir": "apps/client/e2e",
      "single": "bun wdio run wdio.conf.ts --spec {spec}"
    }
  },
  "frameworks": [
    { "surface": "web", "runner": "playwright", "hosts": ["*.staging.example.com"] },
    { "surface": "expo", "runner": "appium", "apps": ["com.acme.app"] }
  ],
  "notes": "anything a future run must know (env quirks, seed commands, ports)"
}
```

Field rules:

- `{name}`/`{branch}`/`{spec}` are substitution slots the skills fill.
- `worktree.rule` is prose the orchestrator applies against the session
  digest's hosts/app-ids — keep it one decidable sentence.
- `ready` is either `{url}` (2xx = up) or `{log}` (line appears in the run
  output); always with `timeoutSec`. A stack without a readiness check WILL
  eventually eat a test run — refuse to leave it empty.
- Run entries take two optional pair-mode keys (`vitrinka pair` reads them):
  `"hot": true` marks an HMR/Metro stack where a file save reaches the running
  app with no restart (so `pair restart` is a no-op for it), and `"url"` is
  the human-facing address to hand the tester when it differs from
  `ready.url`.
- `frameworks[].hosts`/`apps` mirror the server-side project domain/app rules
  (project settings) — the mapping between what a session recorded and which
  runner tests it.
- Unknown extra keys are allowed (projects are unique); skills must ignore
  what they don't understand and never delete keys they didn't write.
