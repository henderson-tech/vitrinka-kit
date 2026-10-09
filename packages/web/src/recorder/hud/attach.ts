/**
 * One picked, pasted or dropped file → a `HudAttachment` a controller ships
 * as-is (recorder attachments). The image is decoded (an animated input keeps
 * its first frame), drawn at a long edge ≤ 2560 px and re-encoded, so its
 * EXIF/GPS never leave the device: WebP at 0.85; where the browser cannot
 * encode WebP (it hands back another type) JPEG at 0.85, or PNG when the
 * image has transparency JPEG would lose. Over 12 MiB (the `/shot` cap) it
 * steps down until it fits. A file that is not an image is refused with a
 * reason the sheet shows verbatim.
 */
import type { HudAttachment } from './controller';

/** Images one note carries from the HUD (the server takes at most 10). */
export const MAX_ATTACHMENTS = 4;
export const MAX_EDGE = 2560;
/** The `/shot` upload cap. */
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const QUALITY = 0.85;
/** Step-downs before an image counts as too large. */
const MAX_TRIES = 8;

/** The two calls the encoder needs, as both canvas kinds spell them. */
interface Paint {
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
}

interface Surface {
  paint: Paint;
  encode(type: string, quality?: number): Promise<Blob | null>;
}

interface Decoded {
  source: CanvasImageSource;
  w: number;
  h: number;
  close(): void;
}

/** null until the first encode says whether this browser writes WebP. */
let webp: boolean | null = null;

/** The name a pasted image carries: the clipboard's generic one becomes "pasted image.<ext>". */
export function pastedName(file: File): string {
  if (file.name && !/^(image|untitled)\.\w+$/i.test(file.name)) return file.name;
  const ext = file.type.startsWith('image/') ? file.type.slice(6).replace('jpeg', 'jpg').replace(/\+.*$/, '') : 'png';
  return `pasted image.${ext || 'png'}`;
}

/**
 * Normalize one file for a note. Rejects with an `Error` whose message names
 * the file and the reason (not an image, unreadable, too large).
 */
export async function normalizeAttachment(file: Blob, name: string): Promise<HudAttachment> {
  if (file.type && !file.type.startsWith('image/')) throw new Error(`${name} is not an image`);
  let img: Decoded;
  try {
    img = await decode(file);
  } catch (e) {
    console.warn('vitrinka: attachment decode failed —', e);
    throw new Error(`${name} could not be read as an image`);
  }
  let out: HudAttachment | null;
  try {
    out = await encode(img, name, mayHaveAlpha(file.type));
  } catch (e) {
    // A canvas the browser refuses to read back (a tainted SVG) or encode.
    console.warn('vitrinka: attachment encode failed —', e);
    throw new Error(`${name} could not be converted`);
  } finally {
    img.close();
  }
  if (!out) throw new Error(`${name} is too large to attach`);
  return out;
}

/** JPEG never carries transparency; anything else may. */
function mayHaveAlpha(type: string): boolean {
  return type !== 'image/jpeg' && type !== 'image/jpg';
}

/** The re-encoded image, or null when even the last step-down is over the cap. */
async function encode(img: Decoded, name: string, alphaInput: boolean): Promise<HudAttachment | null> {
  let scale = Math.min(1, MAX_EDGE / Math.max(img.w, img.h));
  let alpha: boolean | null = null;
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const w = Math.max(1, Math.round(img.w * scale));
    const h = Math.max(1, Math.round(img.h * scale));
    const s = surface(w, h);
    s.paint.drawImage(img.source, 0, 0, w, h);
    let blob = webp === false ? null : await s.encode('image/webp', QUALITY);
    if (blob && webp === null) webp = blob.type === 'image/webp';
    if (!blob || blob.type !== 'image/webp') {
      alpha ??= alphaInput && hasAlpha(s.paint, w, h);
      blob = alpha ? await s.encode('image/png') : await s.encode('image/jpeg', QUALITY);
    }
    if (!blob) throw new Error('the canvas encoded nothing');
    if (blob.size <= MAX_ATTACHMENT_BYTES) return { name, blob, w, h };
    // Bytes scale with the area: aim just under the cap, never less than half the edge a step.
    scale *= Math.min(0.9, Math.max(0.5, Math.sqrt(MAX_ATTACHMENT_BYTES / blob.size) * 0.95));
  }
  return null;
}

/** Any pixel not fully opaque. */
function hasAlpha(paint: Paint, w: number, h: number): boolean {
  const data = paint.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 255) return true;
  return false;
}

/** An OffscreenCanvas where there is one, else a detached `<canvas>`. */
function surface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas === 'function') {
    const c = new OffscreenCanvas(w, h);
    const paint = c.getContext('2d');
    if (!paint) throw new Error('no 2d canvas');
    return { paint, encode: (type, quality) => c.convertToBlob({ type, ...(quality === undefined ? {} : { quality }) }) };
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const paint = c.getContext('2d');
  if (!paint) throw new Error('no 2d canvas');
  return { paint, encode: (type, quality) => new Promise((resolve) => c.toBlob(resolve, type, quality)) };
}

/**
 * Decode upright (EXIF orientation applied, so the re-encode that drops the
 * tag keeps the picture the right way up). `createImageBitmap` takes most
 * types; an SVG decodes only through an `<img>`.
 */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const el = new Image();
    el.src = url;
    await el.decode();
    if (!el.naturalWidth || !el.naturalHeight) throw new Error('no intrinsic size');
    return { source: el, w: el.naturalWidth, h: el.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}
