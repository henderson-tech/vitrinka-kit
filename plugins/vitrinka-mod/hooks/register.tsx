// The vitrinka mod: the session's board, epic and task in the prompt footer
// (the compass), /vt to open, copy or pick them and to open the work-tree
// pane, and the hand-back drawn as a folded card. It reads the files the
// vitrinka CLI writes for this session and calls `vitrinka … --json`; it never
// holds a credential, never reaches the network itself and never claims a
// listener lease. Every /vt answers {} so no command row reaches the model.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Dashboard, Focus, Lease, Section, Strip } from '../types'
import { FILES, VT_USAGE, age, clip, compass, decisionCounts, fileOf, handBackText, lanes, linkOf, parseVt, sessionDir } from './model'
import type { FileName } from './model'


const strip = atom({ plugin: 'vitrinka-mod', key: 'strip' } as const, null)
const focus = atom({ plugin: 'vitrinka-mod', key: 'focus' } as const, null)
const lease = atom({ plugin: 'vitrinka-mod', key: 'lease' } as const, null)
const dashboard = atom({ plugin: 'vitrinka-mod', key: 'dashboard' } as const, null)
const dashboardAt = atom({ plugin: 'vitrinka-mod', key: 'dashboardAt' } as const, 0)
const fullAt = atom({ plugin: 'vitrinka-mod', key: 'fullAt' } as const, 0)
const reading = atom({ plugin: 'vitrinka-mod', key: 'reading' } as const, false)
const expanded = atom({ plugin: 'vitrinka-mod', key: 'expanded' } as const, [])

const PANE = 'vt'
/** The sections a while-open tick reads; todos and PRs wait for an open or a refresh. */
const TICK_SECTIONS = 'tree,frontier,needsYou,ready'
/** The backstop for FileChanged (which a managed install may not deliver). */
const POLL_MS = 15_000

// Module state is a reload's to lose: the next poll and the next open rebuild it.
let mtimes: Partial<Record<FileName, number>> = {}
let poller: Timer | undefined
let ticker: Timer | undefined

async function where($: EngineInterface): Promise<{ session: string; dir: string } | null> {
  const session = await $.session.id()
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const dir = sessionDir({ xdg: await $.env.get('XDG_CONFIG_HOME'), home }, session)
  return dir === null ? null : { session, dir }
}

function missing(err: unknown): boolean {
  return err instanceof Error && /ENOENT|no such file|not found/i.test(err.message)
}

/** Reads one session file into its atom; a missing file is null, never an error. */
async function load($: EngineInterface, name: FileName): Promise<void> {
  const at = await where($)
  if (at === null) return
  let value: Strip | Lease | Focus | null = null
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(`${at.dir}/${name}`))
    if (parsed && typeof parsed === 'object' && 'v' in parsed && parsed.v === 1) value = parsed as Strip | Lease | Focus
    else $.ui.log(`vitrinka-mod: ${name} is not version 1; update the vitrinka CLI or the mod`)
  } catch (err) {
    if (!missing(err) && !(err instanceof SyntaxError)) throw err
  }
  if (name === 'strip.json') await update($, strip, () => value as Strip | null)
  else if (name === 'listening.json') await update($, lease, () => value as Lease | null)
  else await update($, focus, () => value as Focus | null)
}

async function loadAll($: EngineInterface): Promise<void> {
  for (const name of FILES) await load($, name)
}

/** Re-reads any session file whose mtime moved since the last look. */
async function poll($: EngineInterface): Promise<void> {
  const at = await where($)
  if (at === null) return
  for (const name of FILES) {
    let mtime = 0
    try {
      mtime = (await $.fs.stat(`${at.dir}/${name}`)).mtimeMs
    } catch (err) {
      if (!missing(err)) throw err
    }
    if (mtime !== (mtimes[name] ?? 0)) {
      mtimes = { ...mtimes, [name]: mtime }
      await load($, name)
    }
  }
}

type Envelope<T> = { ok: boolean; data?: T; diagnostics?: { code?: string; detail?: string; fix?: string }[] }

/** Runs one `vitrinka … --json` verb and reads its envelope. */
async function cli<T>($: EngineInterface, argv: string[]): Promise<{ ok: true; data: T } | { ok: false; why: string }> {
  const ran = await $.process.run(['vitrinka', ...argv, '--json'], { timeoutMs: 20_000 })
  let env: Envelope<T>
  try {
    env = JSON.parse(ran.stdout) as Envelope<T>
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err
    return { ok: false, why: `vitrinka ${argv[0]} answered no envelope (exit ${ran.exitCode}): ${clip(ran.stderr.trim(), 160)}` }
  }
  if (env.ok && env.data !== undefined) return { ok: true, data: env.data }
  const d = env.diagnostics?.[0]
  return { ok: false, why: [d?.detail ?? `vitrinka ${argv[0]} failed`, d?.fix].filter(Boolean).join(' · ') }
}

