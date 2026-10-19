/**
 * Which face a `<vitrinka-report>` shows (vt-8020 D8): Report a problem, or —
 * for a linked vitrinka member — the recorder pill, switched in place and
 * remembered per browser and origin (`vitrinka.report.face` in localStorage).
 *
 * A member is a browser holding the device link the member link flow minted
 * (`vitrinka.recorder.link`) on the widget's own `base`. A reporter holds
 * none, and a `vkr_` key the host passes is a build's key, never a person:
 * neither ever gets the switch. A member who never picked starts where their
 * account's display mode says (D8: dev starts on the pill) — the mode
 * `GET /api/v1/recorder/me` answers, remembered here once the widget read it.
 */
import { linkWorkspace } from '@vitrinka/link';

import { LINK_KEY, readLink } from '../recorder/config';
import { getState } from '../recorder/queue';
import { subscribe } from '../recorder/state';
import { getRecorderStorage } from '../recorder/storage';
import type { ReportFace } from './element';

/** localStorage key of the face this browser last picked on this origin. */
export const FACE_KEY = 'vitrinka.report.face';

const trimBase = (url: string): string => url.trim().replace(/\/+$/, '');

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage blocked (sandboxed frame, privacy mode): every mount starts on the report face
  }
}

/**
 * This browser holds a member link for `base`: one recorded as minted there,
 * or — a link stored before links carried their base — one pinned to the
 * workspace `base` addresses (any, for a bare origin).
 */
export function memberLinked(base: string): boolean {
  const link = readLink();
  if (!link) return false;
  if (link.base) return trimBase(link.base) === trimBase(base);
  try {
    const ws = linkWorkspace(base);
    return ws === undefined || ws === link.workspace;
  } catch {
    return false; // not a URL: no link can be for it
  }
}

/** The face this browser last picked here; null when it never picked (or storage is blocked). */
export function rememberedFace(): ReportFace | null {
  const v = store()?.getItem(FACE_KEY);
  return v === 'recorder' || v === 'report' ? v : null;
}

export function rememberFace(face: ReportFace): void {
  try {
    store()?.setItem(FACE_KEY, face);
  } catch (e) {
    console.warn('vitrinka: the picked face could not be remembered — the next load starts on Report a problem', e);
  }
}

/** localStorage key of the linked member's display mode, as `/api/v1/recorder/me` last answered it. */
export const MODE_KEY = 'vitrinka.report.mode';

export function rememberDisplayMode(mode: string | undefined): void {
  try {
    if (mode === 'dev' || mode === 'regular') store()?.setItem(MODE_KEY, mode);
  } catch (e) {
    console.warn('vitrinka: the display mode could not be remembered — the next load starts on Report a problem', e);
  }
}

/** The face a mount starts on: a member's last pick, else the pill for a dev-mode member; everyone else the report face. */
export function startFace(base: string): ReportFace {
  if (!memberLinked(base)) return 'report';
  const picked = rememberedFace();
  if (picked) return picked;
  return store()?.getItem(MODE_KEY) === 'dev' ? 'recorder' : 'report';
}

/**
 * The pill holds a recording: the session record its ⋯ menu reads, which
 * offers "Report a problem" only while there is none (Menu.tsx) — leaving
 * the pill mid-recording would strand the session, so nothing switches away.
 */
export function pillRecording(): boolean {
  return getState() !== null;
}

/**
 * Hear the stored link change: another tab's link or unlink (the storage
 * event), or this document's (`storeLink` / `clearLink` notify). Returns the
 * unsubscribe.
 */
export function watchMemberLink(onChange: () => void): () => void {
  const offOther = getRecorderStorage().watch?.(LINK_KEY, () => onChange());
  const offHere = subscribe(onChange);
  return () => {
    offOther?.();
    offHere();
  };
}
