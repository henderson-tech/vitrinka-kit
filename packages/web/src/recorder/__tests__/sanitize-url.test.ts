/**
 * The host's `sanitizeUrl`: every URL and route the recorder records passes
 * it first and the engine's query/fragment scrub after; routes are scrubbed
 * even without it; a sanitizer that throws fails closed; a host without one
 * records what it always did.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { EventType, type eventWithTime } from '@rrweb/types';

import { installClickLane } from '../capture/click';
import { noteNavigation, primeNavigation } from '../capture/nav';
import { patchNetwork, unpatchNetwork } from '../capture/net';
import { redactRRWebEvent, redactUrl, setRedactionPolicy } from '../capture/redact';
import { configureRecorder } from '../config';
import { __bufferForTests, capturesSettled, setState } from '../queue';
import { addAnnotation, addNote, startSession } from '../session';
import { BASE, fakeLocation, freshRecorder, installStub, liveSession, type Stub } from './stub';

let stub: Stub;
const PAGE = 'https://app.example.test/reset-password/s3cr3t?token=q1';
/** A Reservine-like host: the token is the path segment after `reset-password`. */
const sanitizeUrl = (url: string) => url.replace(/\/reset-password\/[^/?#]+/, '/reset-password/:token');
const payloads = (kind: string) => __bufferForTests().filter((e) => e.kind === kind).map((e) => e.payload);

beforeEach(() => {
  stub = installStub();
  freshRecorder();
  configureRecorder({ url: `${BASE}/`, key: 'vkr_test', sanitizeUrl });
  fakeLocation(PAGE);
  primeNavigation();
});
afterEach(() => stub.restore());

describe('sanitizeUrl', () => {
  it('a navigation records the sanitized URL and route, query still scrubbed — under fullFidelity too', () => {
    setState(liveSession());
    fakeLocation('https://app.example.test/reset-password/other?token=q2');
    noteNavigation();
    setRedactionPolicy({ fullFidelity: true });
    noteNavigation(true);
    expect(payloads('nav')).toEqual([
      { url: 'https://app.example.test/reset-password/:token?token=[redacted]', route: '/reset-password/:token', spa: true },
      { url: 'https://app.example.test/reset-password/:token?token=q2', route: '/reset-password/:token', spa: true },
    ]);
  });

  it('a Start records the page it began on sanitized', async () => {
    await startSession();
    expect(payloads('nav')[0]).toEqual({
      url: 'https://app.example.test/reset-password/:token?token=[redacted]',
      route: '/reset-password/:token',
    });
  });

  it('a click records the sanitized route', () => {
    const g = globalThis as { Element?: unknown; document?: unknown };
    const saved = { Element: g.Element, document: g.document };
    class FakeElement {
      id = 'pay';
      tagName = 'BUTTON';
      innerText = 'Pay';
      closest(sel: string) {
        return sel.startsWith('a,button') ? this : null;
      }
      matches() {
        return false;
      }
      querySelector() {
        return null;
      }
      getBoundingClientRect() {
        return { x: 0, y: 0, width: 10, height: 10 };
      }
    }
    let onClick: ((e: { target: unknown }) => void) | null = null;
    g.Element = FakeElement;
    g.document = { addEventListener: (_: string, fn: typeof onClick) => (onClick = fn), removeEventListener: () => {} };
    try {
      setState(liveSession());
      installClickLane({ ignore: () => false });
      onClick!({ target: new FakeElement() });
      expect(payloads('click')).toEqual([expect.objectContaining({ selector: '#pay', route: '/reset-password/:token' })]);
    } finally {
      Object.assign(g, saved);
    }
  });

  it('notes and annotations record the sanitized route', async () => {
    setState(liveSession());
    addNote('step');
    addAnnotation('here', { x: 0, y: 0, w: 1, h: 1 }, '#pay');
    await capturesSettled();
    expect(payloads('note').map((p) => p?.route)).toEqual(['/reset-password/:token', '/reset-password/:token']);
  });

  it('a network request records its sanitized URL', async () => {
    delete (globalThis as { __vitrinkaRecorderNetPatched?: boolean }).__vitrinkaRecorderNetPatched;
    patchNetwork();
    try {
      setState(liveSession());
      await fetch('https://api.example.test/reset-password/s3cr3t?token=q1', { method: 'POST' });
      await capturesSettled();
      expect(payloads('net')[0]).toMatchObject({ url: 'https://api.example.test/reset-password/:token?token=[redacted]' });
    } finally {
      unpatchNetwork();
    }
  });

  it('the rrweb Meta event carries the sanitized page URL', () => {
    const meta: eventWithTime = { type: EventType.Meta, data: { href: PAGE, width: 1, height: 1 }, timestamp: 1 };
    expect(redactRRWebEvent(meta)).toMatchObject({
      data: { href: 'https://app.example.test/reset-password/:token?token=[redacted]' },
    });
  });

  it('routes pass the redaction engine even without a sanitizer', async () => {
    configureRecorder({ url: `${BASE}/`, key: 'vkr_test' });
    setRedactionPolicy({ patterns: ['tok_[A-Za-z0-9]+'] });
    setState(liveSession());
    fakeLocation('https://app.example.test/invite/tok_abc123');
    noteNavigation();
    addNote('joined');
    await capturesSettled();
    expect(payloads('nav')[0]).toMatchObject({ route: '/invite/[redacted]' });
    expect(payloads('note')[0]).toMatchObject({ route: '/invite/[redacted]' });
  });

  it('a sanitizer that throws or returns a non-string records the origin, or [redacted] — never the raw URL', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      configureRecorder({ url: `${BASE}/`, key: 'vkr_test', sanitizeUrl: (url) => { throw new Error(`cannot sanitize ${url}`); } });
      setState(liveSession());
      noteNavigation(true);
      expect(payloads('nav')[0]).toEqual({ url: 'https://app.example.test', route: '[redacted]', spa: true });
      expect(redactUrl('/api/reset-password/s3cr3t')).toBe('[redacted]');
      // Once, and never the thrown value: it quotes the secret URL.
      expect(warn.mock.calls).toEqual([['vitrinka: sanitizeUrl threw Error — such URLs are recorded as their origin only']]);
      configureRecorder({ url: `${BASE}/`, key: 'vkr_test', sanitizeUrl: () => undefined as unknown as string });
      expect(redactUrl(PAGE)).toBe('https://app.example.test');
      expect(redactUrl('about:blank')).toBe('[redacted]');
    } finally {
      warn.mockRestore();
    }
  });

  it('a host without the hook records what it always did', () => {
    configureRecorder({ url: `${BASE}/`, key: 'vkr_test' });
    setState(liveSession());
    noteNavigation(true);
    expect(payloads('nav')[0]).toEqual({
      url: 'https://app.example.test/reset-password/s3cr3t?token=[redacted]',
      route: '/reset-password/s3cr3t',
      spa: true,
    });
  });
});
