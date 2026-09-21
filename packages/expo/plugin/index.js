/**
 * Expo config plugin — `"plugins": [["@vitrinka/expo", { … }]]` (the bare
 * package name: Expo resolves it to this file through app.plugin.js; a
 * subpath string would be required directly and hit the ESM build).
 *
 * Runs the recorder build guard at config-evaluation time (the same moment an
 * app.config.js call would) and, on recorder-enabled builds, HARD-FAILS unless
 * metro.config.js wires `withRecorderStrip` — the one piece a config plugin
 * cannot inject itself (plugins mod app config, never metro config). Both
 * halves of the production-strip guarantee are therefore enforced from here:
 * the env guard directly, the metro hook by verification.
 *
 * Props (see plugin/build-guard.js for the full semantics):
 *   allowedProfiles   REQUIRED — EAS build profiles allowed to carry the token
 *   forbiddenChannels OTA channels that must never carry it (default
 *                     ['production', 'preview'])
 *   devVariants       appVariant values counting as local dev (default
 *                     ['development'])
 *   variantEnvVar     env var holding the app variant (default 'APP_VARIANT')
 *   devModeVar / updateLaneVar / laneMarkerVar / laneMarkerValues
 *                     escape-hatch markers for scripted lanes
 *   requireStripCheck set false to skip the metro.config.js verification
 *                     (default true)
 */
const fs = require('fs');
const path = require('path');

const { assertRecorderBuildEnv } = require('./build-guard');

function withVitrinkaRecorder(config, props = {}) {
  const variantEnvVar = props.variantEnvVar ?? 'APP_VARIANT';
  const appVariant = process.env[variantEnvVar] ?? 'production';
  assertRecorderBuildEnv(appVariant, props);

  // URL-only enablement: auth is the device link (or an env token for
  // unattended builds), so the URL alone decides whether the recorder ships.
  const enabled = Boolean(process.env.EXPO_PUBLIC_VITRINKA_URL);
  if (enabled && (props.requireStripCheck ?? true)) {
    const projectRoot =
      (config._internal && config._internal.projectRoot) || process.cwd();
    const metroConfigPath = ['metro.config.js', 'metro.config.cjs']
      .map((f) => path.join(projectRoot, f))
      .find((f) => fs.existsSync(f));
    const wired =
      metroConfigPath && fs.readFileSync(metroConfigPath, 'utf8').includes('withRecorderStrip');
    if (!wired) {
      throw new Error(
        '[@vitrinka/expo] Recorder env is set but metro.config.js does not wire ' +
          "withRecorderStrip — without it, builds WITHOUT recorder env would still bundle " +
          'the whole recorder (Metro follows require() before dead-code elimination). Add:\n\n' +
          "  const { withRecorderStrip } = require('@vitrinka/expo/recorder/metro');\n" +
          '  module.exports = withRecorderStrip(config);\n\n' +
          'or pass requireStripCheck: false if you wire the strip another way.',
      );
    }
  }
  return config;
}

module.exports = withVitrinkaRecorder;
