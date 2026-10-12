/**
 * The pill's inline flows — what it says when it is not just a recorder:
 *
 *   none ─ask(stop)→ confirm ─confirm→ saving ─saved→ saved ─dismiss→ none
 *                       │                 └─failed→ failed ─retry→ saving
 *                       └─cancel→ none                    └─dismiss→ none
 *   none ─ask(unlink)→ confirm ─confirm→ none   (the caller unlinks)
 *   none ─send→ saving ─saved→ saved …          (a bug report, `report: true`)
 *   any but saving ─stop→ saving …              (a remote stop: no confirm, ONE recorder D11)
 *   none ─startFailed→ failed ─dismiss→ none     (a refused or failed Start, `start: true`, D12)
 *   confirm | saved | failed ─follow→ none       (another recorder leads, or let go: the pill comes back
 *                                                 idle; a refused Start's face stays until dismissed)
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
  /** `sessionId` lets a face saved before its board existed take the link from recents. */
  | { face: 'saved'; boardUrl?: string; sessionId?: string; report?: true }
  /** `start`: a Start that was refused or failed — nothing to retry, only dismiss. */
  | { face: 'failed'; message: string; report?: true; start?: true };

export type FlowEvent =
  | { type: 'ask'; action: ConfirmAction }
  | { type: 'cancel' }
  | { type: 'confirm'; queued: number }
  /** A bug report went out (idle: its own short session). */
  | { type: 'send' }
  | { type: 'retry'; queued: number }
  | { type: 'saved'; boardUrl?: string; sessionId?: string }
  | { type: 'failed'; message: string }
  | { type: 'dismiss' }
  /** The other recorder stopped this one's recording (D11): straight to saving. */
  | { type: 'stop'; queued: number }
  /** A Start was refused (`recorder_busy`) or failed (D12). */
  | { type: 'startFailed'; message: string }
  /** This HUD became, or stopped being, the other recorder's remote: nothing stays open. */
  | { type: 'follow' };

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
      // A failed Start has nothing to retry: pressing Start again is the retry.
      return flow.face === 'failed' && !flow.start ? { face: 'saving', total: ev.queued, ...reportOf(flow) } : flow;
    case 'saved':
      return flow.face === 'saving'
        ? {
            face: 'saved',
            ...(ev.boardUrl ? { boardUrl: ev.boardUrl } : {}),
            ...(ev.sessionId ? { sessionId: ev.sessionId } : {}),
            ...reportOf(flow),
          }
        : flow;
    case 'failed':
      return flow.face === 'saving' ? { face: 'failed', message: ev.message, ...reportOf(flow) } : flow;
    case 'dismiss':
      return flow.face === 'saved' || flow.face === 'failed' ? NO_FLOW : flow;
    case 'stop':
      return flow.face === 'saving' ? flow : { face: 'saving', total: ev.queued };
    case 'startFailed':
      return flow.face === 'none' ? { face: 'failed', message: ev.message, start: true } : flow;
    case 'follow':
      // A save in flight keeps its face (it settles on its own), and so does
      // a refused Start: it is what tells the tester why the pill steps aside.
      if (flow.face === 'none' || flow.face === 'saving' || (flow.face === 'failed' && flow.start)) return flow;
      return NO_FLOW;
  }
}

/** Save progress 0…1 while draining `total` items of which `queued` remain; null = indeterminate. */
export function saveProgress(flow: Flow, queued: number): number | null {
  if (flow.face !== 'saving' || flow.total <= 0) return null;
  return Math.min(1, Math.max(0, 1 - queued / flow.total));
}
