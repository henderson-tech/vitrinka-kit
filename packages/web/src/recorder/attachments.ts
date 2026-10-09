/**
 * The host half of recorder attachments: what an image must be to ride the
 * wire — png, webp or jpeg, ≤ 12 MiB, what `/shot` accepts — and how many one
 * note carries (the server takes 10 and ignores the rest). The HUD already
 * normalizes what it hands over (hud/attach.ts); this gate stands for any
 * other caller of the controller, dropping what the server would refuse
 * instead of uploading it.
 */
import type { AttachmentPayload, ImageMime } from '../protocol';
import { MAX_ATTACHMENT_BYTES } from './hud/attach';
import type { HudAttachment } from './hud/controller';

/** What the server keeps of one note; the rest is never uploaded. */
export const NOTE_ATTACHMENT_CAP = 10;

const MIMES: readonly ImageMime[] = ['image/png', 'image/webp', 'image/jpeg'];

/** One image ready for the queue: its event payload and its bytes. */
export interface StagedImage {
  payload: AttachmentPayload;
  blob: Blob;
}

/** The images of one note that can ride, in order; each one left out is said once. */
export function stageAttachments(list: readonly HudAttachment[] | undefined): StagedImage[] {
  const out: StagedImage[] = [];
  for (const a of list ?? []) {
    if (out.length >= NOTE_ATTACHMENT_CAP) {
      console.warn(`vitrinka: a note carries at most ${NOTE_ATTACHMENT_CAP} images — the rest are left out`);
      break;
    }
    const mime = MIMES.find((m) => m === a.blob.type);
    if (!mime || a.blob.size === 0 || a.blob.size > MAX_ATTACHMENT_BYTES) {
      const why = !mime ? `${a.blob.type || 'an untyped blob'} is not png, webp or jpeg` : a.blob.size ? 'over 12 MiB' : 'empty';
      console.warn(`vitrinka: attachment ${a.name} left out — ${why}`);
      continue;
    }
    out.push({
      blob: a.blob,
      payload: {
        name: a.name,
        mime,
        bytes: a.blob.size,
        ...(a.w > 0 ? { w: Math.round(a.w) } : {}),
        ...(a.h > 0 ? { h: Math.round(a.h) } : {}),
      },
    });
  }
  return out;
}
