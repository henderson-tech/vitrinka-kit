/**
 * The reporter's files (vt-8020 D9): the caps come from the report config or
 * fall back to the defaults, a file past a cap is refused naming it, and the
 * wire's attachment leg resumes — a retry never sends a landed file twice.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { admit, DEFAULT_ATTACHMENT_CAPS, formatBytes, parseAttachmentCaps, pastedName, typesLabel } from '../attachments';
import type { BuiltCapture } from '../engine';
import { type ReportEnvelope, ReportJob } from '../wire';

const BASE = 'https://vitrinka.test';
const file = (name: string, type: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type, lastModified: 1 });

describe('caps', () => {
  it('reads the server’s caps field by field; anything missing or malformed takes its default', () => {
    expect(parseAttachmentCaps(undefined)).toEqual(DEFAULT_ATTACHMENT_CAPS);
    expect(parseAttachmentCaps({ maxBytes: 2048, maxCount: -1, types: ['IMAGE/PNG', 7] })).toEqual({
      maxBytes: 2048,
      maxCount: DEFAULT_ATTACHMENT_CAPS.maxCount,
      types: ['image/png'],
    });
  });

  it('keeps maxCount 0 — the project switched attaching off', () => {
    expect(parseAttachmentCaps({ maxCount: 0 }).maxCount).toBe(0);
  });

  it('names the server’s exact types as the few groups a person reads', () => {
    const names = { image: 'images', pdf: 'PDF', text: 'text files', office: 'office documents' };
    const types = ['image/png', 'image/jpeg', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
    expect(typesLabel(types, names, 'en')).toBe('images, PDF, text files, and office documents');
  });

  it('refuses a wrong type, an over-size file and one past the count — the first reason names its cap', () => {
    const caps = { maxBytes: 100, maxCount: 2, types: ['image/*', '.pdf'] };
    const shot = file('shot.png', 'image/png');
    const spec = file('spec.pdf', '');
    expect(admit([], [shot, file('notes.zip', 'application/zip'), spec], caps)).toEqual({ files: [shot, spec], refusal: { kind: 'type', name: 'notes.zip' } });
    expect(admit([], [file('big.png', 'image/png', 101)], caps).refusal).toEqual({ kind: 'size', name: 'big.png', cap: 100 });
    expect(admit([shot, spec], [file('third.png', 'image/png', 5)], caps).refusal).toEqual({ kind: 'count', cap: 2 });
    // The same file twice is one attachment, quietly.
    expect(admit([shot], [shot], caps)).toEqual({ files: [], refusal: null });
  });

  it('names sizes as a file dialog does and numbers clipboard images', () => {
    expect([formatBytes(512, 'en'), formatBytes(2048, 'en'), formatBytes(1.5 * 1024 * 1024, 'cs'), formatBytes(10 * 1024 * 1024, 'en')]).toEqual(['512 B', '2 kB', '1,5 MB', '10 MB']);
    expect([pastedName('image.png', 2), pastedName('mockup.png', 3)]).toEqual(['pasted-2.png', 'mockup.png']);
  });
});

describe('the attachment leg', () => {
  const realFetch = globalThis.fetch;
  let seen: string[] = [];
  let failSpec = 0;

  beforeEach(() => {
    seen = [];
    failSpec = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.slice(BASE.length);
      seen.push(`${init.method ?? 'GET'} ${path} ${new Headers(init.headers).get('content-type') ?? ''}`.trim());
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
      if (path === '/api/v1/reports') return json({ id: 'rep-1', custody: 'direct' }, 201);
      if (path.includes('/attachment?name=spec.pdf') && failSpec-- > 0) return new Response('storage unavailable', { status: 503 });
      if (path.includes('/attachment?name=notes%20(1).txt')) return new Response('type not allowed', { status: 415 });
      if (path.includes('/attachment')) return json({ id: 'att', name: 'x', size: 10, type: 'x' }, 201);
      if (path.endsWith('/submit')) return json({ status: 'filed' });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const empty: BuiltCapture = { chunks: [], truncated: false, console: [], network: [] };
  const envelope: ReportEnvelope = {
    description: 'The logo is cut off',
    env: { url: 'https://app.test/', ua: 'test', viewport: { w: 1280, h: 800, dpr: 1 }, appVersion: '', locale: 'en' },
    console: [],
    network: [],
    markers: [],
    locale: 'en',
  };

  it('sends each file after the create, raw under its own type, and a retry skips the files that landed', async () => {
    failSpec = 1;
    const job = new ReportJob(empty, 'app.test', { url: BASE, key: 'vkb_test' }, [file('shot.png', 'image/png'), file('spec.pdf', 'application/pdf'), file('notes (1).txt', '')]);
    await expect(job.run(envelope)).rejects.toThrow('503');
    expect(job.filesPending).toBe(true);
    expect(await job.run(envelope)).toEqual({ status: 'filed' });
    expect(job.filesPending).toBe(false);
    expect(seen).toEqual([
      'POST /api/v1/reports application/json',
      'POST /api/v1/reports/rep-1/attachment?name=shot.png image/png',
      'POST /api/v1/reports/rep-1/attachment?name=spec.pdf application/pdf',
      'POST /api/v1/reports/rep-1/attachment?name=spec.pdf application/pdf',
      // Refused for good (415): skipped with a warning, the report still files.
      'POST /api/v1/reports/rep-1/attachment?name=notes%20(1).txt application/octet-stream',
      'POST /api/v1/reports/rep-1/submit application/json',
    ]);
  });
});
