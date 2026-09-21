/**
 * Console lane — `console.error` + `window.onerror` + `unhandledrejection`.
 * The recorder's own logs are prefixed "vitrinka:" and skipped, or a failed
 * flush would feed itself forever. Shape matches the extension's CDP tap:
 * `{level: 'error', text}`.
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

function record(text: string): void {
  if (!text || text.startsWith('vitrinka:')) return;
  // Logged objects routinely carry tokens/headers — same redaction pass as
  // network bodies.
  pushEvent(
    'console',
    { level: 'error', text: redactText(text) },
    { tabId: currentRoute.tabId, tabHost: currentRoute.tabHost },
  );
}

const UNPATCH_MARK = '__vitrinkaRecorderConsoleUnpatch';

type PatchGlobals = typeof globalThis & { [PATCH_MARK]?: boolean; [UNPATCH_MARK]?: () => void };

/** Restore console.error (while it is still ours) and drop the window listeners. */
export function unpatchConsole(): void {
  (globalThis as PatchGlobals)[UNPATCH_MARK]?.();
}

export function patchConsole(): void {
  const g = globalThis as PatchGlobals;
  if (g[PATCH_MARK]) return;
  g[PATCH_MARK] = true;
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
    if (hasWindow) {
      removeEventListener('error', onError);
      removeEventListener('unhandledrejection', onRejection);
    }
    delete g[PATCH_MARK];
    delete g[UNPATCH_MARK];
  };
}
