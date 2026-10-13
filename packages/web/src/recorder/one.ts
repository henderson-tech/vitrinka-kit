/**
 * ONE recorder (extension + page recorder decisions, 2026-10-12): the
 * page-embedded recorder (main world) and the browser extension's content
 * scripts (isolated world) share nothing but the DOM, so this is the whole
 * protocol they speak over it — written once here, imported by the page
 * recorder (`lead.ts`) and shipped to the extension as `build/one.iife.js`
 * (`globalThis.VitrinkaOne`). DOM-light and React-free: every function takes
 * a `OneEnv` (the `<html>` element and `window` by default), so it runs
 * under bun without a DOM.
 *
 * - State lives on `<html>` attributes: `data-vitrinka-page` (a page
 *   recorder is mounted here) and `data-vitrinka-lead` (the claim: who
 *   records this document). A claim is written only by its holder, taken by
 *   a synchronous check-and-set (`takeClaim`), and cleared by anyone else
 *   only under its own `id` once its holder no longer answers (D4, D5).
 * - Actions travel as `window` CustomEvents whose `detail` is a JSON STRING
 *   (an object `detail` from the isolated world reads `null` in the main
 *   world). `dispatchEvent` runs every world's listeners synchronously, so a
 *   `hello` ask and a `command` are answered inside their own dispatch: no
 *   answer means no live holder, and nobody ever waits on a timer.
 * - Never `data-vitrinka-recorder` on `<html>`: that is rrweb's block
 *   selector and the click lanes' "ours" marker.
 */
import { listen } from './hud/listen';

/** Protocol version; a reader takes the fields it knows from a higher one. */
export const ONE_VERSION = 1;
/** `<html>` attribute: a page recorder is mounted here (its recorder id, e.g. `web/0.5.0`). */
export const PAGE_ATTR = 'data-vitrinka-page';
/** `<html>` attribute: the claim (JSON). */
export const LEAD_ATTR = 'data-vitrinka-lead';
export const HELLO_EVENT = 'vitrinka:hello';
export const COMMAND_EVENT = 'vitrinka:command';
export const ACK_EVENT = 'vitrinka:ack';

export type OneParty = 'page' | 'extension';
/** `saved` = the leader's pill still shows Saving / Saved / failed after a stop (D7); every other state is live. */
export type ClaimState = 'starting' | 'recording' | 'paused' | 'stopping' | 'saved';
export type CommandOp = 'pause' | 'stop' | 'note';
export type AckCode = 'not_recording' | 'stopping' | 'not_here' | 'bad_command';

/** Who records this document. No title, workspace, URL or credential: any script on the page reads it. */
export interface Claim {
  v: number;
  by: OneParty;
  /** The holder: a page recorder instance's nonce, or the extension recording's generation. */
  id: string;
  state: ClaimState;
  /** `''` while `starting`. */
  sessionId: string;
  /** Epoch ms the claim was taken. */
  since: number;
}

/** What a party says about the recording it knows of. */
export interface Live {
  by: OneParty;
  state: ClaimState;
  /** The sender holds this document's claim. */
  here: boolean;
  /** The claim's `id` when `here`. */
  id?: string;
}

export interface Hello {
  v: number;
  from: OneParty;
  /** The sender instance; every party ignores events carrying its own. */
  inst: string;
  /** Asks every live party to answer with its own hello, inside this dispatch. */
  ask?: true;
  live?: Live | null;
  /** The sender is leaving. */
  gone?: true;
}

export interface Command {
  v: number;
  from: OneParty;
  inst: string;
  /** This command's id; its ack carries it back. */
  id: string;
  op: CommandOp;
  /** A note's text. */
  text?: string;
}

export interface Ack {
  v: number;
  from: OneParty;
  inst: string;
  id: string;
  ok: boolean;
  code?: AckCode;
  error?: string;
}

/** What a party answers a command with; `null` = not the holder (no answer at all). */
export type CommandReply = { ok: true } | { ok: false; code: AckCode; error?: string };

