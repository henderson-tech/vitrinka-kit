/**
 * Who a report is filed as (QA Studio D4). The host vouches with a token it
 * signed SERVER-SIDE — a compact HS256 JWS over `{sub, email, name?, iat,
 * exp, aud: "<ws>/<project>"}` with the project's host secret, `exp` at most
 * 24 h after `iat` — which files the report directly; or it asserts an
 * email, which binds the report to a pending reporter (quarantined until
 * approved). Neither: anonymous, quarantined.
 *
 * Held in memory only, for the life of the page: the host passes it on
 * every load. The widget never reads the token's claims — the server
 * verifies it; the token itself never leaves for anywhere but `base`.
 */
export type Identity = { token: string } | { email: string; name?: string };

/** What `identify()` accepts: an identity, or null/undefined to go anonymous. */
export type IdentifyInput = Identity | null | undefined;

const JWS = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/** A clean identity, or null (with one warning) for anything malformed. */
export function normalizeIdentity(input: IdentifyInput): Identity | null {
  if (!input) return null;
  if ('token' in input) {
    const token = typeof input.token === 'string' ? input.token.trim() : '';
    if (token.length > 4096 || !JWS.test(token)) {
      console.warn('vitrinka: identify({token}) needs the compact JWS your server signed — reporting anonymously');
      return null;
    }
    return { token };
  }
  const email = typeof input.email === 'string' ? input.email.trim().slice(0, 254) : '';
  if (!email.includes('@')) {
    console.warn('vitrinka: identify({email}) needs an email address — reporting anonymously');
    return null;
  }
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 200) : '';
  return name ? { email, name } : { email };
}

let shared: Identity | null = null;
const listeners = new Set<() => void>();

/** Name the person every mounted widget files as (a widget's own `identify` wins). */
export function identify(input: IdentifyInput): void {
  shared = normalizeIdentity(input);
  for (const l of listeners) l();
}

export function sharedIdentity(): Identity | null {
  return shared;
}

export function onSharedIdentity(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
