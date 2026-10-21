---
name: watch
description: "Use after a deploy or on 'is prod OK?', 'check prod', 'check Sentry after the deploy', 'did the release break anything' in a workspace that runs Hlídač; one problem's detail is investigate."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka-signals:watch — is prod OK, in one call

One read answers it: MCP `get {kind: "prod_status"}` (CLI `vitrinka signals
status`). The server joins every watched deployment's checks, the alerts
Alertmanager holds active for it and its project's open problems, and
returns only what is not ok. Never poll Sentry, Grafana or Prometheus
yourself, and never compose the verdict from their parts.

## Reading the answer

- `verdict` is the workspace's worst: `down` (a failing check, a critical alert or
  an emergency page) beats `blind` (no check, or no alert source, reached us: unknown,
  never ok) beats `degraded` (a warning or an unknown check) beats `ok`.
- Each deployment lists `checks` and `alerts` only when they are not ok, and
  its open `problems` with their `url`. Print a problem as a masked link over
  that `url` exactly; open one with investigate.
- `sourcesFailing` names a source that did not answer: say so — a blind
  deployment is a finding, not a pass.
- A `fix` means nothing is watched yet: hand it to whoever owns the setup
  (the setup skill).

## After a deploy

Read once right after it, and once more a few minutes later — checks are
recording rules and lag a scrape or two. Report the verdict, each
deployment that is not ok and why, and the new problems. Never call a
deploy clean on a `blind` deployment.
