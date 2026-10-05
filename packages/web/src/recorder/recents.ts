/**
 * The device's last five recordings (`recents` in the recorder storage),
 * newest first. The session lifecycle writes them (start → recording, stop →
 * saved with the board link and duration, a local end → unsaved); the HUD's
 * menu lists them. A recorder token cannot LIST sessions, only read its own by
 * id, so a recent without a board link is refreshed through that reconcile
 * read (`GET /api/v1/sessions/:id`).
 */
import type { HudRecent, HudRecentStatus } from './hud/controller';
import { api, permanentStatus, VitrinkaApiError } from './api';
import { notify } from './state';
import { getRecorderStorage } from './storage';

export const RECENTS_KEY = 'recents';
export const MAX_RECENTS = 5;

const STATUSES: readonly HudRecentStatus[] = ['recording', 'saved', 'unsaved', 'deleted'];

function valid(r: unknown): r is HudRecent {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.sessionId === 'string' &&
    typeof o.title === 'string' &&
    typeof o.startedAt === 'number' &&
    STATUSES.includes(o.status as HudRecentStatus)
  );
}

let cache: HudRecent[] | undefined;

export function readRecents(): readonly HudRecent[] {
  if (cache === undefined) {
    try {
      const raw = JSON.parse(getRecorderStorage().getString(RECENTS_KEY) ?? '[]') as unknown;
      cache = Array.isArray(raw) ? raw.filter(valid).slice(0, MAX_RECENTS) : [];
    } catch {
      cache = [];
    }
  }
  return cache;
}

function write(list: HudRecent[]): void {
  cache = list.slice(0, MAX_RECENTS);
  try {
    getRecorderStorage().set(RECENTS_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('vitrinka: could not store recent recordings', e);
  }
  notify();
}

/** Add (or move to the front) a recording. */
export function noteRecent(entry: HudRecent): void {
  write([entry, ...readRecents().filter((r) => r.sessionId !== entry.sessionId)]);
}

/** Patch a recording in place; a no-op for one not listed. */
export function updateRecent(sessionId: string, patch: Partial<Omit<HudRecent, 'sessionId'>>): void {
  const list = readRecents();
  if (!list.some((r) => r.sessionId === sessionId)) return;
  write(list.map((r) => (r.sessionId === sessionId ? { ...r, ...patch } : r)));
}

/** What the reconcile read answers (the fields a recent can use). */
interface SessionRead {
  status?: string;
  deletedAt?: string | null;
  boardUrl?: string;
  board?: { url?: string };
  projection?: { state?: string };
}

/** A session answer's board link: the server's `boardUrl`, or an older server's `board.url`. */
export function boardUrlOf(s: Pick<SessionRead, 'boardUrl' | 'board'> | null | undefined): string | undefined {
  return s?.boardUrl || s?.board?.url || undefined;
}

/** How often, and how long, a saved session is read until its board exists (the extension's D11 numbers). */
export const BOARD_POLL_MS = 1_500;
export const BOARD_WAIT_MS = 10 * 60_000;

const awaiting = new Set<string>();

/**
 * The server answered a stop (or a report) before the session's board was
 * built — it projects after the stop, stills first, 30–60 s. Read the
 * session until it names its board and put the link on the recent, where
 * the Saved face and the menu pick it up. Ends on a failed or empty
 * projection, a gone or refused session, or after `forMs`; a transient
 * error keeps waiting. Never rejects.
 */
export async function awaitBoard(
  sessionId: string,
  { everyMs = BOARD_POLL_MS, forMs = BOARD_WAIT_MS }: { everyMs?: number; forMs?: number } = {},
): Promise<void> {
  if (awaiting.has(sessionId)) return;
  awaiting.add(sessionId);
  const until = Date.now() + forMs;
  try {
    while (Date.now() < until) {
      await new Promise<void>((res) => setTimeout(res, everyMs));
      try {
        const s = await api<SessionRead>('GET', `/api/v1/sessions/${sessionId}`);
        const boardUrl = boardUrlOf(s);
        if (boardUrl) return updateRecent(sessionId, { boardUrl });
        if (s.deletedAt) return updateRecent(sessionId, { status: 'deleted' });
        if (s.projection?.state === 'failed' || s.projection?.state === 'empty') return;
      } catch (e) {
        if (e instanceof VitrinkaApiError && e.status === 404) return updateRecent(sessionId, { status: 'deleted' });
        if (e instanceof VitrinkaApiError && permanentStatus(e.status)) return;
        console.warn(`vitrinka: waiting for the board of session ${sessionId}`, e);
      }
    }
  } finally {
    awaiting.delete(sessionId);
  }
}

/** Ids already asked this document — a refused read is not retried on every menu open. */
const asked = new Set<string>();

/**
 * Fill the board links the list lacks — `live` (the recording in progress)
 * is skipped, its link arrives with its stop. Never rejects.
 */
export async function refreshRecents(live: string | null): Promise<void> {
  const missing = readRecents().filter(
    (r) => !r.boardUrl && r.status !== 'deleted' && r.sessionId !== live && !asked.has(r.sessionId),
  );
  for (const r of missing) {
    asked.add(r.sessionId);
    try {
      const s = await api<SessionRead>('GET', `/api/v1/sessions/${r.sessionId}`);
      const boardUrl = boardUrlOf(s);
      if (s.deletedAt) updateRecent(r.sessionId, { status: 'deleted' });
      else if (boardUrl) updateRecent(r.sessionId, { boardUrl, ...(s.status === 'done' ? { status: 'saved' as const } : {}) });
      // Still projecting (the document that waited for it reloaded or left): wait here instead.
      else if (s.projection?.state === 'running') void awaitBoard(r.sessionId);
    } catch (e) {
      if (e instanceof VitrinkaApiError && e.status === 404) updateRecent(r.sessionId, { status: 'deleted' });
      else console.warn(`vitrinka: could not refresh recent session ${r.sessionId}`, e);
    }
  }
}

/** Another tab wrote the list (its stop saved a recording): read it afresh. */
export function forgetRecents(): void {
  cache = undefined;
  notify();
}

/** Test-only: forget the in-memory list (storage stays). */
export function __resetRecentsForTests(): void {
  cache = undefined;
  asked.clear();
  awaiting.clear();
}
