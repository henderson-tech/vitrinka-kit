/**
 * The test round this browser is in (recorder report mode, vt-3094): one
 * person's reports from one sitting on one site, grouped in vitrinka. The
 * first report opens a round and vitrinka hands back its token; every later
 * report sends the token and joins the round while it stands. vitrinka
 * decides when a round is over (the reporter ended it, or it was quiet too
 * long): the report then opens a new one and `rotated` says so. This module
 * only keeps the token.
 *
 * Kept in the recorder storage (localStorage: every tab of the site shares
 * it, a reload keeps it) under ONE key, per vitrinka and report key, so two
 * widgets for two projects on a page never share a round.
 */
import { api, type ApiTarget, VitrinkaApiError } from '../recorder/api';
import { getRecorderStorage } from '../recorder/storage';

export const ROUND_STORAGE_KEY = 'report.round';

/** A round as this browser knows it. */
export interface HeldRound {
  token: string;
  /** How many reports it held when vitrinka last answered. */
  reports: number;
  /** When it opened (RFC 3339), '' when vitrinka did not say. */
  openedAt: string;
}

type Held = Record<string, HeldRound>;

const scope = (t: ApiTarget): string => `${t.url}|${t.key}`;

/** What the store holds, entry by entry as stored: whatever another script or version wrote there, so nothing is trusted. */
function readAll(): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(getRecorderStorage().getString(ROUND_STORAGE_KEY) ?? '{}');
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Storage can refuse a write long after it took the first (a full quota, a
 * browser that withdrew it): a round then simply is not kept — the report
 * that was just filed never fails for it, and the next one opens a new round.
 */
function writeAll(all: Record<string, unknown>): void {
  try {
    const s = getRecorderStorage();
    if (Object.keys(all).length) s.set(ROUND_STORAGE_KEY, JSON.stringify(all));
    else s.remove(ROUND_STORAGE_KEY);
  } catch (e) {
    console.warn('vitrinka: the test round could not be kept in this browser — the next report opens a new one', e);
  }
}

/** One stored entry as a round, field by field; null for anything that is not one. */
function heldOf(v: unknown): HeldRound | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.token !== 'string' || !r.token) return null;
  return {
    token: r.token,
    reports: typeof r.reports === 'number' && Number.isFinite(r.reports) && r.reports > 0 ? Math.floor(r.reports) : 0,
    openedAt: typeof r.openedAt === 'string' ? r.openedAt : '',
  };
}

/** The round held for this vitrinka and key; null on a first report. */
export function roundFor(target: ApiTarget): HeldRound | null {
  return heldOf(readAll()[scope(target)]);
}

/** Forget the round (it ended, or vitrinka no longer knows it). */
export function forgetRound(target: ApiTarget): void {
  const all = readAll();
  if (!(scope(target) in all)) return;
  delete all[scope(target)];
  writeAll(all);
}

/** Forget `token`'s round only while it is still the one held: another tab may have been handed a new one since. */
function forgetToken(target: ApiTarget, token: string): void {
  if (roundFor(target)?.token === token) forgetRound(target);
}

/**
 * Keep what a create answered as `round` ({token, reports?, openedAt?,
 * rotated?}); anything else leaves the held round as it is. Returns the
 * round now held and whether vitrinka opened a new one in place of the
 * token sent.
 */
export function keepRound(target: ApiTarget, reply: unknown): { round: HeldRound; rotated: boolean } | null {
  if (typeof reply !== 'object' || reply === null) return null;
  const r = reply as Record<string, unknown>;
  if (typeof r.token !== 'string' || !r.token) return null;
  const round: HeldRound = {
    token: r.token,
    reports: typeof r.reports === 'number' && Number.isFinite(r.reports) && r.reports > 0 ? Math.floor(r.reports) : 1,
    openedAt: typeof r.openedAt === 'string' ? r.openedAt : '',
  };
  const all = readAll();
  all[scope(target)] = round;
  writeAll(all);
  return { round, rotated: r.rotated === true };
}

/**
 * End the round this browser holds: vitrinka closes it and the next report
 * opens a new one. The token is forgotten once vitrinka ended the round or
 * no longer knows it; a failure it may recover from (offline, a 5xx) keeps
 * the token and rejects, so End can be pressed again. Only the round the
 * request named is forgotten: a new one another tab was handed meanwhile
 * stays. False when there was no round to end.
 */
export async function endRound(target: ApiTarget, signal?: AbortSignal): Promise<boolean> {
  const held = roundFor(target);
  if (!held) return false;
  try {
    await api('POST', '/api/v1/report/round/end', { round: held.token }, { target, signal });
  } catch (e) {
    // 404: vitrinka knows no such round (or predates rounds) — nothing left to end.
    if (!(e instanceof VitrinkaApiError) || e.status !== 404) throw e;
  }
  forgetToken(target, held.token);
  return true;
}
