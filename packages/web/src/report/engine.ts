/**
 * The report face's capture runtime — the shared engine (QA Studio D6)
 * driven by the project's capture profile instead of a recording:
 *
 * 1. `GET /api/v1/report-config` with the `vkb_` key → the capture profile
 *    (narrowed by the host's `capture` option), the masking profile and the
 *    attachment caps (attachments.ts). An
 *    unreachable or older server means the safe fallback: memory, the last
 *    minute, strict masking.
 * 2. The redaction rules first, then the lanes — so capture runs under the
 *    project's rules from its first byte: the console lane (errors, every
 *    level with `console`), the network lane in metadata-only mode
 *    (`errors`: failures, `network`: every request), and the rrweb lane
 *    into the flight buffer (`interactions`).
 * 3. The flight buffer under the profile's window and cap, in memory or
 *    also in IndexedDB (`storage: browser`, storage/capture.ts), whose
 *    expired windows the start sweeps.
 *
 * One engine per page however many widgets mount (the lanes and the buffer
 * are page-wide); the last widget to leave stops it. The runtime is the
 * recorder face's whenever one is mounted (state.ts `claimCapture`): then
 * the engine captures nothing, and it never writes the recorder's
 * configuration — every call it makes names its own target.
 */
import type { eventWithTime } from '@rrweb/types';

import { api, type ApiTarget } from '../recorder/api';
import { patchConsole, unpatchConsole } from '../recorder/capture/console';
import { patchNetwork, unpatchNetwork } from '../recorder/capture/net';
import { setCaptureSanitizer, setRedactionPolicy } from '../recorder/capture/redact';
import { checkoutRRWeb, type RecordFn, runningRecord, startRecordWith, stopRRWeb } from '../recorder/capture/rrweb-lane';
import { addOwnBase } from '../recorder/config';
import {
  clearFlight,
  clipHasSnapshot,
  FLIGHT_MAX_LANE_EVENTS,
  type FlightClip,
  type FlightLaneEvent,
  type FlightProfile,
  flightWrites,
  persistFlightNow,
  startFlightBuffer,
  type StoredWindow,
  stopFlightBuffer,
  takeFlightClip,
} from '../recorder/flight';
import { listen } from '../recorder/hud/listen';
import { EVENTS_PER_POST, splitRRWebEvents, utf8Bytes } from '../recorder/queue';
import { browserTabId, claimCapture, currentRoute, releaseCapture, setTabIdentity } from '../recorder/state';
import { type CaptureStore, deleteCaptureStore, openCaptureStore } from '../recorder/storage/capture';
import { type AttachmentCaps, DEFAULT_ATTACHMENT_CAPS, parseAttachmentCaps } from './attachments';
import { applyHides, hiddenNodeIds, type Marker, type NodeIds } from './markers';
import {
  type CaptureLanes,
  type CaptureNarrowing,
  type CaptureProfile,
  lanesOf,
  legacyProfile,
  type MaskingProfile,
  maskingOf,
  maskingPolicy,
  narrowProfile,
  parseProfile,
  UNMASK_SELECTOR,
} from './profile';

export { EVENTS_PER_POST };

/** Loads rrweb's `record` lazily: `import('rrweb')` from npm, vitrinka's `/vendor` in the single-file widget. */
export type RecordLoader = (base: string) => Promise<RecordFn | null>;

export interface EngineOptions {
  /** vitrinka's origin, no trailing slash. */
  base: string;
  /** The project's `vkb_` report key. */
  key: string;
  appVersion?: string;
  sanitizeUrl?: (url: string) => string;
  capture?: CaptureNarrowing;
  loadRecord: RecordLoader;
}

export interface ReportConfig {
  project: string;
  /** The profile in force (the project's, narrowed by the host). */
  profile: CaptureProfile;
  lanes: CaptureLanes;
  masking: MaskingProfile;
  /** False when the config read failed: the fallback profile runs. */
  reachable: boolean;
  /** This widget captures (false while the recorder face runs the page's capture). */
  capturing: boolean;
  /** What the reporter may attach (vt-8020 D9): the server's caps, else the defaults. */
  attachments: AttachmentCaps;
}

export interface ConsoleEntry {
  level: string;
  ts: string;
  text: string;
}

export interface NetEntry {
  method: string;
  path: string;
  status: number;
  ms: number;
}

