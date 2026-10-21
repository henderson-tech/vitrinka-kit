---
name: setup
description: "Use when Hlídač must start reading a Sentry, Alertmanager or Prometheus, or prod_status answers that nothing is watched — 'set up Hlídač', 'connect our Prometheus', 'add a deployment to prod status'."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka-signals:setup — the sources Hlídač reads

Sources are workspace configuration a workspace admin saves with `vitrinka
signals source set` and checks with `vitrinka signals source check`, run
with a workspace service token minted at admin (a person's own token never
carries `integration.manage`); the kinds, the bodies and the check
contract are `docs {topic: "guide:hlidac-sources"}` — read it before
writing one. Credentials go in a
source's body once and are never returned; take them from your vault at the
point of use, never from a file or the chat.

## The three kinds

- `sentry` — polled; routes map a Sentry project (and environment) onto a
  vitrinka project.
- `alertmanager` — pushes to the webhook URL its save answers; an optional
  base URL lets prod status read the alerts active now.
- `prometheus` — one route per deployment, matched by the `deployment` label
  of its `deployment:check:*` recording rules.

## Laws

- Thresholds live in the recording rules, never in vitrinka: a check that
  needs tuning is an infra change.
- An internal address (or plain http) is saved only by deployment authority;
  anyone else gets a refusal naming whom to ask — pass it on, never work
  around it.
- Done is `get {kind: "prod_status"}` answering every deployment you added
  with a verdict that is not `blind`.
