/**
 * The face switch's rule (vt-8020 D8): only a browser holding a member link
 * for the widget's own base may switch to the pill — never a reporter, never
 * a host's `vkr_` key — and the member's pick is remembered per browser.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { clearLink, configureRecorder, storeLink, type StoredLink } from '../../recorder/config';
import { setState } from '../../recorder/queue';
import { __resetStorageForTests, configureRecorderStorage, memoryRecorderStorage } from '../../recorder/storage';
import { FACE_KEY, memberLinked, pillRecording, rememberDisplayMode, rememberedFace, rememberFace, startFace, watchMemberLink } from '../face';

const BASE = 'https://vitrinka.test';
const link = (over: Partial<StoredLink> = {}): StoredLink => ({ token: 'vkr_member', workspace: 'acme', label: 'Chrome', expires_in: 3600, ...over });

beforeEach(() => {
  __resetStorageForTests();
  configureRecorderStorage(memoryRecorderStorage());
  configureRecorder({ url: '', key: '' });
  // bun test runs without a DOM: an in-memory Storage stands in for the browser's.
  const m = new Map<string, string>();
  const shim: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('memberLinked', () => {
  it('is false for a reporter, and a host recorder key is not a person', () => {
    expect(memberLinked(BASE)).toBe(false);
    configureRecorder({ url: BASE, key: 'vkr_host_build' });
    expect(memberLinked(BASE)).toBe(false);
  });

  it('holds only for the base the link was minted on', () => {
    storeLink(link({ base: `${BASE}/` }));
    expect(memberLinked(BASE)).toBe(true);
    expect(memberLinked('https://other.test')).toBe(false);
  });

  it('takes a link stored without its base by the workspace the base addresses', () => {
    storeLink(link());
    expect(memberLinked(BASE)).toBe(true);
    expect(memberLinked(`${BASE}/w/acme`)).toBe(true);
    expect(memberLinked(`${BASE}/w/globex`)).toBe(false);
  });

  it('hears this document link and unlink', () => {
    let heard = 0;
    const off = watchMemberLink(() => heard++);
    storeLink(link({ base: BASE }));
    clearLink();
    off();
    storeLink(link({ base: BASE }));
    expect(heard).toBe(2);
    expect(memberLinked(BASE)).toBe(true);
  });
});

describe('the remembered face', () => {
  it('starts on the pill only for a member who left it there', () => {
    expect(startFace(BASE)).toBe('report');
    rememberFace('recorder');
    expect(localStorage.getItem(FACE_KEY)).toBe('recorder');
    expect(startFace(BASE)).toBe('report'); // remembered, but nobody is linked
    storeLink(link({ base: BASE }));
    expect(startFace(BASE)).toBe('recorder');
    rememberFace('report');
    expect(rememberedFace()).toBe('report');
    expect(startFace(BASE)).toBe('report');
  });

  it('ignores a value it never wrote', () => {
    localStorage.setItem(FACE_KEY, 'pill');
    expect(rememberedFace()).toBeNull();
  });

  it('starts a dev-mode member who never picked on the pill, and their pick wins after', () => {
    storeLink(link({ base: BASE }));
    rememberDisplayMode('dev');
    expect(startFace(BASE)).toBe('recorder');
    rememberFace('report');
    expect(startFace(BASE)).toBe('report');
  });
});

describe('pillRecording', () => {
  it('holds while the session record the pill’s menu reads exists', () => {
    setState(null);
    expect(pillRecording()).toBe(false);
    setState({ sessionId: 'sess-1', project: 'voke', environment: 'development', title: '', seq: 0, paused: false, activeMs: 0, resumeAt: null });
    expect(pillRecording()).toBe(true);
    setState(null);
    expect(pillRecording()).toBe(false);
  });
});
