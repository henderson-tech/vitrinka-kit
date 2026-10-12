/**
 * The page side of ONE recorder (lead.ts) against the extension's two
 * endpoints played by `one.ts` parties: the mount's write order, the Start
 * refusal before any network call, a resumed session waiting (D14), the
 * follower's remote, the leader's synchronous acks, `saved` holding (D7),
 * an orphaned holder cleared (D5), and a second recorder bundle following
 * the first.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { holdFace, leadStatus, pingLeader, RecorderBusyError, sendToLeader, setLeadStopping, setRemoteStop, startLead } from '../lead';
import { ask, LEAD_ATTR, PAGE_ATTR, readClaim, sendCommand, serveHello, takeClaim } from '../one';
import { getState, pushEvent, REC_KEY, setState } from '../queue';
import { resyncStoredSession, startSession } from '../session';
import { leadState, notify } from '../state';
import { getRecorderStorage } from '../storage';
import { RECORDER_ID } from '../version';
import { extensionElsewhere, extensionHere, fakeDocument, settle } from './one-fake';
import { fakeLocation, freshRecorder, installStub, liveSession, ROUTE, type Stub } from './stub';

let stub: Stub;
const did: string[] = [];
const handlers = {
  pause: () => void did.push('pause'),
  stop: () => void did.push('stop'),
  note: (t: string) => void did.push(`note:${t}`),
  resync: resyncStoredSession,
};
const follower = { from: 'extension' as const, inst: 'x.popup' };

beforeEach(() => {
  stub = installStub();
  freshRecorder();
  fakeLocation();
  did.length = 0;
});
afterEach(() => {
  freshRecorder();
  stub.restore();
});

const created = () => stub.calls.filter((c) => c.path === '/api/v1/sessions' && c.method === 'POST').length;

describe('mount', () => {
  it('marks the page before its first ask, so the extension in an uncaptured tab is heard and the page follows from its first frame', () => {
    const { env, attrs } = fakeDocument();
    extensionElsewhere(env);
    startLead(handlers, env);
    expect(attrs.get(PAGE_ATTR)).toBe(RECORDER_ID);
    expect(leadState.following).toBe('extension');
    expect(attrs.has(LEAD_ATTR)).toBe(false);
  });

  it('idle with nobody else: no claim, not following; leaving removes the mark', () => {
    const { env, attrs } = fakeDocument();
    const leave = startLead(handlers, env);
    expect(leadState.following).toBeNull();
    expect(attrs.has(LEAD_ATTR)).toBe(false);
    leave();
    expect(attrs.has(PAGE_ATTR)).toBe(false);
  });
});

describe('start refusal (D12)', () => {
  it('refuses while the extension records this page, naming the session, before any network call', async () => {
    const { env } = fakeDocument();
    extensionHere(env).start();
    startLead(handlers, env);
    const err = await startSession({ title: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecorderBusyError);
    expect(err).toMatchObject({
      code: 'recorder_busy',
      leader: 'extension',
      message: 'the Vitrinka extension is already recording this page (#42) — use its pill, or stop it from the extension',
    });
    expect(stub.calls).toEqual([]);
  });

  it('refuses while the extension records another tab, and names no session', async () => {
    const { env } = fakeDocument();
    extensionElsewhere(env, 'starting');
    startLead(handlers, env);
    await expect(startSession()).rejects.toThrow('the Vitrinka extension is recording in another tab — stop it there first');
    expect(created()).toBe(0);
  });

  it('both start in the same tick: the page claims `starting` synchronously, so the extension\'s check-and-set is refused', async () => {
    const { env } = fakeDocument();
    const ext = extensionHere(env);
    startLead(handlers, env);
    const starting = startSession({ title: 'checkout' });
    expect(readClaim(env)).toMatchObject({ by: 'page', state: 'starting', sessionId: '' });
    expect(ext.start().ok).toBe(false);
    await starting;
    expect(readClaim(env)).toMatchObject({ by: 'page', state: 'recording', sessionId: 'sess-1' });
  });

  it('a failed create releases the `starting` claim', async () => {
    const { env, attrs } = fakeDocument();
    startLead(handlers, env);
    stub.script.sessions.push({ ok: false, status: 503 });
    await expect(startSession()).rejects.toThrow();
    expect(attrs.has(LEAD_ATTR)).toBe(false);
  });

  it('a second recorder bundle on the page follows the first, and its Start is refused', async () => {
    const { env } = fakeDocument();
    const other = { from: 'page' as const, inst: 'p.other' };
    serveHello(env, other, () => ({ by: 'page', state: 'recording', here: true, id: 'p.other' }));
    takeClaim(env, other, { id: 'p.other', state: 'recording', sessionId: '7' });
    startLead(handlers, env);
    expect(leadState.following).toBe('page');
    await expect(startSession()).rejects.toThrow('another recorder on this page is already recording (#7) — use its pill, or stop it first');
  });
});

describe('following', () => {
  it('a resumed session waits while the extension leads — capturing nothing — and resumes once it lets go (D14)', async () => {
    const { env } = fakeDocument();
    const ext = extensionHere(env);
    ext.start();
    setState(liveSession());
    startLead(handlers, env);
    expect(leadState.following).toBe('extension');
    expect(pushEvent('click', { selector: '#buy' }, ROUTE)).toBeNull();
    expect(readClaim(env)?.by).toBe('extension');
    ext.stop();
    await settle();
    expect(leadState.following).toBeNull();
    expect(readClaim(env)).toMatchObject({ by: 'page', state: 'recording', sessionId: 'sess-1' });
    expect(pushEvent('click', { selector: '#buy' }, ROUTE)).not.toBeNull();
  });

  it('pause, stop and a note act on the leader; a note the leader can no longer take is refused, never re-routed', async () => {
    const { env } = fakeDocument();
    const ext = extensionHere(env);
    ext.start();
    startLead(handlers, env);
    sendToLeader('pause');
    sendToLeader('note', 'looks off');
    expect(ext.commands.map((c) => [c.op, c.text])).toEqual([
      ['pause', undefined],
      ['note', 'looks off'],
    ]);
    // The leader stopped while the note was in flight.
    ext.reply({ ok: false, code: 'not_recording' });
    expect(() => sendToLeader('note', 'late')).toThrow('the recording ended before the note arrived');
    ext.reply({ ok: false, code: 'stopping' });
    expect(() => sendToLeader('stop')).toThrow('still saving #42');
    ext.stop();
    await settle();
    expect(() => sendToLeader('note', 'later')).toThrow('the recording ended before the note arrived');
    expect(leadStatus()).toMatchObject({ leader: null, following: null });
  });

  it('the extension recording another tab takes no command from here', () => {
    const { env } = fakeDocument();
    extensionElsewhere(env);
    startLead(handlers, env);
    expect(() => sendToLeader('stop')).toThrow('the Vitrinka extension is recording in another tab — use it there');
  });

  it('an orphaned holder (extension reloaded or uninstalled) is cleared under its own id and the page comes back (D5)', async () => {
    const { env, attrs } = fakeDocument();
    const ext = extensionHere(env);
    ext.start();
    startLead(handlers, env);
    expect(leadState.following).toBe('extension');
    ext.orphan();
    pingLeader();
    expect(attrs.has(LEAD_ATTR)).toBe(false);
    expect(leadState.following).toBeNull();
    // …and the page may record again.
    await startSession();
    expect(readClaim(env)).toMatchObject({ by: 'page', state: 'recording' });
  });

  it('the extension saying it is gone ends following in another tab', () => {
    const { env } = fakeDocument();
    const one = extensionElsewhere(env);
    startLead(handlers, env);
    expect(leadState.following).toBe('extension');
    one.stop();
    expect(leadState.following).toBeNull();
  });

  it('stays a hidden follower while the leader\'s pill still shows Saved (D7)', async () => {
    const { env } = fakeDocument();
    const ext = extensionHere(env);
    ext.start();
    startLead(handlers, env);
    ext.set('saved');
    await settle();
    expect(leadState.following).toBe('extension');
    ext.stop();
    await settle();
    expect(leadState.following).toBeNull();
  });
});

describe('leading', () => {
  it('a session joined from another tab claims this document; leaving releases it', () => {
    const { env, attrs } = fakeDocument();
    const leave = startLead(handlers, env);
    setState(liveSession());
    notify();
    expect(readClaim(env)).toMatchObject({ by: 'page', state: 'recording', sessionId: 'sess-1' });
    leave();
    expect(attrs.has(LEAD_ATTR)).toBe(false);
  });

  it('answers the holder\'s commands inside their dispatch: pause, note, and stop through the HUD\'s own flow', () => {
    const { env } = fakeDocument();
    setState(liveSession());
    startLead(handlers, env);
    expect(ask(env, follower)).toEqual([expect.objectContaining({ from: 'page', live: expect.objectContaining({ here: true, state: 'recording' }) })]);
    expect(sendCommand(env, follower, 'pause')).toMatchObject({ ok: true });
    expect(sendCommand(env, follower, 'note', '  from the popup ')).toMatchObject({ ok: true });
    expect(sendCommand(env, follower, 'note', ' ')).toMatchObject({ ok: false, code: 'bad_command' });
    // No HUD: the direct stop. A mounted HUD registers its flow, which runs instead (no second confirm).
    expect(sendCommand(env, follower, 'stop')).toMatchObject({ ok: true });
    const unregister = setRemoteStop(() => void did.push('hud-stop'));
    expect(sendCommand(env, follower, 'stop')).toMatchObject({ ok: true });
    unregister();
    expect(did).toEqual(['pause', 'note:from the popup', 'stop', 'hud-stop']);
  });

  it('refuses a remote pause or stop while its own Stop drains, and a note on a paused recording', () => {
    const { env } = fakeDocument();
    setState(liveSession());
    startLead(handlers, env);
    setLeadStopping('sess-1');
    expect(readClaim(env)?.state).toBe('stopping');
    expect(sendCommand(env, follower, 'stop')).toMatchObject({ ok: false, code: 'stopping', error: 'still saving #sess-1' });
    setLeadStopping(null);
    setState(liveSession(true));
    notify();
    expect(readClaim(env)?.state).toBe('paused');
    expect(sendCommand(env, follower, 'note', 'x')).toMatchObject({ ok: false, code: 'bad_command' });
    expect(did).toEqual([]);
  });

  it('holds the claim as `saved` while the stop\'s face shows, and lets go when it is dismissed (D7)', () => {
    const { env, attrs } = fakeDocument();
    setState(liveSession());
    startLead(handlers, env);
    holdFace('saving');
    setState(null);
    notify();
    expect(readClaim(env)).toMatchObject({ by: 'page', state: 'saved', sessionId: 'sess-1' });
    expect(sendCommand(env, follower, 'note', 'x')).toMatchObject({ ok: false, code: 'not_recording' });
    holdFace('saved');
    expect(readClaim(env)?.state).toBe('saved');
    holdFace('none');
    expect(attrs.has(LEAD_ATTR)).toBe(false);
    expect(getState()).toBeNull();
  });
});

describe('a waiting session is never replaced', () => {
  it('a Start while the other recorder\'s Saved face holds the document keeps the waiting session (D14)', async () => {
    const { env } = fakeDocument();
    const ext = extensionHere(env);
    ext.start();
    setState(liveSession());
    startLead(handlers, env);
    ext.set('saved');
    await settle();
    expect(leadState.following).toBe('extension');
    await expect(startSession()).rejects.toThrow('vitrinka: a session is already recording');
    expect(getState()?.sessionId).toBe('sess-1');
    expect(readClaim(env)?.by).toBe('extension');
    expect(created()).toBe(0);
  });
});

describe('another bundle in this document', () => {
  it('a waiting session its leader already ended is not resumed from a stale cache', async () => {
    const { env, attrs } = fakeDocument();
    // The leading bundle (protocol-wise a holder like any other) records this document.
    const leader = extensionHere(env);
    leader.start();
    setState(liveSession());
    startLead(handlers, env);
    expect(leadState.following).toBe('extension');
    // Its Stop removed the shared record; storage events never reach the document that wrote them.
    getRecorderStorage().remove(REC_KEY);
    expect(getState()?.sessionId).toBe('sess-1');
    leader.stop();
    await settle();
    expect(getState()).toBeNull();
    expect(attrs.has(LEAD_ATTR)).toBe(false);
    expect(leadState.following).toBeNull();
  });
});

describe('another bundle in this document replaced the session', () => {
  it('a waiting bundle resumes the session in storage, with that session\'s redaction policy recovered', async () => {
    const { env } = fakeDocument();
    const leader = extensionHere(env);
    leader.start();
    setState({ ...liveSession(), policy: null });
    startLead(handlers, env);
    // The other bundle's newer session is in storage; its policy never reached this cache.
    getRecorderStorage().set(REC_KEY, JSON.stringify({ ...liveSession(), sessionId: 'sess-2' }));
    stub.script.policy = { attachments: true };
    leader.stop();
    await settle();
    expect(getState()?.sessionId).toBe('sess-2');
    expect(readClaim(env)).toMatchObject({ by: 'page', state: 'recording', sessionId: 'sess-2' });
    expect(stub.calls.some((c) => c.path === '/api/v1/recorder/policy')).toBe(true);
  });
});
