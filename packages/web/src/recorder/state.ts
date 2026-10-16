/**
 * Shared recorder state with NO DOM or React imports, so the capture layers
 * and the queue stay unit-testable under bun and `session.ts` can re-export
 * it as the one import site for callers.
 */

/**
 * Where the recorder believes the user is. Mirrors the browser extension's
 * lane vocabulary: `tabId` is a per-tab id (one timeline lane per browser
 * tab), `tabHost` the page host; the route itself rides in event payloads.
 */
export const currentRoute = { tabId: 'root', tabHost: '/', pathname: '/' };

const TAB_KEY = 'vitrinka.tab';

/** One lane per browser tab: a per-tab id kept in sessionStorage (survives reloads). */
export function browserTabId(): string {
  try {
    const ss = globalThis.sessionStorage;
    const have = ss.getItem(TAB_KEY);
    if (have) return have;
    const id = Math.random().toString(36).slice(2, 10);
    ss.setItem(TAB_KEY, id);
    return id;
  } catch {
    return 'root';
  }
}

/** Set the tab identity once per document (provider mount, report face mount). */
export function setTabIdentity(tabId: string, tabHost: string): void {
  currentRoute.tabId = tabId;
  currentRoute.tabHost = tabHost;
}

/** Update the current pathname; returns true when it actually changed. */
export function setCurrentPath(pathname: string): boolean {
  if (currentRoute.pathname === pathname) return false;
  currentRoute.pathname = pathname;
  notify();
  return true;
}

/** Annotate mode (element pick / region marquee); chip and overlay share it. */
export const annotateState = { active: false };

export function setAnnotating(active: boolean): void {
  if (annotateState.active === active) return;
  annotateState.active = active;
  notify();
}

/**
 * ONE recorder (lead.ts): who else leads this document's recording while
 * this recorder follows — `'extension'` or `'page'` (another recorder bundle
 * on the page) — else null. A follower captures nothing: every lane, the
 * rrweb stream and the flight recorder check it.
 */
export const leadState: { following: 'page' | 'extension' | null } = { following: null };

// -- change subscription (the HUD re-renders off this) -----------------------

const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(): void {
  for (const fn of listeners) fn();
}
