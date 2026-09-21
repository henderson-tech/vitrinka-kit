/**
 * Runtime configuration — the web recorder has no build-time env baking (the
 * host app hands `url` + `key` to `VitrinkaRecorderRoot` as props, typically
 * from `NEXT_PUBLIC_VITRINKA_URL` / `NEXT_PUBLIC_VITRINKA_KEY`), so the API
 * client reads the target from here rather than from `process.env`.
 *
 * SECURITY POSTURE: the key is a PUBLISHABLE recorder key (`vkr_…`) — it is
 * project-pinned, origin-allowlisted and valid only on the session doors, so
 * a key visible in a browser bundle grants nothing beyond "record a session
 * into this project from an allowed origin". The package treats it as an
 * opaque bearer string and never inspects its prefix.
 */

export interface RecorderConfig {
  /** vitrinka base URL, trailing slash stripped. */
  url: string;
  /** The recorder key sent as `authorization: Bearer <key>`. */
  key: string;
  /** Reported in session meta (`appVersion`). */
  appVersion?: string;
  /** Explicit server lane; omitted = the key's project rule decides. */
  environment?: string;
}

const config: RecorderConfig = { url: '', key: '' };

export function configureRecorder(next: RecorderConfig): void {
  config.url = next.url.replace(/\/+$/, '');
  config.key = next.key;
  config.appVersion = next.appVersion;
  config.environment = next.environment;
}

export function recorderConfig(): Readonly<RecorderConfig> {
  return config;
}

export function vitrinkaConfigured(): boolean {
  return config.url !== '' && config.key !== '';
}

/** Recorder's own traffic — the network capture layer must skip it. */
export function isVitrinkaUrl(url: string): boolean {
  return config.url !== '' && url.startsWith(config.url);
}

/**
 * Read the conventional env pair when the host app did not pass props. Written
 * as literal `process.env.NEXT_PUBLIC_*` reads so a Next/webpack/Vite define
 * step can inline them; guarded so a runtime without `process` (plain Vite in
 * the browser) reads nothing instead of throwing.
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
