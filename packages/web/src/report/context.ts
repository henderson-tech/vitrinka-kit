/**
 * The context a host app declares on a report (vt-9515): a small map the
 * server files with it, e.g. `{environment: 'demo', organization: {id:
 * 'org_42', label: 'Turena'}}`. The contract is frozen and the server checks
 * the same limits: at most 8 keys; a key is 1 to 32 characters of
 * [a-z0-9_]; a value is a string of 1 to 100 characters, or `{id, label?}`
 * with an id of 1 to 100 characters and a label of at most 100. Characters
 * are Unicode code points, never UTF-16 units.
 *
 * What the host passes here is CLAIMED (unverified). The same map in the
 * `ctx` claim of the identity token the host's server signed is VERIFIED and
 * wins for a key in both; the widget never reads or rewrites that token.
 * The reserved key `environment` also sets the filed task's environment.
 *
 * The widget validates on the client so a bad entry never costs the report:
 * an invalid key or value is dropped from what is sent and warned about
 * once per page, naming the key and the limit; nothing is ever thrown into
 * the host app.
 */

/** One context value: a plain string, or an entity the host names by id (and a label people read). */
export type ReportContextValue = string | { id: string; label?: string };

/** The map a report carries as `context`: at most 8 keys of [a-z0-9_]{1,32}. */
export type ReportContext = Record<string, ReportContextValue>;

/** What `setContext` and the `context` option accept: a map, or null/undefined to clear it. */
export type ReportContextInput = ReportContext | null | undefined;

export const CONTEXT_MAX_KEYS = 8;
const KEY = /^[a-z0-9_]{1,32}$/;
const VALUE_MAX = 100;

const KEY_RULE = 'a key is 1 to 32 characters of [a-z0-9_]';
const VALUE_RULE = `a value is a string of 1 to ${VALUE_MAX} characters, or {id, label?}`;
const ID_RULE = `an id is 1 to ${VALUE_MAX} characters`;
const LABEL_RULE = `a label is at most ${VALUE_MAX} characters`;
const COUNT_RULE = `a context holds at most ${CONTEXT_MAX_KEYS} keys`;

/** Code points, as the contract counts characters (an emoji is one, not two UTF-16 units). */
function chars(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A clean copy of one value, or the rule it breaks. */
function cleanValue(v: unknown): ReportContextValue | { broken: string } {
  if (typeof v === 'string') {
    const n = chars(v);
    return n >= 1 && n <= VALUE_MAX ? v : { broken: VALUE_RULE };
  }
  if (!isPlainObject(v)) return { broken: VALUE_RULE };
  const { id, label } = v;
  if (typeof id !== 'string' || chars(id) < 1 || chars(id) > VALUE_MAX) return { broken: ID_RULE };
  if (label === undefined) return { id };
  if (typeof label !== 'string' || chars(label) > VALUE_MAX) return { broken: LABEL_RULE };
  // Only id and label leave: anything else on the host's object is not part of the contract.
  return { id, label };
}

export interface CleanedContext {
  context: ReportContext;
  /** One line per dropped entry: the key, quoted, and the rule it broke. */
  dropped: string[];
}

/**
 * The valid part of `input` (a fresh copy, so a later mutation of the
 * host's object never reaches a report) and what was dropped. Entries go in
 * the host's key order; past the eighth valid key the rest are dropped.
 */
export function cleanContext(input: unknown): CleanedContext {
  if (input === null || input === undefined) return { context: {}, dropped: [] };
  if (!isPlainObject(input)) return { context: {}, dropped: ['the whole context (a context is a plain object of keys to values)'] };
  const kept: [string, ReportContextValue][] = [];
  const dropped: string[] = [];
  for (const key of Object.keys(input)) {
    if (!KEY.test(key)) {
      dropped.push(`${JSON.stringify(key)} (${KEY_RULE})`);
      continue;
    }
    const value = cleanValue(input[key]);
    if (typeof value === 'object' && 'broken' in value) {
      dropped.push(`${JSON.stringify(key)} (${value.broken})`);
      continue;
    }
    if (kept.length >= CONTEXT_MAX_KEYS) {
      dropped.push(`${JSON.stringify(key)} (${COUNT_RULE})`);
      continue;
    }
    kept.push([key, value]);
  }
  // fromEntries defines own properties, so a `__proto__` key stays a key and never a prototype.
  return { context: Object.fromEntries(kept), dropped };
}

/** Problems already warned about on this page: a host that sets the same bad map on every render hears it once. */
const warned = new Set<string>();

/** The valid part of `input`; each dropped entry is warned about once per page, never thrown. */
export function normalizeContext(input: unknown): ReportContext {
  const { context, dropped } = cleanContext(input);
  const fresh = dropped.filter((d) => !warned.has(d));
  for (const d of fresh) warned.add(d);
  if (fresh.length) console.warn(`vitrinka: setContext dropped ${fresh.join('; ')}. The report goes without ${fresh.length === 1 ? 'it' : 'them'}.`);
  return context;
}

/** The report body's `context` field: absent for an empty map, so nothing is sent. */
export function contextField(context: ReportContext): { context?: ReportContext } {
  return Object.keys(context).length ? { context } : {};
}
