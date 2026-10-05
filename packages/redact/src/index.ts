/**
 * @vitrinka/redact — the recorder redaction engine.
 *
 * Safe-by-default, capture-side scrubbing of auth-bearing headers, sensitive
 * body keys, and URL query/fragment secrets, extensible per workspace via the
 * redaction policy the vitrinka server serves at
 * `GET /api/v1/recorder/policy`. The server re-applies the same policy at
 * ingest (its `internal/redact` engine) as the load-bearing backstop — this
 * engine is defense in depth: secrets never transit, stored payloads shrink.
 *
 * The engine is a PLATFORM, not a client: it owns no I/O and no capture. A
 * recorder (browser extension, Expo, or a future Flutter/Swift/Kotlin port)
 * compiles the policy into a {@link RuleSet} once, then routes each capture
 * surface through the matching transform:
 *
 *   headers     → {@link redactHeaders}
 *   bodies      → {@link redactBody} / {@link redactAndCap}
 *   URLs        → {@link redactUrl}
 *   free text   → {@link redactText}
 *   DOM capture → {@link maskDirectives}   (rrweb-style recorders)
 *   pixels      → {@link pixelPolicy}      (screenshot recorders)
 *
 * Conformance is defined by `spec/REDACTION-SPEC.md` + `spec/vectors.json`
 * (ported from the server engine's table tests): any implementation, in any
 * language, must pass the vectors. This TS implementation is the reference.
 *
 * Matching is DELIBERATELY a superset of the server's: the server matches
 * normalized names (lowercase, `-`/`_` stripped) against its default sets;
 * this engine additionally token-matches key names (so `X-Dev-Auth-Secret`,
 * `otpCode` and `user_password_hash` hit without being listed). Over-redacting
 * a value the server would keep is acceptable; the reverse is not.
 *
 * FAIL CLOSED: `compileRules(null)` is the full default rule set. A client
 * whose policy fetch fails must use it — never capture-everything. Only an
 * explicit `fullFidelity: true` from the server (self-host escape hatch,
 * env-gated there) disables scrubbing.
 */

/** Replaces every scrubbed value — a marker, not "", so a replayed session
 * still shows that a header/field WAS present. */
export const REDACTED = '[redacted]';

// ---------------------------------------------------------------------------
// Policy → RuleSet
// ---------------------------------------------------------------------------

/**
 * The workspace-configurable redaction policy, exactly as the server serves
 * it. The zero/absent policy is the safe default.
 */
export interface RedactionPolicy {
  /** Additional header names whose values are scrubbed. */
  extraHeaders?: string[];
  /** Additional JSON/form body keys to scrub recursively. */
  extraBodyKeys?: string[];
  /**
   * Extra regex patterns; every match in recorded string values is replaced.
   * The server pre-filters these to a backtracking-safe subset before serving
   * them to clients; each is still compiled in its own try/catch here.
   */
  patterns?: string[];
  /** Mask ALL text in DOM recordings; screenshot recorders degrade pixels. */
  maskAllText?: boolean;
  /**
   * Disables redaction entirely — the self-host escape hatch. Only ever
   * honored when the server explicitly served it; clients never default to it.
   */
  fullFidelity?: boolean;
}

/** A compiled policy — build once per policy via {@link compileRules}. */
export interface RuleSet {
  readonly full: boolean;
  readonly maskAllText: boolean;
  /** Normalized header names (defaults + policy extras). */
  readonly headers: ReadonlySet<string>;
  /** Normalized body-key names (defaults + policy extras). */
  readonly bodyKeys: ReadonlySet<string>;
  readonly patterns: readonly RegExp[];
}

/** Always-scrubbed header names, normalized — mirrors the server engine. */
const DEFAULT_HEADERS = [
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'xapikey',
  'xauthtoken',
  'xcsrftoken',
  'xamzsecuritytoken',
];

/** Always-scrubbed body keys, normalized — mirrors the server engine. */
const DEFAULT_BODY_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'apikey',
  'clientsecret',
  'card',
  'cardnumber',
  'cvv',
  'cvc',
  'pin',
  'ssn',
];

/** Canonicalize a header/body-key name: lowercase, `-` and `_` removed. */
export function norm(s: string): string {
  return String(s).toLowerCase().replace(/[-_]/g, '');
}

let cache: { src: string; rules: RuleSet } | null = null;

