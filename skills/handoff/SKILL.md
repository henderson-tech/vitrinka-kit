---
name: handoff
description: "Hand a vitrinka task back at the end of a session through ONE door — `hand_back` (CLI `vitrinka task handback`) files next steps as children, attaches the summary as the task's versioned hand-back and returns the chat block to print verbatim. Use for `/vitrinka:handoff`, when the Stop gate asks for a hand-back, or whenever work on a bound task ends; starting is the pickup skill."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:handoff — the hand-back is a projection of the task

Work on a bound task ends with ONE call. `hand_back` takes what you would
have written into the chat — summary, what got done, what you opened, what
comes next, what you left out, where the branch is — and lands it on the
task in one transaction: next steps become ranked children, omissions become
children too, the summary becomes the next version of the task's `handoff`
attachment, refs and status land, and the parent epic's `next_action` moves.
It returns `rendered`: the chat hand-back block. You print that. You never
write a second one by hand.

## The call

MCP `hand_back` (CLI `vitrinka task handback [id]`; REST
`POST /tasks/{id}/handback`):

```text
hand_back {
  id: <bound task>,
  summary: "<higher-level, for everyone — what changed for the product, not the diff>",
  done: ["<one finished thing>", …],
  surfaces: ["<new API, component, door — what the next session can build on>", …],
  buildOn: "<where to start from>",
  next: [{title, type: "task"|"bug", body, priority}, …],
  omitted: [{title, why, decide: true|false}, …],
  branch: "<branch>", worktree: "<path>",
  prerequisites: ["<what must be true before the next step>", …],
  readFirst: [<ref id>, …],
  status: "<only to correct — see below>",
  refs: [{kind: "pr", ref: "acme/shop#42"}, {kind: "board", ref: "<slug>"}],
  sessionId: "<this session — ends its live run with the summary>"
}
```

What each field becomes:

- **`summary`** — the LAST row of the next pickup and the first line a
  colleague reads; write it for the team, not for the reviewer.
- **`done`** — the hand-back's middle lines; one line per finished thing.
- **`surfaces` · `buildOn`** — the pickup's ON row: what exists now that did
  not before, and where the next session should start.
- **`next`** — filed as children of the task, ranked after the existing
  ones, in the order given. Everything you would have listed under "Next
  steps" goes here; spotted items already filed (the spot skill) are NOT
  repeated — the block lists open children by itself.
- **`omitted`** — what you consciously did not do and why, as children;
  `decide: true` prefixes the title with `Decide:` for a call a human owns.
- **`branch` · `worktree`** — the pickup's BRANCH row; the CLI defaults
  them from the checkout.
- **`prerequisites`** — the pickup's BEFORE row; a non-empty list marks the
  parent epic `waiting`.
- **`readFirst`** — ref ids (yours or the epic's) the next session must read
  before anything else; they head the pickup's READ rows.
- **`refs`** — the PR and the board this work produced, when not attached
  already; the block's 🔀 and 🖼️ lines come from them.
- **`sessionId`** — the run bound at session start ends with the summary.

CLI form: `vitrinka task handback --summary … --done … --surface … --next
"bug:<title>" --omit "<title>::<why>" --decide "<title>::<why>" --prereq …
--read-first <refId> --pr owner/repo#n --board <slug>`; `vitrinka task handback [id] - < body.json` reads the
exact body from stdin.

## Print `rendered` verbatim

The response carries `rendered`:

```text
Summary
<summary>

<one line per done item>

Next steps
1. <child title> — <child url>
…
📋 Task: <url> — <status>
🔀 PR: <url> — <state>
🖼️ Board: <url>
```

That block IS your hand-back. Print it as returned — same lines, same
order, same urls — and add nothing that belongs in the task. A line you
feel like adding by hand is a field you forgot to fill: call again.

## Status

Status moves by itself — a run starting marks the task in progress, an
open PR marks it in review, a merged PR completes it. Fill `status` only to
correct that: reopening, cancelling, sending back to backlog. Leave it
empty otherwise.

## The Stop gate

When a session's closing message carries a `Next steps` heading and the
bound task has no hand-back newer than this session's run, the Stop hook
blocks with "call hand_back first". This skill is the answer: make the
call, print `rendered`, stop. Never work around the gate by dropping the
heading. Codex runs the same hook from `~/.codex/hooks.json` once
`vitrinka install` has written it and it has been trusted through `/hooks`
in Codex; `vitrinka doctor` shows the state as `hooks·codex`.

## Delegation

The personal `/handoff` and `/continue` commands keep their file form for
chores and repositories without vitrinka; when a task is bound they call
this skill and the pickup skill respectively.

## Never

- Never end a bound task's work with a chat-only next-steps list.
- Never write the hand-back block by hand, shorten it or reorder it.
- Never attach the summary through `upload_task_file` yourself — the door
  versions the `handoff` lineage.
- Never set `status` to move work forward; the rules do that.
