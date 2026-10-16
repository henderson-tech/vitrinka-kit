/**
 * The report face's capture runtime — the shared engine (QA Studio D6)
 * driven by the project's capture profile instead of a recording:
 *
 * 1. `GET /api/v1/report-config` with the `vkb_` key → the capture profile
 *    (narrowed by the host's `capture` option) and the masking profile. An
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
 * are page-wide); the last widget to leave stops it.
 */
import type { eventWithTime } from '@rrweb/types';

import { api, type ApiTarget } from '../recorder/api';
import { patchConsole, unpatchConsole } from '../recorder/capture/console';
import { patchNetwork, unpatchNetwork } from '../recorder/capture/net';
import { setRedactionPolicy } from '../recorder/capture/redact';
import { checkoutRRWeb, type RecordFn, runningRecord, startRecordWith, stopRRWeb } from '../recorder/capture/rrweb-lane';
import { configureRecorder } from '../recorder/config';
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
import { EVENTS_PER_POST, splitRRWebEvents } from '../recorder/queue';
import { browserTabId, currentRoute, setTabIdentity } from '../recorder/state';
import { type CaptureStore, deleteCaptureStore, openCaptureStore } from '../recorder/storage/capture';
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

async function fetchConfig(target: ApiTarget): Promise<{ project: string; profile: CaptureProfile; masking: MaskingProfile; reachable: boolean }> {
  try {
    const res = await api<Record<string, unknown>>('GET', '/api/v1/report-config', undefined, { target });
    const flight = typeof res.flightRecorder === 'boolean' ? res.flightRecorder : undefined;
    return {
      project: str(res.project),
      profile: res.captureProfile == null ? legacyProfile(flight) : parseProfile(res.captureProfile, flight),
      masking: maskingOf(res.profile),
      reachable: true,
    };
  } catch (e) {
    console.warn('vitrinka: report config unavailable — capturing the last minute, strictly masked', e);
    return { project: '', profile: legacyProfile(), masking: 'strict', reachable: false };
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
  private readonly offs: (() => void)[] = [];

  constructor(readonly opts: EngineOptions) {
    this.ready = this.start();
  }

  private async start(): Promise<ReportConfig> {
    const { opts } = this;
    configureRecorder({
      url: opts.base,
      key: opts.key,
      appVersion: opts.appVersion,
      flightRecorder: true,
      sanitizeUrl: opts.sanitizeUrl,
    });
    setTabIdentity(browserTabId(), globalThis.location?.host ?? '');
    currentRoute.pathname = globalThis.location?.pathname ?? '/';
    setRedactionPolicy(null);
    const fetched = await fetchConfig({ url: opts.base, key: opts.key });
    const profile = narrowProfile(fetched.profile, opts.capture);
    const lanes = lanesOf(profile.classes);
    const config: ReportConfig = { project: fetched.project, profile, lanes, masking: fetched.masking, reachable: fetched.reachable };
    if (this.stopped) return config;
    setRedactionPolicy(maskingPolicy(config.masking));

    const windowMs = profile.windowSec * 1000;
    // What stored windows were captured FOR: another project, or a laxer
    // masking or wider classes than now, never comes back (sweep drops it).
    const scope = [opts.base, fetched.project, config.masking, profile.classes.join(',')].join('|');
    let prior: StoredWindow[] = [];
    if (profile.storage === 'browser') {
      try {
        this.store = await openCaptureStore();
        prior = await this.store.sweep(Date.now(), windowMs, currentRoute.tabId, scope);
      } catch (e) {
        console.warn('vitrinka: browser capture storage unavailable — keeping the capture in memory', e);
        this.store = null;
        prior = [];
      }
    } else {
      // Memory means memory: nothing a browser profile once stored stays behind.
      deleteCaptureStore();
    }
    if (this.stopped) {
      this.store?.close();
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
    });
    this.offs.push(stopFlightBuffer);
    if (this.store) {
      const persist = () => persistFlightNow();
      this.offs.push(listen(window, 'pagehide', persist), listen(document, 'visibilitychange', persist));
    }
    // Each acquisition names its own settings, so nothing of the report face
    // outlives its release into the next face that patches these lanes.
    if (lanes.errors || lanes.console) {
      patchConsole({ levels: lanes.console ? ['warn', 'info', 'log'] : [] });
      this.offs.push(unpatchConsole);
    }
    if (lanes.errors || lanes.network) {
      patchNetwork({ detail: 'meta' });
      this.offs.push(unpatchNetwork);
    }
    if (lanes.replay) {
      const record = await opts.loadRecord(opts.base).catch((e: unknown) => {
        // A report without a replay is still a report: never block the card.
        console.warn('vitrinka: the page recorder did not load — reports go without a replay', e);
        return null;
      });
      if (record && !this.stopped) {
        startRecordWith(record, 'flight', { unmaskSelector: UNMASK_SELECTOR });
        this.offs.push(stopRRWeb);
      }
    }
    return config;
  }

  /** Freeze the capture now (the card opened); the buffer rolls on. */
  freeze(): Frozen {
    currentRoute.pathname = globalThis.location?.pathname ?? currentRoute.pathname;
    let clip = takeFlightClip();
    // No screen of this page yet (the recorder only just started, a window
    // went over the cap): take one now so the report shows the current view.
    if (clip && runningRecord() && !clipHasSnapshot(clip)) {
      checkoutRRWeb();
      clip = takeFlightClip();
    }
    return { clip };
  }

  /**
   * The rrweb ids of the page nodes under a hide right now — taken when the
   * hide is drawn (the page sits frozen under the marking layer); null when
   * the running recorder has no mirror to say (then a hide withholds the replay).
   */
  hiddenIdsAt(rect: Marker['rect']): Set<number> | null {
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
    const lanes: FlightLaneEvent[] = [];
    let truncated = frozen.clip?.truncated ?? false;
    if (frozen.clip) {
      if (frozen.clip.windows.some((w) => w.stored)) await flightWrites();
      for (const w of frozen.clip.windows) {
        if (!w.stored) {
          events.push(...w.events);
          continue;
        }
        try {
          if (!this.store) throw new Error('the store is gone');
          const read = await this.store.read(w.id);
          events.push(...read.events);
          lanes.push(...read.lanes);
        } catch (e) {
          console.warn('vitrinka: a stored part of the capture could not be read — the replay starts later', e);
          truncated = true;
        }
      }
      lanes.push(...frozen.clip.lanes);
    }
    const { parts, dropped } = withheld
      ? { parts: [], dropped: [] }
      : splitRRWebEvents(applyHides(events, hides, hiddenIds), CHUNK_PACK_BYTES, CHUNK_HARD_BYTES);
    const chunks: CaptureChunk[] = [];
    let at = 0;
    for (const p of parts) {
      at += p.count;
      const last = events[at - 1]?.timestamp ?? Date.now();
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
    clearFlight();
  }

  stop(): void {
    this.stopped = true;
    for (const off of this.offs.splice(0).reverse()) off();
    const store = this.store;
    this.store = null;
    if (store) void flightWrites().then(() => store.close());
  }
}

let shared: { engine: CaptureEngine; refs: number } | null = null;

/** The page's one engine (started by the first widget); null when another base/key already owns it. */
export function acquireEngine(opts: EngineOptions): CaptureEngine | null {
  if (shared) {
    if (shared.engine.opts.base !== opts.base || shared.engine.opts.key !== opts.key) {
      console.warn('vitrinka: one capture engine per page — this widget reports without a capture (another key or base owns it)');
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
