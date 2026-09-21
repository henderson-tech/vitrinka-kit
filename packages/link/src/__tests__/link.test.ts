import { describe, expect, it } from 'bun:test';

import { isUnauthorized, LinkExpired, linkOrigin, pollLink, startLink } from '../index';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('link', () => {
  it('starts at the base’s origin and resolves absolute verify/qr URLs', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return json(201, { device_code: 'dc1', user_code: 'ABCD-EFGH', verify_path: '/link?c=ABCD-EFGH', qr_path: '/link/qr?c=ABCD-EFGH', interval: 1, expires_in: 600 });
    }) as unknown as typeof globalThis.fetch;
    const s = await startLink('https://app.vitrinka.ai/w/acme', { label: 'Safari · x', fetch });
    expect(calls[0]).toEqual({ url: 'https://app.vitrinka.ai/api/v1/cli/auth', body: { kind: 'recorder', label: 'Safari · x' } });
    expect(s).toMatchObject({ user_code: 'ABCD-EFGH', verifyUrl: 'https://app.vitrinka.ai/link?c=ABCD-EFGH', qrUrl: 'https://app.vitrinka.ai/link/qr?c=ABCD-EFGH', interval: 2 });
    expect(linkOrigin('https://app.vitrinka.ai/w/acme/')).toBe('https://app.vitrinka.ai');
  });

  it('polls pending → ok', async () => {
    let n = 0;
    const fetch = (async () => (++n < 3 ? json(202) : json(200, { token: 'vkr_t', workspace: 'acme', label: 'l', expires_at: '2027-01-01' }))) as unknown as typeof globalThis.fetch;
    const sleeps: number[] = [];
    const linked = await pollLink('https://x.test/w/a', 'dc', { fetch, interval: 1, sleep: async (ms) => void sleeps.push(ms) });
    expect(linked.token).toBe('vkr_t');
    expect(n).toBe(3);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it('throws LinkExpired on 404 and aborts on signal', async () => {
    const gone = (async () => json(404)) as unknown as typeof globalThis.fetch;
    await expect(pollLink('https://x.test', 'dc', { fetch: gone, sleep: async () => undefined })).rejects.toBeInstanceOf(LinkExpired);
    const ac = new AbortController();
    const pending = (async () => json(202)) as unknown as typeof globalThis.fetch;
    const p = pollLink('https://x.test', 'dc', { fetch: pending, signal: ac.signal, sleep: async (_ms, signal) => { ac.abort(); if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(isUnauthorized(401)).toBe(true);
    expect(isUnauthorized(403)).toBe(false);
  });
});