/** The capture as frozen when the card opened (the buffer keeps rolling). */
export interface Frozen {
  clip: FlightClip | null;
  /** Earlier loads' windows of the clip, read when it froze (the buffer may expire them before Send). */
  stored: Promise<Map<string, { events: eventWithTime[]; lanes: FlightLaneEvent[] }>>;
}

export interface CaptureChunk {
  /** 1..n: the chunk's leaf seq and its `rrweb` row's seq. */
  seq: number;
  /** Its last event's time. */
  ts: string;
  count: number;
  body: string;
}

/** What one report sends of the capture. */
export interface BuiltCapture {
  chunks: CaptureChunk[];
  truncated: boolean;
  console: ConsoleEntry[];
  network: NetEntry[];
}

/** The report wire's chunk cap is 4 MiB; pack a little under it. */
const CHUNK_PACK_BYTES = 3.5 * 1024 * 1024;
const CHUNK_HARD_BYTES = 4 * 1024 * 1024 - 64;
const MAX_CONSOLE_TEXT = 2000;
const MAX_ENTRIES = 500;
/** A checkout every minute at most: a short window checks out as often as it is long. */
const MAX_CHECKOUT_MS = 60_000;
/** Token-shaped runs in a request path (reset links, signed URLs) are scrubbed: the server keeps paths as sent. */
const TOKENY = /[A-Za-z0-9_-]{20,}/g;

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** A request URL (already through the redaction engine) as the wire's path: pathname only, token runs scrubbed. */
export function reportPath(url: unknown): string {
  const raw = str(url);
  let path: string;
  try {
    path = new URL(raw, globalThis.location?.href ?? 'http://localhost').pathname;
  } catch {
    path = raw.split(/[?#]/)[0] ?? '';
  }
  return path.replace(TOKENY, '•••').slice(0, 300);
}

/** rrweb's `EventType.Meta`, the head of every window (`@rrweb/types` is type-only here). */
const RRWEB_META = 4;

/**
 * Whole windows only: rrweb's stream is stateful, so a window holding an
 * event over the wire cap (a huge full snapshot) goes entirely — its
 * incrementals are worthless without it — and the replay says truncated.
 */
export function wholeWindows(events: readonly eventWithTime[], hardBytes: number): { events: eventWithTime[]; dropped: boolean } {
  const out: eventWithTime[] = [];
  let dropped = false;
  let window: eventWithTime[] = [];
  let tooBig = false;
  const close = () => {
    if (tooBig) dropped = true;
    else out.push(...window);
    window = [];
    tooBig = false;
  };
  for (const ev of events) {
    if (ev.type === RRWEB_META && window.length) close();
    if (!tooBig && utf8Bytes(JSON.stringify(ev)) + 1 > hardBytes) tooBig = true;
    window.push(ev);
  }
  close();
  return { events: out, dropped };
}

/** What the flight buffer keeps of each lane event under the profile's classes: the wire's shapes only. */
function laneKeeper(lanes: CaptureLanes): NonNullable<FlightProfile['keepLane']> {
  return (kind, payload) => {
    if (kind === 'console') {
      const level = str(payload?.level, 'error');
      if (level === 'error' ? !(lanes.errors || lanes.console) : !lanes.console) return null;
      return { level, text: str(payload?.text).slice(0, MAX_CONSOLE_TEXT) };
    }
    if (kind === 'net') {
      const status = typeof payload?.status === 'number' ? payload.status : 0;
      const failed = status === 0 || status >= 400 || payload?.error !== undefined;
      if (!(lanes.network || (lanes.errors && failed))) return null;
      return {
        method: str(payload?.method, 'GET').toUpperCase(),
        path: reportPath(payload?.url),
        status,
        ms: typeof payload?.ms === 'number' ? Math.max(0, Math.round(payload.ms)) : 0,
      };
    }
    return null;
  };
}

async function fetchConfig(
  target: ApiTarget,
): Promise<{ project: string; profile: CaptureProfile; masking: MaskingProfile; reachable: boolean; attachments: AttachmentCaps }> {
  try {
    const res = await api<Record<string, unknown>>('GET', '/api/v1/report-config', undefined, { target });
    const flight = typeof res.flightRecorder === 'boolean' ? res.flightRecorder : undefined;
    return {
      project: str(res.project),
      profile: res.captureProfile == null ? legacyProfile(flight) : parseProfile(res.captureProfile, flight),
      masking: maskingOf(res.profile),
      reachable: true,
      // vitrinka serves the caps inside the capture profile; a top-level `attachments` is read as a fallback.
      attachments: parseAttachmentCaps(
        typeof res.captureProfile === 'object' && res.captureProfile !== null && 'attachments' in res.captureProfile
          ? (res.captureProfile as { attachments?: unknown }).attachments
          : res.attachments,
      ),
    };
  } catch (e) {
    console.warn('vitrinka: report config unavailable — capturing the last minute, strictly masked', e);
    return { project: '', profile: legacyProfile(), masking: 'strict', reachable: false, attachments: DEFAULT_ATTACHMENT_CAPS };
  }
}

/** rrweb's mirror off the running recorder, when it carries one (the vendor build may not). */
function mirrorOf(record: RecordFn | null): NodeIds | null {
  const mirror: unknown = record?.mirror;
  if (typeof mirror !== 'object' || mirror === null) return null;
  const getId: unknown = (mirror as { getId?: unknown }).getId;
  return typeof getId === 'function' ? { getId: (n) => Number(getId.call(mirror, n)) } : null;
}

export class CaptureEngine {
  readonly ready: Promise<ReportConfig>;
  private store: CaptureStore | null = null;
  private stopped = false;
  /** The release token of this engine's claim on the page's capture runtime. */
  private claim: string | null = null;
  /** The config `ready` resolved with — kept true to what the engine does now. */
  private config: ReportConfig | null = null;
  private readonly listeners = new Set<() => void>();
  /** …and runs it now: false before the claim, without it, and after it yielded. */
  private capturing = false;
  /** The engine's own lifetime (its base registration). */
  private readonly offs: (() => void)[] = [];
  /** The capture runtime's teardown, run when it yields to a recorder or stops. */
  private readonly capture: (() => void)[] = [];

  constructor(readonly opts: EngineOptions) {
    this.ready = this.start();
  }

  private async start(): Promise<ReportConfig> {
    const { opts } = this;
    // Every call is targeted (ApiTarget): the recorder's configuration is
    // never written. Its lanes skip this base's traffic all the same.
    this.offs.push(addOwnBase(opts.base));
    const fetched = await fetchConfig({ url: opts.base, key: opts.key });
    const profile = narrowProfile(fetched.profile, opts.capture);
    const lanes = lanesOf(profile.classes);
    const config: ReportConfig = {
      project: fetched.project,
      profile,
      lanes,
      masking: fetched.masking,
      reachable: fetched.reachable,
      capturing: false,
      attachments: fetched.attachments,
    };
    if (this.stopped) return config;
    // The page-wide runtime (lanes, buffer, rrweb, rules) is the recorder's
    // whenever one is mounted; this widget then reports without a capture.
    this.config = config;
    this.claim = claimCapture('report', () => this.standDown());
    if (!this.claim) {
      console.warn('vitrinka: the recorder runs this page’s capture — Report a problem sends without one');
      return config;
    }
    this.capturing = true;
    config.capturing = true;
    setTabIdentity(browserTabId(), globalThis.location?.host ?? '');
    currentRoute.pathname = globalThis.location?.pathname ?? '/';
    setRedactionPolicy(maskingPolicy(config.masking));
    setCaptureSanitizer(opts.sanitizeUrl);
    this.capture.push(() => setCaptureSanitizer(null));

    const windowMs = profile.windowSec * 1000;
    // What stored windows were captured FOR: another project, or a laxer
    // masking or wider classes than now, never comes back (sweep drops it).
    const scope = [opts.base, fetched.project, config.masking, profile.classes.join(',')].join('|');
    let prior: StoredWindow[] = [];
    let priorLanes: FlightLaneEvent[] = [];
    if (profile.storage === 'browser') {
      try {
        this.store = await openCaptureStore();
        const kept = await this.store.sweep(Date.now(), windowMs, currentRoute.tabId, scope);
        // Replay windows and lane spans both: the buffer expires each in its turn.
        prior = kept;
        // The console and network entries of earlier loads, replay or not.
        const store = this.store;
        const spans = await Promise.all(kept.filter((w) => w.kind === 'lanes').map((w) => store.read(w.id)));
        priorLanes = spans.flatMap((s) => s.lanes).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      } catch (e) {
        console.warn('vitrinka: browser capture storage unavailable — keeping the capture in memory', e);
        this.store = null;
        prior = [];
        priorLanes = [];
      }
    } else {
      // Memory means memory: nothing a browser profile once stored stays behind.
      deleteCaptureStore();
    }
    if (!this.capturing) {
      this.store?.close();
      this.store = null;
      return config;
    }
    startFlightBuffer({
      windowMs,
      checkoutMs: Math.min(MAX_CHECKOUT_MS, windowMs),
      maxBytes: profile.maxBytes,
      maxEvents: Math.max(20_000, Math.round(profile.maxBytes / 200)),
      maxLaneEvents: FLIGHT_MAX_LANE_EVENTS,
      keepLane: laneKeeper(lanes),
      store: this.store,
      scope,
      prior,
      priorLanes,
    });
    this.capture.push(stopFlightBuffer);
    if (this.store && typeof window !== 'undefined') {
      const persist = () => persistFlightNow();
      this.capture.push(listen(window, 'pagehide', persist), listen(document, 'visibilitychange', persist));
    }
    // Each acquisition names its own settings, so nothing of the report face
    // outlives its release into the next face that patches these lanes.
    if (lanes.errors || lanes.console) {
      patchConsole({ levels: lanes.console ? ['warn', 'info', 'log'] : [] });
      this.capture.push(unpatchConsole);
    }
    if (lanes.errors || lanes.network) {
      patchNetwork({ detail: 'meta' });
      this.capture.push(unpatchNetwork);
    }
    if (lanes.replay) {
      const record = await opts.loadRecord(opts.base).catch((e: unknown) => {
        // A report without a replay is still a report: never block the card.
        console.warn('vitrinka: the page recorder did not load — reports go without a replay', e);
        return null;
      });
      if (record && this.capturing) {
        startRecordWith(record, 'flight', { unmaskSelector: UNMASK_SELECTOR });
        this.capture.push(stopRRWeb);
      }
    }
    return config;
  }

  /** Hear the engine's state change (it stopped capturing): the widget repaints. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The recorder mounted: hand it the runtime — this widget goes on reporting without a capture. */
  private standDown(): void {
    if (!this.capturing) return;
    this.capturing = false;
    if (this.config) this.config.capturing = false;
    for (const off of this.capture.splice(0).reverse()) off();
    const store = this.store;
    this.store = null;
    if (store) void flightWrites().then(() => store.close());
    for (const fn of this.listeners) fn();
  }

  /** Freeze the capture now (the card opened); the buffer rolls on. */
  freeze(): Frozen {
    // Not this widget's runtime (the recorder runs it): nothing to take.
    if (!this.capturing) return { clip: null, stored: Promise.resolve(new Map()) };
    currentRoute.pathname = globalThis.location?.pathname ?? currentRoute.pathname;
    let clip = takeFlightClip();
    // No screen of this page yet (the recorder only just started, a window
    // went over the cap): take one now so the report shows the current view.
    if (clip && runningRecord() && !clipHasSnapshot(clip)) {
      checkoutRRWeb();
      clip = takeFlightClip();
    }
    // Earlier loads' windows are read NOW: the buffer keeps rolling while the
    // reporter writes and may expire them before Send.
    const store = this.store;
    const ids = clip?.windows.filter((w) => w.stored).map((w) => w.id) ?? [];
    const stored: Frozen['stored'] =
      store && ids.length ? Promise.all(ids.map(async (id) => [id, await store.read(id)] as const)).then((rows) => new Map(rows)) : Promise.resolve(new Map());
    stored.catch(() => undefined); // build reports a failed read
    return { clip, stored };
  }

  /**
   * The rrweb ids of the page nodes under a hide right now — taken when the
   * hide is drawn (the page sits frozen under the marking layer); null when
   * the running recorder has no mirror to say (then a hide withholds the replay).
   */
  hiddenIdsAt(rect: Marker['rect']): Set<number> | null {
    if (!this.capturing) return null;
    const mirror = mirrorOf(runningRecord());
    return mirror ? hiddenNodeIds([rect], mirror) : null;
  }

  /**
   * What one report sends: the frozen windows (stored ones read back), the
   * hides applied, split under the chunk cap. `markedIds` are the nodes each
   * hide covered when it was drawn; the nodes under it at send join them. A
   * hide whose nodes cannot be named (no mirror) withholds the replay — fail
   * closed, never a box over text that still rides along.
   */
  async build(frozen: Frozen, markers: readonly Marker[], markedIds: ReadonlySet<number> = new Set()): Promise<BuiltCapture> {
    const hides = markers.filter((m) => m.shape === 'hide').map((m) => m.rect);
    const mirror = mirrorOf(runningRecord());
    const withheld = hides.length > 0 && !mirror;
    if (withheld) console.warn('vitrinka: this page recorder cannot name what a hide covers — the report goes without its replay');
    const hiddenIds = new Set(markedIds);
    if (hides.length && mirror) for (const id of hiddenNodeIds(hides, mirror)) hiddenIds.add(id);
    const events: eventWithTime[] = [];
    let truncated = frozen.clip?.truncated ?? false;
    const pinned = await frozen.stored.catch((e: unknown) => {
      console.warn('vitrinka: the stored part of the capture could not be read — the replay starts later', e);
      return null;
    });
    for (const w of frozen.clip?.windows ?? []) {
      if (!w.stored) {
        events.push(...w.events);
        continue;
      }
      const read = pinned?.get(w.id);
      // Gone before the card opened, or unreadable: say the replay is short.
      if (!read?.events.length) truncated = true;
      else events.push(...read.events);
    }
    // The console and network entries, earlier loads' included (priorLanes).
    const lanes: FlightLaneEvent[] = frozen.clip?.lanes ?? [];
    const whole = withheld ? { events: [], dropped: false } : wholeWindows(applyHides(events, hides, hiddenIds), CHUNK_HARD_BYTES);
    if (whole.dropped) truncated = true;
    const { parts, dropped } = splitRRWebEvents(whole.events, CHUNK_PACK_BYTES, CHUNK_HARD_BYTES);
    const chunks: CaptureChunk[] = [];
    let at = 0;
    for (const p of parts) {
      at += p.count;
      const last = whole.events[at - 1]?.timestamp ?? Date.now();
      chunks.push({ seq: chunks.length + 1, ts: new Date(last).toISOString(), count: p.count, body: p.body });
    }
    const consoleEntries: ConsoleEntry[] = lanes
      .filter((e) => e.kind === 'console')
      .slice(-MAX_ENTRIES)
      .map((e) => ({ level: str(e.payload?.level, 'error'), ts: e.ts, text: str(e.payload?.text) }));
    const network: NetEntry[] = lanes
      .filter((e) => e.kind === 'net')
      .slice(-MAX_ENTRIES)
      .map((e) => ({
        method: str(e.payload?.method, 'GET'),
        path: str(e.payload?.path),
        status: typeof e.payload?.status === 'number' ? e.payload.status : 0,
        ms: typeof e.payload?.ms === 'number' ? e.payload.ms : 0,
      }));
    return { chunks, truncated: truncated || dropped.length > 0, console: consoleEntries, network };
  }

  /** A report went out: forget what it carried, in memory and in the store. */
  clear(): void {
    if (this.capturing) clearFlight();
  }

  stop(): void {
    this.stopped = true;
    this.listeners.clear();
    this.standDown();
    releaseCapture(this.claim);
    this.claim = null;
    for (const off of this.offs.splice(0).reverse()) off();
  }
}

let shared: { engine: CaptureEngine; refs: number } | null = null;

/** The page's one engine (started by the first widget); null when another base/key already owns it. */
export function acquireEngine(opts: EngineOptions): CaptureEngine | null {
  if (shared) {
    const owner = shared.engine.opts;
    // Sharing means one capture: only for a widget asking exactly what the
    // first one did — never another target, narrowing or URL sanitizer.
    const same =
      owner.base === opts.base &&
      owner.key === opts.key &&
      owner.sanitizeUrl === opts.sanitizeUrl &&
      JSON.stringify(owner.capture ?? {}) === JSON.stringify(opts.capture ?? {});
    if (!same) {
      console.warn('vitrinka: one capture engine per page — this widget reports without a capture (another widget’s key, base, capture or sanitizeUrl owns it)');
      return null;
    }
    shared.refs++;
    return shared.engine;
  }
  shared = { engine: new CaptureEngine(opts), refs: 1 };
  return shared.engine;
}

export function releaseEngine(engine: CaptureEngine | null): void {
  if (!engine || !shared || shared.engine !== engine) return;
  if (--shared.refs > 0) return;
  shared = null;
  engine.stop();
}