/**
 * Compile a policy (or null/undefined = the safe defaults) into a RuleSet.
 * Cached by policy identity, so calling per event is free. Bad regexes are
 * skipped individually — the server backstop still applies them at ingest.
 */
export function compileRules(policy?: RedactionPolicy | null): RuleSet {
  const src = JSON.stringify(policy ?? null);
  if (cache?.src === src) return cache.rules;
  const headers = new Set(DEFAULT_HEADERS);
  const bodyKeys = new Set(DEFAULT_BODY_KEYS);
  const patterns: RegExp[] = [];
  for (const h of policy?.extraHeaders ?? []) {
    const n = norm(h);
    if (n) headers.add(n);
  }
  for (const k of policy?.extraBodyKeys ?? []) {
    const n = norm(k);
    if (n) bodyKeys.add(n);
  }
  for (const p of policy?.patterns ?? []) {
    try {
      patterns.push(new RegExp(p, 'g'));
    } catch (e) {
      // Server-validated as RE2; an engine-specific miss must not kill capture.
      console.warn('vitrinka redact: unsupported pattern skipped', p, e);
    }
  }
  const rules: RuleSet = {
    full: policy?.fullFidelity === true,
    maskAllText: policy?.maskAllText === true,
    headers,
    bodyKeys,
    patterns,
  };
  cache = { src, rules };
  return rules;
}

// ---------------------------------------------------------------------------
// Key classification — token matching on top of the normalized sets
// ---------------------------------------------------------------------------

/** Exact key TOKENS that mark a secret (compared per word, case-folded). */
const SECRET_TOKENS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'auth',
  'authorization',
  'otp',
  'pin',
  'apikey',
  'credential',
  'credentials',
  'cookie',
  'cvv',
  'cvc',
  'iban',
  'ssn',
]);

/** Multi-word names that only read as secrets when joined. */
const SECRET_PHRASES = [
  'apikey',
  'privatekey',
  'secretkey',
  'sessionid',
  'cardnumber',
  'birthnumber',
  'rodnecislo',
  'accesstoken',
  'refreshtoken',
  'idtoken',
];

