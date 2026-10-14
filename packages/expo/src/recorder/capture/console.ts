/**
 * Console capture — error/warn tap. The recorder's own logs are prefixed
 * "vitrinka:" and skipped, or a failed flush would feed itself forever.
 */
import { pushEvent } from '../queue';
import { eventRoute, redactText } from './redact';

const TEXT_CAP = 8 * 1024;

/**
 * Same globalThis marker as the network patch: a module-local boolean is reset
 * by Fast Refresh re-evaluation while the previously installed wrappers stay in
 * place, stacking a new wrapper on each reload.
 */
const PATCH_MARK = '__vitrinkaRecorderConsolePatched';

export function patchConsole(): void {
  const g = globalThis as typeof globalThis & { [PATCH_MARK]?: boolean };
  if (g[PATCH_MARK]) return;
  g[PATCH_MARK] = true;
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      try {
        const text = args
          .map((a) =>
            typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a),
          )
          .join(' ')
          .slice(0, TEXT_CAP);
        if (text.startsWith('vitrinka:')) return;
        // Logged objects routinely carry tokens/headers — same redaction pass
        // as network bodies.
        pushEvent('console', { level, text: redactText(text) }, eventRoute());
      } catch {
        // capture must never break logging
      }
    };
  }
}
