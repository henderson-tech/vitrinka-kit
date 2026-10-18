/**
 * Files the reporter attaches (vt-8020 D9): picked with 📎, pasted or dropped
 * onto the card, and checked against the project's caps BEFORE anything is
 * sent — a file the server would refuse is refused at once, with a reason
 * that names the cap. The caps come from `GET /api/v1/report-config`
 * `attachments: {maxBytes, maxCount, types}` (the capture profile's); a
 * server that names none gets the defaults below. The files ride the wire's
 * attachment leg (wire.ts), never the `/shot` leg — that stays the report's
 * one reviewed screenshot.
 */
export interface AttachmentCaps {
  /** Per file. */
  maxBytes: number;
  /** Per report. */
  maxCount: number;
  /** MIME types (`image/*` wildcards allowed) or `.ext` suffixes — the file input's `accept` vocabulary. */
  types: readonly string[];
}

export const DEFAULT_ATTACHMENT_CAPS: AttachmentCaps = {
  maxBytes: 10 * 1024 * 1024,
  maxCount: 5,
  types: ['image/*', 'application/pdf', 'text/*'],
};

/** What admit() reads of a file: a `File` has it all. */
export type AttachableFile = Pick<File, 'name' | 'type' | 'size' | 'lastModified'>;

export type Refusal =
  | { kind: 'type'; name: string }
  | { kind: 'size'; name: string; cap: number }
  | { kind: 'count'; cap: number };

function positiveInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;
}

/** The server's `attachments`, field by field; anything missing or malformed takes its default. */
export function parseAttachmentCaps(raw: unknown): AttachmentCaps {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_ATTACHMENT_CAPS;
  const caps: Record<string, unknown> = { ...raw };
  const types = Array.isArray(caps.types) ? caps.types.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim().toLowerCase()) : [];
  return {
    maxBytes: positiveInt(caps.maxBytes, DEFAULT_ATTACHMENT_CAPS.maxBytes),
    // 0 is a real answer: the project switched attaching off.
    maxCount: typeof caps.maxCount === 'number' && Number.isInteger(caps.maxCount) && caps.maxCount >= 0 ? caps.maxCount : DEFAULT_ATTACHMENT_CAPS.maxCount,
    types: types.length ? types : DEFAULT_ATTACHMENT_CAPS.types,
  };
}

/** Does `types` let this file in — by its MIME type (wildcards too) or its name's suffix? */
export function typeAllowed(file: Pick<AttachableFile, 'name' | 'type'>, types: readonly string[]): boolean {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return types.some((t) => {
    if (t === '*' || t === '*/*') return true;
    if (t.startsWith('.')) return name.endsWith(t);
    if (t.endsWith('/*')) return mime.startsWith(t.slice(0, -1));
    return mime === t;
  });
}

function same(a: AttachableFile, b: AttachableFile): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

/**
 * The incoming files that may join `current`, in order: a file already there
 * is skipped quietly; a wrong type, an over-size file or one past the count
 * is refused — `refusal` is the first such reason (one line on the card).
 */
export function admit<F extends AttachableFile>(current: readonly F[], incoming: readonly F[], caps: AttachmentCaps): { files: F[]; refusal: Refusal | null } {
  const files: F[] = [];
  let refusal: Refusal | null = null;
  for (const f of incoming) {
    if ([...current, ...files].some((c) => same(c, f))) continue;
    if (!typeAllowed(f, caps.types)) refusal ??= { kind: 'type', name: f.name };
    else if (f.size > caps.maxBytes) refusal ??= { kind: 'size', name: f.name, cap: caps.maxBytes };
    else if (current.length + files.length >= caps.maxCount) refusal ??= { kind: 'count', cap: caps.maxCount };
    else files.push(f);
  }
  return { files, refusal };
}

/** 2 kB, 1.4 MB, 10 MB — in the widget's language (binary units, as file dialogs count them). */
export function formatBytes(n: number, locale: string): string {
  const fmt = (v: number, unit: string, digits: number) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v)} ${unit}`;
  if (n < 1024) return fmt(n, 'B', 0);
  if (n < 1024 * 1024) return fmt(n / 1024, 'kB', 0);
  return fmt(n / (1024 * 1024), 'MB', n < 10 * 1024 * 1024 ? 1 : 0);
}

/** The caps' types as a person reads them: "images, PDF and text files". */
export function typesLabel(types: readonly string[], names: { image: string; pdf: string; text: string; office: string }, locale: string): string {
  // The server lists exact types (image/png, the office formats): a person reads them as a few groups.
  const group = (t: string): string => {
    if (t.startsWith('image/')) return names.image;
    if (t === 'application/pdf' || t === '.pdf') return names.pdf;
    if (t.startsWith('text/')) return names.text;
    if (/officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(t)) return names.office;
    return t.startsWith('.') ? t : (t.split('/')[1] ?? t);
  };
  const named = types.map(group);
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format([...new Set(named)]);
}

/** A clipboard image arrives as "image.png" every time: number it, so two pastes read as two chips. */
export function pastedName(name: string, n: number): string {
  const generic = /^image\.(\w+)$/i.exec(name);
  return generic ? `pasted-${n}.${generic[1]}` : name;
}
