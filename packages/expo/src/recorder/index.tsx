/**
 * Vitrinka journey recorder — the production-strip gate.
 *
 * The FIRST and ONLY condition on the path to each `require()` is an inlined
 * `EXPO_PUBLIC_VITRINKA_*` comparison, as its own early return. That matters:
 * `babel-preset-expo` replaces `process.env.EXPO_PUBLIC_*` with a literal at
 * transform time, so on any build that does not set them the guard folds to
 * `return children` and the minifier proves everything after it unreachable —
 * the recorder tree (provider, HUD, queue, api, capture layers) is then never
 * required and never bundled. Folding RUNTIME checks into that condition (as
 * an `ENABLED` const) makes the condition runtime-valued, defeats dead-code
 * elimination, and ships the whole recorder into release bundles. Keep this
 * condition purely env-literal.
 *
 * Metro collects `require()` dependencies while TRANSFORMING a module — before
 * any minifier can prove the surrounding branch dead — so the config plugin's
 * metro hook (`withRecorderStrip`) additionally redirects the entry modules to
 * the plugin's shipped stub on builds without recorder env. Both layers together are the strip
 * guarantee; consuming apps should assert it against their own export pipeline
 * (see the package README).
 *
 * The recorder is deliberately NOT gated on `__DEV__`: recording journeys on a
 * prod-like build (TestFlight / internal track) is a primary use case. The
 * safety boundary is build-config time instead — the config plugin's build
 * guard refuses any build whose profile is not on the recorder allowlist.
 *
 * What remains in a release bundle is this gate module itself: components that
 * immediately return their input, with — deliberately — zero imports beyond
 * types.
 */
import type { ReactNode } from 'react';

import type { RecorderRoute } from './RecorderProvider';

export type { RecorderRoute };
// Type-only on purpose — a value re-export would put ./storage (and through
// its lazy require, the fs driver + expo-file-system) into every bundle this
// gate survives in. Values live on the `/recorder/storage` subpath.
export type { RecorderStorage } from './storage';

/**
 * Wrap the app root (around the navigation container). Observes touches and
 * navigation, hosts the screenshot capture root. `route` feeds the journey's
 * lane/pathname — expo-router apps take it from `useExpoRouterRecorderRoute()`
 * (the `/recorder/expo-router` subpath); other stacks pass their own.
 */
export function VitrinkaRecorderRoot({
  children,
  route,
}: {
  children: ReactNode;
  route?: RecorderRoute;
}) {
  // Inlined literals → statically true on any build without recorder env, so
  // everything below is dead code and never bundled.
  if (!process.env.EXPO_PUBLIC_VITRINKA_URL) {
    return children;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RecorderProvider } = require('./RecorderProvider') as typeof import('./RecorderProvider');
  return <RecorderProvider route={route}>{children}</RecorderProvider>;
}

/**
 * The HUD pill — mount it separately AFTER the navigation container (e.g.
 * after the <Stack>): floating UI rendered outside the screens container draws
 * fine but never receives touches on iOS.
 *
 * The annotate overlay rides along as the sibling BEFORE the pill: this spot
 * is inside the capture root (the frozen frame includes the marquee/dim) and
 * under KeyboardProvider (KeyboardStickyView needs it), and the pill drawing
 * after it keeps the ⌖/✕ chip tappable above the dim.
 *
 * `hideIdleGripOn`: pathnames where the idle grip must not mount because the
 * host app owns competing right-edge UI there (the grip's invisible hit target
 * is deliberately wide). A live recording stays visible on those routes.
 */
export function VitrinkaRecorderPill({
  hideIdleGripOn,
}: {
  hideIdleGripOn?: readonly string[];
} = {}) {
  if (!process.env.EXPO_PUBLIC_VITRINKA_URL) {
    return null; // same static-strip contract as above
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RecorderPill } = require('./hud/RecorderPill') as typeof import('./hud/RecorderPill');
  const { AnnotateOverlay } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./hud/AnnotateOverlay') as typeof import('./hud/AnnotateOverlay');
  return (
    <>
      <AnnotateOverlay />
      <RecorderPill hideIdleGripOn={hideIdleGripOn} />
    </>
  );
}
