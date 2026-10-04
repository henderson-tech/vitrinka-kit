/**
 * The pill's inline flows — what it says when it is not just a recorder:
 *
 *   none ─ask(stop)→ confirm ─confirm→ saving ─saved→ saved ─dismiss→ none
 *                       │                 └─failed→ failed ─retry→ saving
 *                       └─cancel→ none                    └─dismiss→ none
 *   none ─ask(unlink)→ confirm ─confirm→ none   (the caller unlinks)
 *   none ─send→ saving ─saved→ saved …          (a bug report, `report: true`)
 *
 * Saved stays until the tester dismisses it. A report's saving, saved and
 * failed faces carry `report: true` through retries, so the pill can say
 * "Sending…" / "Sent". A pure reducer, so the HUD's transitions are testable
 * without a DOM; an event that does not apply to the current state leaves it
 * unchanged.
 */

export type ConfirmAction = 'stop' | 'unlink';

export type Flow =
  | { face: 'none' }
  | { face: 'confirm'; action: ConfirmAction }
  /** `total` = items queued when the save began (0 = nothing to drain). */
  | { face: 'saving'; total: number; report?: true }
  | { face: 'saved'; boardUrl?: string; report?: true }
  | { face: 'failed'; message: string; report?: true };

export type FlowEvent =
  | { type: 'ask'; action: ConfirmAction }
  | { type: 'cancel' }
  | { type: 'confirm'; queued: number }
  /** A bug report went out (idle: its own short session). */
  | { type: 'send' }
  | { type: 'retry'; queued: number }
  | { type: 'saved'; boardUrl?: string }
  | { type: 'failed'; message: string }
  | { type: 'dismiss' };

export const NO_FLOW: Flow = { face: 'none' };

/** `{report: true}` when the flow is a bug report's — spread into the next face. */
function reportOf(flow: Flow): { report?: true } {
  return 'report' in flow && flow.report ? { report: true } : {};
}

export function flowReducer(flow: Flow, ev: FlowEvent): Flow {
  switch (ev.type) {
    case 'ask':
      return flow.face === 'none' ? { face: 'confirm', action: ev.action } : flow;
    case 'cancel':
      return flow.face === 'confirm' ? NO_FLOW : flow;
    case 'confirm':
      if (flow.face !== 'confirm') return flow;
      return flow.action === 'stop' ? { face: 'saving', total: ev.queued } : NO_FLOW;
    case 'send':
      return flow.face === 'none' ? { face: 'saving', total: 0, report: true } : flow;
    case 'retry':
      return flow.face === 'failed' ? { face: 'saving', total: ev.queued, ...reportOf(flow) } : flow;
    case 'saved':
      return flow.face === 'saving'
        ? { face: 'saved', ...(ev.boardUrl ? { boardUrl: ev.boardUrl } : {}), ...reportOf(flow) }
        : flow;
    case 'failed':
      return flow.face === 'saving' ? { face: 'failed', message: ev.message, ...reportOf(flow) } : flow;
    case 'dismiss':
      return flow.face === 'saved' || flow.face === 'failed' ? NO_FLOW : flow;
  }
}

/** Save progress 0…1 while draining `total` items of which `queued` remain; null = indeterminate. */
export function saveProgress(flow: Flow, queued: number): number | null {
  if (flow.face !== 'saving' || flow.total <= 0) return null;
  return Math.min(1, Math.max(0, 1 - queued / flow.total));
}
