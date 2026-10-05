/** The rrweb lane's scrub: the Meta event's page URL loses its secrets; nothing else changes. */
import { describe, expect, it } from 'bun:test';

import { EventType, type eventWithTime } from '@rrweb/types';

import { redactRRWebEvent } from '../capture/redact';

describe('redactRRWebEvent', () => {
  it('scrubs the Meta event href and passes every other event through untouched', () => {
    const meta: eventWithTime = {
      type: EventType.Meta,
      data: { href: 'https://app.example.test/cb?code=x&access_token=at-1#id_token=it-1', width: 1440, height: 810 },
      timestamp: 1,
    };
    expect(redactRRWebEvent(meta)).toEqual({
      type: EventType.Meta,
      data: { href: 'https://app.example.test/cb?code=x&access_token=[redacted]#id_token=[redacted]', width: 1440, height: 810 },
      timestamp: 1,
    });
    const load: eventWithTime = { type: EventType.Load, data: {}, timestamp: 2 };
    expect(redactRRWebEvent(load)).toBe(load);
  });
});
