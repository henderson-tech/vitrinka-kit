/**
 * Redaction bridge — binds the shared engine (@vitrinka/redact) to the
 * CURRENT session's workspace policy.
 *
 * The engine itself owns all semantics (key classification, JSON/form/
 * multipart bodies, URL query+fragment scrubbing, patterns, fullFidelity);
 * this module owns which RULES apply right now: the safe defaults until a
 * session starts, the session's fetched policy after. FAIL CLOSED — a failed
 * or slow policy fetch means the defaults, never capture-everything.
 *
 * Capture layers import the bound helpers below so every call site stays a
 * one-liner and can never forget to pass the rules. URLs and routes also pass
 * the host's own `sanitizeUrl` (config) first: credentials in PATHS are the
 * app's to name, the engine only sees query and fragment pairs.
 */
import type { eventWithTime, metaEvent } from '@rrweb/types';
import {
  compileRules,
  REDACTED,
  redactAndCap as engineRedactAndCap,
  redactHeaders as engineRedactHeaders,
  redactText as engineRedactText,
  redactUrl as engineRedactUrl,
  maskDirectives as engineMaskDirectives,
  type MaskDirectives,
  type RedactionPolicy,
  type RuleSet,
} from '@vitrinka/redact';

import { recorderConfig } from '../config';
import { currentRoute } from '../state';

// Engine primitives that need no binding, re-exported for tests and callers.
export { isSecretKey, REDACTED, type RedactionPolicy } from '@vitrinka/redact';

let rules: RuleSet = compileRules(null);

/**
 * Apply a session's workspace policy (null = the safe defaults). Called at
 * session start when the fetch resolves, and on provider mount when a session
 * (with its policy) is recovered from storage after a reload.
 */
export function setRedactionPolicy(policy: RedactionPolicy | null | undefined): void {
  rules = compileRules(policy ?? null);
}

/** The active rule set (test + capture-layer introspection). */
export function currentRules(): RuleSet {
  return rules;
}

/** Redact a captured body/log string under the active rules. Never throws. */
export function redactText(text: string | undefined): string | undefined {
  return engineRedactText(rules, text);
}

/**
 * Redact then cap (shape-aware order) under the active rules. Pass the
 * captured content type when known — the engine dispatches its form-encoded
 * and multipart transforms on it; without it those bodies only get the
 * generic text scanner.
 */
export function redactAndCap(
  body: string,
  cap: number,
  contentType?: string,
): string | undefined {
  return engineRedactAndCap(rules, body, cap, contentType);
}

/** The sanitizer whose failure was last reported: once, not on every URL. */
let reportedSanitizer: unknown = null;

/**
 * The host's `sanitizeUrl` over one captured URL or route. FAIL CLOSED: a
 * sanitizer that throws or returns a non-string leaves the URL's origin, or
 * `[redacted]` when it has none (a relative URL, a route), never the raw
 * value. It applies under `fullFidelity` too: it is the host's statement
 * about its own URLs, not a workspace redaction rule.
 */
function sanitizeUrl(url: string): string {
  const sanitize = recorderConfig().sanitizeUrl;
  if (!sanitize) return url;
  let failure: unknown;
  try {
    const out: unknown = sanitize(url);
    if (typeof out === 'string') return out;
    failure = new TypeError(`sanitizeUrl returned ${typeof out}, not a string`);
  } catch (e) {
    failure = e;
  }
  if (reportedSanitizer !== sanitize) {
    reportedSanitizer = sanitize;
    console.warn('vitrinka: sanitizeUrl failed — such URLs are recorded as their origin only', failure);
  }
  return originOf(url) ?? REDACTED;
}

function originOf(url: string): string | null {
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Scrub one URL or route under the active rules: the host's `sanitizeUrl`
 * first (path credentials), then the engine's query/fragment scrub and
 * patterns. Every URL-bearing field the recorder captures passes here.
 */
export function redactUrl(url: string): string {
  return engineRedactUrl(rules, sanitizeUrl(url));
}

/** The `route` an event carries: the current pathname through `redactUrl`. */
export function redactedRoute(): string {
  return redactUrl(currentRoute.pathname);
}

/** rrweb's `EventType.Meta`; `@rrweb/types` is type-only here, so the value. */
const RRWEB_META = 4;

/** rrweb's Meta event — the head of every full snapshot (start, each checkout, resume). */
export function isMetaEvent(ev: eventWithTime): ev is metaEvent & eventWithTime {
  return ev.type === RRWEB_META;
}

/**
 * Scrub an rrweb event before it is buffered. The Meta event that opens every
 * full snapshot (start, each checkout, resume) carries the page's raw
 * `location.href`, query and fragment included; it gets `redactUrl`. Every
 * other event passes through as is — the DOM itself is masked by rrweb under
 * `maskDirectives`.
 */
export function redactRRWebEvent(ev: eventWithTime): eventWithTime {
  if (!isMetaEvent(ev)) return ev;
  return { ...ev, data: { ...ev.data, href: redactUrl(ev.data.href) } };
}

/** Scrub + cap a captured header map under the active rules. */
export function redactHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  return engineRedactHeaders(rules, headers);
}

/** rrweb masking options under the active rules (maskAllInputs / maskAllText). */
export function maskDirectives(): MaskDirectives {
  return engineMaskDirectives(rules);
}
