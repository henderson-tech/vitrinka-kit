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

/** Set the tab identity once per document (provider mount). */
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

// -- change subscription (the HUD re-renders off this) -----------------------

const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(): void {
  for (const fn of listeners) fn();
}
