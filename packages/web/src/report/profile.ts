/**
 * The capture profile (QA Studio D7): what Report a problem keeps before a
 * report, decided per project in vitrinka (`captureProfile` in
 * `GET /api/v1/report-config`). A host's init options can only NARROW it.
 *
 *   storage    memory | browser (IndexedDB, masked, expiring with the window)
 *   windowSec  how far back (default 300)
 *   maxBytes   the replay's size cap
 *   classes    ⊆ errors · interactions · full · console · network
 *
 * Classes: `interactions` = the masked DOM replay (clicks, scrolls, typing
 * as masked input, each page's view); `errors` = uncaught errors, console
 * errors and failed requests; `console` = every console level; `network` =
 * every request's method, path, status and duration; `full` = all of them.
 * Request and response bodies and headers are never part of a report.
 */
import type { RedactionPolicy } from '@vitrinka/redact';

export type CaptureClass = 'errors' | 'interactions' | 'full' | 'console' | 'network';
export type CaptureStorage = 'memory' | 'browser';

export interface CaptureProfile {
  storage: CaptureStorage;
  windowSec: number;
  maxBytes: number;
  classes: CaptureClass[];
}

/** What a host may pass to narrow the project's profile; every field optional. */
export type CaptureNarrowing = Partial<CaptureProfile>;

/** What each class switches on, `full` expanded. */
export interface CaptureLanes {
  replay: boolean;
  errors: boolean;
  console: boolean;
  network: boolean;
}

const CLASSES: readonly CaptureClass[] = ['errors', 'interactions', 'full', 'console', 'network'];
const MIN_WINDOW_SEC = 10;
const MAX_WINDOW_SEC = 3600;
const MIN_BYTES = 256 * 1024;
const MAX_BYTES = 64 * 1024 * 1024;

/** The profile a project gets when its server names one without every field. */
export const PROFILE_DEFAULTS: CaptureProfile = {
  storage: 'memory',
  windowSec: 300,
  maxBytes: 12 * 1024 * 1024,
  classes: ['errors', 'interactions'],
};

/**
 * A server without a capture profile (or an unreachable one): memory, the
 * last minute under 4 MiB, errors and the replay — errors only where the
 * server says `flightRecorder: false`.
 */
export function legacyProfile(flightRecorder?: boolean): CaptureProfile {
  return {
    storage: 'memory',
    windowSec: 60,
    maxBytes: 4 * 1024 * 1024,
    classes: flightRecorder === false ? ['errors'] : ['errors', 'interactions'],
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function classesOf(raw: unknown): CaptureClass[] | null {
  if (!Array.isArray(raw)) return null;
  return CLASSES.filter((c) => raw.includes(c));
}

/** The server's `captureProfile`, field by field; anything missing or malformed takes its default. */
export function parseProfile(raw: unknown, flightRecorder?: boolean): CaptureProfile {
  if (typeof raw !== 'object' || raw === null) return legacyProfile(flightRecorder);
  const p = raw as Record<string, unknown>;
  return {
    storage: p.storage === 'browser' ? 'browser' : p.storage === 'memory' ? 'memory' : PROFILE_DEFAULTS.storage,
    windowSec:
      typeof p.windowSec === 'number' && Number.isFinite(p.windowSec)
        ? clamp(Math.round(p.windowSec), MIN_WINDOW_SEC, MAX_WINDOW_SEC)
        : PROFILE_DEFAULTS.windowSec,
    maxBytes:
      typeof p.maxBytes === 'number' && Number.isFinite(p.maxBytes)
        ? clamp(Math.round(p.maxBytes), MIN_BYTES, MAX_BYTES)
        : PROFILE_DEFAULTS.maxBytes,
    classes: classesOf(p.classes) ?? PROFILE_DEFAULTS.classes,
  };
}

export function lanesOf(classes: readonly CaptureClass[]): CaptureLanes {
  const full = classes.includes('full');
  return {
    replay: full || classes.includes('interactions'),
    errors: full || classes.includes('errors'),
    console: full || classes.includes('console'),
    network: full || classes.includes('network'),
  };
}

function classesFor(lanes: CaptureLanes): CaptureClass[] {
  const out: CaptureClass[] = [];
  if (lanes.errors) out.push('errors');
  if (lanes.replay) out.push('interactions');
  if (lanes.console) out.push('console');
  if (lanes.network) out.push('network');
  return out;
}

/**
 * The project's profile as the host narrowed it: storage only down to
 * memory, the window and the cap only shorter, the classes only fewer
 * (compared lane by lane, so `full` on either side means all four).
 */
export function narrowProfile(server: CaptureProfile, host: CaptureNarrowing | undefined): CaptureProfile {
  if (!host) return server;
  const window = typeof host.windowSec === 'number' && host.windowSec > 0 ? Math.min(server.windowSec, host.windowSec) : server.windowSec;
  const bytes = typeof host.maxBytes === 'number' && host.maxBytes > 0 ? Math.min(server.maxBytes, host.maxBytes) : server.maxBytes;
  let classes = server.classes;
  if (host.classes) {
    const s = lanesOf(server.classes);
    const h = lanesOf(host.classes);
    classes = classesFor({
      replay: s.replay && h.replay,
      errors: s.errors && h.errors,
      console: s.console && h.console,
      network: s.network && h.network,
    });
  }
  return {
    storage: host.storage === 'memory' ? 'memory' : server.storage,
    windowSec: clamp(window, MIN_WINDOW_SEC, MAX_WINDOW_SEC),
    maxBytes: clamp(bytes, MIN_BYTES, MAX_BYTES),
    classes,
  };
}

/** The masking profile a project asked for (`profile` in report-config). */
export type MaskingProfile = 'strict' | 'balanced' | 'full';

export function maskingOf(raw: unknown): MaskingProfile {
  return raw === 'balanced' || raw === 'full' ? raw : 'strict';
}

/**
 * The redaction rules a masking profile means for the shared engine:
 * strict masks every text node and input (a `[data-vitrinka-unmask]`
 * subtree keeps its text), balanced masks inputs, full masks nothing.
 */
export function maskingPolicy(masking: MaskingProfile): RedactionPolicy {
  if (masking === 'full') return { fullFidelity: true };
  if (masking === 'balanced') return {};
  return { maskAllText: true };
}

/** The attribute a host puts on a subtree whose text a strict replay may keep. */
export const UNMASK_SELECTOR = '[data-vitrinka-unmask]';