// generation orders the reads: a reply that a newer read superseded is
// dropped, so a slow tick never paints over a fresh refresh.
let generation = 0

async function refresh($: EngineInterface, only: string | null): Promise<void> {
  // A tick waits its turn: while any read is in flight it is skipped.
  if (only !== null && (await read($, reading))) return
  const at = await where($)
  if (at === null) return
  const mine = ++generation
  await update($, reading, () => true)
  try {
    const got = await cli<Dashboard>($, ['mod', 'dashboard', '--session', at.session, ...(only ? ['--only', only] : [])])
    if (mine !== generation) return
    if (!got.ok) {
      $.ui.toast(`vitrinka: ${got.why}`)
      return
    }
    // A tick reads part of the dashboard; the sections it skipped keep the last read.
    await update($, dashboard, prev => {
      if (!only || prev === null) return got.data
      const merged = { ...got.data }
      for (const k of ['sprint', 'todos', 'prs'] as const) merged[k] = prev[k] as never
      return merged
    })
    const now = Date.now()
    await update($, dashboardAt, () => now)
    if (!only) await update($, fullAt, () => now)
  } finally {
    if (mine === generation) await update($, reading, () => false)
  }
}

async function count($: EngineInterface, what: string): Promise<void> {
  const raw = await $.store.get('counters')
  const counters = raw && typeof raw === 'object' ? (raw as Record<string, number>) : {}
  await $.store.set('counters', { ...counters, [what]: (counters[what] ?? 0) + 1 })
}

async function openLink($: EngineInterface, url: string, label: string): Promise<void> {
  const got = await cli<{ url: string; opened: boolean }>($, ['board', 'open', url])
  $.ui.toast(got.ok ? `opened ${label}` : `vitrinka: ${got.why}`)
}

async function pick($: EngineInterface, board: string): Promise<void> {
  const at = await where($)
  if (at === null) return
  const got = await cli<Focus>($, ['mod', 'focus', 'set', board, '--session', at.session])
  if (!got.ok) {
    $.ui.toast(`vitrinka: ${got.why}`)
    return
  }
  await update($, focus, () => got.data)
  $.ui.toast(`selected ${got.data.board?.title || board}`)
}

