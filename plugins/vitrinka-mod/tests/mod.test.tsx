import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Dashboard, Focus, Strip } from '../types'
import { compass, decisionCounts, lanes, linkOf, parseVt } from '../hooks/model'

const SESSION = 's-1'
const DIR = `/home/me/.config/vitrinka/sessions/${SESSION}`

const strip: Strip = {
  v: 1, session: SESSION, at: '2026-10-22T10:00:00Z', state: 'ok', project: 'vitrinka', branch: 'feat/vt-8463-x',
  task: { id: 8463, key: 'VIT-8463', title: 'Wire the compass', type: 'task', status: 'in_progress', url: 'https://app.vitrinka.ai/w/fixit/p/vitrinka/t/8463' },
  epic: { id: 8462, key: 'VIT-8462', title: 'Vitrinka mod for Claude Code', type: 'epic', status: 'backlog', url: 'https://app.vitrinka.ai/w/fixit/p/vitrinka/t/8462' },
  related: [],
}
const focus: Focus = {
  v: 1, session: SESSION, at: '2026-10-22T10:01:00Z', source: 'pick', previous: null,
  board: { slug: 'vitrinka-brainstorm-mod', title: 'Mod brainstorm', kind: 'brainstorm', url: 'https://app.vitrinka.ai/w/fixit/brainstorms/vitrinka-brainstorm-mod' },
}

/** The CLI's files and process, answered beneath the plugin. */
function world(on: On, files: Record<string, unknown>, runs: string[][] = [], toasts: string[] = []) {
  mock.env(on, { HOME: '/home/me' })
  mock.store(on)
  on('classic.SessionStart', () => ({}))
  on('session.id', () => ({ value: SESSION }))
  on('fs.stat', ($, e) => {
    const name = e.path.slice(DIR.length + 1)
    if (!(name in files)) return { deny: `ENOENT: no such file ${e.path}` }
    return { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }
  })
  on('fs.read', ($, e) => {
    const name = e.path.slice(DIR.length + 1)
    if (!(name in files)) return { deny: `ENOENT: no such file ${e.path}` }
    return { value: JSON.stringify(files[name]) }
  })
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, data: { url: e.argv[3], opened: true } }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
}

test('the compass draws the board, epic and task, and drops the epic then the board when narrow', () => {
  const wide = compass({ strip, focus, lease: null }, 200)
  expect(wide.map(s => s.kind)).toEqual(['board', 'epic', 'task'])
  expect(wide.map(s => s.url)).toEqual([focus.board!.url, strip.epic!.url, strip.task!.url])
  expect(compass({ strip, focus, lease: null }, 70).map(s => s.kind)).toEqual(['board', 'task'])
  expect(compass({ strip, focus, lease: null }, 40).map(s => s.kind)).toEqual(['task'])
  expect(compass({ strip: { ...strip, state: 'unbound', task: null, epic: null }, focus, lease: null }, 200)).toEqual([])
  const out = compass({ strip: { ...strip, state: 'signed_out', fix: 'vitrinka auth login' }, focus, lease: null }, 200)
  expect(out.map(s => [s.kind, s.label])).toEqual([['health', 'vitrinka signed out · vitrinka auth login']])
})

test('a link is the strip\'s own url, byte for byte, and a missing slot has none', () => {
  expect(linkOf({ strip, focus }, 'epic')).toEqual({ url: strip.epic!.url, label: 'VIT-8462' })
  expect(linkOf({ strip, focus }, 'board')?.url).toBe(focus.board!.url)
  expect(linkOf({ strip, focus: null }, 'board')).toBeNull()
})

test('/vt reads its verbs and names what it does not know', () => {
  expect(parseVt('')).toEqual({ verb: 'pane' })
  expect(parseVt('epic')).toEqual({ verb: 'open', target: 'epic' })
  expect(parseVt('copy task')).toEqual({ verb: 'copy', target: 'task' })
  expect(parseVt('board my-brainstorm')).toEqual({ verb: 'pick', board: 'my-brainstorm' })
  expect(parseVt('board clear')).toEqual({ verb: 'clear' })
  expect(parseVt('frobnicate').verb).toBe('help')
})

test('the two lanes never merge, and a staged pick is in neither', () => {
  const d = {
    needsYou: { state: 'ok', data: { items: [], total: 3 } },
    ready: { state: 'ok', data: { board: 'b', items: [], total: 2 } },
  } as unknown as Dashboard
  expect(lanes(d)).toEqual({ needsYou: 3, ready: 2 })
  expect(lanes({ ...d, ready: { state: 'skipped', reason: 'no board' } } as Dashboard)).toEqual({ needsYou: 3, ready: 0 })
  const counts = decisionCounts({
    slug: 'b', title: 'B', href: '', status: 'active', attention: 'waiting', epic: null, lease: null,
    counts: { open: 3, staged: 1, answered: 5, total: 9, sent: 2 },
    decisions: [
      { key: 'D1', title: 'a', state: 'open', url: '' },
      { key: 'D2', title: 'b', state: 'staged', url: '' },
      { key: 'D3', title: 'c', state: 'decided', delivery: 'sent', url: '' },
      { key: 'D4', title: 'd', state: 'decided', delivery: 'delivered', url: '' },
    ],
  })
  // The list is capped (four of nine shown); the tallies are whole.
  expect(counts).toEqual({ open: 3, staged: 1, sent: 2, decided: 3 })
})

test('the footer keeps the engine\'s modes and links each chip to the strip\'s url', async ($, on) => {
  world(on, { 'strip.json': strip, 'focus.json': { ...focus, declared: { slug: 'other', title: 'Other', url: 'https://app.vitrinka.ai/w/fixit/brainstorms/other' } } })
  // The engine's own mode labels, beneath the mod.
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.modes.join(' & ')}</Text>
  })
  await $.classic.SessionStart({ source: 'startup' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'vitrinka-mod', surface, component: 'SessionMode', props: { modes: ['focus'] } })
    expect(await ui.find({ type: 'Link', text: /VIT-8462/ })).toMatchObject({ props: { href: strip.epic!.url } })
    expect(await ui.find({ type: 'Link', text: /VIT-8463/ })).toMatchObject({ props: { href: strip.task!.url } })
    expect(await ui.find({ text: /⚠/ })).toBeDefined()
    expect(await ui.find({ text: /focus/ })).toBeDefined()
  }
})

test('/vt epic opens the strip\'s url through the CLI and leaves the transcript nothing', async ($, on) => {
  const runs: string[][] = []
  const toasts: string[] = []
  world(on, { 'strip.json': strip }, runs, toasts)
  await $.classic.SessionStart({ source: 'startup' })
  const result = await $.command.run({ command: 'vt', args: 'epic', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(result.text).toBeUndefined()
  expect(runs).toEqual([['vitrinka', 'board', 'open', strip.epic!.url, '--json']])
  expect(toasts).toEqual(['opened VIT-8462'])
})

test('a hand-back draws folded with Raw, and Raw unfolds the whole block', async ($, on) => {
  world(on, {})
  const rendered = 'Handed back #8463 · in_review\n\nNext steps\n1. Review the PR'
  const props = { tool_use_id: 'tu-1', tool: 'mcp__vitrinka__hand_back', isErrored: false, output: [{ type: 'text', text: JSON.stringify({ rendered }) }] }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'vitrinka-mod', surface, component: 'ToolResult', props })
    expect(await ui.find({ text: /Handed back #8463/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.press({ key: 'raw-tu-1' })
    expect(await ui.find({ type: 'Markdown' })).toMatchObject({ props: { text: rendered } })
    await ui.press({ key: 'raw-tu-1' })
  }
})
