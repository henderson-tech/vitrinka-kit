/**
 * Which face a `<vitrinka-report>` shows (vt-8020 D8): Report a problem, or —
 * for a linked vitrinka member — the recorder pill, switched in place and
 * remembered per browser and origin (`vitrinka.report.face` in localStorage).
 *
 * A member is a browser holding the device link the member link flow minted
 * (`vitrinka.recorder.link`) on the widget's own `base`. A reporter holds
 * none, and a `vkr_` key the host passes is a build's key, never a person:
 * neither ever gets the switch. D8's "a dev-mode member starts on the pill"
 * has no input yet — `GET /api/v1/recorder/me` carries no display mode — so
 * the first mount is always the report face until the member picks the pill.
 */
import { linkWorkspace } from '@vitrinka/link';

import { LINK_KEY, readLink } from '../recorder/config';
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

/** The face a mount starts on: the pill only for a member who last left it on the pill. */
export function startFace(base: string): ReportFace {
  return rememberedFace() === 'recorder' && memberLinked(base) ? 'recorder' : 'report';
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
