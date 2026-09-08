---
name: listen
description: "Tune this session into a vitrinka annotation board and work its queue continuously — a native background monitor (`vitrinka watch`) re-invokes the session per annotation, zero-token idle. Invoke as /vitrinka:listen [board-slug] FROM THE APP'S REPO."
metadata:
  vitrinka-contract: "2026-08-30"
---

# /vitrinka:listen — the listening session (native Monitor)

You are the **worker half of an audit loop**: the user looks at their app's
screens on a vitrinka board and annotates what's wrong; you fix each annotation
in THIS repository, attach visual proof, and go back to listening.

**How the listening works.** You do NOT loop on `wait_for_work` in-model.
Instead you arm Claude Code's **native background Monitor** on `vitrinka
watch`: a persistent script that long-polls the work queue and prints ONE line
per NEW annotation. Each line re-invokes this session; while the queue is idle
it prints nothing and costs nothing. Silence means "healthy and idle",
forever — a finished turn still wakes on new work.

Argument: an optional board slug (`/vitrinka:listen acme-audit`). **Without a
board it now AUTO-SCOPES to this repo + branch** — it infers the project from the
repo (the main worktree's name, the same derivation `vitrinka push` uses) and the
current git branch, and listens for exactly that project+branch's work. This is
what lets several Claude sessions listen at once without stepping on each other:
each session's listener scopes to its own work.

## One listener per scope (the multi-session model)

Multiple Claude sessions can work concurrently on different things, and each arms
its own scoped listener. The server enforces **at most one live listener per
scope** — the same board (or the same project+branch) cannot be listened to twice:

- The listener *leases* its scope through the `vitrinka watch` long-poll — that
  long-poll IS the heartbeat. A clean stop (the Monitor torn down, the session
  exiting) releases the lease immediately and reverts any work it had claimed;
  if the process is killed outright the lease lapses on the ~90s TTL instead.
  The watch also self-terminates if it is ever orphaned — it watches its own
  parent, so an agent that dies without signalling anything (SIGKILL, crash,
  closed terminal) still frees the scope within seconds rather than holding it
  forever. See the `exec` note under "Arm the monitor".
- **Newest wins (same machine):** arming a listener IS the routing decision. If
  another session ON THIS MACHINE holds the scope, your `vitrinka watch` claim
  displaces it automatically — no 409, no question, nothing to surface. The
  displaced session's monitor emits one `⚠ listener for <scope> taken over by
  <actor>@<session> — standing down` line and exits cleanly. **If YOUR monitor
  emits that stand-down line**, the user armed the scope from another session:
  acknowledge in one line ("listener moved to <session> — standing down") and do
  NOT re-arm — re-arming would steal it back and ping-pong.
- If the scope is held live by a session on a **different machine**,
  `vitrinka watch` prints `⚠ listener already active (live, another machine): …`
  and exits (code 2). Tell the user which session holds it and stop — a
  cross-machine live lease is never stolen.
- `--takeover` steals only an **expired** lease (a crashed/hard-killed session
  whose lease hasn't been released). Same-machine live leases need no flag
  (newest wins); cross-machine live ones can never be stolen.

Scope flags (all optional): `--board <slug>` (one board), `--project <p>
--branch <b>` (override the inferred repo scope), `--all` (the firehose — observe
every board; `--all` conflicts with nothing and claims no scope, so use it only
for a read-only overview session, never to work items another session owns).

All scope resolves *within the token's workspace* — the server infers the
workspace from your Bearer token, so `wait_for_work`/`list_work` scoping by
`{board}` or `{project, branch}` only ever sees that workspace's work.

## Preconditions — check once, then arm

1. You are in the app repository the board's screenshots come from
   (`git rev-parse --show-toplevel` works and the project matches what capsules
   will reference). If the cwd is clearly not an app repo, say so and stop.
2. The `vitrinka` MCP tools are available (`wait_for_work`, `set_status`,
   `reply`, `attach_after`, `get_capsule`). If not, tell the user to run
   `vitrinka install` in this repo (or the manual form:
   `claude mcp add --scope project --transport http vitrinka <origin>/w/<workspace>/mcp`,
   then `/mcp` → vitrinka → authenticate inside Claude Code) — the
   registration is a secret-free remote HTTP entry with OAuth; the stdio
   forwarder `vitrinka mcp` remains the fallback for hosts without OAuth.
   In a bound repo the PROJECT-level entry (`/w/<workspace>/mcp`) must be
   present — a session riding only the user-level grant may land in the
   wrong workspace and cannot create projects; `vitrinka install` renders
   it (Cursor, OpenCode, VS Code and Gemini CLI get their own files too).
3. The **Monitor tool** is available in this harness. If it is NOT, use the
   FALLBACK loop at the bottom of this file instead.

## Arm the monitor, then END THE TURN

Use the `vitrinka` binary on PATH (installed by `vitrinka install` / `npm i -g
@vitrinka/cli`). If it is not on PATH (a repo-dev machine without the shim),
fall back to `go run ./cmd/vitrinka watch` from a vitrinka repo checkout.

Arm the monitor (the schema requires `timeout_ms` and `persistent` even though
`timeout_ms` is ignored when `persistent` is true — pass both):

```
Monitor({
  command: "exec vitrinka watch",   // auto-scopes to this repo+branch; add --board <slug> for one board, --all for the firehose
  persistent: true,
  timeout_ms: 300000,
  description: "vitrinka work queue (<repo/branch|board|all>)"
})
```

**The `exec` is load-bearing — never drop it.** Claude Code runs a monitor
command inside a wrapper shell and, when the session ends, signals *that shell*.
`exec` replaces the wrapper, so the watch *is* the process Claude Code signals:
it releases the lease and exits the instant the session ends. Without `exec` the
watch is a grandchild — the wrapper dies, the SIGTERM never reaches it, and it
is adopted by init while still long-polling. Its parent-death guard notices the
reparenting and shuts it down within 5 seconds, so the lease is not held
forever; but until that fires, the board's scope belongs to a process whose
stdout nobody reads, and anything dispatched in the gap disappears. `exec` is
the immediate, signal-driven release; the guard is only the ≤5s backstop.

**Default is auto-scope** — no `--board` needed. `vitrinka watch` with no scope
flag infers project+branch from the repo you are in and leases that scope.
Arming displaces any same-machine holder automatically (newest wins — see the
multi-session section above). If the monitor's FIRST output line is a
`⚠ listener already active (live, another machine) …` (exit 2), a session on a
different machine owns the scope: surface which one and stop. If the monitor
later emits `… taken over by … — standing down`, the listener moved to another
of the user's sessions: acknowledge in one line and do not re-arm.

Then, in the SAME turn:

1. Announce exactly one line: `⏳ listening on <board|all boards> — annotate away`.
2. **END THE TURN.** Do not loop, do not poll, do not sleep. Idle costs nothing;
   the monitor's next line re-invokes you. This is the whole point — a finished
   turn is fine, the monitor is what wakes you.

## On a monitor notification — drain the queue

A monitor line looks like `№<id> [<intent>] <board>: <prompt…>` — one per new
annotation. A `№<id> [choice] <board>: <question> → <answer>` line is an
ANSWERED BOARD QUESTION (a "Send to Claude" dispatch, e.g. from a brainstorm
decision map) — drain it the same way: `wait_for_work` returns it in the
`choices[]` array alongside `work[]`; record the decision (answer + any `note`)
per the brainstorming skill instead of treating it as a code-fix item. Note
choices are delivered exactly once — the `choices[]` payload you drain is the
only copy, so act on it in this turn (or re-read answers via the MCP
`get_questions {board}` — the durable question record — if lost).
A `№<id> [session] <project>: testing session started — …` line means the user
just began a RECORDER SESSION on your project (the `sessions[]` lane): the №
is a session id (`get_session`, not `get_annotation`), and the move is the
pair skill — switch to `/vitrinka:pair`'s preflight and loop; there is no
annotation to service yet.
A `№<id> [ask] <board>: <question> → <prompt>` line is an ASK-AI INFO REQUEST
(questions-ux wave2): the operator wants more information about that question,
now, mid-selection — it arrives in `wait_for_work`'s `asks[]` array. Service
asks FIRST (a ● working popover is open on their screen): answer by streaming
`answer_ask {id, text, partial:true}` in 2-4 sentence chunks, final chunk
without `partial` — grounded in this repo's actual code when the ask is about
behavior, popover-sized, never a code change. When you're re-invoked by a
line (or a batch):

1. **Drain via MCP, SCOPED THE SAME WAY.** Call `wait_for_work({ …scope,
   timeoutSec: 1 })` and loop it until it returns `{"idle":true}`, working each
   returned capsule serially, oldest first, under the per-item rules below. Pass
   the SAME scope the monitor uses so you only drain your own work: `{ board }`
   for a board listener, or `{ project, branch }` for the auto-scoped repo
   listener. Use `timeoutSec: 1` (NOT 50) — the monitor is what waits; here you're
   just draining what's ready right now, not blocking.
2. When `wait_for_work` returns idle, the ready queue is empty. **End the turn
   again.** The monitor stays armed (it's `persistent`) and will re-invoke you on
   the next annotation. Never disarm it yourself.

Do NOT re-arm the monitor on each notification — it is already running for the
session's lifetime.

## Keepalive heartbeats (cache warming)

A `· keepalive <scope>` line is NOT work — it is a presence-gated heartbeat the
watch emits while the user has a scope board open in a browser and this session
has been idle for about one prompt-cache TTL. The wake ITSELF is the point: it
re-reads the session's prompt cache (~10% of input price) so the next real
annotation lands on a warm cache instead of paying a full-price cache re-write.
On a keepalive line, **do nothing**: no `wait_for_work`, no replies, no text —
end the turn immediately. If a keepalive line arrives batched with real work
lines, just drain normally (the drain is the wake). The interval is
`vitrinka watch --keepalive <sec>` (default 3000; `0` disables); the watch
never emits it while nobody is viewing a board, so an abandoned board costs
nothing overnight.

## Working one item

1. **Claim it**: `set_status {id, status: "working"}` — the user's board pin
   flips amber live. If this returns a 409 (cancelled / already claimed), skip
   the item silently.
2. **Announce the plan**: `reply` with ONE terse line ("tightening hero contrast
   on the dark theme").
3. **Understand**: the capsule has the ask, the region, and a crop URL — fetch
   the crop image if seeing the region matters (it usually does). `get_capsule
   {id}` re-fetches the latest brief after user edits.
4. **Fix it in this repo.** Scope discipline: the annotated ask only — no
   drive-by refactors. Commit with a conventional message referencing №id.
5. **Prove it**: regenerate the screen(s) and push a new set the way this repo
   does it (its CLAUDE.md / `vitrinka snap` / journey script). Then `attach_after
   {id, project, branch, selector, file, commit}` pointing at the fixed screen
   inside the set you just pushed.
6. **Report**: `reply` with 1-3 lines (what changed, commit, anything the user
   should eyeball), then `set_status {id, status: "in_review"}`.

Progress notes: at most one `reply` per meaningful moment (plan, pushed vN).
Never spam the thread; never post "still working". Pass `agent` on `reply`
and `attach_after` (`claude-code` / `codex` / …) so the thread shows
`agent:<runtime>` beside your verified identity.

Something ELSE wrong on the screen (not the annotated ask)? Don't widen the
fix — file it: `get_card_image {board, cardId}` to measure, then `annotate
{board, agent, items:[{key, cardId, cardVersion, region, summary, …}]}`. It
lands `staged`; the user accepts it into the queue. Never a document card,
never `highlight` for a finding (docs topic `annotation`).

## Cancels (the user changed their mind)

Any vitrinka tool returning **409 "cancelled"** for an item means the user
withdrew it mid-flight:

1. Revert the working-tree changes you made FOR THAT ITEM (`git checkout` / drop
   the WIP commit — surgical, don't touch unrelated state).
2. Do not reply to the cancelled annotation (writes bounce); mention the
   cancellation in your session output only.
3. Move on to the next ready item as if it never existed.

## Degraded / down

If a monitor line reads `⚠ vitrinka unreachable for <n>s — listener degraded`,
tell the user vitrinka looks down and that the listener is retrying — **keep the
monitor armed** (it self-recovers and will print `✓ vitrinka reachable again`).
Do not disarm or re-arm it.

## Stopping the listener

- **The user asks to stop listening** → `TaskStop` the monitor. That is the
  clean teardown: the watch releases its lease at once and anything it had
  claimed goes back on the queue. Never just "stop paying attention" — the
  lease outlives your attention.
- **The user is exiting Claude Code** and the exit dialog lists the monitor:
  `Exit anyway` stops it (the lease is released); `Move to background and exit`
  deliberately keeps it running, and it will keep leasing and answering the
  board with no session attached to act on the work. If they ask which to pick,
  the answer is `Exit anyway` unless they specifically want the queue held.
- **Never disarm and re-arm** to "refresh" it. Re-arming from the same machine
  displaces the old lease (newest wins) and the churn is pointless.
- Stale leases from an older crash are visible in `vitrinka doctor` and cleared
  by `vitrinka doctor --fix` — offer that if a scope seems held by nobody.

## Rules

- **Never `set_status resolved`** — only the user accepts, on the board.
- Statuses are the UI: claim before touching code, in_review only after the
  after-shot is attached.
- One item at a time; the queue is FIFO — take the oldest first.
- If a fix genuinely needs the user's input, `reply` with the question,
  `set_status {status: "open"}` to put it back, and end the turn — any plain
  reply in the thread re-queues the item and the monitor wakes you again
  (annotation threads route to claude by default; only explicit `@eve` turns go
  to Eve, vitrinka's AI reviewer).
- If your context grows unwieldy after many fixes, finish the current item, tell
  the user to restart the listener, and stop.

---

## FALLBACK — in-model loop (only if the Monitor tool is unavailable)

If this harness has **no Monitor tool**, you cannot arm a background watcher —
fall back to the old in-model loop. It works but is inferior: it burns context
while idle and the *publishing* session can't self-wake once its turn ends, so
prefer the Monitor path whenever it exists.

1. Announce `⏳ listening on <board|all boards> — annotate away`.
2. Loop, never exiting on your own:

```
forever:
  r = wait_for_work({ board?, timeoutSec: 50 })
  if r.idle → call wait_for_work again (free; do NOT sleep, do NOT stop)
  for each capsule in r.work (serially, oldest first):
    work the item (per "Working one item" above)
  → wait_for_work again
```

`{"idle":true}` is the normal heartbeat of an empty queue — loop silently. Never
conclude "no work, I'm done". The loop only ends when the user interrupts you, or
when your context grows unwieldy (finish the current item, tell the user to
restart the listener, and stop — the ONLY self-initiated exit).

## Update notices

Any `vitrinka` command may print `update available X → Y · run: vitrinka update`
on stderr (the CLI's daily background check — server-first, npm fallback).
When you see it: relay it to the user ONCE and offer to run `vitrinka update`
for them. Never run the update unprompted, and never repeat the offer in the
same session.
