/**
 * The host's context on a report (vt-9515): the frozen limits the server
 * checks too, applied on the client so a bad entry is dropped and warned
 * about, never thrown and never costing the report.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { cleanContext, CONTEXT_MAX_KEYS, contextField, normalizeContext } from '../context';

let warnings: string[] = [];
const realWarn = console.warn;
beforeEach(() => {
  warnings = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
});
afterEach(() => {
  console.warn = realWarn;
});

describe('a context map', () => {
  it('keeps every valid entry as given: strings and {id, label?}', () => {
    const input = { environment: 'demo', organization: { id: 'org_42', label: 'Turena' }, team: { id: 't1' } };
    expect(cleanContext(input)).toEqual({ context: input, dropped: [] });
  });

  it('drops an invalid key and names the key and the limit', () => {
    const { context, dropped } = cleanContext({ Org: 'x', 'with-dash': 'x', '': 'x', [`k${'x'.repeat(32)}`]: 'x', ok_1: 'y' });
    expect(context).toEqual({ ok_1: 'y' });
    expect(dropped).toHaveLength(4);
    expect(dropped[0]).toBe('"Org" (a key is 1 to 32 characters of [a-z0-9_])');
  });

  it('drops an empty or oversized value, id or label, and a value of another type', () => {
    const { context, dropped } = cleanContext({
      empty: '',
      long: 'x'.repeat(101),
      at_limit: 'x'.repeat(100),
      no_id: { label: 'Turena' },
      long_id: { id: 'x'.repeat(101) },
      long_label: { id: 'org', label: 'x'.repeat(101) },
      empty_label: { id: 'org', label: '' },
      number: 42,
      list: ['a'],
    });
    expect(context).toEqual({ at_limit: 'x'.repeat(100), empty_label: { id: 'org', label: '' } });
    expect(dropped).toEqual([
      '"empty" (a value is a string of 1 to 100 characters after trimming, or {id, label?})',
      '"long" (a value is a string of 1 to 100 characters after trimming, or {id, label?})',
      '"no_id" (an id is 1 to 100 characters after trimming)',
      '"long_id" (an id is 1 to 100 characters after trimming)',
      '"long_label" (a label is at most 100 characters after trimming)',
      '"number" (a value is a string of 1 to 100 characters after trimming, or {id, label?})',
      '"list" (a value is a string of 1 to 100 characters after trimming, or {id, label?})',
    ]);
  });

  it('counts characters as code points: 100 emoji fit, 101 do not', () => {
    expect(cleanContext({ a: '😀'.repeat(100), b: '😀'.repeat(101) }).context).toEqual({ a: '😀'.repeat(100) });
  });

  it('trims a value, id and label before counting, and sends the trimmed text', () => {
    const padded = `  ${'x'.repeat(100)}  `;
    const { context, dropped } = cleanContext({ environment: ' demo ', at_limit: padded, organization: { id: ' org_42 ', label: ' Turena ' } });
    expect(context).toEqual({ environment: 'demo', at_limit: 'x'.repeat(100), organization: { id: 'org_42', label: 'Turena' } });
    expect(dropped).toEqual([]);
  });

  it('drops a value or id that is empty after trimming', () => {
    const { context, dropped } = cleanContext({ plan: ' ', organization: { id: '  ' }, ok: 'y' });
    expect(context).toEqual({ ok: 'y' });
    expect(dropped).toEqual(['"plan" (a value is a string of 1 to 100 characters after trimming, or {id, label?})', '"organization" (an id is 1 to 100 characters after trimming)']);
  });

  it('holds at most 8 keys: the first eight valid ones in the host’s order, the rest dropped by name', () => {
    expect(CONTEXT_MAX_KEYS).toBe(8);
    const input = Object.fromEntries(['bad key', ...Array.from({ length: 10 }, (_, i) => `k${i}`)].map((k) => [k, 'v']));
    const { context, dropped } = cleanContext(input);
    expect(Object.keys(context)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']);
    expect(dropped).toEqual(['"bad key" (a key is 1 to 32 characters of [a-z0-9_])', '"k8" (a context holds at most 8 keys)', '"k9" (a context holds at most 8 keys)']);
  });

  it('sends only id and label, as a copy the host can no longer change', () => {
    const org = { id: 'org_42', label: 'Turena', plan: 'gold' };
    const input: Record<string, unknown> = { organization: org };
    const { context } = cleanContext(input);
    org.id = 'changed';
    input.extra = 'late';
    expect(context).toEqual({ organization: { id: 'org_42', label: 'Turena' } });
  });

  it('null and undefined clear; anything but a plain object clears and is reported', () => {
    expect(cleanContext(null)).toEqual({ context: {}, dropped: [] });
    expect(cleanContext(undefined)).toEqual({ context: {}, dropped: [] });
    for (const bad of ['demo', 42, ['a'], new Date(0)]) {
      expect(cleanContext(bad)).toEqual({ context: {}, dropped: ['the whole context (a context is a plain object of keys to values)'] });
    }
  });

  it('a `__proto__` key stays a key, never the copy’s prototype', () => {
    const { context } = cleanContext(JSON.parse('{"__proto__": "x"}'));
    expect(Object.getPrototypeOf(context)).toBe(Object.prototype);
    expect(Object.keys(context)).toEqual(['__proto__']);
  });
});

describe('setContext’s warning', () => {
  it('names each dropped key once per page and never throws', () => {
    const bad = { Warned_once: 'x', fine: 'ok' };
    expect(normalizeContext(bad)).toEqual({ fine: 'ok' });
    expect(normalizeContext(bad)).toEqual({ fine: 'ok' });
    expect(warnings).toEqual(['vitrinka: setContext dropped "Warned_once" (a key is 1 to 32 characters of [a-z0-9_]). The report goes without it.']);
  });

  it('warns once about a whitespace-only value, naming the key and the rule', () => {
    expect(normalizeContext({ blank_plan: ' ', fine: 'ok' })).toEqual({ fine: 'ok' });
    expect(normalizeContext({ blank_plan: ' ', fine: 'ok' })).toEqual({ fine: 'ok' });
    expect(warnings).toEqual(['vitrinka: setContext dropped "blank_plan" (a value is a string of 1 to 100 characters after trimming, or {id, label?}). The report goes without it.']);
  });

  it('a valid map warns about nothing', () => {
    normalizeContext({ environment: 'demo' });
    expect(warnings).toEqual([]);
  });
});

describe('the report body’s context field', () => {
  it('rides as `context` when the map has a key, and is absent for an empty map', () => {
    expect(contextField({ environment: 'demo' })).toEqual({ context: { environment: 'demo' } });
    expect(contextField({})).toEqual({});
    expect('context' in contextField({})).toBe(false);
  });
});
