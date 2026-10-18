/**
 * What this browser sent (vt-8020 D4): an anonymous or unsigned reporter has
 * no server list to read, so the widget keeps its own — title, time, filed or
 * waiting, and the story link when the server minted one. Scoped to the
 * vitrinka base and the page's host, newest first, capped.
 */
export interface SentReport {
  title: string;
  /** Epoch ms. */
  at: number;
  status: 'filed' | 'quarantined';
  url?: string;
}

export const MAX_SENT = 20;
const PREFIX = 'vitrinka.report.sent:';

function keyOf(base: string, host: string): string {
  return `${PREFIX}${base}|${host}`;
}

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage blocked (sandboxed frame, privacy mode): the list just stays empty
  }
}

export function readSent(base: string, host: string): SentReport[] {
  const raw = store()?.getItem(keyOf(base, host));
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows.filter((r): r is SentReport => typeof r?.title === 'string' && typeof r?.at === 'number' && (r.status === 'filed' || r.status === 'quarantined'));
  } catch {
    return [];
  }
}

export function noteSent(base: string, host: string, row: SentReport): void {
  const s = store();
  if (!s) return;
  const rows = [row, ...readSent(base, host)].slice(0, MAX_SENT);
  try {
    s.setItem(keyOf(base, host), JSON.stringify(rows));
  } catch (e) {
    console.warn('vitrinka: could not remember the sent report on this browser', e);
  }
}
