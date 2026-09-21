/**
 * Recorder root — mounted ONLY via the __DEV__ gate in index.tsx.
 *
 * Wraps the app in a capture-phase responder View (design decision): it
 * OBSERVES every touch (coords + current route) and always returns false,
 * never claiming the gesture. The same View is the captureRef target for
 * screenshot keyframes, so shots include sheets/modals rendered inside it.
 *
 * Route awareness comes in through the `route` prop — the package is
 * navigation-agnostic. expo-router apps get theirs from the bundled adapter
 * (`useExpoRouterRecorderRoute`, the `/recorder/expo-router` subpath); any
 * other navigation stack passes `{ pathname, lane }` from its own source.
 * tabId = the lane (tab/section grouping for the journey timeline);
 * tabHost = the full pathname.
 */
import { type ReactNode, useEffect, useRef } from 'react';
import { AppState, type GestureResponderEvent, View } from 'react-native';

import { patchConsole } from './capture/console';
import { patchNetwork } from './capture/net';
import { pressLabel } from './capture/press';
import { setShotRoot, shoot } from './capture/shot';
import { useRecorderControl } from './control';
import {
  armReconcile,
  flush,
  getState,
  persistNow,
  pushEvent,
  reconcile,
  scheduleFlush,
} from './queue';
import { installUnauthorizedHandler } from './link';
import { armIdleStop, recoverRedactionPolicy } from './session';
import { currentRoute, setCurrentRoute } from './state';

/** Where the recorder believes the user is; see the header for the mapping. */
export interface RecorderRoute {
  /** Full pathname, e.g. '/orders/42' — becomes the event's tabHost. */
  pathname: string;
  /** Timeline lane (tab/section name); defaults to 'root'. */
  lane?: string;
}

/**
 * Expo's DevTools socket is backed by Metro and throws while resolving its
 * connection info in a Release bundle. Keep that bridge out of Release while
 * leaving the recorder itself available in TestFlight-style recorder builds.
 */
function RecorderDevToolsControl() {
  useRecorderControl();
  return null;
}

export function RecorderProvider({
  children,
  route,
}: {
  children: ReactNode;
  route?: RecorderRoute;
}) {
  const rootRef = useRef<View | null>(null);
  const pathname = route?.pathname ?? '/';
  const lane = route?.lane ?? 'root';

  useEffect(() => {
    patchNetwork();
    patchConsole();
    setShotRoot(rootRef);
    // An app restart mid-outage keeps the durable tail — kick a drain. A
    // recording recovered from storage also needs its reconcile poll re-armed
    // (intervals do not survive a JS reload).
    scheduleFlush();
    if (getState()) {
      // A JS reload dropped the in-memory rule set — re-apply the session's
      // policy before anything captures, and re-FETCH it if the start-time
      // fetch never settled (its promise died with the old runtime).
      recoverRedactionPolicy();
      armReconcile();
    }
    // A recovered recording also lost its idle timer. This recovery belongs
    // to the recorder lifecycle, including Release builds without Metro.
    armIdleStop();
    // Backgrounding is the moment before an OS kill: force the debounced buffer
    // to disk so the tail is never only in memory.
    //
    // 'inactive' gets the DISK write only. On iOS it fires for every Control
    // Center pull, notification banner, incoming call and app-switcher peek, so
    // kicking a network upload there would fire constantly during normal use
    //. Only a real 'background' transition uploads.
    const off401 = installUnauthorizedHandler();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'inactive') {
        persistNow();
      } else if (state === 'background') {
        persistNow();
        void flush();
      } else if (state === 'active') {
        // RN timers are suspended in the background: catch the queue and the
        // server-truth poll up as soon as the tester returns.
        if (getState()) {
          void flush();
          void reconcile();
        }
      }
    });
    return () => {
      sub.remove();
      off401();
    };
  }, []);

  useEffect(() => {
    setCurrentRoute(pathname, lane);
    pushEvent('nav', { route: pathname }, { ...currentRoute });
    void shoot('nav');
  }, [pathname, lane]);

  const onTouchCapture = (e: GestureResponderEvent): boolean => {
    const text = pressLabel(e);
    pushEvent(
      'click',
      {
        x: Math.round(e.nativeEvent.pageX),
        y: Math.round(e.nativeEvent.pageY),
        route: currentRoute.tabHost,
        ...(text ? { text } : {}),
      },
      { ...currentRoute },
    );
    void shoot('touch');
    return false; // never claim the touch
  };

  return (
    <View
      ref={rootRef}
      collapsable={false}
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={onTouchCapture}
    >
      {__DEV__ ? <RecorderDevToolsControl /> : null}
      {children}
    </View>
  );
}
