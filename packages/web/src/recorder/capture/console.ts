/**
 * Console lane — `console.error` + `window.onerror` + `unhandledrejection`,
 * plus `console.warn` / `info` / `log` when the face that patches it asks
 * (`patchConsole({levels})`: the report face's `console` capture class).
 * The recorder's own logs are prefixed "vitrinka:" and skipped, or a failed
 * flush would feed itself forever. Shape matches the extension's CDP tap:
 * `{level, text}`.
 */
import { pushEvent } from '../queue';
import { currentRoute } from '../state';
import { redactText } from './redact';

const TEXT_CAP = 8 * 1024;

const PATCH_MARK = '__vitrinkaRecorderConsolePatched';

function describe(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ')
    .slice(0, TEXT_CAP);
}

/** The console methods beyond `error` a lane may tap. */
export type ExtraConsoleLevel = 'warn' | 'info' | 'log';

function record(text: string, level: 'error' | ExtraConsoleLevel = 'error'): void {
  if (!text || text.startsWith('vitrinka:')) return;
  // Logged objects routinely carry tokens/headers — same redaction pass as
  // network bodies.
  pushEvent(
    'console',
    { level, text: redactText(text) },
    { tabId: currentRoute.tabId, tabHost: currentRoute.tabHost },
  );
}

const UNPATCH_MARK = '__vitrinkaRecorderConsoleUnpatch';

type PatchGlobals = typeof globalThis & { [PATCH_MARK]?: unknown; [UNPATCH_MARK]?: () => void };

/**
 * This module instance's mark. The wrappers are global, so the mark says WHOSE
 * are live: another recorder bundle's on the page, or a stale Fast Refresh
 * copy's. `ownConsolePatch` hands them to this one (ONE recorder: whoever leads
 * captures, not whoever mounted first).
 */
const OWNER: object = {};

/** Restore console.error (while it is still ours) and drop the window listeners. */
export function unpatchConsole(): void {
  const g = globalThis as PatchGlobals;
  // Another bundle's live wrapper is its own to remove.
  if (g[PATCH_MARK] !== undefined && g[PATCH_MARK] !== OWNER) return;
  g[UNPATCH_MARK]?.();
}

/** Make this module's wrapper the live one (a no-op when it already is). */
export function ownConsolePatch(): void {
  const g = globalThis as PatchGlobals;
  if (g[PATCH_MARK] === OWNER) return;
  g[UNPATCH_MARK]?.();
  delete g[PATCH_MARK];
  patchConsole();
}

/** Tap `console.error` and the page's errors — plus `levels` (default none) while this patch lives. */
export function patchConsole(opts: { levels?: readonly ExtraConsoleLevel[] } = {}): void {
  const g = globalThis as PatchGlobals;
  if (g[PATCH_MARK]) return;
  g[PATCH_MARK] = OWNER;
  const origError = console.error;
  const orig = origError.bind(console);
  const patched = (...args: unknown[]) => {
    orig(...args);
    try {
      record(describe(args));
    } catch {
      // capture must never break logging
    }
  };
  console.error = patched;
  const extras = (opts.levels ?? []).map((level) => {
    const original = console[level];
    const bound = original.bind(console);
    const wrapper = (...args: unknown[]) => {
      bound(...args);
      try {
        record(describe(args), level);
      } catch {
        // capture must never break logging
      }
    };
    console[level] = wrapper;
    return () => {
      if (console[level] === wrapper) console[level] = original;
    };
  });
  const onError = (e: ErrorEvent) => {
    try {
      record(describe([e.error ?? e.message]));
    } catch {
      // never break the page's own error handling
    }
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    try {
      record(`unhandled rejection: ${describe([e.reason])}`);
    } catch {
      // see above
    }
  };
  const hasWindow = typeof addEventListener === 'function';
  if (hasWindow) {
    addEventListener('error', onError);
    addEventListener('unhandledrejection', onRejection);
  }
  g[UNPATCH_MARK] = () => {
    if (console.error === patched) console.error = origError;
    for (const restore of extras) restore();
    if (hasWindow) {
      removeEventListener('error', onError);
      removeEventListener('unhandledrejection', onRejection);
    }
    delete g[PATCH_MARK];
    delete g[UNPATCH_MARK];
  };
}
