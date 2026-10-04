# vitrinka recorder redaction — engine specification

This document defines the redaction semantics every vitrinka capture client
must implement, in any language. The TypeScript engine in this package is the
reference implementation; `vectors.json` (same directory) is the conformance
suite — **an implementation is conformant when it passes every vector**. The
vitrinka server applies the same semantics at ingest as the load-bearing
backstop, so client-side redaction is defense in depth: a conformant client
never lets a secret leave the device, and a broken one still cannot store one.

An implementation MAY redact **more** than required (superset matching is
explicitly encouraged), except where a vector's `exact` field demands
byte-identical output — those cases pin down *over*-redaction bugs (benign
data must survive).

## The policy document

Clients fetch the workspace policy at session start from
`GET /api/v1/recorder/policy` (same PAT-gated auth as the ingest surface):

```jsonc
{
  "extraHeaders":  ["X-Tenant-Secret"],   // extra header names to scrub
  "extraBodyKeys": ["internalId"],        // extra body keys, matched normalized
  "patterns":      ["vk_[A-Za-z0-9]+"],   // regexes; every match → "[redacted]"
  "maskAllText":   false,                  // DOM recorders mask ALL text;
                                           // pixel recorders degrade to blur
  "fullFidelity":  false                   // self-host escape hatch — no-op
}
```

Rules:

- **Fail closed.** A failed/slow/absent fetch means the built-in defaults —
  never capture-everything. The fetch must never reject; defaults apply until
  it resolves. Capture may start before it resolves only in states that are
  already safe (DOM recording starts with inputs masked).
- `patterns` served to clients are pre-filtered server-side to a
  backtracking-safe subset, but each pattern still compiles inside its own
  try/catch: a bad pattern is skipped (and logged), the rest keep working.
- `fullFidelity: true` disables all scrubbing. Clients only ever *honor* the
  field (the server refuses to serve it unless the deployment allows it);
  clients never default to it.

## Normalization

`norm(name)` = lowercase, then remove every `-` and `_`. All name matching
below is on normalized names, so `card_number` ≡ `cardNumber` ≡ `Card-Number`.

## Default rule set

Header names (values replaced with `[redacted]`): `authorization`,
`proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`,
`x-csrf-token`, `x-amz-security-token`, plus any name whose normalized form
**ends with** `apikey` or `token`, plus `extraHeaders`.

Body keys (values replaced wholesale, recursively): `password`, `passwd`,
`secret`, `token`, `access_token`, `refresh_token`, `id_token`,
`authorization`, `api_key`, `apikey`, `client_secret`, `card`, `card_number`,
`cvv`, `cvc`, `pin`, `ssn`, plus `extraBodyKeys`.

URL parameters: every sensitive body key, plus the `apikey`/`token` suffix
rule (`?access_token=…`, `?sas_token=…`, `?my_api_key=…`).

Values (scrubbed by shape, whatever key or line carries them): a **PEM
private key** — `-----BEGIN <LABEL>PRIVATE KEY-----` through the matching
`-----END <LABEL>PRIVATE KEY-----`, any label (`RSA `, `EC `, `OPENSSH `,
`ENCRYPTED `, none), across lines — becomes one `[redacted]`. A block with no
END line (cut off by a cap) is scrubbed to the end of the value. This runs
wherever the extra patterns run (every string value of every surface), and
an encoded value (form/query, `+` or `%20` for spaces) whose *decoded* form
holds the BEGIN line loses its whole value. Certificates and public keys
are not secrets and stay.

The reference engine additionally **token-matches** names (splitting
camelCase/snake/kebab into words) against a secret vocabulary (`auth`, `otp`,
`pin`, `cvv`, `iban`, `ssn`, `credential`, …) and secret phrases
(`privatekey`, `sessionid`, `cardnumber`, …), so `X-Dev-Auth-Secret` and
`otpCode` are caught without being listed. Ports SHOULD implement this; the
vectors only require the normalized-set matching above.

## Surfaces

Every capture surface routes through the matching transform. The replacement
marker is always the string `[redacted]` — a marker, not deletion, so replay
still shows the field existed.

### Headers

Sensitive names lose their value; benign values pass through the extra
patterns. Values are capped (reference: 1024 chars/value, 8 KiB budget per
map, overflow marked with a `"…": "(truncated)"` entry).

### Bodies

Dispatch on shape and declared content type:

