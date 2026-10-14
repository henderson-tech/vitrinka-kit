/**
 * The host's `sanitizeUrl`: every route (each event's tabHost and the nav,
 * click and shot `route` fields) and every request URL passes it first and the
 * engine after; routes are scrubbed even without it; a sanitizer that throws
 * fails closed; a host without one records what it always did.
 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

mock.module('expo-constants', () => ({
  default: { expoConfig: { ios: { bundleIdentifier: 'com.example.app.dev' }, version: '9.9.9' } },
}));

mock.module('expo-file-system/legacy', () => ({
  documentDirectory: '/docs/',
  getInfoAsync: async () => ({ exists: true }),
  makeDirectoryAsync: async () => undefined,
  deleteAsync: async () => undefined,
  moveAsync: async () => undefined,
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: async () => ({ status: 200, body: '{}' }),
}));

const apiStatus = (await import(
  '../api-status'
)) as typeof import('../api-status');

mock.module('../api', () => ({
  api: async (_method: string, path: string) =>
    path === '/api/v1/sessions'
      ? { id: 'sess-new', project: 'example', environment: 'development', title: '' }
      : {},
  fetchPolicy: async () => null,
  uploadShot: async () => ({ blobKey: 'b1' }),
  permanentStatus: apiStatus.permanentStatus,
  VitrinkaApiError: apiStatus.VitrinkaApiError,
  isVitrinkaUrl: (u: string) => u.startsWith('https://vitrinka.test'),
  vitrinkaConfigured: () => true,
}));

const queue = (await import('../queue')) as typeof import('../queue');
const session = (await import('../session')) as typeof import('../session');
const { redactUrl, setRedactionPolicy, setSanitizeUrl } = (await import(
  '../capture/redact'
)) as typeof import('../capture/redact');
const { patchNetwork } = (await import('../capture/net')) as typeof import('../capture/net');
const { patchConsole } = (await import('../capture/console')) as typeof import('../capture/console');
const { setCurrentRoute } = (await import('../state')) as typeof import('../state');

/** An expo-router host: the token is the path segment after `reset-password`. */
const sanitizeUrl = (url: string) => url.replace(/\/reset-password\/[^/?#]+/, '/reset-password/[token]');
const events = (kind: string) => queue.__bufferForTests().filter((e) => e.kind === kind);

beforeEach(() => {
  queue.__resetForTests();
  session.disarmIdleStop();
  setRedactionPolicy(null);
  setSanitizeUrl(sanitizeUrl);
  setCurrentRoute('/reset-password/s3cr3t', 'reset-password');
  queue.setState({
    sessionId: 'sess-1',
    project: 'example',
    environment: 'development',
    title: '',
    seq: 0,
    paused: false,
    activeMs: 0,
    resumeAt: new Date().toISOString(),
    shots: 0,
  });
});
afterEach(() => {
  setSanitizeUrl(undefined);
  setRedactionPolicy(null);
  setCurrentRoute('/', 'root');
});

describe('sanitizeUrl', () => {
  it('a Start records the route it began on sanitized, as tabHost and as the nav route', async () => {
    await session.startSession();
    session.disarmIdleStop();
    expect(events('nav')).toEqual([
      expect.objectContaining({
        tabId: 'reset-password',
        tabHost: '/reset-password/[token]',
        payload: { route: '/reset-password/[token]' },
      }),
    ]);
  });

  it('notes and annotations carry the sanitized route — under fullFidelity too', () => {
    setRedactionPolicy({ fullFidelity: true });
    session.addNote('step');
    session.addAnnotation('here', { x: 0, y: 0, w: 1, h: 1 }, { scale: 1, commit: () => {}, discard: () => {} });
    expect(events('note').map((e) => e.tabHost)).toEqual(['/reset-password/[token]', '/reset-password/[token]']);
  });

  it('a network request records its sanitized URL', async () => {
    const pristineFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}')) as unknown as typeof fetch;
    (globalThis as Record<string, unknown>).__vitrinkaRecorderNetPatched = undefined;
    patchNetwork();
    try {
      await fetch('https://api.example.test/reset-password/s3cr3t?token=q1', { method: 'POST' });
      await queue.capturesSettled();
      expect(events('net')[0]).toMatchObject({
        tabHost: '/reset-password/[token]',
        payload: { url: 'https://api.example.test/reset-password/[token]?token=[redacted]' },
      });
    } finally {
      globalThis.fetch = pristineFetch;
      (globalThis as Record<string, unknown>).__vitrinkaRecorderNetPatched = undefined;
    }
  });

  it('routes pass the redaction engine even without a sanitizer, under the policy in force now', () => {
    setSanitizeUrl(undefined);
    setCurrentRoute('/invite/tok_abc123', 'invite');
    session.addNote('before the policy');
    setRedactionPolicy({ patterns: ['tok_[A-Za-z0-9]+'] });
    session.addNote('after it landed');
    expect(events('note').map((e) => e.tabHost)).toEqual(['/invite/tok_abc123', '/invite/[redacted]']);
  });

  it('a sanitizer that throws or returns a non-string records the origin, or [redacted] — never the raw URL', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setSanitizeUrl((url) => {
        throw new Error(`no rule for ${url}`);
      });
      session.addNote('step');
      expect(events('note')[0]?.tabHost).toBe('[redacted]');
      expect(redactUrl('https://User:pw@API.example.test:8443/reset-password/s3cr3t')).toBe(
        'https://api.example.test:8443',
      );
      expect(warn).toHaveBeenCalledTimes(1);
      setSanitizeUrl(() => undefined as unknown as string);
      expect(redactUrl('https://api.example.test/reset-password/s3cr3t')).toBe('https://api.example.test');
      expect(warn).toHaveBeenCalledTimes(2);
      // The warning names how it failed, never the thrown value quoting the URL.
      expect(JSON.stringify(warn.mock.calls)).not.toContain('s3cr3t');
    } finally {
      warn.mockRestore();
    }
  });

  it('a line the sanitizer logs reaches the console, never the recording', () => {
    const logged: unknown[][] = [];
    const saved = { error: console.error, warn: console.warn };
    console.error = (...args: unknown[]) => void logged.push(args);
    (globalThis as Record<string, unknown>).__vitrinkaRecorderConsolePatched = undefined;
    patchConsole();
    try {
      setSanitizeUrl((url) => {
        console.error('sanitizing', url);
        return sanitizeUrl(url);
      });
      session.addNote('step');
      expect(logged).toEqual([['sanitizing', '/reset-password/s3cr3t']]);
      expect(events('console')).toEqual([]);
      expect(events('note')[0]?.tabHost).toBe('/reset-password/[token]');
      expect(JSON.stringify(queue.__bufferForTests())).not.toContain('s3cr3t');
    } finally {
      Object.assign(console, saved);
      (globalThis as Record<string, unknown>).__vitrinkaRecorderConsolePatched = undefined;
    }
  });

  it('a host without the hook records what it always did', () => {
    setSanitizeUrl(undefined);
    session.addNote('step');
    expect(events('note')[0]).toMatchObject({ tabId: 'reset-password', tabHost: '/reset-password/s3cr3t' });
  });
});
