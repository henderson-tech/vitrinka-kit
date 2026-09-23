/**
 * The link sheet: the 9-char code, "Open vitrinka" for the same-device path,
 * the server-rendered QR for the desktop→phone path (fine pointers only),
 * and the waiting line.
 * Polling runs in the parent; this only paints the state.
 */
import type { ReactElement } from 'react';
import type { LinkStart } from '@vitrinka/link';

import { CloseIcon, NewTabIcon } from './icons';
import { FINE_QUERY, useMedia } from './layer';

export type LinkPhase = 'starting' | 'waiting' | 'expired' | 'error';

export interface LinkSheetProps {
  /** Presence classes (`grow`/`rise` + `is-open`/`is-closing`). */
  className: string;
  /** The corner it grows from (`bottom-right`, …). */
  origin: string;
  phase: LinkPhase;
  start: LinkStart | null;
  error?: string;
  onRetry: () => void;
  onClose: () => void;
}

export const LINK_STRINGS = {
  title: 'Link recorder',
  open: 'Open vitrinka',
  waiting: 'waiting for approval…',
  starting: 'asking vitrinka for a code…',
  expired: 'code expired — try again',
  retry: 'Try again',
  qrAlt: 'Scan to link',
  hint: 'Approve here, or scan it with your phone.',
  hintTouch: 'Approve it in vitrinka, then come back here.',
} as const;

export function LinkSheet({ className, origin, phase, start, error, onRetry, onClose }: LinkSheetProps): ReactElement {
  // The QR serves the desktop→phone path; a touch device cannot scan itself (D5).
  const qr = useMedia(FINE_QUERY);
  return (
    <div className={`pop link ${className}`} data-origin={origin} role="dialog" aria-labelledby="vt-link-title" data-e2e="link-sheet">
      <div className="pop-head">
        <span className="title">
          <i />
          <span id="vt-link-title">{LINK_STRINGS.title}</span>
        </span>
        <button type="button" className="closeb" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      {phase === 'starting' || !start ? (
        <div className="linkline">{phase === 'error' ? error || 'could not start the link' : LINK_STRINGS.starting}</div>
      ) : (
        <>
          <div className={qr ? 'linkgrid' : 'linkgrid noqr'}>
            <div className="code" data-e2e="link-code">
              {start.user_code}
            </div>
            <a className="sendb" href={start.verifyUrl} target="_blank" rel="noopener noreferrer">
              <NewTabIcon />
              <span>{LINK_STRINGS.open}</span>
            </a>
            {qr ? <img className="qr" src={start.qrUrl} alt={LINK_STRINGS.qrAlt} width={76} height={76} /> : null}
          </div>
          <div className={phase === 'expired' || phase === 'error' ? 'linkline bad' : 'linkline'}>
            {phase === 'waiting' ? LINK_STRINGS.waiting : phase === 'expired' ? LINK_STRINGS.expired : error}
            {phase === 'expired' || phase === 'error' ? (
              <button type="button" className="retry" onClick={onRetry}>
                {LINK_STRINGS.retry}
              </button>
            ) : null}
          </div>
        </>
      )}
      <div className="hints">{qr ? LINK_STRINGS.hint : LINK_STRINGS.hintTouch}</div>
    </div>
  );
}
