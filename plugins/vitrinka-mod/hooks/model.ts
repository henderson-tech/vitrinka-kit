// The mod's pure half: what the footer draws, how /vt reads, what the pane
// counts. No $ here, so a test holds every rule without a surface.
import type { Brainstorm, Dashboard, Focus, Lease, Strip } from '../types'

/** The files the CLI writes per session, in the order the hook watches them. */
export const FILES = ['strip.json', 'listening.json', 'focus.json'] as const
export type FileName = (typeof FILES)[number]

/**
 * The session directory, by the CLI's own rule (config.Dir): XDG_CONFIG_HOME's
 * vitrinka directory, else the home's .config/vitrinka.
 */
export function sessionDir(env: { xdg?: string; home?: string }, session: string): string | null {
  const root = env.xdg ? `${env.xdg}/vitrinka` : env.home ? `${env.home}/.config/vitrinka` : null
  return root === null ? null : `${root}/sessions/${session}`
}

/** Which of the session's files a changed path is, or null. */
export function fileOf(path: string, session: string): FileName | null {
  for (const name of FILES) {
    if (path.endsWith(`/sessions/${session}/${name}`)) return name
  }
  return null
}

/** One footer chip: a glyph, its words and the server's own link. */
export type Slot = { kind: 'board' | 'epic' | 'task' | 'health'; glyph: string; label: string; url?: string; warn?: boolean }

const TITLE_MIN = 12

/** A label clipped to n characters, an ellipsis marking the cut. */
export function clip(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, Math.max(1, n - 1))}…`
}

/**
 * The compass: ◆ the selected board (◇ the listening one when none is
 * selected), ▲ the epic, ● the task. A strip that is not ok draws its health
 * instead, unless the checkout is simply unbound. Narrow footers clip titles
 * first, then drop the epic, then the board; the task goes last.
 */
export function compass(s: { strip: Strip | null; focus: Focus | null; lease: Lease | null }, columns: number): Slot[] {
  const { strip, focus, lease } = s
  if (strip === null || strip.state === 'unbound') return []
  if (strip.state !== 'ok') {
    return [{ kind: 'health', glyph: '○', label: `vitrinka ${strip.state.replace('_', ' ')} · ${strip.fix ?? 'vitrinka doctor'}`, warn: true }]
  }
  const slots: Slot[] = []
  if (focus?.board) {
    slots.push({ kind: 'board', glyph: '◆', label: focus.board.title || focus.board.slug, url: focus.board.url, warn: focus.declared !== undefined })
  } else if (lease?.state === 'listening' && lease.board) {
    slots.push({ kind: 'board', glyph: '◇', label: lease.board })
  }
  const epic = strip.epic ?? (strip.task?.type === 'epic' ? strip.task : null)
  if (epic) slots.push({ kind: 'epic', glyph: '▲', label: `${epic.key} ${epic.title}`, url: epic.url })
  if (strip.task && strip.task !== epic) slots.push({ kind: 'task', glyph: '●', label: `${strip.task.key} ${strip.task.title}`, url: strip.task.url })
  return fit(slots, Math.max(24, Math.floor(columns * 0.5)))
}

const width = (slots: Slot[]) => slots.reduce((n, s) => n + s.glyph.length + 1 + s.label.length + (s.warn ? 2 : 0), 0) + Math.max(0, slots.length - 1) * 3

function fit(slots: Slot[], budget: number): Slot[] {
  let out = slots
  for (let room = 40; width(out) > budget && room >= TITLE_MIN; room -= 4) {
    out = slots.map(s => ({ ...s, label: clip(s.label, room) }))
  }
  for (const drop of ['epic', 'board'] as const) {
    if (width(out) <= budget) break
    out = out.filter(s => s.kind !== drop)
  }
  return out
}

/** A /vt invocation. */
export type Vt =
  | { verb: 'pane' }
  | { verb: 'open' | 'copy'; target: 'task' | 'epic' | 'board' }
  | { verb: 'pick'; board: string }
  | { verb: 'clear' }
  | { verb: 'refresh' }
  | { verb: 'help'; why?: string }

const TARGETS = ['task', 'epic', 'board'] as const

/** Reads `/vt [task|epic|board] | copy <slot> | board <slug|url> | board clear | refresh`. */
export function parseVt(args: string): Vt {
  const [first = '', second = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (rest.length > 0) return { verb: 'help', why: `too many words: ${args.trim()}` }
  if (first === '') return { verb: 'pane' }
  if (first === 'refresh' && second === '') return { verb: 'refresh' }
  if (first === 'copy') {
    const target = TARGETS.find(t => t === second)
    return target ? { verb: 'copy', target } : { verb: 'help', why: 'copy takes task, epic or board' }
  }
  if (first === 'board' && second === 'clear') return { verb: 'clear' }
  if (first === 'board' && second !== '') return { verb: 'pick', board: second }
  const target = TARGETS.find(t => t === first)
  if (target && second === '') return { verb: 'open', target }
  return { verb: 'help', why: `no /vt ${args.trim()}` }
}

export const VT_USAGE = '/vt · /vt task|epic|board · /vt copy task|epic|board · /vt board <slug|url> · /vt board clear · /vt refresh'

/** The server's link for a slot, never composed. */
export function linkOf(s: { strip: Strip | null; focus: Focus | null }, target: 'task' | 'epic' | 'board'): { url: string; label: string } | null {
  const strip = s.strip?.state === 'ok' ? s.strip : null
  if (target === 'board') return s.focus?.board ? { url: s.focus.board.url, label: s.focus.board.title || s.focus.board.slug } : null
  const epic = strip?.epic ?? (strip?.task?.type === 'epic' ? strip.task : null)
  const t = target === 'epic' ? epic : strip?.task
  return t ? { url: t.url, label: t.key } : null
}

/**
 * A brainstorm's questions as the frontier counts them: open, staged (picked,
 * not yet sent), sent (released, the listener has not drained it) and decided.
 * The server's tallies are whole; its decision list is capped, so it never
 * counts.
 */
export function decisionCounts(b: Brainstorm): { open: number; staged: number; sent: number; decided: number } {
  const { open, staged, answered, sent } = b.counts
  return { open, staged, sent, decided: Math.max(0, answered - sent) }
}

/**
 * The two inbox lanes, never merged: Needs you is the person's move (their
 * gates, asks, plans), Ready is released agent work on the listening board. A
 * staged brainstorm pick is in neither: Studio owns it until it is sent.
 */
export function lanes(d: Dashboard | null): { needsYou: number; ready: number } {
  return {
    needsYou: d?.needsYou.state === 'ok' ? (d.needsYou.data?.total ?? 0) : 0,
    ready: d?.ready.state === 'ok' ? (d.ready.data?.total ?? 0) : 0,
  }
}

/** How old a read is, as the pane says it. */
export function age(at: number, now: number): string {
  if (at === 0) return 'not read yet'
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  const t = new Date(at)
  return `as of ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}

/** The hand-back's rendered block, from the MCP reply the tool returned. */
export function handBackText(output: unknown): string | null {
  const text = (v: unknown): string | null => {
    if (typeof v === 'string') return v
    if (Array.isArray(v)) {
      for (const b of v) {
        if (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string') return b.text
      }
    }
    if (v && typeof v === 'object' && 'content' in v) return text(v.content)
    return null
  }
  const raw = text(output)
  if (raw === null) return null
  try {
    const reply: unknown = JSON.parse(raw)
    if (reply && typeof reply === 'object' && 'rendered' in reply && typeof reply.rendered === 'string') return reply.rendered
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err
  }
  return raw
}
