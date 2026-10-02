/**
 * The pill's inline flows (stop and unlink confirms, saving, saved, failed)
 * and the sync chip's wording — the logic under the HUD's states.
 */
import { describe, expect, it } from 'bun:test';

import type { HudSync } from '../hud/controller';
import { type Flow, flowReducer, NO_FLOW, saveProgress } from '../hud/flow';
import { SENDING_AFTER_MS, syncChip } from '../hud/status';

describe('flow', () => {
  it('stop: ask → confirm → saving → saved, which stays until dismissed', () => {
    let f: Flow = flowReducer(NO_FLOW, { type: 'ask', action: 'stop' });
    expect(f).toEqual({ face: 'confirm', action: 'stop' });
    f = flowReducer(f, { type: 'confirm', queued: 8 });
    expect(f).toEqual({ face: 'saving', total: 8 });
    expect(saveProgress(f, 2)).toBe(0.75);
    f = flowReducer(f, { type: 'saved', boardUrl: 'https://v.test/b/1' });
    expect(f).toEqual({ face: 'saved', boardUrl: 'https://v.test/b/1' });
    // Nothing but a dismiss ends it.
    expect(flowReducer(f, { type: 'cancel' })).toBe(f);
    expect(flowReducer(f, { type: 'ask', action: 'unlink' })).toBe(f);
    expect(flowReducer(f, { type: 'dismiss' })).toEqual(NO_FLOW);
  });

  it('cancel backs out of a confirm; a refused save can be retried; unlink confirms to nothing', () => {
    const ask = flowReducer(NO_FLOW, { type: 'ask', action: 'stop' });
    expect(flowReducer(ask, { type: 'cancel' })).toEqual(NO_FLOW);
    const failed = flowReducer(flowReducer(ask, { type: 'confirm', queued: 0 }), { type: 'failed', message: 'offline' });
    expect(failed).toEqual({ face: 'failed', message: 'offline' });
    expect(saveProgress(flowReducer(failed, { type: 'retry', queued: 0 }), 0)).toBeNull();
    const unlink = flowReducer(NO_FLOW, { type: 'ask', action: 'unlink' });
    expect(flowReducer(unlink, { type: 'confirm', queued: 3 })).toEqual(NO_FLOW);
  });
});

describe('syncChip', () => {
  const base: HudSync = {
    state: 'ok',
    synced: true,
    queued: 0,
    chunks: 0,
    failures: 0,
    error: '',
    lastSyncAt: 1_000,
    events: 10,
    serverMaxSeq: 10,
    deadReason: '',
  };

  it('reads synced / sending N / offline · N / ended, and a routine flush never flickers it', () => {
    expect(syncChip(base, 2_000).label).toBe('synced');
    const pending = { ...base, synced: false, queued: 3 };
    expect(syncChip(pending, 1_000 + SENDING_AFTER_MS - 1).kind).toBe('synced');
    expect(syncChip(pending, 1_000 + SENDING_AFTER_MS + 1).label).toBe('sending 3');
    expect(syncChip({ ...base, state: 'offline', synced: false, queued: 40 }, 2_000)).toMatchObject({ kind: 'offline', label: 'offline · 40' });
    expect(syncChip({ ...base, state: 'dead', deadReason: 'session was deleted' }, 2_000)).toMatchObject({
      kind: 'error',
      label: 'ended',
      title: 'session was deleted',
    });
  });
});
