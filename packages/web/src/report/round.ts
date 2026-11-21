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

function readAll(): Held {
  try {
    const v: unknown = JSON.parse(getRecorderStorage().getString(ROUND_STORAGE_KEY) ?? '{}');
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Held) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Held): void {
  const s = getRecorderStorage();
  if (Object.keys(all).length) s.set(ROUND_STORAGE_KEY, JSON.stringify(all));
  else s.remove(ROUND_STORAGE_KEY);
}

/** The round held for this vitrinka and key; null on a first report. */
export function roundFor(target: ApiTarget): HeldRound | null {
  const r = readAll()[scope(target)];
  return r && typeof r.token === 'string' && r.token ? { token: r.token, reports: Number(r.reports) || 0, openedAt: typeof r.openedAt === 'string' ? r.openedAt : '' } : null;
}

/** Forget the round (it ended, or vitrinka no longer knows it). */
export function forgetRound(target: ApiTarget): void {
  const all = readAll();
  if (!(scope(target) in all)) return;
  delete all[scope(target)];
  writeAll(all);
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
    reports: typeof r.reports === 'number' && r.reports > 0 ? Math.floor(r.reports) : 1,
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
 * the token and rejects, so End can be pressed again. False when there was
 * no round to end.
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
  forgetRound(target);
  return true;
}
