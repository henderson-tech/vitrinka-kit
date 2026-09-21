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
 * one-liner and can never forget to pass the rules.
 */
import {
  compileRules,
  redactAndCap as engineRedactAndCap,
  redactHeaders as engineRedactHeaders,
  redactText as engineRedactText,
  redactUrl as engineRedactUrl,
  maskDirectives as engineMaskDirectives,
  type MaskDirectives,
  type RedactionPolicy,
  type RuleSet,
} from '@vitrinka/redact';

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

/** Scrub URL query/fragment secrets under the active rules. */
export function redactUrl(url: string): string {
  return engineRedactUrl(rules, url);
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
