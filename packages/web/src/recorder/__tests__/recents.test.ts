/**
 * Recents: the session lifecycle files the device's last five recordings
 * (newest first, with duration and board link at stop), a missing board link
 * is refreshed through the session's own reconcile read, and the page
 * controller's snapshot is the same object until something changed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createPageController } from '../page-controller';
import { MAX_RECENTS, noteRecent, readRecents, refreshRecents } from '../recents';
import { startSession, stopSession } from '../session';
import { installStub, freshRecorder, fakeLocation, type Stub } from './stub';

let stub: Stub;

beforeEach(() => {
  stub = installStub();
  freshRecorder();
  fakeLocation();
});
afterEach(() => stub.restore());

describe('recents', () => {
  it('files a recording on start and marks it saved with its board and duration on stop', async () => {
    await startSession({ title: 'checkout' });
    expect(readRecents()[0]).toMatchObject({ sessionId: 'sess-1', title: 'checkout', status: 'recording' });
    await stopSession();
    const r = readRecents()[0]!;
    expect(r).toMatchObject({ status: 'saved', boardUrl: 'https://vitrinka.test/acme/b/example-session-1?x=1' });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps the newest five and refreshes a missing board link from the session read', async () => {
    for (let i = 0; i < 7; i++) noteRecent({ sessionId: `s-${i}`, title: `t${i}`, startedAt: i, status: 'saved' });
    expect(readRecents().map((r) => r.sessionId)).toEqual(['s-6', 's-5', 's-4', 's-3', 's-2']);
    expect(readRecents()).toHaveLength(MAX_RECENTS);
    stub.script.sessions.push(
      { ok: true, body: { status: 'done', boardUrl: 'https://vitrinka.test/b/six' } },
      { ok: false, status: 404 },
    );
    await refreshRecents('s-4'); // the live one is skipped
    expect(stub.calls.filter((c) => c.method === 'GET').map((c) => c.path)).toEqual([
      '/api/v1/sessions/s-6',
      '/api/v1/sessions/s-5',
      '/api/v1/sessions/s-3',
      '/api/v1/sessions/s-2',
    ]);
    expect(readRecents()[0]).toMatchObject({ sessionId: 's-6', boardUrl: 'https://vitrinka.test/b/six' });
    expect(readRecents()[1]).toMatchObject({ sessionId: 's-5', status: 'deleted' });
  });

  it('the controller hands back the same snapshot until state changes', async () => {
    const c = createPageController();
    const a = c.getSnapshot();
    expect(c.getSnapshot()).toBe(a);
    await c.setPrefs({ verbose: true });
    const b = c.getSnapshot();
    expect(b).not.toBe(a);
    expect(b.prefs.verbose).toBe(true);
    expect(b.version).toMatch(/^web\//);
  });
});
