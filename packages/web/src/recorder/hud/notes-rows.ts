/**
 * The notes sheet's rows (recorder HUD polish D5/D12), derived from the live
 * recording's note log: ONE row per original note, its edits (`replaces`
 * chains) folded in as versions — the board island's list grammar
 * (№ · kind · age, text, a state dot). Pure, so it is tested without a DOM.
 */
import type { HudNote } from './controller';

export type NoteFilter = 'all' | 'regions' | 'notes';

/** One version of a note's text: the original, then each edit. */
export interface NoteVersion {
  cid: string;
  text: string;
  at: number;
}

export interface NoteRow {
  /** The original note's cid — what an edit's chain and a reference resolve to. */
  cid: string;
  /** The newest version's cid — what the next edit replaces. */
  latestCid: string;
  /** 1-based, in capture order, like the board's №. */
  number: number;
  region: boolean;
  /** The newest version's text. */
  text: string;
  versions: readonly NoteVersion[];
  /** When the original was captured (epoch ms). */
  at: number;
  route: string;
  w?: number;
  h?: number;
  /** Not yet acknowledged by the server: its newest version is still queued. */
  queued: boolean;
  refs: readonly string[];
}

/** Rows newest first; `pending` = the cids the queue still holds. */
export function noteRows(notes: readonly HudNote[], pending: readonly string[] = []): NoteRow[] {
  const root = new Map<string, NoteRow>();
  const rows: NoteRow[] = [];
  for (const n of [...notes].sort((a, b) => a.at - b.at)) {
    const original = n.replaces ? root.get(n.replaces) : undefined;
    if (original) {
      original.versions = [...original.versions, { cid: n.cid, text: n.text, at: n.at }];
      original.latestCid = n.cid;
      original.text = n.text;
      root.set(n.cid, original);
      continue;
    }
    const row: NoteRow = {
      cid: n.cid,
      latestCid: n.cid,
      number: rows.length + 1,
      region: n.region,
      text: n.text,
      versions: [{ cid: n.cid, text: n.text, at: n.at }],
      at: n.at,
      route: n.route,
      ...(n.w !== undefined ? { w: n.w } : {}),
      ...(n.h !== undefined ? { h: n.h } : {}),
      queued: false,
      refs: n.refs ?? [],
    };
    root.set(n.cid, row);
    rows.push(row);
  }
  const waiting = new Set(pending);
  for (const r of rows) r.queued = waiting.has(r.latestCid);
  return rows.reverse();
}

export function filterRows(rows: readonly NoteRow[], filter: NoteFilter): NoteRow[] {
  if (filter === 'all') return [...rows];
  return rows.filter((r) => (filter === 'regions' ? r.region : !r.region));
}

/** The row `step` away from `cid` in `rows` (clamped); the first row when none is focused. */
export function walkRows(rows: readonly NoteRow[], cid: string | null, step: 1 | -1): string | null {
  if (rows.length === 0) return null;
  const i = rows.findIndex((r) => r.cid === cid);
  if (i < 0) return rows[0]!.cid;
  return rows[Math.min(rows.length - 1, Math.max(0, i + step))]!.cid;
}
