/**
 * Vitrinka journey recorder for React DOM apps — `@vitrinka/web/recorder`.
 *
 * The runtime strip: when `url` or `key` is empty, `VitrinkaRecorderRoot`
 * renders its children and starts NOTHING, and `VitrinkaRecorderPill` renders
 * null. A build without the env pair therefore carries an inert recorder;
 * `withVitrinkaRecorder` (`@vitrinka/web/next`) additionally refuses a
 * production build that carries a key outside an allowed lane.
 */
import { createElement, Fragment, type ReactElement, type ReactNode, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { envConfig, vitrinkaConfigured } from './config';
import { createHudHost } from './hud/host';
import { Hud } from './hud/Hud';
import { RecorderProvider, useRecorderRoute } from './RecorderProvider';

export { useRecorderRoute };
export type { RecorderControl, RecorderStatus } from './control';
export type { RecorderConfig } from './config';
export { configureRecorderStorage, type RecorderStorage } from './storage';

export interface VitrinkaRecorderRootProps {
  /** vitrinka base URL; defaults to `NEXT_PUBLIC_VITRINKA_URL`. */
  url?: string;
  /**
   * A `vkr_` recorder key; defaults to `NEXT_PUBLIC_VITRINKA_KEY`. Named
   * `recorderKey` because React reserves `key` and never delivers it as a prop.
   */
  recorderKey?: string;
  /** Reported in session meta. */
  appVersion?: string;
  /** Explicit server lane; omitted = the key's project rule decides. */
  environment?: string;
  /** A router's pathname, when the History wrap is not enough. */
  route?: string | null;
  children?: ReactNode;
}

/** Wrap the app root. Starts the capture lanes only when `url` + `key` are present. */
export function VitrinkaRecorderRoot(props: VitrinkaRecorderRootProps): ReactElement {
  const env = envConfig();
  const url = props.url ?? env.url;
  const key = props.recorderKey ?? env.key;
  if (!url || !key) return createElement(Fragment, null, props.children);
  return createElement(
    RecorderProvider,
    {
      config: { url, key, appVersion: props.appVersion, environment: props.environment },
    },
    createElement(RouteFeed, { route: props.route }),
    props.children,
  );
}

function RouteFeed({ route }: { route?: string | null }): null {
  useRecorderRoute(route);
  return null;
}

export interface VitrinkaRecorderPillProps {
  /** Session title when the tester starts from the pill; defaults to `document.title`. */
  title?: string;
}

/**
 * The HUD — mount it anywhere under the root (it renders into its own shadow
 * host on `<html>`, never into the app's DOM). Renders null when the root is
 * inert.
 */
export function VitrinkaRecorderPill(props: VitrinkaRecorderPillProps): null {
  const rootRef = useRef<Root | null>(null);
  const titleRef = useRef(props.title);
  titleRef.current = props.title;
  useEffect(() => {
    if (!vitrinkaConfigured()) return;
    const host = createHudHost();
    const root = createRoot(host.mount);
    rootRef.current = root;
    root.render(
      createElement(Hud, {
        hostMount: host.mount,
        defaultTitle: () => titleRef.current ?? document.title,
      }),
    );
    return () => {
      root.unmount();
      host.destroy();
      rootRef.current = null;
    };
  }, []);
  return null;
}