/** The attribute surface of `<html>` the claim lives on. */
export interface ClaimRoot {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface OneEnv {
  /** `document.documentElement`. */
  root: ClaimRoot;
  /** `window`: where actions travel. */
  bus: EventTarget;
  /** Calls back after the claim attribute changed; returns the stop. Default: a MutationObserver on `root`. */
  watch?: (fn: () => void) => () => void;
}

/** A party on the channel: which side it is and its instance nonce. */
export interface OneSelf {
  from: OneParty;
  inst: string;
}

/** The document's env; null where there is no DOM (SSR, a worker). */
export function documentEnv(): OneEnv | null {
  const doc = (globalThis as { document?: Document }).document;
  const root = doc?.documentElement;
  if (!root || typeof globalThis.dispatchEvent !== 'function') return null;
  return { root, bus: globalThis as unknown as EventTarget };
}

/** A fresh nonce: `p.k3x9q2…` for a page instance. */
export function nonce(prefix: string): string {
  return `${prefix}.${Math.random().toString(36).slice(2, 10)}`;
}

// -- the codec ---------------------------------------------------------------

const PARTIES: readonly string[] = ['page', 'extension'];
const STATES: readonly string[] = ['starting', 'recording', 'paused', 'stopping', 'saved'];
const OPS: readonly string[] = ['pause', 'stop', 'note'];
const CODES: readonly string[] = ['not_recording', 'stopping', 'not_here', 'bad_command'];

type Bag = Record<string, unknown>;

function bagOf(raw: unknown): Bag | null {
  if (typeof raw !== 'string') return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Bag) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): v is string => typeof v === 'string';
const party = (v: unknown): v is OneParty => str(v) && PARTIES.includes(v);
const claimState = (v: unknown): v is ClaimState => str(v) && STATES.includes(v);
/** `v` is a positive integer; a higher one still parses (D18). */
const version = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/** Parse a claim attribute; null for anything that is not one. */
export function parseClaim(raw: string | null | undefined): Claim | null {
  const b = bagOf(raw);
  if (!b || !version(b.v) || !party(b.by) || !str(b.id) || !b.id || !claimState(b.state)) return null;
  return {
    v: b.v,
    by: b.by,
    id: b.id,
    state: b.state,
    // web 0.5.0 pages wrote the server's numeric id.
    sessionId: str(b.sessionId) ? b.sessionId : Number.isFinite(b.sessionId) ? String(b.sessionId) : '',
    since: typeof b.since === 'number' ? b.since : 0,
  };
}

export function serializeClaim(c: Claim): string {
  return JSON.stringify({ v: c.v, by: c.by, id: c.id, state: c.state, sessionId: c.sessionId, since: c.since });
}

/** Live = a recording is (or is about to be) under way; `saved` is not. */
export function isLive(state: ClaimState | null | undefined): boolean {
  return state !== undefined && state !== null && state !== 'saved';
}

function parseLive(raw: unknown): Live | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Bag;
  if (!party(b.by) || !claimState(b.state)) return null;
  return { by: b.by, state: b.state, here: b.here === true, ...(str(b.id) && b.id ? { id: b.id } : {}) };
}

export function parseHello(raw: unknown): Hello | null {
  const b = bagOf(raw);
  if (!b || !version(b.v) || !party(b.from) || !str(b.inst) || !b.inst) return null;
  const live = parseLive(b.live);
  return {
    v: b.v,
    from: b.from,
    inst: b.inst,
    ...(b.ask === true ? { ask: true as const } : {}),
    ...(b.live !== undefined ? { live } : {}),
    ...(b.gone === true ? { gone: true as const } : {}),
  };
}

/** A command; null when it does not parse or names an unknown op (treated as absent). */
export function parseCommand(raw: unknown): Command | null {
  const b = bagOf(raw);
  if (!b || !version(b.v) || !party(b.from) || !str(b.inst) || !b.inst || !str(b.id) || !b.id) return null;
  if (!str(b.op) || !OPS.includes(b.op)) return null;
  return { v: b.v, from: b.from, inst: b.inst, id: b.id, op: b.op as CommandOp, ...(str(b.text) ? { text: b.text } : {}) };
}

