/**
 * Who the token belongs to, and the HUD preferences that follow the user.
 *
 *   GET   /api/v1/recorder/me  → {kind, workspace, user, project, label, prefs}
 *   PATCH /api/v1/recorder/me    {prefs: {size?, verbose?}} → the same envelope
 *   PATCH /api/v1/recorder/me    {prefs: {sheetW?, sheetH?}} → the same envelope
 *
 * Prefs live in the recorder storage first (`prefs`): the first paint, an
 * offline page and a key build (`prefs: null`, PATCH answers 409) all read the
 * local copy. A linked device's server prefs win whenever `/me` answers. A 404
 * or a network error means a server too old for the route or an offline one:
 * the local copy stands, said once. A 401 keeps the session doors' semantics
 * (api.ts forgets the link).
 *
 * The sheet size (`sheetW`/`sheetH`, CSS px 0..1600, 0 = the HUD's default)
 * rides its OWN PATCH. A server that predates it answers that one 422: the
 * size then stays on this device for the document's lifetime (never asked
 * again, never an error to show), and an answer without the fields never
 * resets the local size — size/verbose sync as before.
 */
import { DEFAULT_PREFS, type HudAccount, type HudPrefs, type HudSize } from './hud/controller';
import { api, VitrinkaApiError } from './api';
import { vitrinkaLinked } from './config';
import { notify } from './state';
import { getRecorderStorage } from './storage';

const PREFS_KEY = 'prefs';
const ME_KEY = 'me';
const SIZES: readonly HudSize[] = ['sm', 'md', 'lg'];
/** The largest sheet size the server stores. */
const SHEET_PX_MAX = 1600;

/** The `/recorder/me` envelope. */
export interface RecorderMe extends HudAccount {
  prefs: HudPrefs | null;
}

/** A sheet size: a finite number ≥ 0 (within what the server stores), else 0 = the default. */
function sheetPx(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, SHEET_PX_MAX) : 0;
}

function parsePrefs(raw: unknown): HudPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    size: SIZES.includes(o.size as HudSize) ? (o.size as HudSize) : DEFAULT_PREFS.size,
    verbose: typeof o.verbose === 'boolean' ? o.verbose : DEFAULT_PREFS.verbose,
    sheetW: sheetPx(o.sheetW),
    sheetH: sheetPx(o.sheetH),
  };
}

function readJson(key: string): unknown {
  const raw = getRecorderStorage().getString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    getRecorderStorage().set(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`vitrinka: could not store ${key}`, e);
  }
}

let prefsCache: HudPrefs | undefined;
let meCache: HudAccount | null | undefined;

/** The local prefs (defaults when never set). */
export function cachedPrefs(): HudPrefs {
  if (prefsCache === undefined) prefsCache = parsePrefs(readJson(PREFS_KEY)) ?? DEFAULT_PREFS;
  return prefsCache;
}

function storePrefs(p: HudPrefs): void {
  prefsCache = p;
  write(PREFS_KEY, p);
}

/** The last account `/me` answered for this token (null when unknown). */
export function cachedAccount(): HudAccount | null {
  if (meCache === undefined) {
    const o = readJson(ME_KEY);
    meCache = o && typeof o === 'object' ? (o as HudAccount) : null;
  }
  return meCache;
}

/** Forget the account (unlink, 401); prefs stay with the device. */
export function clearAccount(): void {
  meCache = null;
  getRecorderStorage().remove(ME_KEY);
}

/** A 404 said the server predates the route: not asked again this document. */
let unavailable = false;
let warned = false;

/** 404 (route unknown) and transport failures mean "too old or offline", never an error to show. */
function soft(e: unknown): boolean {
  return !(e instanceof VitrinkaApiError) || e.status === 404;
}

function noteUnavailable(e: unknown): void {
  if (e instanceof VitrinkaApiError) unavailable = true;
  if (warned) return;
  warned = true;
  console.warn('vitrinka: /recorder/me unavailable — HUD prefs stay on this device', e);
}

/** A 422 to the sheet-size PATCH said the server predates it: kept local, not sent again this document. */
let sheetLocal = false;

/**
 * The server's prefs, keeping the local sheet size where the answer has none
 * (a server before sheetW/sheetH) or this document stopped sending it.
 */
