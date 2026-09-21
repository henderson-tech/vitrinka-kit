/**
 * Runtime configuration — the web recorder has no build-time env baking (the
 * host app hands `url` to `VitrinkaRecorderRoot`, typically from
 * `NEXT_PUBLIC_VITRINKA_URL`), so the API client reads the target from here.
 *
 * AUTH: the bearer is either an explicit `recorderKey` prop (an admin-minted
 * `vkr_` recorder key — CI, e2e, unattended builds) or, when none is passed,
 * the token minted by the DEVICE LINK (`@vitrinka/link`) and stored under
 * `vitrinka.recorder.link`. Both are ingest-only `vkr_` tokens; the package
 * treats them as opaque strings and never inspects the prefix.
 */
import type { Linked } from '@vitrinka/link';

import { notify } from './state';
import { getRecorderStorage } from './storage';

export interface RecorderConfig {
  /** vitrinka base URL, trailing slash stripped. */
  url: string;
  /** An explicit recorder key; empty = use the stored device link. */
  key?: string;
  /** Reported in session meta (`appVersion`). */
  appVersion?: string;
  /** Explicit server lane; omitted = the key's project rule decides. */
  environment?: string;
  /** Device-link label; defaults to `<browser> on <os> · <host>`. */
  label?: string;
}

const config: RecorderConfig = { url: '', key: '' };

export function configureRecorder(next: RecorderConfig): void {
  config.url = next.url.replace(/\/+$/, '');
  config.key = next.key ?? '';
  config.appVersion = next.appVersion;
  config.environment = next.environment;
  config.label = next.label;
}

export function recorderConfig(): Readonly<RecorderConfig> {
  return config;
}

/** The recorder is enabled by the URL alone; auth comes from a key or a link. */
export function vitrinkaConfigured(): boolean {
  return config.url !== '';
}

/** Recorder's own traffic — the network capture layer must skip it. */
export function isVitrinkaUrl(url: string): boolean {
  return config.url !== '' && url.startsWith(config.url);
}

// -- the stored device link --------------------------------------------------

/** Storage key of the linked token (`vitrinka.recorder.link` in localStorage). */
export const LINK_KEY = 'link';

export function readLink(): Linked | null {
  const raw = getRecorderStorage().getString(LINK_KEY);
  if (!raw) return null;
  try {
    const l = JSON.parse(raw) as Linked;
    return typeof l.token === 'string' && l.token ? l : null;
  } catch {
    return null;
  }
}

export function storeLink(link: Linked): void {
  getRecorderStorage().set(LINK_KEY, JSON.stringify(link));
  notify();
}

export function clearLink(): void {
  getRecorderStorage().remove(LINK_KEY);
  notify();
}

/** Has the recorder something to authenticate with? */
export function vitrinkaLinked(): boolean {
  return Boolean(config.key) || readLink() !== null;
}

/** The bearer for the session doors: the explicit key wins over the link. */
export function bearerToken(): string {
  return config.key || readLink()?.token || '';
}

/** Device-link label from the UA — deliberately simple, no parser dependency. */
export function defaultLinkLabel(): string {
  if (config.label) return config.label;
  const ua = globalThis.navigator?.userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'unknown OS';
  const host = globalThis.location?.host ?? '';
  return `${browser} on ${os}${host ? ` · ${host}` : ''}`;
}

/**
 * Read the conventional env pair when the host app did not pass props. Written
 * as literal `process.env.NEXT_PUBLIC_*` reads so a Next/webpack/Vite define
 * step can inline them; guarded so a runtime without `process` reads nothing.
 */
export function envConfig(): { url: string; key: string } {
  try {
    if (typeof process === 'undefined' || !process.env) return { url: '', key: '' };
    return {
      url: process.env.NEXT_PUBLIC_VITRINKA_URL ?? '',
      key: process.env.NEXT_PUBLIC_VITRINKA_KEY ?? '',
    };
  } catch {
    return { url: '', key: '' };
  }
}