export function parseAck(raw: unknown): Ack | null {
  const b = bagOf(raw);
  if (!b || !version(b.v) || !party(b.from) || !str(b.inst) || !str(b.id) || typeof b.ok !== 'boolean') return null;
  return {
    v: b.v,
    from: b.from,
    inst: b.inst,
    id: b.id,
    ok: b.ok,
    ...(str(b.code) && CODES.includes(b.code) ? { code: b.code as AckCode } : {}),
    ...(str(b.error) ? { error: b.error } : {}),
  };
}

// -- state: the attributes ---------------------------------------------------

export function readClaim(env: OneEnv): Claim | null {
  return parseClaim(env.root.getAttribute(LEAD_ATTR));
}

function writeClaim(env: OneEnv, c: Claim): void {
  const next = serializeClaim(c);
  // Transitions only: the leader's rrweb and the page's own observers see every write.
  if (env.root.getAttribute(LEAD_ATTR) !== next) env.root.setAttribute(LEAD_ATTR, next);
}

export type TakeResult = { ok: true; claim: Claim } | { ok: false; holder: Claim };

/**
 * The synchronous check-and-set (D4): take this document's claim unless a
 * LIVE claim of another holder stands and that holder still answers (D5).
 * A `saved` claim, a stale one and the caller's own are taken over. Call it
 * before any network call, inside one task.
 */
export function takeClaim(env: OneEnv, self: OneSelf, next: { id: string; state: ClaimState; sessionId?: string }): TakeResult {
  const cur = readClaim(env);
  if (cur && cur.id !== next.id && isLive(cur.state) && holderAnswers(env, self, cur)) return { ok: false, holder: cur };
  const claim: Claim = {
    v: ONE_VERSION,
    by: self.from,
    id: next.id,
    state: next.state,
    sessionId: next.sessionId ?? '',
    // Re-taking its own live claim keeps its age; a new claim (or one over a `saved` face) starts now.
    since: cur?.id === next.id && isLive(cur.state) ? cur.since : Date.now(),
  };
  writeClaim(env, claim);
  return { ok: true, claim };
}

/** Move the holder's claim to `state` (and `sessionId`); false when the claim is not `id`'s. */
export function updateClaim(env: OneEnv, id: string, patch: { state: ClaimState; sessionId?: string }): boolean {
  const cur = readClaim(env);
  if (cur?.id !== id) return false;
  writeClaim(env, { ...cur, v: ONE_VERSION, state: patch.state, sessionId: patch.sessionId ?? cur.sessionId });
  return true;
}

/** Remove the claim only if it is `id`'s — the holder releasing, or anyone clearing a stale one. */
export function releaseClaim(env: OneEnv, id: string): boolean {
  if (readClaim(env)?.id !== id) return false;
  env.root.removeAttribute(LEAD_ATTR);
  return true;
}

/** Call back on every change of the claim attribute; returns the stop. */
export function watchClaim(env: OneEnv, fn: () => void): () => void {
  if (env.watch) return env.watch(fn);
  if (typeof MutationObserver !== 'function' || typeof Node === 'undefined' || !(env.root instanceof Node)) return () => undefined;
  const mo = new MutationObserver(fn);
  mo.observe(env.root, { attributes: true, attributeFilter: [LEAD_ATTR] });
  return () => mo.disconnect();
}

export function markPage(env: OneEnv, recorderId: string): void {
  if (env.root.getAttribute(PAGE_ATTR) !== recorderId) env.root.setAttribute(PAGE_ATTR, recorderId);
}

export function unmarkPage(env: OneEnv): void {
  env.root.removeAttribute(PAGE_ATTR);
}

export function pageMarked(env: OneEnv): boolean {
  return env.root.getAttribute(PAGE_ATTR) !== null;
}

// -- actions: the events -----------------------------------------------------

function emit(env: OneEnv, type: string, msg: object): void {
  env.bus.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(msg) }));
}

