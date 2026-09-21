/**
 * The link sheet: the 9-char code, "Open vitrinka" for the same-device path,
 * the server-rendered QR for the desktop→phone path, and the waiting line.
 * Polling runs in the parent; this only paints the state.
 */
import type { ReactElement } from 'react';
import type { LinkStart } from '@vitrinka/link';

import { CloseIcon, NewTabIcon } from './icons';

export type LinkPhase = 'starting' | 'waiting' | 'expired' | 'error';

export interface LinkSheetProps {
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
  hint: 'approve on this device, or scan from your phone',
} as const;

export function LinkSheet({ phase, start, error, onRetry, onClose }: LinkSheetProps): ReactElement {
  return (
    <div className="pop link" role="dialog" aria-labelledby="vt-link-title" data-e2e="link-sheet">
      <div className="pop-head">
        <label>
          <i />
          <span id="vt-link-title">{LINK_STRINGS.title}</span>
        </label>
        <button type="button" className="closeb" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      {phase === 'starting' || !start ? (
        <div className="linkline">{phase === 'error' ? error || 'could not start the link' : LINK_STRINGS.starting}</div>
      ) : (
        <>
          <div className="code" data-e2e="link-code">{start.user_code}</div>
          <div className="linkrow">
            <a className="sendb" href={start.verifyUrl} target="_blank" rel="noopener noreferrer">
              <NewTabIcon />
              <span>{LINK_STRINGS.open}</span>
            </a>
            <img className="qr" src={start.qrUrl} alt={LINK_STRINGS.qrAlt} width={96} height={96} />
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
      <div className="hints">{LINK_STRINGS.hint}</div>
    </div>
  );
}
