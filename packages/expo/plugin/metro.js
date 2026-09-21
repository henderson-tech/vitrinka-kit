/**
 * Metro half of the recorder's production strip — the ONE line a consuming
 * app adds to metro.config.js (config plugins cannot modify metro config,
 * so this cannot be automated away; the config plugin verifies it is wired):
 *
 *   const { withRecorderStrip } = require('@vitrinka/expo/recorder/metro');
 *   module.exports = withRecorderStrip(config);
 *
 * WHY THE GATE ALONE IS NOT ENOUGH: the gate module folds to an early return
 * on builds without recorder env, but Metro collects `require()` dependencies
 * while TRANSFORMING a module — before any minifier can prove the branch dead.
 * Measured by exporting the same tree both ways: without this hook, bundles
 * contained the full recorder (api paths, captureRef, …) inert. Redirecting
 * the gate's three specifiers to the empty stub — exactly on the builds where
 * the gate can never reach them — is what actually excludes the subtree:
 * provider, HUD, queue, api and the capture layers all drop out transitively.
 */
const path = require('path');

const STRIPPED_SPECIFIERS = new Set([
  './RecorderProvider',
  './hud/RecorderPill',
  './hud/AnnotateOverlay',
]);

/**
 * Is this module inside @vitrinka/expo's recorder tree? Matches BOTH layouts:
 * the installed package (node_modules/@vitrinka/expo/build/module/recorder)
 * and a workspace/source checkout (packages/expo/src/recorder) — Metro reports
 * REAL paths through workspace symlinks, so an @vitrinka-only match would
 * silently skip the strip for workspace-linked consumers.
 */
function isRecorderOrigin(originModulePath) {
  if (!originModulePath) return false;
  const inPackage =
    originModulePath.includes(path.join('@vitrinka', 'expo')) ||
    originModulePath.includes(path.join('vitrinka-kit', 'packages', 'expo'));
  return inPackage && originModulePath.includes('recorder');
}

/**
 * @param {object} metroConfig the app's resolved Metro config
 * @param {{requireOnProfiles?: string[]}} [opts] EAS build profiles that MUST
 *   carry recorder env — profiles that exist only to produce a recorder build
 *   (e.g. a prod-backed test lane whose token is injected per build). Without
 *   this, such a profile built without its token silently takes the stub swap
 *   and produces an artifact indistinguishable from a plain store build until
 *   someone installs it and finds no HUD. This resolver is the process that
 *   decides the swap, so it is the last point where the answer is knowable.
 */
function withRecorderStrip(metroConfig, opts = {}) {
  // URL-only enablement: auth is the device link (or an env token for
  // unattended builds), so the URL alone decides whether the recorder ships.
  const enabled = Boolean(process.env.EXPO_PUBLIC_VITRINKA_URL);

  const profile = process.env.EAS_BUILD_PROFILE;
  if (!enabled && profile && (opts.requireOnProfiles ?? []).includes(profile)) {
    throw new Error(
      `[@vitrinka/expo] Build refused — the "${profile}" profile requires the vitrinka ` +
        'recorder env, and EXPO_PUBLIC_VITRINKA_URL is not set. Set it on the profile; ' +
        'without it this profile silently produces a recorder-less binary, which is the ' +
        'one thing it exists not to be.',
    );
  }

  if (enabled) return metroConfig;

  // The stub lives HERE in plugin/ (plain CJS, no build step) so the redirect
  // works identically for the installed package and a workspace/source
  // checkout that has never run `bob build`.
  const stub = path.join(__dirname, 'recorder-stub.js');
  const upstreamResolveRequest = metroConfig.resolver.resolveRequest;
  metroConfig.resolver.resolveRequest = (context, moduleName, platform) => {
    if (STRIPPED_SPECIFIERS.has(moduleName) && isRecorderOrigin(context.originModulePath)) {
      return { type: 'sourceFile', filePath: stub };
    }
    const next = upstreamResolveRequest ?? context.resolveRequest;
    return next(context, moduleName, platform);
  };
  return metroConfig;
}

module.exports = { withRecorderStrip };
