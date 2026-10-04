# @vitrinka/redact

The vitrinka recorder redaction engine: safe-by-default scrubbing of
auth-bearing headers, sensitive body keys, URL query/fragment secrets and
PEM private keys (by value, under any key) in recorded sessions — extensible per workspace via the redaction policy the
vitrinka server serves, and shared by every vitrinka capture client
([`@vitrinka/expo`](../expo) and the [browser extension](../../apps/extension)).

The vitrinka server applies the same policy again at ingest as the
load-bearing backstop. This engine is defense in depth: with it, secrets never
leave the device at all, and recorded payloads are smaller on the wire.

## Usage

```ts
import {
  compileRules,
  redactHeaders,
  redactBody,
  redactUrl,
  redactAndCap,
  maskDirectives,
  pixelPolicy,
} from '@vitrinka/redact';

// Fetch the workspace policy at session start (GET /api/v1/recorder/policy).
// FAIL CLOSED: on any failure, compile null — the built-in safe defaults.
const rules = compileRules(policyOrNull);

redactHeaders(rules, { Authorization: 'Bearer …' });
//  → { Authorization: '[redacted]' }

redactBody(rules, '{"password":"hunter2"}', 'application/json');
//  → '{"password":"[redacted]"}'

redactUrl(rules, 'https://app.example.com/cb#access_token=…');
//  → 'https://app.example.com/cb#access_token=[redacted]'

redactAndCap(rules, body, 64 * 1024, contentType); // redact-then-cap, shape-aware

maskDirectives(rules); // rrweb-style DOM recorders: maskAllInputs/maskAllText
pixelPolicy(rules);    // screenshot recorders: 'none' | 'blur'
```

`compileRules` caches by policy identity — call it per event for free.
`fullFidelity: true` in the policy (the self-host escape hatch, env-gated
server-side) turns every transform into a pass-through; clients only honor
the field, never default to it.

## Porting to other platforms

The engine is specified language-agnostically in
[`spec/REDACTION-SPEC.md`](spec/REDACTION-SPEC.md), with a portable
conformance suite in [`spec/vectors.json`](spec/vectors.json) (ported from the
server engine's table tests). A recorder for any UI technology — Flutter,
native iOS/Android, desktop — implements the spec's surface transforms and
must pass every vector. This TypeScript implementation is the reference.

## License

[Elastic License 2.0](../../LICENSE).
