---
name: investigate
description: "Use when a Hlídač problem, an error group or an old Sentry short id (FIXIT-API-7K) is to be understood or fixed — 'investigate this problem', 'what is FIXIT-API-7K', 'why was this dismissed'; prod-wide status is watch."
metadata:
  vitrinka-contract: "2026-09-15"
---

# /vitrinka-signals:investigate — start from the prepared case

A problem is a task from birth. Its brief is the task body (what is known,
what is not, the suspect deploy) and its evidence is the task's `signals`
block: every group it carries, the most felt first, with users, events, last
seen and the Sentry link. Start there; never start from Sentry's issue list.

## The reads

- A problem: `get {kind: "task", id}` — body plus `signals`. Pick it up like
  any task (the pickup skill) when you will fix it.
- An old Sentry short id or a pasted id: `search {q: "FIXIT-API-7K", mode:
  "resolve"}` answers the problem it belongs to, exactly.
- One group, handled or not: `get {kind: "signal_group", id}` (a group id or
  the short id) — what it is now, where Hlídač left it and why (`decision`),
  and its problem. A group handled for you is reversed by a person in Intake;
  never surface, snooze or dismiss it yourself.
- Its evidence: `include: ["evidence"]` adds the latest Sentry event,
  scrubbed (exception, in-app frames, breadcrumbs, request, release, tag
  spread) in one read; a failed read is named in `evidenceError`.

## Working it

Treat the brief's unknowns as the questions to answer first. Verify the
suspect deploy against the code before blaming it. A fix lands like any task
(commit trailer, hand-back); the problem counts as fixed only once
production proves it, so never close one on a merge alone.
