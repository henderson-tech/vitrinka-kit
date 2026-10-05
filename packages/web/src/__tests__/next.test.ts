/** `withVitrinkaRecorder`: refuses a production build carrying a key outside an allowed lane. */
import { afterEach, describe, expect, it } from 'bun:test';

import { withVitrinkaRecorder } from '../next';

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

const cfg = { reactStrictMode: true };

describe('withVitrinkaRecorder', () => {
  it('throws on a production build with a key and no allowed lane', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_VITRINKA_KEY = 'vkr_x';
    delete process.env.VITRINKA_RECORDER_LANE;
    expect(() => withVitrinkaRecorder(cfg)).toThrow(/VITRINKA_RECORDER_LANE/);
    process.env.VITRINKA_RECORDER_LANE = 'production';
    expect(() => withVitrinkaRecorder(cfg)).toThrow(/not an allowed recorder lane/);
  });

  it('returns the config unchanged when the lane is allowed, the key is absent, or not production', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_VITRINKA_KEY = 'vkr_x';
    process.env.VITRINKA_RECORDER_LANE = 'preview';
    expect(withVitrinkaRecorder(cfg)).toBe(cfg);
    process.env.VITRINKA_RECORDER_LANE = 'staging';
    expect(withVitrinkaRecorder(cfg, { allowedLanes: ['staging'] })).toBe(cfg);
    delete process.env.NEXT_PUBLIC_VITRINKA_KEY;
    delete process.env.VITRINKA_RECORDER_LANE;
    expect(withVitrinkaRecorder(cfg)).toBe(cfg);
    process.env.NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_VITRINKA_KEY = 'vkr_x';
    expect(withVitrinkaRecorder(cfg)).toBe(cfg);
  });

  it('honours custom var names', () => {
    process.env.NODE_ENV = 'production';
    process.env.MY_KEY = 'vkr_x';
    expect(() => withVitrinkaRecorder(cfg, { keyVar: 'MY_KEY', laneVar: 'MY_LANE' })).toThrow(/MY_LANE/);
  });
});
