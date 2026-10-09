import { afterEach, beforeEach, expect, it } from 'bun:test';
import type { RecorderEvent } from '../../protocol';
import { stageAttachments } from '../attachments';
import { addNote } from '../session';
import { __dropCachesForTests, __imagesForTests, __resetForTests, flush, persistNow, setState } from '../queue';
import { __resetStorageForTests, configureRecorderStorage, memoryRecorderStorage, type RecorderStorage } from '../storage';
import { configureRecorderBlobStore, memoryBlobStore, __resetBlobStoreForTests } from '../storage/blobs';
import { fakeLocation, freshRecorder, installStub, liveSession, type Stub } from './stub';

let stub: Stub;
const image = () => ({ name: 'reference.png', blob: new Blob(['pixels'], { type: 'image/png' }), w: 40, h: 20 });
const events = () => stub.calls.filter(c => c.path.endsWith('/events')).flatMap(c => (c.body as { events: RecorderEvent[] }).events);
/** A store shared across tabs (it locks), so every capture keeps a journal another tab can recover. */
function sharedStore(): RecorderStorage {
  const storage = memoryRecorderStorage();
  __resetStorageForTests();
  configureRecorderStorage({ ...storage, withLock: async (_key, run) => { run(); } });
  __resetForTests();
  setState({ ...liveSession(), attachments: true });
  return storage;
}
beforeEach(() => {
  stub = installStub();
  freshRecorder();
  fakeLocation();
  configureRecorderBlobStore({ ...memoryBlobStore(), durable: true });
  setState({ ...liveSession(), attachments: true });
});
afterEach(() => { stub.restore(); __resetBlobStoreForTests(); });

it('allocates attachment seqs before an image-only note and uploads typed bytes before its attachment row', async () => {
  const a = image();
  addNote('', [a]);
  expect(await flush()).toBe(true);
  const upload = stub.calls.find(c => c.path.includes('/shot?seq='))!;
  const attachment = events().find(e => e.kind === 'attachment')!;
  const note = events().find(e => e.kind === 'note')!;
  expect(upload.path).toBe(`/api/v1/sessions/sess-1/shot?seq=${attachment.seq}`);
  expect(upload.headers['content-type']).toBe('image/png');
  expect(upload.body).toBe(a.blob);
  expect(stub.calls.indexOf(upload)).toBeLessThan(stub.calls.findIndex(c => c.path.endsWith('/events')));
  expect(attachment).toMatchObject({ blobKey: `image-${attachment.seq}`, payload: { name: a.name, mime: 'image/png', bytes: 6, w: 40, h: 20 } });
  expect(attachment.seq).toBeLessThan(note.seq);
  expect(attachment.tabId).toBe(note.tabId);
  expect(attachment.tabHost).toBe(note.tabHost);
  expect(note.payload).toMatchObject({ text: '', attachments: [attachment.seq] });
});

it('re-uploads journaled bytes after a reload while the first upload was offline', async () => {
  addNote('reference', [image()]);
  stub.script.chunks.push({ ok: false, status: 503 });
  await flush();
  expect(events().some(e => e.kind === 'attachment')).toBe(false);
  persistNow();
  __dropCachesForTests();
  expect(await flush()).toBe(true);
  const uploads = stub.calls.filter(c => c.path.includes('/shot?seq='));
  expect(uploads).toHaveLength(2);
  expect(uploads[1]!.path).toBe(uploads[0]!.path);
  expect(await (uploads[1]!.body as Blob).text()).toBe('pixels');
  expect(events().filter(e => e.kind === 'attachment')).toHaveLength(1);
});

it('keeps journaled bytes queued when the journal read fails transiently', async () => {
  const store = memoryBlobStore();
  let refuseRead = true;
  configureRecorderBlobStore({ ...store, durable: true, get: async key => {
    if (refuseRead) throw new Error('temporary journal read failure');
    return store.get(key);
  } });
  addNote('reference', [image()]);
  stub.script.chunks.push({ ok: false, status: 503 });
  await flush();
  persistNow();
  __dropCachesForTests();
  await flush();
  refuseRead = false;
  await flush();
  expect(events().some(e => e.kind === 'attachment')).toBe(true);
});

it('gives an image up only after the journal refuses five reads in a row', async () => {
  configureRecorderBlobStore({ ...memoryBlobStore(), durable: true, get: async () => { throw new Error('journal gone'); } });
  addNote('reference', [image()]);
  stub.script.chunks.push({ ok: false, status: 503 });
  await flush();
  persistNow();
  __dropCachesForTests();
  for (let i = 0; i < 4; i++) await flush();
  expect(__imagesForTests()).toHaveLength(1);
  await flush();
  expect(__imagesForTests()).toHaveLength(0);
  expect(events().some(e => e.kind === 'attachment')).toBe(false);
  expect(events().some(e => e.kind === 'note')).toBe(true);
});

