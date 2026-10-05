/**
 * Vitrinka journey recorder for React DOM apps — `@vitrinka/web/recorder`.
 *
 * The runtime strip: when `url` is empty, `VitrinkaRecorderRoot` renders its
 * children and starts NOTHING, and `VitrinkaRecorderPill` renders null. Auth
 * is a device link minted from the pill (`@vitrinka/link`) or, for CI and
 * unattended builds, an explicit `recorderKey`; `withVitrinkaRecorder`
 * (`@vitrinka/web/next`) refuses a production build that carries a baked key
 * outside an allowed lane.
 */
import { createElement, Fragment, type ReactElement, type ReactNode, useEffect, useRef } from 'react';

import { envConfig, vitrinkaConfigured } from './config';
import { mountRecorderHud } from './hud/mount';
import { createPageController } from './page-controller';
import { RecorderProvider, useRecorderRoute } from './RecorderProvider';
import { wantFlight } from './report';
import { getRecorderStorage } from './storage';

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
  /** Device-link label shown in vitrinka; defaults to `<browser> on <os> · <host>`. */
  label?: string;
  /** Reported in session meta. */
  appVersion?: string;
  /** Explicit server lane; omitted = the key's project rule decides. */
  environment?: string;
  /** Explicit project; omitted = the host's project rule decides. */
  project?: string;
  /**
   * `false` turns off the flight recorder: the idle pill keeps no in-memory
   * last minute, so "Report a bug" is offered only while recording.
   */
  flightRecorder?: boolean;
  /** A router's pathname, when the History wrap is not enough. */
  route?: string | null;
  children?: ReactNode;
}

/** Wrap the app root. Starts the capture lanes only when `url` + `key` are present. */
export function VitrinkaRecorderRoot(props: VitrinkaRecorderRootProps): ReactElement {
  const env = envConfig();
  const url = props.url ?? env.url;
  const key = props.recorderKey ?? env.key;
  // The strip: the URL alone enables the recorder; auth is a key or the device link.
  if (!url) return createElement(Fragment, null, props.children);
  return createElement(
    RecorderProvider,
    {
      config: {
        url,
        key,
        appVersion: props.appVersion,
        environment: props.environment,
        project: props.project,
        label: props.label,
        flightRecorder: props.flightRecorder,
      },
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
 * host on `<html>`, never into the app's DOM), driven by the in-page
 * recorder's controller. Renders null when the root is inert.
 */
export function VitrinkaRecorderPill(props: VitrinkaRecorderPillProps): null {
  const titleRef = useRef(props.title);
  titleRef.current = props.title;
  useEffect(() => {
    if (!vitrinkaConfigured()) return;
    // The idle pill keeps the last minute for "Report a bug" (report.ts gates it).
    const releaseFlight = wantFlight();
    const unmount = mountRecorderHud(createPageController(), {
      title: () => titleRef.current ?? document.title,
      storage: getRecorderStorage(),
    });
    return () => {
      unmount();
      releaseFlight();
    };
  }, []);
  return null;
}