/** Split a key into lowercase word tokens: camelCase, snake_case, kebab-case, dots. */
function tokenize(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/**
 * Token-wise secret detection: TOKEN matching, not substring, so `author`,
 * `authorId`, `shippingAddress` and `pinned` stay intact while
 * `Authorization`, `accessToken` and `X-Dev-Auth-Secret` are caught.
 */
export function isSecretKey(key: string): boolean {
  const tokens = tokenize(key);
  if (tokens.some((t) => SECRET_TOKENS.has(t))) return true;
  // Phrases match a run of CONSECUTIVE tokens, never a raw substring of the
  // joined key: `joined.includes('privatekey')` also matched
  // `privateKeyboardEnabled` and `apiKeyboardLayout`.
  for (let i = 0; i < tokens.length; i++) {
    let run = '';
    for (let j = i; j < tokens.length; j++) {
      run += tokens[j];
      if (SECRET_PHRASES.includes(run)) return true;
      if (run.length > 24) break; // no phrase is longer
    }
  }
  return false;
}

/**
 * Is this header's value scrubbed? Listed (defaults + policy), an
 * api-key/token-suffixed variant (the server's suffix rule), or token-secret.
 */
export function sensitiveHeader(rules: RuleSet, name: string): boolean {
  const n = norm(name);
  return (
    rules.headers.has(n) || n.endsWith('apikey') || n.endsWith('token') || isSecretKey(name)
  );
}

/** Is this JSON/form key's value scrubbed? Listed (normalized) or token-secret. */
export function sensitiveBodyKey(rules: RuleSet, name: string): boolean {
  return rules.bodyKeys.has(norm(name)) || isSecretKey(name);
}

/**
 * Is this URL query/fragment parameter's value scrubbed? Every sensitive body
 * key, plus the api-key/token suffix rule (?access_token=…, ?sas_token=…).
 */
export function sensitiveParam(rules: RuleSet, name: string): boolean {
  if (sensitiveBodyKey(rules, name)) return true;
  const n = norm(name);
  return n.endsWith('apikey') || n.endsWith('token');
}

/**
 * A PEM private key — RSA, EC, OPENSSH, PKCS#8, ENCRYPTED, any label — is a
 * secret by its VALUE, whatever key or line carries it (`keyPem`, a logged
 * config, a pasted textarea body). The whole block becomes one marker. A
 * block with no END line (cut off by a body cap) is scrubbed to the end of
 * the string: the cap must never become a bypass. A certificate or public
 * key PEM is not a secret and stays.
 */
const PEM_PRIVATE_KEY =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

/** A PEM private-key header in DECODED text; `+` is a space in a form value. */
const PEM_PRIVATE_KEY_HEADER = /-----BEGIN[A-Z +]*PRIVATE[ +]KEY-----/;

/** Replace every PEM private-key block in one string value. */
function scrubPem(s: string): string {
  return s.includes('PRIVATE KEY-----') ? s.replace(PEM_PRIVATE_KEY, REDACTED) : s;
}

/**
 * Apply the built-in value patterns (PEM private keys) and the policy's extra
 * regex patterns to one string value. Every surface's string values pass
 * through here, so a value-shaped secret is caught regardless of its key.
 */
function maskPatterns(rules: RuleSet, s: string): string {
  let out = scrubPem(s);
  for (const rx of rules.patterns) {
    rx.lastIndex = 0;
    out = out.replace(rx, REDACTED);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Percent-decoding for INSPECTION (never for output), failing closed
// ---------------------------------------------------------------------------

/**
 * Does this DECODED value carry a secret — a `secretkey=value` pair, or a PEM
 * private key (which only reads as one once its `%0A`/`+` escapes are gone)?
 */
function containsSecretPair(rules: RuleSet, text: string): boolean {
  if (PEM_PRIVATE_KEY_HEADER.test(text)) return true;
  for (const m of text.matchAll(/([A-Za-z][A-Za-z0-9_.\-[\]]{0,60})\s*[:=]/g)) {
    if (sensitiveBodyKey(rules, m[1] as string)) return true;
  }
  return false;
}

/**
 * Decode for INSPECTION, failing closed. `decodeURIComponent` is
 * all-or-nothing: one malformed escape anywhere (`?next=token%3Dhunter2%ZZ`)
 * threw, and the value was then scanned in its still-encoded form where
 * `containsSecretPair` cannot see the encoded `=`. Decode escape-by-escape so
 * a bad tail cannot hide a good prefix, and repeat a bounded number of times
 * so a double-encoded `token%253D…` is seen.
 */
function safeDecode(s: string): string {
  let out = s;
  for (let pass = 0; pass < 3; pass++) {
    const next = decodeEscapes(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Percent-decode what we can; leave individually-malformed escapes as-is. */
function decodeEscapes(s: string): string {
  if (!s.includes('%')) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    // Per-run best effort, then per-ESCAPE: a run containing malformed UTF-8
    // (e.g. `%3Dhunter2%E0%80`) used to be returned whole, keeping the valid
    // `%3D` encoded so the structural scan could not see it. ASCII-range
    // escapes decode individually; non-ASCII bytes that cannot stand alone
    // are left as-is.
    return s.replace(/(%[0-9A-Fa-f]{2})+/g, (seq) => {
      try {
        return decodeURIComponent(seq);
      } catch {
        return seq.replace(/%([0-9A-Fa-f]{2})/g, (esc, hex: string) => {
          const code = Number.parseInt(hex, 16);
          return code < 0x80 ? String.fromCharCode(code) : esc;
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// URLs — query AND fragment, split on BOTH `&` and `;`
// ---------------------------------------------------------------------------

/**
 * Redact sensitive-keyed pairs in one raw query/fragment/form string,
 * splitting on BOTH separators (`&` and `;`). Never URLSearchParams (it
 * treats `;` as a literal, hiding a trailing `;access_token=…` inside the
 * previous value) and never the platform URL parser (React Native's is
 * incomplete). A pair with a benign name still loses its value when the
 * DECODED value carries an embedded secret pair (`?next=%2Fcb%3Ftoken%3D…`).
 * A fully benign string comes back byte-identical.
 */
export function scrubPairs(
  rules: RuleSet,
  sensitive: (rules: RuleSet, name: string) => boolean,
  raw: string,
): string {
  let changed = false;
  const out = raw
    .split(/[&;]/)
    .map((p) => {
      if (p === '') return p;
      const i = p.indexOf('=');
      const key = i >= 0 ? p.slice(0, i) : p;
      const name = safeDecode(key.replace(/\+/g, ' '));
      // Hash-route fragments nest a query inside one "pair":
      // `#/reset?token=SECRET` arrives as key `/reset?token`. Token matching
      // catches suffix-shaped names, but set-only keys (`card`, policy
      // extraBodyKeys) match on the WHOLE normalized name — inspect the part
      // after the last `?` too, or nested keys evade the equality matchers.
      const q = name.lastIndexOf('?');
      const nested = q >= 0 ? name.slice(q + 1) : null;
      if (sensitive(rules, name) || (nested !== null && sensitive(rules, nested))) {
        changed = true;
        return `${key}=${REDACTED}`;
      }
      if (i >= 0 && containsSecretPair(rules, safeDecode(p.slice(i + 1)))) {
        changed = true;
        return `${key}=${REDACTED}`;
      }
      return p; // preserve benign pairs' original encoding
    });
  return changed ? out.join('&') : raw;
}

/**
 * Redact sensitive query/fragment parameter values in one URL — OAuth/OIDC
 * callbacks (?access_token=…), magic links (?token=…), SAS URLs. The fragment
 * scrubs too (implicit-grant OAuth returns tokens as `#access_token=…`).
 * String-split rather than URL-parsed: React Native's URL is incomplete, and
 * an unparseable URL must never be a free pass. Benign URLs pass through
 * byte-identical; the extra patterns run over the result.
 */
export function redactUrl(rules: RuleSet, raw: string): string {
  if (rules.full || !raw) return raw;
  const i = raw.search(/[?#]/);
  if (i < 0) return maskPatterns(rules, raw);
  // Everything after the first ?/# is pair territory; the # split keeps a
  // fragment's pairs keyed correctly (and `#/spa/route` fragments, with no
  // `=`, come back untouched).
  const scrubbed = raw
    .slice(i + 1)
    .split('#')
    .map((seg) => scrubPairs(rules, sensitiveParam, seg))
    .join('#');
  return maskPatterns(rules, raw.slice(0, i + 1) + scrubbed);
}

// ---------------------------------------------------------------------------
// Free text — header lines, auth schemes, JWTs, key=value pairs
// ---------------------------------------------------------------------------

/**
 * Generic `key=value` / `"key": "value"` scanner for non-JSON text. The key is
 * handed to the SAME predicates as the structural path, so the two can never
 * drift apart. Quantifiers are bounded — an unbounded key-prefix class
 * backtracks quadratically. The VALUE groups are unbounded on purpose: a
 * `{1,4096}` bound matched only a prefix, leaving the tail of a longer
 * credential recorded verbatim (negated classes with `*` are linear).
 */
const KV_PAIR = /([A-Za-z][A-Za-z0-9_.\-[\]]{0,60})("?\s*[:=]\s*(?!\/\/))("?)([^&?"'\s,}]*)\3/g;

/**
 * Query parameters get their OWN pass, before the generic scanner. Without it
 * a URL's scheme matched the generic pattern first (`https:` as key), which
 * consumed the query string so its real parameters were never examined.
 */
const QUERY_PARAM = /([?&])([^=&#\s]{1,120})=([^&#\s]*)/g;

/**
 * Header-shaped lines (`Key: value`) mask their ENTIRE value: for a header
 * the secret is the rest of the line, not a whitespace-free token.
 */
const HEADER_LINE = /^([A-Za-z][A-Za-z0-9_.-]{0,60})[ \t]*:[ \t]*(.+)$/gm;

/** Beyond this, only the structural JSON path is worth running. */
const MASK_TEXT_LIMIT = 128 * 1024;

function maskText(rules: RuleSet, text: string): string {
  if (text.length > MASK_TEXT_LIMIT) return `[body omitted: ${text.length} bytes, unmaskable]`;
  // PEM blocks go FIRST: the key=value pass below can swallow a block's END
  // line (`…AB=\n-----END` reads as a pair), which would leave the block
  // matched only up to the end of the string.
  const scrubbed = scrubPem(text)
    // Secret HEADERS mask their whole value first — running this before the
    // generic pass avoids matching only `Bearer` in `authorization: Bearer
    // <token>` and only the first pair of `Cookie: a=1; b=2`.
    .replace(HEADER_LINE, (match, key: string) =>
      sensitiveHeader(rules, key) ? `${key}: ${REDACTED}` : match,
    )
    // An auth header appearing MID-LINE (not at line start) loses everything
    // after the key — without wiping ANY line containing e.g. "Digest".
    .replace(
      /\b((?:proxy-)?authorization|www-authenticate)(\s*[:=]\s*)[^\r\n]+/gi,
      (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`,
    )
    // A scheme CHALLENGE/CREDENTIAL standing on its own. The lookahead
    // requires the first token after the scheme to be a `param=`, which is
    // what makes this a credential rather than prose — `Digest mismatch for
    // asset …` does not match, `Digest realm="api", nonce="abc"` does.
    .replace(
      /\b(Digest|Negotiate|NTLM)\s+(?=[A-Za-z][A-Za-z-]{0,30}\s*=)[^\r\n]+/gi,
      (_m, scheme: string) => `${scheme} ${REDACTED}`,
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9._-]{10,}/g, REDACTED) // bare JWT
    .replace(QUERY_PARAM, (match, lead: string, key: string, value: string) => {
      if (sensitiveParam(rules, safeDecode(key))) return `${lead}${key}=${REDACTED}`;
      // An ordinary key can CARRY an encoded URL/form payload that holds a
      // secret: `?next=%2Fcb%3Ftoken%3Dsupersecret`.
      if (containsSecretPair(rules, safeDecode(value))) return `${lead}${key}=${REDACTED}`;
      return match;
    })
    .replace(KV_PAIR, (match, key: string, sep: string, quote: string, value: string) => {
      if (value === REDACTED) return match; // already masked by an earlier pass
      return sensitiveBodyKey(rules, key) ? `${key}${sep}${quote}${REDACTED}${quote}` : match;
    });
  return maskPatterns(rules, scrubbed);
}

// ---------------------------------------------------------------------------
// Bodies — JSON structural, form-encoded, multipart, truncation fallback
// ---------------------------------------------------------------------------

/** URL-valued payload keys get query/fragment scrubbing, not just patterns. */
function urlKey(k: string): boolean {
  switch (norm(k)) {
    case 'url':
    case 'href':
    case 'uri':
    case 'location':
      return true;
    default:
      return false;
  }
}

const MAX_SCRUB_DEPTH = 64; // recursion guard for hostile deeply-nested bodies

function scrubTree(rules: RuleSet, v: unknown, depth: number): unknown {
  if (depth > MAX_SCRUB_DEPTH) return REDACTED;
  if (Array.isArray(v)) return v.map((x) => scrubTree(rules, x, depth + 1));
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, mv] of Object.entries(v as Record<string, unknown>)) {
      if (sensitiveBodyKey(rules, k)) out[k] = REDACTED;
      else if (typeof mv === 'string' && urlKey(k)) out[k] = redactUrl(rules, mv);
      else out[k] = scrubTree(rules, mv, depth + 1);
    }
    return out;
  }
  return typeof v === 'string' ? maskPatterns(rules, v) : v;
}

/**
 * Key-pair fallback for a body that LOOKS like JSON but fails to parse
 * (typically truncated at a client's byte cap) — the cap must never become a
 * redaction bypass. The string alternative accepts a missing closing quote
 * (truncation); the bare alternative stops at JSON structure.
 */
/** Decode JSON string escapes in a KEY for classification (`password`
 * ≡ `password` to a real parser, so it must be to the fallback too). */
function decodeJsonKey(key: string): string {
  if (!key.includes('\\')) return key;
  return key.replace(/\\u([0-9A-Fa-f]{4})|\\(.)/g, (_m, hex: string, ch: string) =>
    hex !== undefined ? String.fromCharCode(Number.parseInt(hex, 16)) : ch,
  );
}

function scrubTruncatedJson(rules: RuleSet, body: string): string {
  // The bare-value alternative stops at JSON STRUCTURE (`{`, `[`, `"` as well
  // as `,}]`): a benign key must consume only its scalar value, never a
  // nested object — `"nested":{"access_token":…}` would otherwise ride inside
  // the benign match and the sensitive pair would never be scanned. The key
  // class admits JSON escapes, DECODED before classification — a real parser
  // sees `password` as `password`, so the fallback must too.
  return body.replace(
    /("((?:[A-Za-z0-9_-]|\\u[0-9A-Fa-f]{4}|\\.)+)"\s*:\s*)("(?:[^"\\]|\\.)*"?|[^,{}[\]"\r\n]*)/g,
    (m, pre: string, key: string) =>
      sensitiveBodyKey(rules, decodeJsonKey(key)) ? `${pre}"${REDACTED}"` : m,
  );
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

/**
 * Scrub a multipart/form-data body: every form field whose name is a
 * sensitive body key loses its value; other part values (including file
 * parts) get the FULL free-text scan — a part value can be a header line, a
 * bare JWT, or embedded JSON carrying sensitive keys. Rebuilt with the SAME
 * boundary. Returns null — caller falls back to free-text masking over the
 * whole body — when the content-type carries no boundary or the structure
 * won't parse (typically truncated at the client cap): never emit a
 * half-scrubbed reconstruction.
 */
function scrubMultipart(rules: RuleSet, body: string, contentType: string): string | null {
  const bm = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!bm) return null;
  const delim = `--${bm[1]}`;
  const segs = body.split(delim);
  // Shape: "" ‖ "\r\n<headers>\r\n\r\n<value>\r\n" × N ‖ "--…" (closing).
  if (segs.length < 3 || segs[0] !== '') return null;
  if (!(segs[segs.length - 1] as string).startsWith('--')) return null; // truncated
  const out: string[] = [segs[0] as string];
  for (let i = 1; i < segs.length - 1; i++) {
    const seg = segs[i] as string;
    if (!seg.startsWith('\r\n') || !seg.endsWith('\r\n')) return null;
    const hb = seg.indexOf('\r\n\r\n');
    if (hb < 0) return null;
    const partHeaders = seg.slice(2, hb);
    const value = seg.slice(hb + 4, -2);
    const nm = /content-disposition:[^\r\n]*;\s*name="([^"]*)"/i.exec(partHeaders);
    const name = nm?.[1] ?? '';
    // Benign parts get the FULL text scanner, not patterns alone — a part
    // value can be a header line (`Authorization: Bearer …`), a bare JWT, or
    // an embedded JSON body carrying sensitive keys.
    const scrubbed =
      name !== '' && sensitiveBodyKey(rules, name) ? REDACTED : maskText(rules, value);
    out.push(`\r\n${partHeaders}\r\n\r\n${scrubbed}\r\n`);
  }
  out.push(segs[segs.length - 1] as string);
  return out.join(delim);
}

/** Bodies above this skip the structural JSON path (parse + deep-copy cost). */
const JSON_STRUCTURAL_LIMIT = 256 * 1024;

/**
 * Scrub one request/response body. JSON parses + scrubs recursively (shape
 * preserved so a timeline still shows which fields were sent); a JSON-looking
 * body that fails to parse — or is too big to parse safely — gets the
 * key-pair fallback; form-encoded and multipart bodies scrub key-wise;
 * anything else gets the free-text scanner + patterns. Never throws — capture
 * must not break the recorded app.
 */
export function redactBody(rules: RuleSet, body: string, contentType?: string): string {
  if (rules.full || !body) return body;
  try {
    if (looksLikeJson(body)) {
      if (body.length <= JSON_STRUCTURAL_LIMIT) {
        try {
          return JSON.stringify(scrubTree(rules, JSON.parse(body), 0));
        } catch {
          // truncated/malformed — fall through to the key-pair fallback
        }
      }
      return maskPatterns(rules, scrubTruncatedJson(rules, body));
    }
    const ct = (contentType ?? '').toLowerCase();
    if (ct.includes('x-www-form-urlencoded')) {
      // Key-wise scrub FIRST, then the full free-text scanner — the CT path
      // must be a SUPERSET of the shapeless-text path, never a replacement:
      // a benign-keyed value can carry a raw credential the key scrub cannot
      // see (`client_assertion=eyJ…` — RFC 7523 / private_key_jwt).
      return maskText(rules, scrubPairs(rules, sensitiveBodyKey, body));
    }
    if (ct.includes('multipart/form-data')) {
      const scrubbed = scrubMultipart(rules, body, contentType ?? '');
      if (scrubbed !== null) return scrubbed;
      // Unparseable (truncated at a cap, missing boundary): FAIL CLOSED and
      // omit the body. The free-text scanner cannot see multipart structure —
      // a leading `name="password"` part's raw value sits on its own line
      // where no key=value rule fires — so emitting a scan of it would leak
      // exactly the fields the key scrub exists for.
      return `[multipart body omitted: unparseable (${body.length} chars)]`;
    }
    return maskText(rules, body);
  } catch {
    return REDACTED; // never let a redaction failure leak the raw payload
  }
}

/**
 * Redact a free-text capture (console line, unknown-shape body, URL-bearing
 * log). JSON is walked structurally; anything else gets the text scanner.
 * Never throws.
 */
export function redactText(rules: RuleSet, text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (rules.full) return text;
  if (looksLikeJson(text)) {
    try {
      return JSON.stringify(scrubTree(rules, JSON.parse(text), 0));
    } catch {
      // malformed (or truncated) JSON — fall through to text masking
    }
  }
  try {
    return maskText(rules, text);
  } catch {
    return REDACTED;
  }
}

/**
 * Redact, then cap to `cap` characters — with the ORDER chosen by shape:
 * JSON redacts WHOLE then caps (capping first would slice it into invalid
 * JSON, downgrading exactly the payloads most likely to carry credentials);
 * anything else caps first (slicing text is harmless and bounds masking
 * cost), then the truncation fallback still guards the sliced tail.
 */
export function redactAndCap(
  rules: RuleSet,
  body: string,
  cap: number,
  contentType?: string,
): string | undefined {
  if (rules.full) return body.length > cap ? `${body.slice(0, cap)}…[truncated]` : body;
  if (body.length > cap && contentType?.toLowerCase().includes('multipart/form-data')) {
    return `[multipart body omitted: oversized (${body.length} chars)]`;
  }
  if (looksLikeJson(body) && body.length <= JSON_STRUCTURAL_LIMIT) {
    const clean = redactBody(rules, body, contentType);
    return clean.length > cap ? `${clean.slice(0, cap)}…[truncated]` : clean;
  }
  const sliced = body.length > cap ? `${body.slice(0, cap)}…[truncated]` : body;
  return redactBody(rules, sliced, contentType);
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** Size caps for a captured header map (one giant cookie must not bloat events). */
export interface HeaderCaps {
  /** Max characters kept of one header value (default 1024). */
  maxValueLen?: number;
  /** Total budget in characters across the whole map (default 8192). */
  budget?: number;
}

/**
 * Scrub + cap a captured header map: sensitive names lose their value, the
 * rest pass the extra patterns; values are bounded individually and by a
 * total budget (the map gains a `…: (truncated)` marker when it overflows).
 */
export function redactHeaders(
  rules: RuleSet,
  headers: Record<string, unknown> | undefined | null,
  caps?: HeaderCaps,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const maxValueLen = caps?.maxValueLen ?? 1024;
  let budget = caps?.budget ?? 8192;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const raw = rules.full
      ? String(v)
      : sensitiveHeader(rules, k)
        ? REDACTED
        : maskPatterns(rules, String(v));
    const val = raw.slice(0, maxValueLen);
    budget -= k.length + val.length;
    if (budget < 0) {
      out['…'] = '(truncated)';
      break;
    }
    out[k] = val;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Capture-surface directives — DOM recorders, screenshot recorders
// ---------------------------------------------------------------------------

/** rrweb-style DOM-capture masking options derived from the rules. */
export interface MaskDirectives {
  /** Fail-closed default: input VALUES are always masked unless fullFidelity. */
  maskAllInputs: boolean;
  /** Mask every text node (policy `maskAllText`). */
  maskAllText: boolean;
  /** Older rrweb spelling of maskAllText; set to `*` when it applies. */
  maskTextSelector?: string;
}

/** DOM-capture masking for rrweb-style recorders. */
export function maskDirectives(rules: RuleSet): MaskDirectives {
  if (rules.full) return { maskAllInputs: false, maskAllText: false };
  return {
    maskAllInputs: true,
    maskAllText: rules.maskAllText,
    ...(rules.maskAllText ? { maskTextSelector: '*' } : {}),
  };
}

/**
 * What a PIXEL capture surface (screenshots — real rendered text, no DOM to
 * mask) must do under these rules: `blur` = degrade resolution until text is
 * unreadable while layout survives; `none` = capture normally.
 */
export function pixelPolicy(rules: RuleSet): 'none' | 'blur' {
  return !rules.full && rules.maskAllText ? 'blur' : 'none';
}
