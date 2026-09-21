/**
 * Recorder root — mounted ONLY when `url` + `key` are present (see index.ts).
 * Installs the capture lanes once per document, recovers a session that
 * survived a reload, and keeps the rrweb lane in step with the session.
 */
import { type ReactElement, type ReactNode, useEffect } from 'react';

import { installClickLane } from './capture/click';
import { patchConsole } from './capture/console';
import { installNavLane, noteNavigation, primeNavigation } from './capture/nav';
import { patchNetwork } from './capture/net';
import { checkoutRRWeb, flushRRWeb, startRRWeb, stopRRWeb } from './capture/rrweb';
import { configureRecorder, type RecorderConfig } from './config';
import { installControl } from './control';
import { installUnauthorizedHandler } from './link';
import { insideHud } from './hud/host';
import { armReconcile, flush, getState, persistNow, reconcile, scheduleFlush } from './queue';
import { onBeforeStop, recoverRedactionPolicy } from './session';
import { annotateState, setTabIdentity, subscribe } from './state';

const TAB_KEY = 'vitrinka.tab';

/** One lane per browser tab: a per-tab id kept in sessionStorage (survives reloads). */
function tabId(): string {
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

const INSTALL_MARK = '__vitrinkaRecorderInstalled';

export function RecorderProvider({
  config,
  children,
}: {
  config: RecorderConfig;
  children?: ReactNode;
}): ReactElement {
  configureRecorder(config);

  useEffect(() => {
    configureRecorder(config);
  }, [config]);

  useEffect(() => {
    const g = globalThis as typeof globalThis & { [INSTALL_MARK]?: boolean };
    setTabIdentity(tabId(), location.host);
    primeNavigation();
    if (!g[INSTALL_MARK]) {
      g[INSTALL_MARK] = true;
      patchNetwork();
      patchConsole();
      installNavLane();
    }
    const uninstallClicks = installClickLane({
      ignore: (t) => annotateState.active || insideHud(t),
    });
    const uninstallControl = installControl();
    const uninstall401 = installUnauthorizedHandler();

    // Keep the rrweb lane in step with the session: start on record, a fresh
    // checkout on resume, ship-and-stop on stop.
    let wasRecording = false;
    let wasPaused = false;
    const syncLanes = () => {
      const rec = getState();
      const recording = rec !== null && !rec.dead;
      if (recording && !wasRecording) startRRWeb();
      else if (!recording && wasRecording) stopRRWeb();
      else if (recording && wasPaused && !rec.paused) checkoutRRWeb();
      wasRecording = recording;
      wasPaused = rec?.paused ?? false;
    };
    const unsubscribe = subscribe(syncLanes);
    const offBeforeStop = onBeforeStop(flushRRWeb);

    // A reload mid-session: the durable tail needs a drain, the reconcile
    // poll re-arming, the policy re-applying, and the new document is a nav.
    scheduleFlush();
    if (getState()) {
      recoverRedactionPolicy();
      armReconcile();
      noteNavigation();
    }
    syncLanes();

    // Leaving the document: ship the rrweb tail, persist, and try a keepalive
    // flush of a small events batch so the last steps ride out.
    const onPageHide = () => {
      flushRRWeb();
      persistNow();
      void flush({ keepalive: true });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && getState()) {
        void flush();
        void reconcile();
      }
    };
    addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
      offBeforeStop();
      uninstallClicks();
      uninstallControl();
      uninstall401();
      stopRRWeb();
    };
    // The lanes install once per mount; config changes are handled above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

/**
 * Feed the recorder a router's pathname (Next: `usePathname()`). The default
 * History wrap already sees `pushState`; this hook exists for routers that
 * navigate without it and is idempotent alongside it.
 */
export function useRecorderRoute(pathname: string | null | undefined): void {
  useEffect(() => {
    if (pathname == null) return;
    noteNavigation();
  }, [pathname]);
}