export const register: Register = (on, options) => {
  const tickMs = Math.max(10, Number(options.tickSeconds ?? 30)) * 1000
  const drawCompass = options.compass !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'vt',
      description: 'vitrinka: the work-tree pane; open or copy the task, epic or board; pick the board',
      argumentHint: '[task|epic|board | copy <slot> | board <slug|url> | board clear | refresh]',
      immediate: true,
    })
    mtimes = {}
    await poll($)
    poller?.cancel()
    poller = $.clock.every(POLL_MS, () => void poll($))
    return started
  })

  // The start hook writes the strip before the settings hooks' result
  // returns, so it is on disk once next(e) resolves.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    await loadAll($)
    return result
  }).catch(($, e, next) => next(e))

  on('classic.FileChanged', async ($, e, next) => {
    const result = await next(e)
    const name = fileOf(e.file_path, await $.session.id())
    if (name !== null) await load($, name)
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'vt' }, async ($, e) => {
    const vt = parseVt(e.args)
    await count($, vt.verb === 'open' || vt.verb === 'copy' ? `${vt.verb} ${vt.target}` : vt.verb)
    const state = { strip: await read($, strip), focus: await read($, focus) }
    switch (vt.verb) {
      case 'pane':
        await $.ui.open({ id: PANE, title: 'vitrinka' })
        ticker?.cancel()
        ticker = $.clock.every(tickMs, () => void refresh($, TICK_SECTIONS))
        await refresh($, null)
        break
      case 'refresh':
        await refresh($, null)
        break
      case 'open':
      case 'copy': {
        const link = linkOf(state, vt.target)
        if (link === null) {
          $.ui.toast(`no ${vt.target} in this session${vt.target === 'board' ? ' — /vt board <slug> picks one' : ''}`)
        } else if (vt.verb === 'open') {
          await openLink($, link.url, link.label)
        } else {
          const copied = await $.ui.copy({ text: link.url })
          $.ui.toast(copied.isCopied ? `copied ${link.label}` : `could not copy (${copied.reason})`)
        }
        break
      }
      case 'pick':
        await pick($, vt.board)
        break
      case 'clear': {
        const at = await where($)
        const got = at === null ? null : await cli<Focus>($, ['mod', 'focus', 'clear', '--session', at.session])
        if (got?.ok) await update($, focus, () => got.data)
        $.ui.toast(got?.ok ? 'board selection cleared' : `vitrinka: ${got && !got.ok ? got.why : 'no session'}`)
        break
      }
      case 'help':
        $.ui.toast(`${vt.why ? `${vt.why} — ` : ''}${VT_USAGE}`)
        break
    }
    return {}
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    ticker?.cancel()
    ticker = undefined
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const engine = await next(e)
    if (!drawCompass) return engine
    const slots = compass({ strip: await read($, strip), focus: await read($, focus), lease: await read($, lease) }, e.viewport?.columns ?? 120)
    if (slots.length === 0) return engine
    const { Box, Text, Link } = $.ui.resolve(e)
    return (
      <Box>
        {slots.map((s, i) => (
          <Box key={s.kind}>
            {i > 0 && <Text dimColor> · </Text>}
            {s.url ? <Link href={s.url}>{`${s.glyph} ${s.label}`}</Link> : <Text dimColor>{`${s.glyph} ${s.label}`}</Text>}
            {s.warn && <Text> ⚠</Text>}
          </Box>
        ))}
        {e.props.modes.length > 0 && <Text dimColor>{'  '}</Text>}
        {engine}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Link, Button } = $.ui.resolve(e)
    const d = await read($, dashboard)
    const st = await read($, strip)
    const f = await read($, focus)
    const l = await read($, lease)
    const at = await read($, dashboardAt)
    const full = await read($, fullAt)
    const busy = await read($, reading)
    const cols = Math.max(30, e.props.bodyColumns)
    // A section that is not ok says why on its heading's own line.
    const head = <T,>(t: string, s?: Section<T>) => (
      <Text>
        <Text bold>{t}</Text>
        {s && s.state !== 'ok' && <Text dimColor>{` — ${s.state === 'skipped' ? '' : `${s.state}: `}${s.reason ?? ''}${s.fix ? ` · ${s.fix}` : ''}`}</Text>}
      </Text>
    )
    const why = <T,>(s: Section<T>) => (
      <Text dimColor>{`  ${s.state === 'skipped' ? '—' : s.state}: ${s.reason ?? ''}${s.fix ? ` · ${s.fix}` : ''}`}</Text>
    )
    const n = lanes(d)
    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>{`${busy ? 'reading… ' : ''}${age(at, Date.now())}${full !== at ? ` · sprint, todos, PRs ${age(full, Date.now())}` : ''} `}</Text>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => void refresh($, null)} />
        </Box>
        {st && st.state !== 'ok' && st.state !== 'unbound' && <Text>{`○ ${st.reason ?? st.state} · ${st.fix ?? ''}`}</Text>}
        {st?.task && (
          <Text>
            {'● '}
            <Link href={st.task.url}>{st.task.key}</Link>
            {` ${clip(st.task.title, cols - 20)} [${st.task.status}]`}
          </Text>
        )}
        {st?.epic && (
          <Text>
            {'▲ '}
            <Link href={st.epic.url}>{st.epic.key}</Link>
            {` ${clip(st.epic.title, cols - 20)}`}
          </Text>
        )}
        {f?.board ? (
          <Text>
            {'◆ '}
            <Link href={f.board.url}>{clip(f.board.title || f.board.slug, cols - 30)}</Link>
            <Text dimColor>{f.source === 'pick' ? ' (your pick)' : ' (the skill declared it)'}</Text>
            {f.declared && <Text>{` ⚠ the skill declared ${f.declared.title || f.declared.slug}; /vt board ${f.declared.slug} takes it`}</Text>}
          </Text>
        ) : (
          <Text dimColor>◆ no board selected · /vt board &lt;slug&gt; picks one</Text>
        )}
        {l && <Text dimColor>{`◇ ${l.state} · ${l.scope}${l.takenBy ? ` (taken by ${l.takenBy})` : ''} · ${age(Date.parse(l.at), Date.now())}`}</Text>}

        {head('Work tree', d?.tree)}
        {d?.tree.state === 'ok' && d.tree.data
          ? d.tree.data.nodes.map(node => (
              <Text key={`t${node.id}`} dimColor={node.status === 'done' || node.status === 'cancelled'}>
                {`${'  '.repeat(node.depth)}${node.current ? '▸ ' : '  '}`}
                <Link href={node.url}>{node.key}</Link>
                {` ${clip(node.title, cols - 24 - node.depth * 2)} [${node.status}]${node.children > 0 ? ` ${node.done}/${node.children}` : ''}${node.holders.length > 0 ? ` · ${node.holders.join(', ')}` : ''}${node.more ? ` +${node.more}` : ''}`}
              </Text>
            ))
          : null}

        {head('Brainstorms', d?.frontier)}
        {d?.frontier.state === 'ok' && d.frontier.data
          ? d.frontier.data.rows.map(b => {
              const c = decisionCounts(b)
              return (
                <Box key={`b${b.slug}`} flexDirection="column">
                  <Text>
                    {b.selected ? '◆ ' : b.related ? '◇ ' : '  '}
                    {clip(b.title, cols - 52)}
                    <Text dimColor>{` open ${c.open} · staged ${c.staged} · sent ${c.sent} · decided ${c.decided}`}</Text>
                  </Text>
                  <Box>
                    <Button key={`open-${b.slug}`} label="Open in Studio" onPress={() => void openLink($, b.href, b.title)} />
                    {!b.selected && <Button key={`pick-${b.slug}`} label="Select" onPress={() => void pick($, b.slug)} />}
                  </Box>
                  {b.selected &&
                    b.decisions
                      .filter(x => x.state !== 'decided' || x.delivery === 'sent')
                      .slice(0, 6)
                      .map(x => (
                        <Text key={`d${b.slug}${x.key}${x.title}`} dimColor>
                          {'    '}
                          <Link href={x.url}>{x.key || '·'}</Link>
                          {` ${clip(x.title, cols - 24)} — ${x.delivery ?? x.state}`}
                        </Text>
                      ))}
                </Box>
              )
            })
          : null}

        {head(`Needs you (${n.needsYou})`, d?.needsYou)}
        {d?.needsYou.state === 'ok' && d.needsYou.data
          ? d.needsYou.data.items.map(x => (
              <Text key={`n${x.id}`}>
                {x.overdue ? '! ' : '  '}
                <Link href={x.url}>{x.verb}</Link>
                {` ${clip(x.ask, cols - 16)}`}
              </Text>
            ))
          : null}

        {head(`Ready for this session (${n.ready})`, d?.ready)}
        {d?.ready.state === 'ok' && d.ready.data
          ? d.ready.data.items.map(x => <Text key={`r${x.intent}${x.id}`}>{`  №${x.id} ${x.intent} ${clip(x.prompt, cols - 20)}`}</Text>)
          : null}

        {head('Sprint · todos · PRs')}
        {d?.sprint.state === 'ok' && d.sprint.data ? (
          <Text>{`  sprint: ${d.sprint.data.mode}${d.sprint.data.sprintId ? ` #${d.sprint.data.sprintId}` : ''}`}</Text>
        ) : (
          d && why(d.sprint)
        )}
        {d?.todos.state === 'ok' && d.todos.data
          ? d.todos.data.items.map(t => (
              <Text key={`o${t.id}`}>
                {'  ☐ '}
                <Link href={t.url}>{clip(t.title, cols - 20)}</Link>
                <Text dimColor>{` ${t.why}`}</Text>
              </Text>
            ))
          : d && why(d.todos)}
        {d?.prs.state === 'ok' && d.prs.data
          ? d.prs.data.items.map(pr => (
              <Text key={`p${pr.ref}`}>
                {'  '}
                {pr.url ? <Link href={pr.url}>{pr.ref}</Link> : pr.ref}
                {` ${pr.state ?? ''}${pr.checks ? ` ✓${pr.checks.pass} ✗${pr.checks.fail} …${pr.checks.pending}` : ''} ${clip(pr.title ?? '', cols - 40)}`}
              </Text>
            ))
          : d && why(d.prs)}
      </Box>
    )
  })

  // The hand-back folds to its first line with Raw beside it: the stored
  // result and what the model read stay exactly as the server sent them.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!/__hand_back$/.test(e.props.tool) || e.props.isErrored) return next(e)
    const text = handBackText(e.props.output)
    if (text === null) return next(e)
    const id = e.props.tool_use_id
    const open = (await read($, expanded)).includes(id)
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const first = text.split('\n').find(line => line.trim() !== '') ?? 'Handed back'
    return (
      <Box flexDirection="column">
        <Box>
          <Text>{clip(first.replace(/^#+\s*/, ''), Math.max(20, (e.viewport?.columns ?? 100) - 12))} </Text>
          <Button
            key={`raw-${id}`}
            label={open ? 'Fold' : 'Raw'}
            onPress={() => {
              void count($, open ? 'fold' : 'raw')
              void update($, expanded, ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id].slice(-50)))
            }}
          />
        </Box>
        {open && <Markdown key={`md-${id}`} text={text} />}
      </Box>
    )
  })
}
