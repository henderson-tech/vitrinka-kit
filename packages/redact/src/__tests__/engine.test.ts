/**
 * Engine-specific behavior NOT covered by the portable vectors: rule
 * compilation and caching, the token matcher's precision, capture-surface
 * directives, cap ordering, and the oversized-JSON fallback (kept out of
 * vectors.json to avoid a 256 KiB fixture in a portable file).
 */
import { describe, expect, test } from 'bun:test';

import {
  compileRules,
  isSecretKey,
  maskDirectives,
  pixelPolicy,
  redactAndCap,
  redactBody,
  redactHeaders,
  redactText,
  redactUrl,
  REDACTED,
} from '../index';

const DEFAULTS = compileRules(null);

describe('compileRules', () => {
  test('caches by policy identity', () => {
    const a = compileRules({ extraBodyKeys: ['x'] });
    const b = compileRules({ extraBodyKeys: ['x'] });
    expect(a).toBe(b);
    expect(compileRules(null)).not.toBe(a);
  });

  test('null, undefined and empty policy are the safe defaults', () => {
    for (const rules of [compileRules(null), compileRules(undefined), compileRules({})]) {
      expect(rules.full).toBe(false);
      expect(redactHeaders(rules, { Authorization: 'Bearer x' })?.Authorization).toBe(REDACTED);
    }
  });

  test('bad patterns are skipped per-pattern, good ones kept', () => {
    const rules = compileRules({ patterns: ['(', 'GOOD-[0-9]+'] });
    expect(rules.patterns).toHaveLength(1);
    expect(redactBody(rules, 'saw GOOD-123 here', 'text/plain')).toContain(REDACTED);
  });
});

describe('token matcher precision (beyond the server defaults)', () => {
  test('catches unlisted secret-shaped names', () => {
    for (const k of ['X-Dev-Auth-Secret', 'otpCode', 'user_password_hash', 'iban']) {
      expect(isSecretKey(k)).toBe(true);
    }
  });

  test('keeps benign lookalikes', () => {
    for (const k of ['author', 'authorId', 'shippingAddress', 'pinned', 'privateKeyboardEnabled']) {
      expect(isSecretKey(k)).toBe(false);
    }
  });
});

describe('oversized JSON never bypasses via the parse cap', () => {
  test('key fallback runs above the structural limit', () => {
    const body = `{"pad":"${'a'.repeat(257 * 1024)}","password":"hunter2","nested":{"access_token":"AT-BIG"}}`;
    const out = redactBody(DEFAULTS, body, 'application/json');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('AT-BIG');
  });
});

describe('redactAndCap ordering', () => {
  test('JSON redacts whole, then caps — a truncated body cannot smuggle a secret', () => {
    const body = JSON.stringify({ pad: 'x'.repeat(100), password: 'hunter2', tail: 'end' });
    const out = redactAndCap(DEFAULTS, body, 64, 'application/json');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('…[truncated]');
  });

  test('text caps first, then masks the sliced tail', () => {
    const body = `${'a'.repeat(100)} token=SECRET-TAIL`;
    const out = redactAndCap(DEFAULTS, body, 50, 'text/plain');
    expect(out).not.toContain('SECRET-TAIL');
  });

  test('oversized multipart omits even a parseable prefix with a private epilogue', () => {
    const body = '--b\r\nContent-Disposition: form-data; name="note"\r\n\r\nok\r\n--b--\r\nprivate-epilogue' + 'x'.repeat(100);
    const out = redactAndCap(DEFAULTS, body, 100, 'multipart/form-data; boundary=b');
    expect(out).toContain('multipart body omitted');
    expect(out).not.toContain('private-epilogue');
  });

  test('fullFidelity still caps (size is a transport concern, not a policy one)', () => {
    const rules = compileRules({ fullFidelity: true });
    const out = redactAndCap(rules, 'a'.repeat(100), 10, 'text/plain');
    expect(out).toBe(`${'a'.repeat(10)}…[truncated]`);
  });
});

describe('capture-surface directives', () => {
  test('maskDirectives: inputs always masked by default; maskAllText adds text', () => {
    expect(maskDirectives(DEFAULTS)).toEqual({ maskAllInputs: true, maskAllText: false });
    expect(maskDirectives(compileRules({ maskAllText: true }))).toEqual({
      maskAllInputs: true,
      maskAllText: true,
      maskTextSelector: '*',
    });
  });

  test('maskDirectives: fullFidelity disables both', () => {
    expect(maskDirectives(compileRules({ fullFidelity: true }))).toEqual({
      maskAllInputs: false,
      maskAllText: false,
    });
  });

  test('pixelPolicy: blur only under maskAllText without fullFidelity', () => {
    expect(pixelPolicy(DEFAULTS)).toBe('none');
    expect(pixelPolicy(compileRules({ maskAllText: true }))).toBe('blur');
    expect(pixelPolicy(compileRules({ maskAllText: true, fullFidelity: true }))).toBe('none');
  });
});

describe('header caps', () => {
  test('one giant value cannot blow the event budget', () => {
    const out = redactHeaders(DEFAULTS, { 'X-Big': 'v'.repeat(10_000), Accept: 'text/html' });
    expect(out?.['X-Big']).toHaveLength(1024);
  });

  test('budget overflow truncates the map with a marker', () => {
    const many = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`h${i}`, 'v'.repeat(1000)]),
    );
    const out = redactHeaders(DEFAULTS, many);
    expect(out?.['…']).toBe('(truncated)');
  });
});

describe('redactText and redactUrl free-text strengths', () => {
  test('free text keeps header-line and bearer scrubbing', () => {
    const out = redactText(DEFAULTS, 'authorization: Bearer abc.def\nplain line');
    expect(out).toContain(`authorization: ${REDACTED}`);
    expect(out).toContain('plain line');
  });

  test('a benign param carrying an encoded secret pair loses its value', () => {
    const out = redactUrl(DEFAULTS, 'https://x.example/cb?next=%2Fcb%3Ftoken%3Dhunter2');
    expect(out).not.toContain('hunter2');
  });
});
