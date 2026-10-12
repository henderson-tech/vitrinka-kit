/**
 * Navigation lane. Every route change lands as ONE `nav` event
 * (`{url, route, spa: true}` for in-document navigations, the extension's
 * shape) whether it was observed by the default History wrap or fed by
 * `useRecorderRoute(pathname)` — both funnel through `noteNavigation`, which
 * dedupes on the URL so a router that fires both produces one event.
 */
import { pushEvent } from '../queue';
import { currentRoute, setCurrentPath } from '../state';
import { redactUrl } from './redact';

let lastUrl = '';

/** Record a navigation to the document's current URL (idempotent per URL). */
export function noteNavigation(): void {
  const loc = globalThis.location;
  if (!loc) return;
  const url = loc.href;
  setCurrentPath(loc.pathname);
  if (url === lastUrl) return;
  lastUrl = url;
  pushEvent(
    'nav',
    { url: redactUrl(url), route: loc.pathname, spa: true },
    { tabId: currentRoute.tabId, tabHost: currentRoute.tabHost },
  );
}

/** Seed the dedupe with the URL the session started on (its nav is pushed by startSession). */
export function primeNavigation(): void {
  lastUrl = globalThis.location?.href ?? '';
  setCurrentPath(globalThis.location?.pathname ?? '/');
}

const PATCH_MARK = '__vitrinkaRecorderNavPatched';
const UNPATCH_MARK = '__vitrinkaRecorderNavUnpatch';

type NavGlobals = typeof globalThis & { [PATCH_MARK]?: unknown; [UNPATCH_MARK]?: () => void };

/** This module instance's mark — whose History wrap is live (see `ownNavLane`). */
const OWNER: object = {};

/** Wrap pushState/replaceState + popstate/hashchange. Idempotent across HMR. */
export function installNavLane(): void {
  const g = globalThis as NavGlobals;
  if (g[PATCH_MARK] || typeof history === 'undefined') return;
  g[PATCH_MARK] = OWNER;
  const restores: (() => void)[] = [];
  const wrap = (name: 'pushState' | 'replaceState') => {
    const orig = history[name];
    const wrapped = (history[name] = function (this: History, ...args: Parameters<History['pushState']>) {
      const r = orig.apply(this, args);
      // After the URL changed, off the caller's stack so a router's own
      // synchronous state update never sees the recorder in its way.
      queueMicrotask(noteNavigation);
      return r;
    });
    // Restored only while it is still ours: a wrap stacked on top keeps ours beneath it.
    restores.push(() => {
      if (history[name] === wrapped) history[name] = orig;
    });
  };
  wrap('pushState');
  wrap('replaceState');
  const onNav = () => queueMicrotask(noteNavigation);
  addEventListener('popstate', onNav);
  addEventListener('hashchange', onNav);
  g[UNPATCH_MARK] = () => {
    for (const r of restores.splice(0)) r();
    removeEventListener('popstate', onNav);
    removeEventListener('hashchange', onNav);
    delete g[PATCH_MARK];
    delete g[UNPATCH_MARK];
  };
}

/**
 * Make this module's History wrap the live one (ONE recorder): the first
 * recorder bundle on the page installs it, but whichever bundle leads must
 * hear the navigations. A no-op when it already is.
 */
export function ownNavLane(): void {
  const g = globalThis as NavGlobals;
  if (g[PATCH_MARK] === OWNER) return;
  g[UNPATCH_MARK]?.();
  delete g[PATCH_MARK];
  installNavLane();
}

/** Test-only. */
export function __resetNavForTests(): void {
  lastUrl = '';
}
