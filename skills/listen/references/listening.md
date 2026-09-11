# The listening ladder — how a session stays tuned to a board

Every skill that "listens" (listen, pair, publish, brainstorming) listens
the SAME way: pick the highest rung this harness offers, announce it ONCE,
then service work exactly as the listen skill's per-item rules say. The rung
changes only how the session is WOKEN — never what it does with an item.

## The four rungs, in order

### 1 · Native Monitor (Claude Code)

The harness has a `Monitor` tool: a persistent background command whose
every stdout line re-invokes the session. Arm it on `vitrinka watch` and END
THE TURN — idle costs nothing, the next line wakes you. The schema requires
`timeout_ms` and `persistent` even though `timeout_ms` is ignored when
`persistent` is true — pass both:

```
Monitor({
  command: "exec vitrinka watch",   // auto-scopes to this repo+branch; add --board <slug> for one board, --all for the firehose
  persistent: true,
  timeout_ms: 300000,
  description: "vitrinka work queue (<repo/branch|board|all>)"
})
```

**The `exec` is load-bearing — never drop it.** The harness runs a monitor
command inside a wrapper shell and, when the session ends, signals *that
shell*. `exec` replaces the wrapper, so the watch *is* the process that gets
signalled: it releases the lease and exits the instant the session ends.
Without `exec` the watch is a grandchild — the wrapper dies, the SIGTERM never
reaches it, and it is adopted by init while still long-polling. Its
parent-death guard shuts it down within 5 seconds, so the lease is not held
forever; but until that fires the board's scope belongs to a process whose
stdout nobody reads, and anything dispatched in the gap disappears.

Never loop on `wait_for_work` under this rung, never re-arm per notification
(the monitor is `persistent`), never disarm to "refresh". Stopping is
`TaskStop` on the monitor — the clean teardown that releases the lease.

### 2 · Hosted by `vitrinka listen --harness <name>`

The human started this session through vitrinka's host: `vitrinka listen`
runs the harness (Codex, Gemini CLI, OpenCode, Claude) as an Agent Client
Protocol subprocess, holds the scope lease itself through the same
`vitrinka watch` loop, and injects each work item into the live session as a
prompt. You recognise it two ways: the environment carries
`VITRINKA_LISTEN_HOST=acp` and `VITRINKA_LISTEN_SCOPE=<scope>`, and the first
prompt says so.

Under this rung the session must NEVER arm a monitor and NEVER loop on
`wait_for_work`: the host is the loop. Work arrives as prompts in the same
grammar `vitrinka watch` prints —
`№<id> [answer|ask|session|<intent>] <scope>: <summary>` (`answer` = a
released question answer, `ask` = an Ask-AI request, `session` = a recorder
session started, any other tag = an annotation's intent such as `fix` or
`note`) — and you drain it through
`wait_for_work {…scope, timeoutSec: 1}` / `get_annotation` exactly as under
rung 1 (the prompt never inlines the capsule). When the drain returns
`{"idle":true}`, **END THE TURN** — the host injects the next item. Stopping
is Ctrl-C in the host's terminal; the host releases the lease.

A dedicated listener with no human at the keyboard is the same host in
headless form: `vitrinka watch --exec <harness>` resumes the listening thread
per item. Inside such a session the rules are identical to this rung.

### 3 · Hold the turn (no Monitor, not hosted)

Nothing outside this session can wake it, so the session stays awake itself:
announce, then loop `wait_for_work` and never end the turn on your own.

```
forever:
  r = wait_for_work({ …scope, timeoutSec: 50 })
  if r.idle → call wait_for_work again (free; do NOT sleep, do NOT stop)
  service asks[] first, then choices[] and work[] serially, oldest first
  → wait_for_work again
```

`{"idle":true}` is the normal heartbeat of an empty queue — loop silently and
never conclude "no work, I'm done". A turn that ends here ends the listening:
the answers queue silently and nobody reacts. The loop ends only when the user
interrupts you, or when your context grows unwieldy (finish the current item,
tell the user to restart the listener, and stop — the ONLY self-initiated
exit). Scope the loop exactly as a monitor would be scoped: `{board}` for a
board listener, `{project, branch}` for the repo listener. This rung holds no
server lease by design (the acting `wait_for_work` lane must never claim a
scope — a lease there would steal dispatches from real listeners), so a
`vitrinka listen` host started later for the same scope takes over cleanly —
that is the lift. The board does not show this rung — only leased listeners
appear in its listening indicator.

### 4 · One-shot drain

When the user asks for a single pull rather than a listening session:
`/vitrinka:answers` (released question answers — `get_questions` is the
durable record) or `/vitrinka:annotations` (dispatched annotation work).
Drain, work the items, done; arms nothing.

## Picking the rung

1. The `Monitor` tool exists in this harness → rung 1.
2. `VITRINKA_LISTEN_HOST` is set in the environment → rung 2.
3. Otherwise → rung 3.

Rung 4 is never a fallback for listening — it is what the user gets when they
ask for one pull. Never mix rungs: a hosted session that also loops, or a
Monitor session that also loops, double-drains its own queue.

## The announcement — exactly one line, once per session

Say which rung you are on the moment you start listening, then never repeat
it:

- rung 1: `⏳ listening on <scope> via Monitor`
- rung 2: `⏳ listening on <scope> — hosted by vitrinka listen`
- rung 3: `⏳ listening on <scope> — holding this turn (no background monitor here; \`vitrinka listen --harness <name>\` lifts that)`

`<scope>` is the board slug, `<project>/<branch>`, or `all boards`. On rung 3
`<name>` is this harness's name when you know it — Codex → `codex`, Gemini CLI
→ `gemini`, OpenCode → `opencode` — and the literal `<harness>` when you do
not. The line is the operator's only signal that the session is on the
weakest rung, so it is never skipped and never softened.

## Contracts that hold on every rung

- Drain scoped: pass the same `{board}` or `{project, branch}` the listener
  was armed with; never act on other boards' items.
- One item at a time, oldest first; asks first (a ● working popover is open on
  the operator's screen).
- Choices ride the wire exactly once — the drained `choices[]` is the only
  copy; `get_questions {board}` is the durable record if it is lost.
- Never `set_status resolved`; only the user accepts, on the board.
- A `⚠ … taken over by … — standing down` line (or a `{revoked:true}` wait
  response) means the listener moved to another of the user's sessions:
  acknowledge in one line and never re-arm.
- Context grown unwieldy: finish the current item, tell the user to restart
  the listener, stop.