1. **JSON** (first non-space char `{`/`[`), within the structural size limit:
   parse, walk recursively (bounded depth; beyond it, subtree → `[redacted]`).
   Sensitive-keyed values replaced wholesale; string values under URL-ish keys
   (`url`, `href`, `uri`, `location`) get URL scrubbing; every other string
   passes the extra patterns.
2. **JSON that fails to parse or exceeds the parse limit** (truncated at a
   client cap — the cap must NEVER become a bypass): a key-pair fallback regex
   rewrites `"<sensitive-key>": <value>` pairs, tolerating a missing closing
   quote; then patterns.
3. **`application/x-www-form-urlencoded`**: split pairs on **both `&` and
   `;`** and scrub key-wise, THEN run the free-text scan over the result.
   Never a platform query parser — `;` handling is the known bypass class
   (see below). The content-type path must be a SUPERSET of the shapeless
   free-text path, never a replacement: a benign-keyed value can carry a raw
   credential the key scrub cannot see (`client_assertion=eyJ…`).
4. **`multipart/form-data`**: parse parts by the boundary; a part whose
   `Content-Disposition` form name is sensitive loses its value; other part
   values (file parts included) get the free-text scan (a part value can be a
   header line, a bare JWT, or embedded JSON carrying sensitive keys);
   rebuild with the same boundary. If the body won't parse (truncated, no
   boundary): FAIL CLOSED — omit the body with a marker. Free-text scanning
   cannot see multipart structure (a `name="password"` part's raw value sits
   on its own line), so a partial scan would leak exactly the fields the key
   scrub exists for.
5. **Anything else**: free-text scanning (reference behavior, see below) and
   the extra patterns. At minimum the patterns must run.

**Order with capping**: redact JSON *before* any size cap (capping first
makes it invalid JSON and silently downgrades it to the weaker fallback);
cap free text first, then scrub the slice.

### URLs

Scrub the query AND the fragment (implicit-grant OAuth returns tokens as
`#access_token=…`). Split pairs on **both `&` and `;`** — never
`URLSearchParams`/`url.ParseQuery`, which mishandle `;` and turn one
semicolon into a full bypass. Do not trust platform URL parsers to accept
every captured URL: an unparseable URL still scrubs everything after the
first `?`/`#` (the reference implementation is string-split end to end).
A fully benign URL comes back **byte-identical** (no re-encoding churn).

A benign-named parameter whose *decoded* value embeds a secret pair
(`?next=%2Fcb%3Ftoken%3D…`) also loses its value (reference behavior;
decoding for inspection fails closed, escape-by-escape, bounded double-decode).
Hash-route fragments nest a query inside one pair (`#/reset?token=…` yields
the key `/reset?token`): the part after the last `?` in a pair's key MUST be
inspected as a name too, or set-matched keys (including policy extras) evade
the scrub. Truncated-JSON fallback keys MUST be classified with JSON string
escapes decoded (`pass\\u0077ord` ≡ `password`).

### Free text (reference engine; ports SHOULD follow)

Header-shaped lines (`Key: value`) with sensitive names lose the rest of the
line; `Authorization`-family names mask mid-line too; standalone scheme
credentials (`Bearer …`, `Basic …`, `Digest realm=…`) and bare JWTs
(`eyJ…`) are masked; generic `key=value` / `"key": value` pairs with
sensitive keys lose their values. Then patterns.

### DOM capture (rrweb-style recorders)

`maskDirectives(rules)`:

- default: `maskAllInputs: true` — input values never recorded. This is the
  fail-closed *starting* state: recording must begin masked even if policy
  delivery races.
- `maskAllText` ⇒ `maskAllText: true` + `maskTextSelector: "*"`.
- `fullFidelity` ⇒ both off.

### Pixel capture (screenshot recorders)

Screenshots carry real rendered text — there is no DOM to mask. Under
`maskAllText` (without `fullFidelity`) `pixelPolicy(rules)` = `blur`: degrade
resolution until text is unreadable while layout survives. Otherwise `none`.

## Event shape invariants

- Recorded event kinds never change (`net` for Expo, `request` for the
  extension — stored sessions carry them forever).
- Existing body caps (64 KiB in both kit clients) stay as they are.

## Conformance

Run every case in `vectors.json`. Case surfaces map to:
`headerName` → the sensitive-header predicate; `headers` → the header map
transform; `body` → the body transform (with `contentType`); `url` → the URL
transform. Assertions: `exact` (byte-identical output), `mustNotContain`,
`mustContain`, `outputIsJson`, `redactedKeys`/`keptEntries`/
`valueMustNotContain` for header maps. The `policy` field, when present, is
the policy to compile for that case.
