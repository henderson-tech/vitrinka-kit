import { describe, expect, it } from 'bun:test';

import {
  isUnauthorized,
  LinkError,
  LinkExpired,
  linkOrigin,
  linkWorkspace,
  LinkWorkspaceMismatch,
  permanentStatus,
  pollLink,
  startLink,
  VitrinkaApiError,
} from '../index';

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
    const fetch = (async () => (++n < 3 ? json(202) : json(200, { token: 'vkr_t', kind: 'recorder', workspace: 'acme', label: 'l', expires_in: 2592000 }))) as unknown as typeof globalThis.fetch;
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

  it('surfaces a non-202/200 claim as LinkError with its status, and 410 as expired', async () => {
    const boom = (async () => json(503)) as unknown as typeof globalThis.fetch;
    await expect(pollLink('https://x.test', 'dc', { fetch: boom, sleep: async () => undefined })).rejects.toMatchObject({ name: 'LinkError', status: 503 });
    const forbidden = (async () => json(403)) as unknown as typeof globalThis.fetch;
    await expect(pollLink('https://x.test', 'dc', { fetch: forbidden, sleep: async () => undefined })).rejects.toBeInstanceOf(LinkError);
    const gone = (async () => json(410)) as unknown as typeof globalThis.fetch;
    await expect(pollLink('https://x.test', 'dc', { fetch: gone, sleep: async () => undefined })).rejects.toBeInstanceOf(LinkExpired);
  });

  it('refuses a malformed start payload instead of yielding undefined URLs', async () => {
    const noVerify = (async () => json(201, { device_code: 'dc', user_code: 'ABCD-EFGH', qr_path: '/q' })) as unknown as typeof globalThis.fetch;
    await expect(startLink('https://x.test', { label: 'l', fetch: noVerify })).rejects.toMatchObject({ name: 'LinkError', message: expect.stringContaining('verify_path') });
    const notJson = (async () => new Response('<html>', { status: 201 })) as unknown as typeof globalThis.fetch;
    await expect(startLink('https://x.test', { label: 'l', fetch: notJson })).rejects.toBeInstanceOf(LinkError);
    const denied = (async () => json(429)) as unknown as typeof globalThis.fetch;
    await expect(startLink('https://x.test', { label: 'l', fetch: denied })).rejects.toMatchObject({ status: 429 });
  });

  it('never points the tap or the QR off the link origin', async () => {
    const hostile = (async () =>
      json(201, {
        device_code: 'dc',
        user_code: 'ABCD-EFGH',
        verify_path: '/cli-auth?code=ABCD-EFGH',
        verify_url: 'https://evil.example/cli-auth?code=ABCD-EFGH',
        qr_path: 'javascript:alert(1)',
      })) as unknown as typeof globalThis.fetch;
    const s = await startLink('https://app.vitrinka.ai/w/acme', { label: 'l', fetch: hostile });
    expect(s.verifyUrl).toBe('https://app.vitrinka.ai/cli-auth?code=ABCD-EFGH');
    expect(s.qrUrl.startsWith('https://app.vitrinka.ai/')).toBe(true);
    expect(s.qrUrl).not.toContain('javascript:');
    const relative = (async () =>
      json(201, { device_code: 'dc', user_code: 'ABCD-EFGH', verify_path: 'cli-auth?code=X', qr_path: '/cli-auth/qr?code=X' })) as unknown as typeof globalThis.fetch;
    const r = await startLink('https://app.vitrinka.ai', { label: 'l', fetch: relative });
    expect(r.verifyUrl).toBe('https://app.vitrinka.ai/cli-auth?code=X');
    expect(r.qrUrl).toBe('https://app.vitrinka.ai/cli-auth/qr?code=X');
  });

  it('hints the /w/<slug> workspace on the approve and QR URLs; a bare origin carries none', async () => {
    const calls: unknown[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return json(201, { device_code: 'dc', user_code: 'ABCD-EFGH', verify_path: '/cli-auth?code=ABCD-EFGH', qr_path: '/cli-auth/qr?code=ABCD-EFGH' });
    }) as unknown as typeof globalThis.fetch;
    expect(linkWorkspace('https://app.vitrinka.ai/w/fixit/')).toBe('fixit');
    expect(linkWorkspace('https://app.vitrinka.ai/api/w/fixit')).toBeUndefined();
    expect(linkWorkspace('https://app.vitrinka.ai')).toBeUndefined();
    const s = await startLink('https://app.vitrinka.ai/w/fixit', { label: 'l', workspace: 'fixit', fetch });
    expect(s.verifyUrl).toBe('https://app.vitrinka.ai/cli-auth?code=ABCD-EFGH&workspace=fixit');
    expect(s.qrUrl).toBe('https://app.vitrinka.ai/cli-auth/qr?code=ABCD-EFGH&workspace=fixit');
    // The hint never reaches the start body: the server refuses unknown fields there.
    expect(calls[0]).toEqual({ kind: 'recorder', label: 'l' });
    const bare = await startLink('https://app.vitrinka.ai', { label: 'l', workspace: linkWorkspace('https://app.vitrinka.ai'), fetch });
    expect(bare.verifyUrl).toBe('https://app.vitrinka.ai/cli-auth?code=ABCD-EFGH');
  });

  it('refuses a claim pinned to another workspace and never returns its token', async () => {
    const turena = (async () => json(200, { token: 'vkr_wrong', kind: 'recorder', workspace: 'turena', label: 'l', expires_in: 1 })) as unknown as typeof globalThis.fetch;
    const err = await pollLink('https://x.test/w/fixit', 'dc', { fetch: turena, workspace: 'fixit', sleep: async () => undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LinkWorkspaceMismatch);
    expect(err).toMatchObject({ linked: 'turena', expected: 'fixit', message: 'linked into turena — this app records into fixit; link again and pick fixit' });
    expect(JSON.stringify(err)).not.toContain('vkr_wrong');
    // Without an expected workspace (a bare-origin base) today's behaviour holds.
    await expect(pollLink('https://x.test', 'dc', { fetch: turena, sleep: async () => undefined })).resolves.toMatchObject({ token: 'vkr_wrong' });
  });

  it('carries the shared transport-status vocabulary', () => {
    expect(permanentStatus(404)).toBe(true);
    expect(permanentStatus(408)).toBe(false);
    expect(permanentStatus(429)).toBe(false);
    expect(permanentStatus(503)).toBe(false);
    expect(new VitrinkaApiError('x', 401).status).toBe(401);
  });
});
