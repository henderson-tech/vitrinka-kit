/**
 * Transport-status vocabulary, split out of `api.ts` so it carries NO native
 * imports (mirrors expo's api-status). That lets tests assert
 * against the SHIPPED classification rule instead of re-implementing it — a
 * re-implementation would keep passing if the real rule changed
 *.
 */

export class VitrinkaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** A server verdict retrying can never fix (4xx minus timeout/rate-limit). */
export function permanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}