function withLocalSheet(server: HudPrefs, raw: unknown): HudPrefs {
  const o = raw as Record<string, unknown>;
  const local = cachedPrefs();
  return {
    ...server,
    sheetW: !sheetLocal && typeof o.sheetW === 'number' ? server.sheetW : local.sheetW,
    sheetH: !sheetLocal && typeof o.sheetH === 'number' ? server.sheetH : local.sheetH,
  };
}

function isMe(o: unknown): o is RecorderMe {
  if (!o || typeof o !== 'object') return false;
  const m = o as Record<string, unknown>;
  const ws = m.workspace as Record<string, unknown> | null | undefined;
  return (m.kind === 'linked' || m.kind === 'key') && typeof ws?.slug === 'string' && typeof ws.name === 'string';
}

/**
 * Local edits so far. A response carries the count from when its request
 * left, and its prefs count only if no edit happened since: a menu GET that
 * overlaps a size change, or two PATCHes answering out of order, never
 * revert the newest choice. The account is always taken.
 */
let edits = 0;

function adopt(me: unknown, gen: number): HudAccount | null {
  if (!isMe(me)) {
    console.warn('vitrinka: /recorder/me answered an unexpected shape — ignored');
    return cachedAccount();
  }
  const account: HudAccount = {
    kind: me.kind,
    workspace: me.workspace,
    user: me.user,
    project: me.project,
    label: me.label,
  };
  meCache = account;
  write(ME_KEY, account);
  const server = parsePrefs(me.prefs);
  if (server && gen === edits) storePrefs(withLocalSheet(server, me.prefs));
  notify();
  return account;
}

/** Ask the server who this token is; null when unlinked, unavailable or refused. Never rejects. */
export async function fetchMe(): Promise<HudAccount | null> {
  if (!vitrinkaLinked() || unavailable) return cachedAccount();
  const gen = edits;
  try {
    return adopt(await api<unknown>('GET', '/api/v1/recorder/me'), gen);
  } catch (e) {
    if (soft(e)) noteUnavailable(e);
    else console.warn('vitrinka: /recorder/me failed', e);
    return cachedAccount();
  }
}

/**
 * Apply a prefs change locally at once (the HUD re-renders), then persist it
 * on the server for a linked device. A key build (409, or a cached `key`
 * account) and an unavailable server keep it local. Never rejects.
 */
export async function savePrefs(patch: Partial<HudPrefs>): Promise<HudPrefs> {
  const { sheetW, sheetH, ...hud } = patch;
  const sheet: Partial<HudPrefs> = {
    ...(sheetW === undefined ? {} : { sheetW: sheetPx(sheetW) }),
    ...(sheetH === undefined ? {} : { sheetH: sheetPx(sheetH) }),
  };
  const next = { ...cachedPrefs(), ...hud, ...sheet };
  storePrefs(next);
  const gen = ++edits;
  notify();
  if (!vitrinkaLinked() || unavailable || cachedAccount()?.kind === 'key') return next;
  // One PATCH per part: a server before the sheet size answers 422 for a body
  // naming it, which must never cost size/verbose their server copy.
  const parts = [hud, sheetLocal ? {} : sheet].filter((p) => Object.values(p).some((v) => v !== undefined));
  let answer: unknown;
  for (const prefs of parts) {
    try {
      answer = await api<unknown>('PATCH', '/api/v1/recorder/me', { prefs });
    } catch (e) {
      if (e instanceof VitrinkaApiError && e.status === 409) return next;
      if (prefs === sheet && e instanceof VitrinkaApiError && e.status === 422) {
        sheetLocal = true;
        console.warn('vitrinka: this server keeps no sheet size — it stays on this device', e);
        continue;
      }
      if (soft(e)) noteUnavailable(e);
      else console.warn('vitrinka: saving HUD prefs failed — kept on this device', e);
      break;
    }
  }
  if (answer !== undefined) adopt(answer, gen);
  return cachedPrefs();
}

/** Test-only: drop the caches and the unavailable latch. */
export function __resetMeForTests(): void {
  prefsCache = undefined;
  meCache = undefined;
  unavailable = false;
  warned = false;
  sheetLocal = false;
  edits = 0;
}
