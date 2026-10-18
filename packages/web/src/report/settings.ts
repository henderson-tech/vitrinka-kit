/**
 * The reporter's own settings beyond the shortcut (vt-8020 D9): the widget's
 * size and the technical details a support conversation asks for. Each
 * setting is one localStorage key of this origin — the reporter's, on this
 * browser, never sent anywhere.
 *
 * Size is the pill's vocabulary (sm · md · lg, the same factors): ONE factor,
 * `--vr-scale` on the widget's root, scales the button, the card and the
 * marking bar — fonts and boxes together, so the card keeps its proportions.
 */
import type { ReportConfig } from './engine';
import type { Strings } from './i18n';
import { formatBytes } from './attachments';

export type WidgetSize = 'sm' | 'md' | 'lg';
export const SIZES: readonly WidgetSize[] = ['sm', 'md', 'lg'];
export const SIZE_SCALE: Readonly<Record<WidgetSize, number>> = { sm: 0.88, md: 1, lg: 1.18 };
export const SIZE_KEY = 'vitrinka.report.size';

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage blocked (sandboxed frame, privacy mode): the defaults stand
  }
}

/** One stored preference; null when unset or unreadable. */
export function readPref(key: string): string | null {
  return store()?.getItem(key) ?? null;
}

export function writePref(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch (e) {
    console.warn(`vitrinka: could not remember ${key} on this browser`, e);
  }
}

export function readSize(): WidgetSize {
  const v = readPref(SIZE_KEY);
  return SIZES.find((s) => s === v) ?? 'md';
}

export interface TechInput {
  /** The package version (recorder/version.ts). */
  version: string;
  base: string;
  /** null until the report config answered. */
  config: ReportConfig | null;
  /** False when another widget runs the page's one capture engine. */
  engine: boolean;
  locale: string;
}

/** The read-only technical details, label → value: version, capture window, capture, buffer, server. */
export function techDetails(t: TechInput, s: Strings): [string, string][] {
  const c = t.config;
  const capture = !t.engine || c?.capturing === false ? s.captureOff : c ? s.captureOn : s.captureStarting;
  let host = t.base;
  try {
    host = new URL(t.base).host;
  } catch {
    // not a URL: show it as configured
  }
  return [
    [s.techVersion, `@vitrinka/web ${t.version}`],
    [s.techWindow, c ? s.windowLength(c.profile.windowSec) : '—'],
    [s.techCapture, capture],
    [s.techBuffer, c ? `${c.profile.storage === 'browser' ? s.bufferBrowser : s.bufferMemory} · ${formatBytes(c.profile.maxBytes, t.locale)}` : '—'],
    [s.techServer, host],
  ];
}
