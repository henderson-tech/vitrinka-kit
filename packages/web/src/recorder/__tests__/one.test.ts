/**
 * The ONE recorder protocol (one.ts): the claim codec, the synchronous
 * check-and-set, stale clearing under the holder's own id, and the hello and
 * command channels answering inside their own dispatch — the codec both
 * worlds (page and extension) speak.
 */
import { describe, expect, it } from 'bun:test';

import {
  ACK_EVENT,
  announce,
  ask,
  COMMAND_EVENT,
  HELLO_EVENT,
  LEAD_ATTR,
  PAGE_ATTR,
  parseClaim,
  parseCommand,
  readClaim,
  releaseClaim,
  sendCommand,
  serializeClaim,
  serveCommands,
  serveHello,
  takeClaim,
  updateClaim,
} from '../one';
import { fakeDocument } from './one-fake';

const page = { from: 'page' as const, inst: 'p.one' };
const ext = { from: 'extension' as const, inst: 'x.one' };

describe('claim codec', () => {
  it('round-trips a claim, refuses what is not one, and reads the known fields of a higher version', () => {
    const c = { v: 1, by: 'page' as const, id: 'p.k3x9q2', state: 'recording' as const, sessionId: '42', since: 1760270000000 };
    expect(parseClaim(serializeClaim(c))).toEqual(c);
    expect(parseClaim(null)).toBeNull();
    expect(parseClaim('not json')).toBeNull();
    expect(parseClaim('{"v":1,"by":"robot","id":"x","state":"recording"}')).toBeNull();
    expect(parseClaim('{"v":1,"by":"page","id":"x","state":"dancing"}')).toBeNull();
    // D18: a newer peer's extra fields are ignored, the known ones kept.
    expect(parseClaim('{"v":2,"by":"extension","id":"gen-3","state":"paused","sessionId":"7","since":5,"tabs":3}')).toEqual({
      v: 2,
      by: 'extension',
      id: 'gen-3',
      state: 'paused',
      sessionId: '7',
      since: 5,
    });
  });

  it('treats an object detail (what an isolated world hands the main world: null) and an unknown op as absent', () => {
    expect(parseCommand({ v: 1, from: 'extension', inst: 'x', id: 'c', op: 'stop' })).toBeNull();
    expect(parseCommand(null)).toBeNull();
    expect(parseCommand(JSON.stringify({ v: 1, from: 'extension', inst: 'x', id: 'c', op: 'start' }))).toBeNull();
    expect(parseCommand(JSON.stringify({ v: 1, from: 'extension', inst: 'x', id: 'c', op: 'note', text: 'hi' }))).toEqual({
      v: 1,
      from: 'extension',
      inst: 'x',
      id: 'c',
      op: 'note',
      text: 'hi',
    });
  });
});

describe('the claim (D4, D5)', () => {
  it('both start in the same tick: the first check-and-set wins, the second is refused while the holder answers', () => {
    const { env } = fakeDocument();
    serveHello(env, page, () => {
      const c = readClaim(env);
      return c?.id === 'p.one' ? { by: 'page', state: c.state, here: true, id: c.id } : null;
    });
    expect(takeClaim(env, page, { id: 'p.one', state: 'starting' }).ok).toBe(true);
    const second = takeClaim(env, ext, { id: 'gen-1', state: 'starting' });
    expect(second).toEqual({ ok: false, holder: expect.objectContaining({ by: 'page', id: 'p.one', state: 'starting' }) });
    expect(readClaim(env)?.id).toBe('p.one');
  });

  it('a stale claim (its holder answers nothing) and a saved one are taken over; the holder moves and releases only its own', () => {
    const { env, attrs } = fakeDocument();
    // An orphaned extension left its claim: nobody answers for it.
    attrs.set(LEAD_ATTR, serializeClaim({ v: 1, by: 'extension', id: 'gen-1', state: 'recording', sessionId: '9', since: 1 }));
    const taken = takeClaim(env, page, { id: 'p.one', state: 'starting' });
    expect(taken.ok && taken.claim).toMatchObject({ by: 'page', id: 'p.one', state: 'starting', sessionId: '' });
    expect(updateClaim(env, 'gen-1', { state: 'paused' })).toBe(false);
    expect(releaseClaim(env, 'gen-1')).toBe(false);
    expect(updateClaim(env, 'p.one', { state: 'recording', sessionId: '42' })).toBe(true);
    expect(readClaim(env)).toMatchObject({ state: 'recording', sessionId: '42' });
    expect(updateClaim(env, 'p.one', { state: 'saved' })).toBe(true);
    // Saved is not live: another party may claim the document.
    expect(takeClaim(env, ext, { id: 'gen-2', state: 'starting' }).ok).toBe(true);
    expect(releaseClaim(env, 'p.one')).toBe(false);
    expect(releaseClaim(env, 'gen-2')).toBe(true);
    expect(attrs.has(LEAD_ATTR)).toBe(false);
  });
});

describe('hello and commands answer inside their own dispatch', () => {
  it('an ask collects every other party\'s answer synchronously; a silent party (answerIf) says nothing', () => {
    const { env, attrs } = fakeDocument();
    serveHello(env, ext, () => ({ by: 'extension', state: 'recording', here: false }), undefined, {
      answerIf: () => attrs.has(PAGE_ATTR),
    });
    const heard: string[] = [];
    serveHello(env, page, () => null, (h) => heard.push(h.inst));
    expect(ask(env, page)).toEqual([]);
    attrs.set(PAGE_ATTR, 'web/0.5.0');
    expect(ask(env, page)).toEqual([
      { v: 1, from: 'extension', inst: 'x.one', live: { by: 'extension', state: 'recording', here: false } },
    ]);
    // Never its own answer; an announcement reaches the other parties.
    announce(env, ext, null, { gone: true });
    expect(heard).toEqual(['x.one', 'x.one']);
  });

  it('a command is acked synchronously by the holder; no holder means no ack (D5)', () => {
    const { env } = fakeDocument();
    expect(sendCommand(env, ext, 'pause')).toBeNull();
    let holding = true;
    const seen: string[] = [];
    serveCommands(env, page, (c) => {
      if (!holding) return null;
      seen.push(`${c.op}:${c.text ?? ''}`);
      return c.op === 'note' && !c.text ? { ok: false, code: 'bad_command', error: 'a note needs text' } : { ok: true };
    });
    expect(sendCommand(env, ext, 'note', 'hi')).toMatchObject({ from: 'page', inst: 'p.one', ok: true });
    expect(sendCommand(env, ext, 'note', '')).toMatchObject({ ok: false, code: 'bad_command', error: 'a note needs text' });
    // Its own dispatch never reaches it.
    expect(sendCommand(env, page, 'stop')).toBeNull();
    holding = false;
    expect(sendCommand(env, ext, 'stop')).toBeNull();
    expect(seen).toEqual(['note:hi', 'note:']);
  });

  it('every action travels as a JSON string detail on the three event names', () => {
    const { env } = fakeDocument();
    const details: unknown[] = [];
    for (const t of [HELLO_EVENT, COMMAND_EVENT, ACK_EVENT]) env.bus.addEventListener(t, (e) => details.push((e as CustomEvent).detail));
    serveCommands(env, page, () => ({ ok: true }));
    ask(env, ext);
    sendCommand(env, ext, 'pause');
    expect(details.length).toBe(3);
    for (const d of details) expect(typeof d).toBe('string');
  });
});
