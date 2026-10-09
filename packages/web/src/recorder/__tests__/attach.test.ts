import { afterEach, expect, it } from 'bun:test';
import { __resetEncoderForTests, MAX_ATTACHMENT_BYTES, normalizeAttachment } from '../hud/attach';

const bitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
const canvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
afterEach(() => {
  if (bitmap) Object.defineProperty(globalThis, 'createImageBitmap', bitmap); else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  if (canvas) Object.defineProperty(globalThis, 'OffscreenCanvas', canvas); else Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
  __resetEncoderForTests();
});
/** `webp: false` plays Safari: a WebP request comes back PNG. `alpha` paints a pixel that is not opaque. */
function encoder(size: (w: number) => number, { webp = true, alpha = false } = {}) {
  let closed = 0;
  const calls: { w: number; h: number; type?: string; quality?: number }[] = [];
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 5120, height: 2560, close: () => closed++ }) });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    constructor(readonly width: number, readonly height: number) {}
    getContext() { return { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, alpha ? 128 : 255]) }) }; }
    async convertToBlob(options: { type?: string; quality?: number }) {
      calls.push({ w: this.width, h: this.height, ...options });
      return new Blob([new Uint8Array(size(this.width))], { type: options.type === 'image/webp' && !webp ? 'image/png' : options.type });
    }
  } });
  return { calls, closed: () => closed };
}
it('downscales the long edge and re-encodes WebP at 0.85, closing the bitmap', async () => {
  const seam = encoder(() => 4);
  const image = await normalizeAttachment(new Blob(['input'], { type: 'image/jpeg' }), 'reference.jpg');
  expect(image).toMatchObject({ name: 'reference.jpg', w: 2560, h: 1280 });
  expect(image.blob.type).toBe('image/webp');
  expect(seam.calls).toEqual([{ w: 2560, h: 1280, type: 'image/webp', quality: 0.85 }]);
  expect(seam.closed()).toBe(1);
});
it('steps down an oversized encoding until the uploaded blob meets the cap', async () => {
  const seam = encoder(w => w === 2560 ? MAX_ATTACHMENT_BYTES + 1 : 8);
  const image = await normalizeAttachment(new Blob(['input'], { type: 'image/png' }), 'reference.png');
  expect(image.blob.size).toBeLessThanOrEqual(MAX_ATTACHMENT_BYTES);
  expect(image.w).toBeLessThan(2560);
  expect(seam.calls).toHaveLength(2);
});
it('falls back to JPEG at 0.85 for an opaque image when the browser refuses WebP, and stops asking for WebP', async () => {
  const seam = encoder(() => 4, { webp: false });
  const first = await normalizeAttachment(new Blob(['input'], { type: 'image/png' }), 'opaque.png');
  expect(first.blob.type).toBe('image/jpeg');
  const second = await normalizeAttachment(new Blob(['input'], { type: 'image/png' }), 'again.png');
  expect(second.blob.type).toBe('image/jpeg');
  expect(seam.calls.map(c => [c.type, c.quality])).toEqual([['image/webp', 0.85], ['image/jpeg', 0.85], ['image/jpeg', 0.85]]);
  expect(seam.closed()).toBe(2);
});
it('keeps a transparent image PNG when the browser refuses WebP', async () => {
  const seam = encoder(() => 4, { webp: false, alpha: true });
  const image = await normalizeAttachment(new Blob(['input'], { type: 'image/png' }), 'cutout.png');
  expect(image.blob.type).toBe('image/png');
  expect(seam.calls.map(c => [c.type, c.quality])).toEqual([['image/webp', 0.85], ['image/png', undefined]]);
  expect(seam.closed()).toBe(1);
});
it('rejects non-image input before decoding', async () => {
  const seam = encoder(() => 4);
  await expect(normalizeAttachment(new Blob(['text'], { type: 'text/plain' }), 'notes.txt')).rejects.toThrow('Not an image: notes.txt');
  expect(seam.calls).toEqual([]);
  expect(seam.closed()).toBe(0);
});
