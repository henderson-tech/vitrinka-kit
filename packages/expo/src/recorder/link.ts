/**
 * The device link on native: start a code, poll for approval, store the
 * token through the recorder storage driver; forget it on Unlink or when a
 * session door answers 401. The flow itself is `@vitrinka/link`.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { type Linked, type LinkStart, linkWorkspace, pollLink, startLink } from '@vitrinka/link';

import { clearLink, onUnauthorized, storeLink, vitrinkaBase } from './api';
import { getState, resetQueues, setState } from './queue';
import { notify } from './state';

export { LinkExpired } from '@vitrinka/link';

export interface DeviceLink {
  start: LinkStart;
  linked: Promise<Linked>;
  cancel: () => void;
}

function label(): string {
  const os = Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS;
  const app = Constants.expoConfig?.name ?? 'app';
  return `${app} on ${os}`;
}

/**
 * Ask for a code and poll until approved; the token is stored on success.
 * A base addressing `/w/<slug>` preselects that workspace on the approve
 * page, and a token approved into any other one is discarded unstored
 * (LinkWorkspaceMismatch — the pill shows its message).
 */
export async function linkDevice(): Promise<DeviceLink> {
  const base = vitrinkaBase();
  const workspace = linkWorkspace(base);
  const start = await startLink(base, { label: label(), workspace });
  const ac = new AbortController();
  const linked = pollLink(base, start.device_code, { interval: start.interval, workspace, signal: ac.signal }).then((l) => {
    storeLink(l);
    notify();
    return l;
  });
  return { start, linked, cancel: () => ac.abort() };
}

/** Forget the stored link; a live session ends locally. */
export function forgetLink(): void {
  clearLink();
  if (getState()) {
    setState(null);
    void resetQueues();
  }
  notify();
}

export function installUnauthorizedHandler(): () => void {
  return onUnauthorized(() => {
    console.warn('vitrinka: recorder token rejected (401) — link the device again');
    forgetLink();
  });
}
