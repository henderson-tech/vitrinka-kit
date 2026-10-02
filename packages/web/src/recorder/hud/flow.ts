/**
 * The pill's inline flows — what it says when it is not just a recorder:
 *
 *   none ─ask(stop)→ confirm ─confirm→ saving ─saved→ saved ─dismiss→ none
 *                       │                 └─failed→ failed ─retry→ saving
 *                       └─cancel→ none                    └─dismiss→ none
 *   none ─ask(unlink)→ confirm ─confirm→ none   (the caller unlinks)
 *
 * Saved stays until the tester dismisses it. A pure reducer, so the HUD's
 * transitions are testable without a DOM; an event that does not apply to
 * the current state leaves it unchanged.
 */

export type ConfirmAction = 'stop' | 'unlink';

export type Flow =
  | { face: 'none' }
  | { face: 'confirm'; action: ConfirmAction }
  /** `total` = items queued when the save began (0 = nothing to drain). */
  | { face: 'saving'; total: number }
  | { face: 'saved'; boardUrl?: string }
  | { face: 'failed'; message: string };

export type FlowEvent =
  | { type: 'ask'; action: ConfirmAction }
  | { type: 'cancel' }
  | { type: 'confirm'; queued: number }
  | { type: 'retry'; queued: number }
  | { type: 'saved'; boardUrl?: string }
  | { type: 'failed'; message: string }
  | { type: 'dismiss' };

export const NO_FLOW: Flow = { face: 'none' };

export function flowReducer(flow: Flow, ev: FlowEvent): Flow {
  switch (ev.type) {
    case 'ask':
      return flow.face === 'none' ? { face: 'confirm', action: ev.action } : flow;
    case 'cancel':
      return flow.face === 'confirm' ? NO_FLOW : flow;
    case 'confirm':
      if (flow.face !== 'confirm') return flow;
      return flow.action === 'stop' ? { face: 'saving', total: ev.queued } : NO_FLOW;
    case 'retry':
      return flow.face === 'failed' ? { face: 'saving', total: ev.queued } : flow;
    case 'saved':
      return flow.face === 'saving' ? { face: 'saved', ...(ev.boardUrl ? { boardUrl: ev.boardUrl } : {}) } : flow;
    case 'failed':
      return flow.face === 'saving' ? { face: 'failed', message: ev.message } : flow;
    case 'dismiss':
      return flow.face === 'saved' || flow.face === 'failed' ? NO_FLOW : flow;
  }
}

/** Save progress 0…1 while draining `total` items of which `queued` remain; null = indeterminate. */
export function saveProgress(flow: Flow, queued: number): number | null {
  if (flow.face !== 'saving' || flow.total <= 0) return null;
  return Math.min(1, Math.max(0, 1 - queued / flow.total));
}
