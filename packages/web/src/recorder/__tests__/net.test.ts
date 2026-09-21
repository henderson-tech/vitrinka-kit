/**
 * Network lane: Authorization is redacted BEFORE the event is queued, the
 * recorder's own vitrinka traffic is never recorded, and a request that ends
 * after its session is not attributed to the next one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { patchNetwork } from '../capture/net';
import { __bufferForTests, capturesSettled, setState } from '../queue';
import { BASE, freshRecorder, installStub, liveSession, type Stub } from './stub';

let stub: Stub;

// patchNetwork wraps whatever fetch is installed at patch time — install the
// stub first so the wrapped original is the scripted transport.
beforeEach(() => {
  stub = installStub();
  freshRecorder();
  delete (globalThis as { __vitrinkaRecorderNetPatched?: boolean }).__vitrinkaRecorderNetPatched;
  patchNetwork();
});
afterEach(() => stub.restore());

const recorded = () => __bufferForTests().filter((e) => e.kind === 'net').map((e) => e.payload ?? {});

describe('net lane', () => {
  it('redacts the Authorization header and secret body keys before queueing', async () => {
    setState(liveSession());
    await fetch('https://api.example.test/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer s3cret', 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'lu', password: 'hunter2' }),
    });
    await capturesSettled();
    const [ev] = recorded();
    expect(ev).toMatchObject({ method: 'POST', url: 'https://api.example.test/login', via: 'fetch' });
    expect((ev!.reqHeaders as Record<string, string>).Authorization).not.toContain('s3cret');
    expect(String(ev!.reqBody)).not.toContain('hunter2');
    expect(String(ev!.reqBody)).toContain('"user":"lu"');
  });

  it('never records the recorder’s own vitrinka traffic', async () => {
    setState(liveSession());
    await fetch(`${BASE}/api/v1/sessions/sess-1/events`, { method: 'POST', body: '{}' });
    await capturesSettled();
    expect(recorded()).toHaveLength(0);
  });

  it('records nothing when no session is live', async () => {
    await fetch('https://api.example.test/x');
    await capturesSettled();
    expect(recorded()).toHaveLength(0);
  });
});