it('publishes a note\'s capture journal only once its image bytes are in the blob journal', async () => {
  const storage = sharedStore();
  const store = memoryBlobStore();
  let land = () => {};
  const landed = new Promise<void>(resolve => { land = resolve; });
  configureRecorderBlobStore({ ...store, durable: true, put: async (key, blob) => { await landed; await store.put(key, blob); } });
  addNote('reference', [image()]);
  await Bun.sleep(0);
  const journals = () => storage.keys!().filter(key => key.startsWith('allocation.'));
  // Another tab recovering it now would read no bytes and drop the image as lost.
  expect(journals()).toEqual([]);
  land();
  await Bun.sleep(0);
  expect(journals()).toHaveLength(1);
  expect(await flush()).toBe(true);
  expect(events().some(e => e.kind === 'attachment')).toBe(true);
});

it('deletes an uploaded image\'s bytes once its row is acknowledged after a reload', async () => {
  sharedStore();
  const store = memoryBlobStore();
  configureRecorderBlobStore({ ...store, durable: true });
  addNote('reference', [image()]);
  stub.script.events.push({ ok: false, status: 503 });
  expect(await flush()).toBe(false);
  expect(stub.calls.some(c => c.path.includes('/shot?seq='))).toBe(true);
  persistNow();
  __dropCachesForTests();
  expect(await flush()).toBe(true);
  expect(stub.calls.filter(c => c.path.includes('/shot?seq='))).toHaveLength(1);
  expect(await store.keys()).toEqual([]);
});

it('bounds the queued image bytes: past the budget the oldest image goes loudly, its journaled bytes with it', async () => {
  const store = memoryBlobStore();
  configureRecorderBlobStore({ ...store, durable: true });
  const big = (i: number) => ({ name: `big-${i}.png`, blob: new Blob([new Uint8Array(12 * 1024 * 1024)], { type: 'image/png' }), w: 1, h: 1 });
  for (let i = 0; i < 6; i++) addNote(`note ${i}`, [big(i)]);
  await Bun.sleep(0);
  expect(__imagesForTests().map(i => i.name)).toEqual(['big-1.png', 'big-2.png', 'big-3.png', 'big-4.png', 'big-5.png']);
  expect((await store.keys()).sort()).toEqual(__imagesForTests().map(i => i.blob).sort());
});

it('a reload never restores an image the budget evicted, nor evicts a queued one in its place', async () => {
  sharedStore();
  const store = memoryBlobStore();
  configureRecorderBlobStore({ ...store, durable: true });
  const big = (i: number) => ({ name: `big-${i}.png`, blob: new Blob([new Uint8Array(12 * 1024 * 1024)], { type: 'image/png' }), w: 1, h: 1 });
  for (let i = 0; i < 6; i++) addNote(`note ${i}`, [big(i)]);
  await Bun.sleep(0);
  const queued = ['big-1.png', 'big-2.png', 'big-3.png', 'big-4.png', 'big-5.png'];
  expect(__imagesForTests().map(i => i.name)).toEqual(queued);
  persistNow();
  __dropCachesForTests();
  stub.script.chunks.push({ ok: false, status: 503 });
  await flush();
  await Bun.sleep(0);
  expect(__imagesForTests().map(i => i.name)).toEqual(queued);
  expect((await store.keys()).sort()).toEqual(__imagesForTests().map(i => i.blob).sort());
});

it('does not upload attachments when capability is absent', async () => {
  setState(liveSession());
  addNote('text only', [image()]);
  await flush();
  expect(stub.calls.some(c => c.path.includes('/shot?seq='))).toBe(false);
  expect(events().find(e => e.kind === 'note')?.payload).not.toHaveProperty('attachments');
});

it('stages only supported nonempty images within the transport size and count caps', () => {
  const a = image();
  expect(stageAttachments([{ ...a, blob: new Blob(['x'], { type: 'text/plain' }) }, { ...a, blob: new Blob([], { type: 'image/png' }) }, { ...a, blob: new Blob([new Uint8Array(12 * 1024 * 1024 + 1)], { type: 'image/png' }) }])).toEqual([]);
  expect(stageAttachments(Array.from({ length: 11 }, image))).toHaveLength(10);
});
