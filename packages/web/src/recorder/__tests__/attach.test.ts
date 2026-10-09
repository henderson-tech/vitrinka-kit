import { afterEach, expect, it } from 'bun:test';
import { MAX_ATTACHMENT_BYTES, normalizeAttachment } from '../hud/attach';

const bitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
const canvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
afterEach(() => {
  if (bitmap) Object.defineProperty(globalThis, 'createImageBitmap', bitmap); else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  if (canvas) Object.defineProperty(globalThis, 'OffscreenCanvas', canvas); else Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
});
function encoder(size: (w: number) => number) {
  let closed = 0;
  const calls: { w: number; h: number; type?: string; quality?: number }[] = [];
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 5120, height: 2560, close: () => closed++ }) });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    constructor(readonly width: number, readonly height: number) {}
    getContext() { return { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }) }; }
    async convertToBlob(options: { type?: string; quality?: number }) {
      calls.push({ w: this.width, h: this.height, ...options });
      return new Blob([new Uint8Array(size(this.width))], { type: options.type });
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
it('rejects non-image input before decoding', async () => {
  const seam = encoder(() => 4);
  await expect(normalizeAttachment(new Blob(['text'], { type: 'text/plain' }), 'notes.txt')).rejects.toThrow('notes.txt is not an image');
  expect(seam.calls).toEqual([]);
  expect(seam.closed()).toBe(0);
});