/** Listen natively (`hud/listen.ts`: a zone.js host routes it like any other). */
function on(env: OneEnv, type: string, fn: (detail: unknown) => void): () => void {
  return listen(env.bus, type, (e) => fn((e as CustomEvent<unknown>).detail));
}

/**
 * Ask who is here: every live party answers inside this dispatch. Returns
 * the answers (never the caller's own).
 */
export function ask(env: OneEnv, self: OneSelf): Hello[] {
  const answers: Hello[] = [];
  const off = on(env, HELLO_EVENT, (d) => {
    const h = parseHello(d);
    if (h && !h.ask && h.inst !== self.inst) answers.push(h);
  });
  try {
    emit(env, HELLO_EVENT, { v: ONE_VERSION, from: self.from, inst: self.inst, ask: true });
  } finally {
    off();
  }
  return answers;
}

/** Say what this party knows (no `ask`): an answer, a change, or `gone` on leaving. */
export function announce(env: OneEnv, self: OneSelf, live: Live | null, opts: { gone?: boolean } = {}): void {
  emit(env, HELLO_EVENT, { v: ONE_VERSION, from: self.from, inst: self.inst, live, ...(opts.gone ? { gone: true } : {}) });
}

/**
 * Serve the hello channel: an ask is answered at once with `live()`; any
 * other hello (an answer to someone else, a change, a `gone`) reaches
 * `onHello`. The party's own dispatches are ignored. `answerIf` keeps a
 * party silent where it must not speak — the extension's `one.js` answers
 * only in documents that carry `data-vitrinka-page` (D6).
 */
export function serveHello(
  env: OneEnv,
  self: OneSelf,
  live: () => Live | null,
  onHello?: (h: Hello) => void,
  opts: { answerIf?: () => boolean } = {},
): () => void {
  return on(env, HELLO_EVENT, (d) => {
    const h = parseHello(d);
    if (!h || h.inst === self.inst) return;
    if (!h.ask) onHello?.(h);
    else if (opts.answerIf?.() ?? true) announce(env, self, live());
  });
}

/** Did the claim's holder answer? Matched on its `id` when the answer names one, else on its side. */
export function answeredBy(answers: readonly Hello[], holder: Claim): boolean {
  return answers.some((h) => h.live?.here === true && (h.live.id ? h.live.id === holder.id : h.from === holder.by));
}

/** Ping the claim's holder (D5): true when it answers inside the dispatch. */
export function holderAnswers(env: OneEnv, self: OneSelf, holder: Claim): boolean {
  return answeredBy(ask(env, self), holder);
}

/**
 * Send a command to the claim's holder; its ack arrives inside this
 * dispatch. Null = nobody answered (the holder is gone, D5).
 */
export function sendCommand(env: OneEnv, self: OneSelf, op: CommandOp, text?: string): Ack | null {
  const id = nonce('c');
  let ack: Ack | null = null;
  const off = on(env, ACK_EVENT, (d) => {
    const a = parseAck(d);
    if (a && a.id === id && a.inst !== self.inst && !ack) ack = a;
  });
  try {
    emit(env, COMMAND_EVENT, { v: ONE_VERSION, from: self.from, inst: self.inst, id, op, ...(text !== undefined ? { text } : {}) });
  } finally {
    off();
  }
  return ack;
}

/**
 * Serve commands: `handle` answers a parsed command (another party's, a
 * known op) with its reply — synchronously, inside the command's dispatch —
 * or `null` when this party is not the holder, which sends no ack at all.
 */
export function serveCommands(env: OneEnv, self: OneSelf, handle: (c: Command) => CommandReply | null): () => void {
  return on(env, COMMAND_EVENT, (d) => {
    const c = parseCommand(d);
    if (!c || c.inst === self.inst) return;
    const reply = handle(c);
    if (!reply) return;
    emit(env, ACK_EVENT, { v: ONE_VERSION, from: self.from, inst: self.inst, id: c.id, ...reply });
  });
}
