/**
 * Who the token belongs to, and the HUD preferences that follow the user.
 *
 *   GET   /api/v1/recorder/me  → {kind, workspace, user, project, label, prefs}
 *   PATCH /api/v1/recorder/me    {prefs: {size?, verbose?}} → the same envelope
 *
 * Prefs live in the recorder storage first (`prefs`): the first paint, an
 * offline page and a key build (`prefs: null`, PATCH answers 409) all read the
 * local copy. A linked device's server prefs win whenever `/me` answers. A 404
 * or a network error means a server too old for the route or an offline one:
 * the local copy stands, said once. A 401 keeps the session doors' semantics
 * (api.ts forgets the link).
 */
import { DEFAULT_PREFS, type HudAccount, type HudPrefs, type HudSize } from './hud/controller';
import { api, VitrinkaApiError } from './api';
import { vitrinkaLinked } from './config';
import { notify } from './state';
import { getRecorderStorage } from './storage';

const PREFS_KEY = 'prefs';
const ME_KEY = 'me';
const SIZES: readonly HudSize[] = ['sm', 'md', 'lg'];

/** The `/recorder/me` envelope. */
export interface RecorderMe extends HudAccount {
  prefs: HudPrefs | null;
}

function parsePrefs(raw: unknown): HudPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    size: SIZES.includes(o.size as HudSize) ? (o.size as HudSize) : DEFAULT_PREFS.size,
    verbose: typeof o.verbose === 'boolean' ? o.verbose : DEFAULT_PREFS.verbose,
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

function isMe(o: unknown): o is RecorderMe {
  if (!o || typeof o !== 'object') return false;
  const m = o as Record<string, unknown>;
  const ws = m.workspace as Record<string, unknown> | null | undefined;
  return (m.kind === 'linked' || m.kind === 'key') && typeof ws?.slug === 'string' && typeof ws.name === 'string';
}

function adopt(me: unknown): HudAccount | null {
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
  if (server) storePrefs(server);
  notify();
  return account;
}

/** Ask the server who this token is; null when unlinked, unavailable or refused. Never rejects. */
export async function fetchMe(): Promise<HudAccount | null> {
  if (!vitrinkaLinked() || unavailable) return cachedAccount();
  try {
    return adopt(await api<unknown>('GET', '/api/v1/recorder/me'));
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
  const next = { ...cachedPrefs(), ...patch };
  storePrefs(next);
  notify();
  if (!vitrinkaLinked() || unavailable || cachedAccount()?.kind === 'key') return next;
  try {
    adopt(await api<unknown>('PATCH', '/api/v1/recorder/me', { prefs: patch }));
  } catch (e) {
    if (e instanceof VitrinkaApiError && e.status === 409) return next;
    if (soft(e)) noteUnavailable(e);
    else console.warn('vitrinka: saving HUD prefs failed — kept on this device', e);
  }
  return cachedPrefs();
}

/** Test-only: drop the caches and the unavailable latch. */
export function __resetMeForTests(): void {
  prefsCache = undefined;
  meCache = undefined;
  unavailable = false;
  warned = false;
}
