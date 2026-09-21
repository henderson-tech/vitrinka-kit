/**
 * The device link, wired to the recorder: start a code, poll for approval,
 * store the token; forget it on Unlink or when a session door answers 401.
 */
import { type Linked, type LinkStart, pollLink, startLink } from '@vitrinka/link';

import { onUnauthorized } from './api';
import { clearLink, defaultLinkLabel, recorderConfig, storeLink } from './config';
import { getState, resetQueues, setState } from './queue';
import { notify } from './state';

export { LinkExpired } from '@vitrinka/link';

export interface DeviceLink {
  start: LinkStart;
  /** Resolves once the tester approved; rejects with LinkExpired / AbortError. */
  linked: Promise<Linked>;
  cancel: () => void;
}

/** Ask for a code and poll until approved. The token is stored on success. */
export async function linkDevice(): Promise<DeviceLink> {
  const { url } = recorderConfig();
  const start = await startLink(url, { label: defaultLinkLabel() });
  const ac = new AbortController();
  const linked = pollLink(url, start.device_code, { interval: start.interval, signal: ac.signal }).then((l) => {
    storeLink(l);
    return l;
  });
  return { start, linked, cancel: () => ac.abort() };
}

/** Forget the stored link; a live session ends locally (its tail is dropped). */
export function forgetLink(): void {
  clearLink();
  if (getState()) {
    setState(null);
    resetQueues();
  }
  notify();
}

/** Register the 401 → unlinked transition. Returns the uninstaller. */
export function installUnauthorizedHandler(): () => void {
  return onUnauthorized(() => {
    console.warn('vitrinka: recorder token rejected (401) — link the device again');
    forgetLink();
  });
}
