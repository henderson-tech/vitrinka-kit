/**
 * `withVitrinkaRecorder` — the build guard for Next apps (`next.config.js`).
 * Node-only, no React import.
 *
 * The recorder ships in any build whose env carries the key; this guard is
 * the safety boundary: a PRODUCTION build (`NODE_ENV=production`) that has
 * the key var set must also declare an allowed lane in `VITRINKA_RECORDER_LANE`
 * (default: `development` or `preview`), or the build refuses with a clear
 * error. The URL alone is allowed everywhere (testers link from the pill); the
 * config is returned unchanged otherwise.
 */

export interface WithVitrinkaRecorderOptions {
  /** Lanes a production build may carry the recorder key in. */
  allowedLanes?: readonly string[];
  /** Env var naming the build's lane. */
  laneVar?: string;
  /** Env var carrying the recorder key. */
  keyVar?: string;
  /** Env var carrying the vitrinka URL (informational — only the key gates). */
  urlVar?: string;
}

export const DEFAULT_ALLOWED_LANES: readonly string[] = ['development', 'preview'];

export function withVitrinkaRecorder<T>(nextConfig: T, opts: WithVitrinkaRecorderOptions = {}): T {
  const allowed = opts.allowedLanes ?? DEFAULT_ALLOWED_LANES;
  const laneVar = opts.laneVar ?? 'VITRINKA_RECORDER_LANE';
  const keyVar = opts.keyVar ?? 'NEXT_PUBLIC_VITRINKA_KEY';
  const env = process.env;
  if (env.NODE_ENV === 'production' && env[keyVar]) {
    const lane = env[laneVar] ?? '';
    if (!allowed.includes(lane)) {
      throw new Error(
        `vitrinka: ${keyVar} is set on a production build but ${laneVar}=${JSON.stringify(lane)} ` +
          `is not an allowed recorder lane (${allowed.join(', ')}). ` +
          `Unset ${keyVar} for this build, or set ${laneVar} to one of the allowed lanes.`,
      );
    }
  }
  return nextConfig;
}
