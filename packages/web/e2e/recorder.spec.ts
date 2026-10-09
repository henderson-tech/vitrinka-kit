/**
 * The recorder end to end in headless Chromium: a node:http page server
 * serves the fixture (bundled with `bun build --format=iife` into a temp
 * dir), a second node:http "vitrinka" stub records every call to the session
 * doors (both in fixture/servers.ts). The test starts a recording from the
 * pill, clicks, pushes a route, sends a note, drags a region annotation and
 * stops — then asserts what the stub saw.
 */
import { readFileSync } from 'node:fs';

import { expect, type Locator, type Page, test } from '@playwright/test';

import type { RecorderControl } from '../src/recorder/control';
import { type Seen, type Servers, startServers } from './fixture/servers';

let servers: Servers;
let pageUrl: string;
let stubUrl: string;
let seen: Seen[];

test.beforeAll(async () => {
  servers = await startServers();
  ({ pageUrl, stubUrl, seen } = servers);
});

test.afterAll(async () => {
  await servers?.close();
});

test('records a journey: create · click · nav · note · region annotation · rrweb · stop', async ({ page }) => {
  // A magic-link style start URL: its token must never reach the stream.
  await page.goto(`${pageUrl}/?token=e2e-url-secret`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const pill = page.locator('[data-e2e="recorder-pill"]');
  await expect(pill).toBeVisible();
  // At rest the capsule is the dot and the clock; the tools unfold on intent.
  const handle = page.getByRole('button', { name: 'Recorder controls' });
  await expect(pill).toHaveAttribute('data-face', 'rec');
  await expect(handle).toHaveText(/^\d\d:\d\d/);
  await page.mouse.move(600, 400);
  await expect(handle).toHaveAttribute('aria-expanded', 'false', { timeout: 5_000 });

  await page.locator('#buy').click();
  await page.locator('#go').click();
  await expect(page).toHaveURL(/\/orders\/42$/);

  // ✎ note: Enter sends.
  await handle.hover();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Note' }).click();
  const ta = page.getByPlaceholder("what's wrong / what to refine…");
  await expect(ta).toBeFocused();
  await ta.fill('checkout looks off');
  await ta.press('Enter');
  await expect(ta).toBeHidden();

  // ⌖ annotate: drag a region over the target.
  await handle.hover();
  await page.getByRole('button', { name: 'Annotate' }).click();
  await expect(page.locator('[data-e2e="annotate-dim"]')).toBeVisible();
  const box = (await page.locator('#target').boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 90, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('Annotate region')).toBeVisible();
  await ta.fill('this area');
  await ta.press('Enter');
  await expect(ta).toBeHidden();

  // Stop from the pill, confirmed inline; the drain must reach a PATCH done.
  await handle.hover();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('group', { name: 'Stop and save' }).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(() => seen.some((s) => s.method === 'PATCH' && (s.body as { status?: string })?.status === 'done'), {
    timeout: 30_000,
  }).toBe(true);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();

  const create = seen.find((s) => s.method === 'POST' && s.path === '/api/v1/sessions')!;
  expect(create.headers.authorization).toBe('Bearer vkr_e2e');
  const cb = create.body as { host: string; title: string; meta: { recorder: string; platform: string; userAgent: string } };
  expect(cb.host).toBe(new URL(pageUrl).host);
  expect(cb.title).toBe('e2e journey');
  expect(cb.meta.recorder.startsWith('web/')).toBe(true);
  expect(cb.meta.platform).toBe('web');

  const events = seen
    .filter((s) => s.path.endsWith('/events'))
    .flatMap((s) => (s.body as { events: { seq: number; kind: string; payload?: Record<string, unknown>; blobKey?: string }[] }).events);
  const kinds = new Set(events.map((e) => e.kind));
  expect([...kinds]).toEqual(expect.arrayContaining(['rrweb', 'click', 'nav', 'note']));
  const rr = events.find((e) => e.kind === 'rrweb')!;
  expect(rr.blobKey).toMatch(/^blob-\d+$/);
  expect(seen.some((s) => s.path === `/api/v1/sessions/sess-e2e/chunk?seq=${rr.seq}`)).toBe(true);
  const click = events.find((e) => e.kind === 'click' && e.payload?.selector === '#buy')!;
  expect(click.payload).toMatchObject({ text: 'Buy now (0)', route: '/' });
  expect((click.payload!.rect as { w: number }).w).toBeGreaterThan(0);
  const nav = events.find((e) => e.kind === 'nav' && e.payload?.route === '/orders/42')!;
  expect(nav.payload).toMatchObject({ spa: true });
  // The start URL's secret is scrubbed in the session's first nav AND in
  // rrweb's Meta event, which carries location.href on every full snapshot.
  const startNav = events.find((e) => e.kind === 'nav' && e.payload?.route === '/')!;
  expect(startNav.payload).toMatchObject({ url: `${pageUrl}/?token=[redacted]` });
  const chunkBodies = seen.filter((s) => s.path.includes('/chunk?seq=')).map((s) => JSON.stringify(s.body));
  expect(chunkBodies.join('')).toContain('?token=[redacted]');
  expect(JSON.stringify(events) + chunkBodies.join('')).not.toContain('e2e-url-secret');
  expect(events.some((e) => e.kind === 'note' && e.payload?.text === 'checkout looks off' && !e.payload.annotate)).toBe(true);
  const region = events.find((e) => e.kind === 'note' && e.payload?.annotate === true)!;
  expect(region.payload).toMatchObject({ text: 'this area', selector: '', route: '/orders/42' });
  expect((region.payload!.rect as { w: number; h: number }).w).toBeGreaterThan(50);
  // seq strictly increasing across every batch, no duplicates.
  const seqs = events.map((e) => e.seq);
  expect(new Set(seqs).size).toBe(seqs.length);
  // The recorder never recorded its own uploads.
  expect(events.some((e) => e.kind === 'net' && String(e.payload?.url).startsWith(stubUrl))).toBe(false);
});

async function openResizeNote(page: Page) {
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  const text = page.getByPlaceholder("what's wrong / what to refine…");
  await expect(text).toBeFocused();
  await expect.poll(() => text.evaluate((el) => el.closest('.pop')!.classList.contains('is-open'))).toBe(true);
  await text.evaluate(async (el) => { await Promise.all(el.closest('.pop')!.getAnimations().map((animation) => animation.finished)); });
  return text;
}

const sheetMetrics = (text: Locator) => text.evaluate((el) => {
  const cs = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  return { height: box.height, cap: parseFloat(cs.lineHeight) * 20 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom),
    client: el.clientHeight, scroll: el.scrollHeight, overflow: cs.overflowY };
});

test('note textarea grows to twenty rows then scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.goto(pageUrl);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const text = await openResizeNote(page);
  const initial = await sheetMetrics(text);
  await text.fill(Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n'));
  expect((await sheetMetrics(text)).height).toBeGreaterThan(initial.height);
  await text.fill(Array.from({ length: 25 }, (_, i) => `Line ${i}`).join('\n'));
  const capped = await sheetMetrics(text);
  await expect.poll(async () => { const m = await sheetMetrics(text); return m.height - m.cap; }).toBeCloseTo(0, 0);
  expect(capped.scroll).toBeGreaterThan(capped.client);
  expect(capped.overflow).toBe('auto');
});

test('grip drag changes both dimensions once and survives a page reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.goto(pageUrl);
  await page.getByRole('button', { name: 'Start recording' }).click();
  let text = await openResizeNote(page);
  const draft = Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n');
  await text.fill(draft);
  const grip = page.getByRole('button', { name: 'Resize note', exact: true });
  const before = (await text.boundingBox())!;
  const corner = (await grip.boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + corner.width / 2 - 100, corner.y + corner.height / 2 - 60, { steps: 6 });
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.recorder.prefs'))).toBeNull();
  await page.mouse.up();
  const after = (await text.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 90);
  expect(after.height).toBeGreaterThan(before.height + 50);
  const stored = await page.evaluate(() => localStorage.getItem('vitrinka.recorder.prefs'));
  expect(JSON.parse(stored!).sheetW).toBe(540);
  await page.reload();
  text = await openResizeNote(page);
  await text.fill(draft);
  expect((await text.boundingBox())!.width).toBeCloseTo(after.width, 0);
  expect((await text.boundingBox())!.height).toBeCloseTo(after.height, 0);
});

test('grip keyboard resizes and Enter restores defaults', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.goto(pageUrl);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const text = await openResizeNote(page);
  const before = (await text.boundingBox())!;
  const grip = page.getByRole('button', { name: 'Resize note', exact: true });
  await grip.focus();
  await grip.press('ArrowLeft');
  expect((await text.boundingBox())!.width).toBeCloseTo(before.width + 16, 0);
  await grip.press('Shift+ArrowUp');
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('vitrinka.recorder.prefs')))!).sheetH).toBe(128);
  await grip.press('Enter');
  expect((await text.boundingBox())!.width).toBeCloseTo(before.width, 0);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('vitrinka.recorder.prefs')))!)).toMatchObject({ sheetW: 0, sheetH: 0 });
});

test('a drag shows the cap it sets, then a short draft fits itself again under it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.goto(pageUrl);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const text = await openResizeNote(page);
  await text.fill('One line');
  const before = (await text.boundingBox())!.height;
  const corner = (await page.getByRole('button', { name: 'Resize note', exact: true }).boundingBox())!;
  const at = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y - 120, { steps: 6 });
  const height = async () => (await text.boundingBox())!.height;
  await expect.poll(height).toBeCloseTo(before + 120, 0);
  await page.mouse.up();
  await expect.poll(height).toBeCloseTo(before, 0);
  const cap = JSON.parse((await page.evaluate(() => localStorage.getItem('vitrinka.recorder.prefs')))!).sheetH;
  expect(cap).toBeCloseTo(before + 120, 0);
  await text.fill(Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n'));
  expect((await text.boundingBox())!.height).toBeCloseTo(cap, 0);
});

test('links the device from the pill, then records with the minted token', async ({ page }) => {
  seen.length = 0;
  await page.goto(`${pageUrl}/?nokey=1`);
  await page.getByRole('button', { name: 'Link recorder' }).click();
  const sheet = page.locator('[data-e2e="link-sheet"]');
  await expect(sheet).toBeVisible();
  await expect(page.locator('[data-e2e="link-code"]')).toHaveText('WXYZ-1234');
  const open = page.getByRole('link', { name: 'Open vitrinka' });
  await expect(open).toHaveAttribute('href', `${stubUrl}/link?c=WXYZ-1234`);
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(page.getByAltText('Scan to link')).toHaveAttribute('src', `${stubUrl}/link/qr?c=WXYZ-1234`);
  await expect(sheet).toContainText('waiting for approval…');
  // The stub answers 202 once, then 200 — approval lands on the second claim.
  await expect(page.getByRole('button', { name: 'Recorder controls' })).toBeVisible({ timeout: 20_000 });
  const start = seen.find((s) => s.path === '/api/v1/cli/auth')!;
  expect(start.body).toEqual({ kind: 'recorder', label: expect.stringMatching(/ on .* · 127\.0\.0\.1:\d+$/) });
  expect(seen.filter((s) => s.path === '/api/v1/cli/auth/claim').length).toBeGreaterThanOrEqual(2);
  const create = seen.find((s) => s.method === 'POST' && s.path === '/api/v1/sessions')!;
  expect(create.headers.authorization).toBe('Bearer vkr_test');
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.recorder.link'))).toContain('vkr_test');
  // The menu names the linked account (GET /recorder/me with the minted token).
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.locator('[data-e2e="menu-account"]')).toContainText('lukas@henderson.tech');
  await expect(page.locator('[data-e2e="menu-account"]')).toContainText('ADF');
  // Unlink asks first: Cancel keeps the link…
  await page.getByRole('menuitem', { name: 'Unlink this device' }).click();
  const confirm = page.getByRole('group', { name: 'Unlink' });
  await expect(confirm).toContainText('Unlink this device?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.recorder.link'))).toContain('vkr_test');
  // …Unlink forgets it → back to the unlinked pill.
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Unlink this device' }).click();
  await confirm.getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByRole('button', { name: 'Link recorder' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.recorder.link'))).toBeNull();
});

const referenceImage = { name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64') };
async function openNote(page: Page) {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
}
async function pickImage(page: Page, files = [referenceImage]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach image', exact: true }).click();
  await (await chooser).setFiles(files);
}

test('picks an image-only note and delivers typed upload, attachment row and note seq reference', async ({ page }) => {
  seen.length = 0;
  await openNote(page);
  await pickImage(page);
  await expect(page.getByRole('button', { name: 'Remove reference.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => seen.some(s => s.path.includes('/shot?seq='))).toBe(true);
  await expect.poll(() => seen.filter(s => s.path.endsWith('/events')).flatMap(s => (s.body as { events: { kind: string }[] }).events).some(e => e.kind === 'attachment')).toBe(true);
  const rows = seen.filter(s => s.path.endsWith('/events')).flatMap(s => (s.body as { events: { kind: string; seq: number; blobKey?: string; payload: Record<string, unknown> }[] }).events);
  const attachment = rows.find(e => e.kind === 'attachment')!;
  const note = rows.find(e => e.kind === 'note' && Array.isArray(e.payload.attachments))!;
  const upload = seen.find(s => s.path.endsWith(`/shot?seq=${attachment.seq}`))!;
  expect(upload.headers['content-type']).toBe(attachment.payload.mime);
  expect(attachment).toMatchObject({ blobKey: `image-${attachment.seq}`, payload: { name: 'reference.png', w: 1, h: 1 } });
  expect(attachment.payload.bytes).toBeGreaterThan(0);
  expect(note.payload).toMatchObject({ text: '', attachments: [attachment.seq] });
  expect(attachment.seq).toBeLessThan(note.seq);
});

for (const source of ['paste', 'drop'] as const) {
  test(`attaches an image from ${source}`, async ({ page }) => {
    await openNote(page);
    const textarea = page.getByRole('textbox');
    await textarea.evaluate((el, input) => {
      const bytes = Uint8Array.from(atob(input.base64), c => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], 'reference.png', { type: 'image/png' }));
      el.dispatchEvent(input.source === 'paste'
        ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
        : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    }, { source, base64: referenceImage.buffer.toString('base64') });
    await expect(page.getByRole('button', { name: 'Remove reference.png' })).toBeVisible();
  });
}

test('queued image bytes survive an actual IndexedDB reload', async ({ page }) => {
  seen.length = 0;
  await page.route('**/shot?seq=*', route => route.abort());
  await openNote(page);
  await pickImage(page);
  await expect(page.getByRole('button', { name: 'Remove reference.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('vitrinka.recorder.blobs');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const r = db.transaction('blobs').objectStore('blobs').count();
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
    } finally { db.close(); }
  })).toBeGreaterThan(0);
  await page.reload();
  await page.unroute('**/shot?seq=*');
  await expect.poll(() => seen.filter(s => s.path.endsWith('/events')).flatMap(s => (s.body as { events: { kind: string }[] }).events).some(e => e.kind === 'attachment'), { timeout: 15_000 }).toBe(true);
});

test('hides the attachment picker when the policy omits the capability', async ({ page }) => {
  delete servers.policy.attachments;
  try {
    await openNote(page);
    await expect(page.getByRole('button', { name: 'Attach image' })).toHaveCount(0);
  } finally { servers.policy.attachments = true; }
});

test('an image still preparing when the sheet closes holds Send in the reopened sheet, then rides the note', async ({ page }) => {
  seen.length = 0;
  await openNote(page);
  // Every decode waits for the test: the image is still preparing when the sheet closes.
  await page.evaluate(() => {
    const decode = window.createImageBitmap.bind(window);
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    Object.assign(window, { releaseDecode: release });
    window.createImageBitmap = (async (image: ImageBitmapSource, options?: ImageBitmapOptions) => {
      await held;
      return decode(image, options);
    }) as typeof window.createImageBitmap;
  });
  await pickImage(page);
  const preparing = page.getByRole('listitem', { name: 'Preparing image' });
  await expect(preparing).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  // Gone for good (past its closing frames), so the reopened sheet is a new one.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await expect(preparing).toBeVisible();
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toHaveAttribute('aria-disabled', 'true');
  await page.evaluate(() => (window as unknown as { releaseDecode: () => void }).releaseDecode());
  await expect(page.getByRole('button', { name: 'Remove reference.png' })).toBeVisible();
  await expect(send).not.toHaveAttribute('aria-disabled', 'true');
  await send.click();
  await expect.poll(() => seen.filter(s => s.path.endsWith('/events')).flatMap(s => (s.body as { events: { kind: string; payload: { attachments?: number[] } }[] }).events)
    .some(e => e.kind === 'note' && e.payload.attachments?.length === 1)).toBe(true);
});

test('removes picked images and caps the sheet at four', async ({ page }) => {
  await openNote(page);
  await pickImage(page, Array.from({ length: 5 }, (_, i) => ({ ...referenceImage, name: `reference-${i}.png` })));
  await expect(page.getByRole('button', { name: /^Remove reference-/ })).toHaveCount(4);
  await page.getByRole('button', { name: 'Remove reference-0.png' }).click();
  await expect(page.getByRole('button', { name: /^Remove reference-/ })).toHaveCount(3);
});

/** Drag the element's centre to (x, y) with a real pointer, then let the spring settle. */
async function dragTo(page: Page, el: Locator, x: number, y: number): Promise<void> {
  // A face change tweens the handle into place: grab it once it holds still.
  await expect
    .poll(async () => {
      const a = await el.boundingBox();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const b = await el.boundingBox();
      return a !== null && b !== null && a.x === b.x && a.width === b.width;
    })
    .toBe(true);
  const b = (await el.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}

test('the capsule folds after the pointer leaves; a throw lands on its spot and survives a reload', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const handle = page.getByRole('button', { name: 'Recorder controls' });
  await page.mouse.move(600, 400);
  await handle.hover();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(600, 400);
  await expect(handle).toHaveAttribute('aria-expanded', 'false', { timeout: 5_000 });

  const dock = page.locator('.dock');
  await expect(dock).toHaveAttribute('data-col', 'r');
  await dragTo(page, handle, 120, 90);
  await expect(dock).toHaveAttribute('data-row', 't');
  await expect(dock).toHaveAttribute('data-col', 'l');
  await page.reload();
  await expect(page.locator('.dock')).toHaveAttribute('data-row', 't');
  await expect(page.locator('.dock')).toHaveAttribute('data-col', 'l');
});

test('pushed past an edge it tucks into a tab; the tab brings it back', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const vw = page.viewportSize()!.width;
  await dragTo(page, page.getByRole('button', { name: 'Recorder controls' }), vw - 4, 300);
  const tab = page.getByRole('button', { name: 'Show recorder' });
  await expect(tab).toBeVisible();
  await expect(page.locator('.dock')).toHaveAttribute('data-tuck', 'right');
  await tab.click();
  await expect(page.getByRole('button', { name: 'Recorder controls' })).toBeVisible();
  await expect(page.locator('.dock')).toHaveAttribute('data-col', 'r');
});

test('a throw over a page link lands: the link underneath never starts a native drag', async ({ page }) => {
  await page.goto(`${pageUrl}/?underlink=1`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const handle = page.getByRole('button', { name: 'Recorder controls' });
  const dock = page.locator('.dock');
  await expect(dock).toHaveAttribute('data-col', 'r');
  // The press point is over the page's link: once the dock moves off it, the
  // browser's drag-source hit test finds the link, not the HUD.
  const b = (await handle.boundingBox())!;
  const under = await page.evaluate(
    ([x, y]) => document.elementsFromPoint(x!, y!).some((el) => el.id === 'under-link'),
    [b.x + b.width / 2, b.y + b.height / 2],
  );
  expect(under).toBe(true);
  await dragTo(page, handle, 120, 90);
  await expect(dock).toHaveAttribute('data-row', 't');
  await expect(dock).toHaveAttribute('data-col', 'l');
});

test('moves without a drag: arrow keys on the handle and the Move to picker', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const handle = page.getByRole('button', { name: 'Recorder controls' });
  const dock = page.locator('.dock');
  await handle.focus();
  // Up from bottom right passes the middle row, Left from the top steps to the centre.
  await page.keyboard.press('ArrowUp');
  await expect(dock).toHaveAttribute('data-row', 'm');
  await page.keyboard.press('ArrowUp');
  await expect(dock).toHaveAttribute('data-row', 't');
  await page.keyboard.press('ArrowLeft');
  await expect(dock).toHaveAttribute('data-col', 'c');
  await handle.hover();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemradio', { name: 'Move to bottom left' }).click();
  await expect(dock).toHaveAttribute('data-row', 'b');
  await expect(dock).toHaveAttribute('data-col', 'l');
});

test('eight spots: the middle row stands the pill up, and its menu and tooltips open sideways into the viewport', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const handle = page.getByRole('button', { name: 'Recorder controls' });
  const pill = page.locator('[data-e2e="recorder-pill"]');
  const dock = page.locator('.dock');
  const view = page.viewportSize()!;
  const spots = [
    ['top left', 't', 'l'],
    ['top centre', 't', 'c'],
    ['top right', 't', 'r'],
    ['middle left', 'm', 'l'],
    ['middle right', 'm', 'r'],
    ['bottom left', 'b', 'l'],
    ['bottom centre', 'b', 'c'],
    ['bottom right', 'b', 'r'],
  ] as const;
  const menu = page.locator('[data-e2e="recorder-menu"]');
  await handle.hover();
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.locator('.screen button')).toHaveCount(8);
  // The picker's labels never select.
  expect(await menu.locator('#vt-move').evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
  for (const [name, row, col] of spots) {
    if (!(await menu.isVisible())) {
      await handle.hover();
      await page.locator('.seg.on .b-more').click();
    }
    await expect(menu).toHaveClass(/is-open/);
    await page.getByRole('menuitemradio', { name: `Move to ${name}` }).click();
    await expect(menu).toBeHidden();
    await expect(dock).toHaveAttribute('data-row', row);
    await expect(dock).toHaveAttribute('data-col', col);
    await expect(pill).toHaveAttribute('data-orient', row === 'm' ? 'v' : 'h');
  }

  // Middle left: a column hugging the left edge; the menu opens to its right, inside the viewport.
  await handle.hover();
  await page.locator('.seg.on .b-more').click();
  await page.getByRole('menuitemradio', { name: 'Move to middle left' }).click();
  await expect(pill).toHaveAttribute('data-orient', 'v');
  await expect.poll(async () => (await pill.evaluate((el) => el.getAnimations().length))).toBe(0);
  const pb = (await pill.boundingBox())!;
  expect(pb.height).toBeGreaterThan(pb.width);
  expect(pb.x).toBeLessThan(40);
  await handle.hover();
  await page.locator('.seg.on .b-more').click();
  await expect(menu).toHaveClass(/is-open/);
  const mb = (await menu.boundingBox())!;
  expect(mb.x).toBeGreaterThan(pb.x + pb.width);
  expect(mb.y).toBeGreaterThanOrEqual(0);
  expect(mb.y + mb.height).toBeLessThanOrEqual(view.height);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Its tooltip opens to the right of the hovered tool, fully inside the viewport.
  await handle.hover();
  await page.getByRole('button', { name: 'Annotate' }).hover();
  const tip = page.locator('[data-e2e="tooltip"]');
  await expect(tip).toHaveAttribute('data-show', 'true');
  await expect(tip).toContainText('Annotate');
  const tb = (await tip.boundingBox())!;
  const ab = (await page.getByRole('button', { name: 'Annotate' }).boundingBox())!;
  expect(tb.x).toBeGreaterThan(ab.x + ab.width);
  expect(tb.x + tb.width).toBeLessThanOrEqual(view.width);
});

test('a tooltip near a viewport edge flips and shifts inside it', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const handle = page.getByRole('button', { name: 'Recorder controls' });
  const view = page.viewportSize()!;
  // Top right: the tray grows left from the edge, tooltips open below and stay on screen.
  await handle.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.dock')).toHaveAttribute('data-row', 't');
  await handle.hover();
  const more = page.locator('.seg.on .b-more');
  await more.hover();
  const tip = page.locator('[data-e2e="tooltip"]');
  await expect(tip).toHaveAttribute('data-show', 'true');
  await expect(tip).toHaveAttribute('data-side', 'bottom');
  const tb = (await tip.boundingBox())!;
  expect(tb.x).toBeGreaterThanOrEqual(0);
  expect(tb.x + tb.width).toBeLessThanOrEqual(view.width);
  expect(tb.y).toBeGreaterThan(0);
});

test('reduced motion stills the recording ripple', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const dot = page.locator('[data-e2e="recorder-pill"] .dot');
  await expect(dot).toBeVisible();
  expect(await dot.evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe('none');
});

test('a click pick never presses the page: the button under it stays untouched', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'Annotate' }).click();
  await expect(page.locator('[data-e2e="annotate-dim"]')).toBeVisible();
  await page.locator('#buy').click();
  await expect(page.getByText('Annotate element')).toBeVisible();
  await expect(page.locator('#buy')).toHaveText('Buy now (0)');
});

test('stop lives in the pill: confirm inline, then saving, then saved with the board link — and it lands in Recents', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const handle = page.getByRole('button', { name: 'Recorder controls' });
  const pill = page.locator('[data-e2e="recorder-pill"]');
  const confirm = page.getByRole('group', { name: 'Stop and save' });
  // Esc and Keep recording both cancel; focus starts on the safe choice and returns to ■.
  await handle.hover();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(confirm).toContainText('Stop & save?');
  await expect(confirm.getByRole('button', { name: 'Keep recording' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(pill).toHaveAttribute('data-face', 'rec');
  await handle.hover();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await confirm.getByRole('button', { name: 'Keep recording' }).click();
  await expect(confirm).toBeHidden();
  expect(seen.some((s) => s.method === 'PATCH' && (s.body as { status?: string })?.status === 'done')).toBe(false);

  // Stop: the PATCH done is held, so "Saving…" with its progress stays on screen.
  const release = servers.holdStop();
  await handle.hover();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await confirm.getByRole('button', { name: 'Stop', exact: true }).click();
  const saving = page.locator('[data-e2e="saving"]');
  await expect(saving).toBeVisible();
  await expect(saving).toContainText('Saving…');
  await expect(saving.getByRole('progressbar')).toBeVisible();
  release();
  const saved = page.locator('[data-e2e="saved"]');
  await expect(saved).toBeVisible({ timeout: 30_000 });
  const open = saved.getByRole('link', { name: /Open board/ });
  await expect(open).toHaveAttribute('href', `${stubUrl}/acme/b/fixture-session-1`);
  await expect(open).toHaveAttribute('target', '_blank');
  // The ended recording leaves no trace on the pill: it no longer reads as recording, and its folded clock stands still.
  await expect(pill).toHaveAttribute('data-state', 'paused');
  const clock = pill.locator('.clock .time');
  const stoppedAt = (await clock.textContent()) ?? '';
  // It stays until dismissed.
  await page.mouse.move(600, 400);
  await page.waitForTimeout(3000);
  await expect(saved).toBeVisible();
  await expect(clock).toHaveText(stoppedAt);

  await saved.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();

  // Recents: the device's last recordings, linked to their boards.
  await page.getByRole('button', { name: 'Start recording' }).hover();
  await page.locator('.seg.on .b-more').click();
  const recent = page.locator('[data-e2e="recent"]').first();
  await expect(recent).toContainText('e2e journey');
  await expect(recent).toContainText('saved');
  await expect(recent).toHaveAttribute('href', `${stubUrl}/acme/b/fixture-session-1`);
  await expect(page.getByRole('menuitem', { name: 'Go to vitrinka' })).toHaveAttribute('href', stubUrl);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('vitrinka.recorder.recents'))) ?? '[]')).toHaveLength(1);
});

for (const webLocks of [true, false]) {
  test(`two tabs keep every event under a unique seq (${webLocks ? 'Web Locks' : 'IndexedDB fallback'})`, async ({ page, context }) => {
    seen.length = 0;
    await context.addInitScript((useLocks) => {
      if (!useLocks) Object.defineProperty(navigator, 'locks', { value: undefined });
      // Delay seq-only notifications: the narrow real-world window where a
      // tab has not heard its sibling's allocation yet, made deterministic.
      window.addEventListener('storage', (event) => {
        if (event.key !== 'vitrinka.recorder.rec' || !event.oldValue || !event.newValue) return;
        const { seq: oldSeq, ...oldRecord } = JSON.parse(event.oldValue);
        const { seq: newSeq, ...newRecord } = JSON.parse(event.newValue);
        if (oldSeq !== newSeq && JSON.stringify(oldRecord) === JSON.stringify(newRecord)) event.stopImmediatePropagation();
      }, true);
    }, webLocks);
    await page.goto(`${pageUrl}/`);
    await page.getByRole('button', { name: 'Start recording' }).click();
    const other = await context.newPage();
    await other.goto(`${pageUrl}/`);
    await expect(other.getByRole('button', { name: 'Recorder controls' })).toBeVisible();

    await Promise.all([page, other].map((tab, lane) => tab.evaluate((lane) => {
      const recorder = (window as Window & { __vitrinkaRecorder?: RecorderControl }).__vitrinkaRecorder!;
      for (let i = 0; i < 20; i++) recorder.note(`concurrent-${lane}-${i}`);
    }, lane)));
    const events = () => seen.filter((s) => s.path.endsWith('/events'))
      .flatMap((s) => (s.body as { events: { seq: number; kind: string; tabId: string; payload?: { text?: string } }[] }).events);
    await expect.poll(() => new Set(events().filter((e) => e.payload?.text?.startsWith('concurrent-')).map((e) => e.payload!.text)).size).toBe(40);
    // Like the server: first row for a seq wins. A collision used to silently
    // lose one note; legitimate retries of the same row remain harmless.
    const accepted = new Map<number, ReturnType<typeof events>[number]>();
    for (const event of events()) if (!accepted.has(event.seq)) accepted.set(event.seq, event);
    expect([...accepted.values()].filter((e) => e.payload?.text?.startsWith('concurrent-'))).toHaveLength(40);
    await expect.poll(() => new Set(events().filter((e) => e.kind === 'rrweb').map((e) => e.tabId)).size).toBe(2);
    const bySeq = new Map<number, string>();
    for (const event of events()) {
      const row = JSON.stringify(event);
      if (bySeq.has(event.seq)) expect(row).toBe(bySeq.get(event.seq));
      bySeq.set(event.seq, row);
    }
    await other.close();
  });
}

for (const stopFromSecond of [false, true]) {
test(`Stop from the ${stopFromSecond ? 'second' : 'first'} tab saves both tails before closing the session`, async ({ page, context }) => {
  seen.length = 0;
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const other = await context.newPage();
  await other.goto(`${pageUrl}/`);
  await other.getByRole('button', { name: 'Recorder controls' }).hover();
  await other.getByRole('button', { name: 'Note', exact: true }).click();
  const input = other.getByPlaceholder("what's wrong / what to refine…");
  await input.fill('the other tab\'s final note');
  await input.press('Enter');
  const markers = ['final DOM mutation in A', 'final DOM mutation in B'];
  await Promise.all([page, other].map((tab, lane) => tab.evaluate((marker) => {
    const text = document.createElement('span');
    text.textContent = marker;
    document.body.append(text);
  }, markers[lane]!)));
  const stoppingTab = stopFromSecond ? other : page;
  await stoppingTab.getByRole('button', { name: 'Recorder controls' }).hover();
  await stoppingTab.getByRole('button', { name: 'Stop', exact: true }).click();
  await stoppingTab.getByRole('group', { name: 'Stop and save' }).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(stoppingTab.locator('[data-e2e="saved"]')).toBeVisible();
  const done = seen.findIndex((call) => call.method === 'PATCH' && (call.body as { status?: string })?.status === 'done');
  const events = seen.slice(0, done).filter((call) => call.path.endsWith('/events'))
    .flatMap((call) => (call.body as { events: { kind: string; tabId: string; payload?: { text?: string } }[] }).events);
  expect(events.some((event) => event.payload?.text === 'the other tab\'s final note')).toBe(true);
  expect(new Set(events.filter((event) => event.kind === 'rrweb').map((event) => event.tabId)).size).toBe(2);
  for (const marker of markers) {
    const chunk = seen.slice(0, done).find((call) => call.path.includes('/chunk?seq=') && JSON.stringify(call.body).includes(marker));
    expect(chunk, `final mutation ${marker} uploaded before done`).toBeDefined();
    const seq = Number(new URL(chunk!.path, pageUrl).searchParams.get('seq'));
    expect(events.some((event) => event.kind === 'rrweb' && (event as { seq?: number }).seq === seq)).toBe(true);
  }
  await other.close();
});
}

test('a departing tab leaves a recoverable note and DOM tail while the seq lock is held', async ({ page, context }) => {
  seen.length = 0;
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const other = await context.newPage();
  await other.goto(`${pageUrl}/`);
  await page.evaluate(() => {
    const state = window as Window & { __held?: boolean; __release?: () => void };
    void navigator.locks.request('vitrinka.recorder.seq', () => new Promise<void>((resolve) => { state.__held = true; state.__release = resolve; }));
  });
  await expect.poll(() => page.evaluate(() => (window as Window & { __held?: boolean }).__held)).toBe(true);
  await other.evaluate(() => {
    const recorder = (window as Window & { __vitrinkaRecorder?: RecorderControl }).__vitrinkaRecorder!;
    recorder.note('departed tab final note');
    const tail = document.createElement('span');
    tail.textContent = 'departed tab final DOM';
    document.body.append(tail);
  });
  await other.goto('about:blank');
  await page.evaluate(() => (window as Window & { __release?: () => void }).__release!());
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('group', { name: 'Stop and save' }).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('[data-e2e="saved"]')).toBeVisible();
  const done = seen.findIndex((call) => call.method === 'PATCH' && (call.body as { status?: string })?.status === 'done');
  expect(seen.slice(0, done).some((call) => call.path.endsWith('/events') && JSON.stringify(call.body).includes('departed tab final note'))).toBe(true);
  expect(seen.slice(0, done).some((call) => call.path.includes('/chunk?seq=') && JSON.stringify(call.body).includes('departed tab final DOM'))).toBe(true);
  await other.close();
});

test('a second tab follows the shared recording: it joins on load and goes idle when the first tab stops it', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const other = await page.context().newPage();
  await other.goto(`${pageUrl}/`);
  const otherPill = other.locator('[data-e2e="recorder-pill"]');
  await expect(otherPill).toHaveAttribute('data-face', 'rec');

  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('group', { name: 'Stop and save' }).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('[data-e2e="saved"]')).toBeVisible({ timeout: 30_000 });
  await expect(otherPill).toHaveAttribute('data-face', 'idle');
  await expect(other.getByRole('button', { name: 'Start recording' })).toBeVisible();

  // Nothing the second tab does afterwards is sent into the stopped session,
  // and it never writes the stopped session back for a reload to restore.
  const posted = seen.filter((s) => s.path.endsWith('/events')).length;
  await other.locator('#buy').click();
  await other.waitForTimeout(3000);
  expect(seen.filter((s) => s.path.endsWith('/events'))).toHaveLength(posted);
  expect(await other.evaluate(() => localStorage.getItem('vitrinka.recorder.rec'))).toBeNull();
  await other.close();
});

test('a second tab leaves the recording within 2 s of Stop in the first, while the save is still out', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const other = await page.context().newPage();
  await other.goto(`${pageUrl}/`);
  const otherPill = other.locator('[data-e2e="recorder-pill"]');
  await expect(otherPill).toHaveAttribute('data-state', 'rec');
  await stampLeavingRec(other);
  await page.bringToFront();
  await stampClicks(page);

  // The save is held, as a slow drain or a busy server holds it live: the
  // second tab must follow the Stop, not the end of the save.
  const release = servers.holdStop();
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('group', { name: 'Stop and save' }).getByRole('button', { name: 'Stop', exact: true }).click();
  const stoppedAt = await page.evaluate(() => (window as Clocked).clickedAt ?? 0);
  await expect(page.locator('[data-e2e="saving"]')).toBeVisible();
  await other.bringToFront();
  await expect(otherPill).not.toHaveAttribute('data-state', 'rec', { timeout: 2_000 });
  const leftAt = await other.evaluate(() => (window as Clocked).leftRecAt ?? 0);
  test.info().annotations.push({ type: 'Stop → second tab leaves rec', description: `${leftAt - stoppedAt} ms` });
  expect(leftAt - stoppedAt).toBeLessThan(2_000);
  // Its clock stands still while the first tab saves.
  const clock = otherPill.locator('.clock .time');
  const frozen = (await clock.textContent()) ?? '';
  await other.waitForTimeout(1500);
  await expect(clock).toHaveText(frozen);

  release();
  await expect(page.locator('[data-e2e="saved"]')).toBeVisible({ timeout: 30_000 });
  await expect(otherPill).toHaveAttribute('data-face', 'idle', { timeout: 2_000 });
  await other.close();
});

test('the ⋯ menu opens from the keyboard with focus on its first item; ↓ walks it, Esc returns to ⋯', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: 'Recorder controls' }).focus();
  const more = page.locator('.seg.on .b-more');
  await more.focus();
  await page.keyboard.press('Enter');
  const items = page.locator('[data-e2e="recorder-menu"] [role^="menuitem"]:not([aria-disabled="true"])');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  // ↓ on ⋯ opens it too.
  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toBeFocused();
});

test('a note or annotation says Saved on the pill', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'Note' }).click();
  const ta = page.getByPlaceholder("what's wrong / what to refine…");
  await ta.fill('button too small');
  await ta.press('Enter');
  const flash = page.locator('[data-e2e="saved-flash"]');
  await expect(flash).toBeVisible();
  await expect(flash).toBeHidden({ timeout: 5_000 });
});

test('annotate: a drag over text draws a region and never selects the page', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  // The page counts every press and move it hears.
  await page.evaluate(() => {
    const w = window as unknown as { heard: number };
    w.heard = 0;
    for (const t of ['pointerdown', 'pointermove', 'mousedown', 'mousemove', 'mouseover', 'selectstart'])
      document.addEventListener(t, () => w.heard++);
  });
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'Annotate' }).click();
  await expect(page.locator('[data-e2e="annotate-dim"]')).toBeVisible();
  await page.evaluate(() => ((window as unknown as { heard: number }).heard = 0));
  const h1 = (await page.locator('h1').boundingBox())!;
  const target = (await page.locator('#target').boundingBox())!;
  await page.mouse.move(h1.x - 10, h1.y + h1.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 200, target.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText('Annotate region')).toBeVisible();
  expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
  expect(await page.evaluate(() => (window as unknown as { heard: number }).heard)).toBe(0);
});

test('size and details: the menu scales the HUD, shows technical details, and both survive a reload', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const handle = page.getByRole('button', { name: 'Recorder controls' });
  const pill = page.locator('[data-e2e="recorder-pill"]');
  const md = (await pill.boundingBox())!.height;
  await handle.hover();
  await page.getByRole('button', { name: 'More' }).click();
  // A key build: the account line names the key, prefs stay on the device (PATCH 409).
  await expect(page.locator('[data-e2e="menu-account"]')).toContainText('Recorder key · e2e key · project fixture');
  await page.getByRole('menuitemradio', { name: 'Size Large' }).click();
  await expect(page.locator('.hud').first()).toHaveAttribute('data-size', 'lg');
  await page.getByRole('menuitemcheckbox', { name: 'Technical details' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await pill.boundingBox())!.height).toBeGreaterThan(md);
  const detail = page.locator('[data-e2e="recorder-detail"]');
  await expect(detail).toContainText('sess-e2e');
  // The package version, not a literal: a release that bumps package.json
  // but forgets RECORDER_VERSION fails here.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  await expect(detail).toContainText(`web/${pkg.version}`);
  await expect(detail).toContainText('events');
  await page.reload();
  await expect(page.locator('.hud').first()).toHaveAttribute('data-size', 'lg');
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('vitrinka.recorder.prefs'))) ?? '{}')).toEqual({
    size: 'lg',
    verbose: true,
    sheetW: 0,
    sheetH: 0,
  });
  await expect(page.locator('[data-e2e="recorder-detail"]')).toContainText('sess-e2e');
});

test('a linked device keeps its size on the server', async ({ page }) => {
  servers.me.prefs = { size: 'sm', verbose: false };
  await page.goto(`${pageUrl}/?nokey=1`);
  await page.evaluate(() =>
    localStorage.setItem('vitrinka.recorder.link', JSON.stringify({ token: 'vkr_test', workspace: 'acme', label: 'e2e', expires_in: 60 })),
  );
  await page.reload();
  // The server's prefs win on load…
  await expect(page.locator('.hud').first()).toHaveAttribute('data-size', 'sm');
  await page.getByRole('button', { name: 'Start recording' }).hover();
  await page.locator('.seg.on .b-more').click();
  await page.getByRole('menuitemradio', { name: 'Size Large' }).click();
  // …and a change is PATCHed back.
  await expect.poll(() => servers.me.prefs.size).toBe('lg');
  const patch = seen.filter((s) => s.method === 'PATCH' && s.path === '/api/v1/recorder/me').at(-1)!;
  expect(patch.body).toEqual({ prefs: { size: 'lg' } });
  expect(patch.headers.authorization).toBe('Bearer vkr_test');
});

test('the HUD never enters the recording: its surfaces are blocked, its clicks and calls are not captured', async ({ page }) => {
  seen.length = 0;
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const handle = page.getByRole('button', { name: 'Recorder controls' });
  await handle.hover();
  await page.getByRole('button', { name: 'Pause' }).hover();
  await page.getByRole('button', { name: 'More' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Note' }).click();
  await page.keyboard.press('Escape');
  // Every HUD surface lives under the one rrweb-blocked host.
  const unblocked = await page.evaluate(() => {
    const host = document.querySelector('[data-vitrinka-hud]');
    return {
      blocked: host?.hasAttribute('data-vitrinka-recorder') ?? false,
      inShadow: ['.pill', '.tip', '.dock'].every((s) => host?.shadowRoot?.querySelector(s) != null),
      leaked: document.querySelectorAll('.pill, .tip, .menu, .detail, .pop, .dim').length,
      htmlStyle: document.documentElement.getAttribute('style'),
    };
  });
  expect(unblocked.blocked).toBe(true);
  expect(unblocked.inShadow).toBe(true);
  expect(unblocked.leaked).toBe(0);
  expect(unblocked.htmlStyle).toBeNull();
  await handle.hover();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('group', { name: 'Stop and save' }).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('[data-e2e="saved"]')).toBeVisible({ timeout: 30_000 });
  const events = seen
    .filter((s) => s.path.endsWith('/events'))
    .flatMap((s) => (s.body as { events: { kind: string; payload?: Record<string, unknown> }[] }).events);
  expect(events.filter((e) => e.kind === 'click')).toEqual([]);
  expect(events.filter((e) => e.kind === 'net')).toEqual([]);
  expect(events.filter((e) => e.kind === 'console')).toEqual([]);
});

test('report a bug from the idle pill: the last minute files as its own session, closed by a task annotation', async ({ page }) => {
  seen.length = 0;
  await page.goto(`${pageUrl}/`);
  const openMenu = async () => {
    await page.getByRole('button', { name: 'Start recording' }).hover();
    await page.locator('.seg.on .b-more').click();
  };
  // The row shows once the flight recorder holds the page (its policy read answered).
  await openMenu();
  await expect(page.getByRole('menuitem', { name: 'Report a bug' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Idle, the pill keeps the last minute in memory: nothing reaches a session door.
  await page.locator('#buy').click();
  await page.locator('#go').click();
  await expect(page).toHaveURL(/\/orders\/42$/);
  expect(seen.some((s) => s.path.startsWith('/api/v1/sessions'))).toBe(false);

  await openMenu();
  await page.getByRole('menuitem', { name: 'Report a bug' }).click();
  const ta = page.getByPlaceholder('What went wrong?');
  await expect(ta).toBeFocused();
  await ta.fill('Order total shows NaN');
  // Mark on screen: annotate mode picks a region, then the sheet is back with the draft.
  await page.getByRole('button', { name: 'Mark on screen' }).click();
  await expect(page.locator('[data-e2e="annotate-dim"]')).toBeVisible();
  const box = (await page.locator('#target').boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 90, { steps: 5 });
  await page.mouse.up();
  await expect(ta).toHaveValue('Order total shows NaN');
  await expect(page.getByRole('button', { name: 'Mark on screen' })).toHaveAttribute('aria-pressed', 'true');
  await ta.press('Enter');
  const saved = page.locator('[data-e2e="saved"]');
  await expect(saved).toContainText('Sent', { timeout: 30_000 });
  await expect(saved.getByRole('link', { name: /Open board/ })).toHaveAttribute('href', `${stubUrl}/acme/b/fixture-session-1`);

  const create = seen.find((s) => s.method === 'POST' && s.path === '/api/v1/sessions')!;
  expect(create.body).toMatchObject({ title: 'Bug report: Order total shows NaN', meta: { kind: 'report', platform: 'web', devicePixelRatio: 1 } });
  type Ev = { seq: number; ts: string; kind: string; payload?: Record<string, unknown>; blobKey?: string };
  const posts = seen.filter((s) => s.path.endsWith('/events'));
  const events = posts.flatMap((s) => (s.body as { events: Ev[] }).events);
  const click = events.find((e) => e.kind === 'click' && e.payload?.selector === '#buy')!;
  expect(click.payload).toMatchObject({ text: 'Buy now (0)', route: '/' });
  expect(events.some((e) => e.kind === 'nav' && e.payload?.route === '/orders/42')).toBe(true);
  const rr = events.find((e) => e.kind === 'rrweb')!;
  expect(rr.blobKey).toMatch(/^blob-\d+$/);
  const note = events.find((e) => e.kind === 'note')!;
  expect(note.payload).toMatchObject({ text: 'Order total shows NaN', selector: '', annotate: true, task: true, route: '/orders/42' });
  expect((note.payload!.rect as { w: number }).w).toBeGreaterThan(50);
  // The clip keeps its original times; the annotation is stamped at Send.
  expect(Date.parse(click.ts)).toBeLessThan(Date.parse(note.ts));
  // create → lane events → chunk → annotation → done.
  const at = (pred: (s: (typeof seen)[number]) => boolean) => seen.findIndex(pred);
  const order = [
    seen.indexOf(create),
    at((s) => s.path.endsWith('/events') && (s.body as { events: Ev[] }).events.some((e) => e.kind === 'click')),
    at((s) => s.path.includes('/chunk?seq=')),
    at((s) => s.path.endsWith('/events') && (s.body as { events: Ev[] }).events.some((e) => e.kind === 'note')),
    at((s) => s.method === 'PATCH' && (s.body as { status?: string })?.status === 'done'),
  ];
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test('a report sent before its board is built says Sent · in Recents, then Open board opens it once it is', async ({ page }) => {
  // The live server projects a board after the stop (stills render first), so Send learns no link.
  const ready = servers.boardLater();
  await page.goto(`${pageUrl}/`);
  await page.locator('#buy').click();
  await page.getByRole('button', { name: 'Start recording' }).hover();
  await page.locator('.seg.on .b-more').click();
  await page.getByRole('menuitem', { name: 'Report a bug' }).click();
  const ta = page.getByPlaceholder('What went wrong?');
  await ta.fill('Buy does nothing');
  await ta.press('Enter');
  const saved = page.locator('[data-e2e="saved"]');
  await expect(saved).toContainText('Sent', { timeout: 30_000 });
  // No link to a board that does not exist yet.
  await expect(saved).toContainText('in Recents');
  await expect(saved.getByRole('link')).toHaveCount(0);

  ready();
  const readyAt = Date.now();
  const open = saved.getByRole('link', { name: /Open board/ });
  await expect(open).toBeVisible({ timeout: 10_000 });
  test.info().annotations.push({ type: 'board ready → Open board', description: `${Date.now() - readyAt} ms` });
  const popup = page.waitForEvent('popup');
  await open.click();
  await expect(await popup).toHaveURL(`${stubUrl}/acme/b/fixture-session-1`);
});

type Clocked = Window & { clickedAt?: number; leftRecAt?: number };

/** Stamp, on the page's clock, the moment each click reaches the page (`clickedAt`). */
async function stampClicks(page: Page): Promise<void> {
  await page.evaluate(() => addEventListener('click', () => void ((window as Clocked).clickedAt = Date.now()), true));
}

/** Stamp, on the page's clock, the moment the pill first stops reading `rec` (`leftRecAt`). */
async function stampLeavingRec(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector('[data-vitrinka-hud]')!.shadowRoot!;
    const w = window as Clocked;
    const check = () => {
      const state = root.querySelector('[data-e2e="recorder-pill"]')?.getAttribute('data-state');
      if (w.leftRecAt === undefined && state !== 'rec') w.leftRecAt = Date.now();
    };
    new MutationObserver(check).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] });
  });
}

/** Start recording and enter annotate mode by finger, the way a phone does it. */
async function annotateByTap(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start recording' }).tap();
  await page.getByRole('button', { name: 'Recorder controls' }).tap();
  await page.getByRole('button', { name: 'Annotate' }).tap();
  await expect(page.locator('[data-e2e="annotate-dim"]')).toBeVisible();
}

/** One finger from `a` to `b` through CDP touch input (Playwright's touchscreen only taps), a frame per step. */
async function touchDrag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (t: number) => [{ id: 1, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= 12; i++) {
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / 12) });
  }
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('annotate: a finger drag draws a region instead of scrolling the page', async ({ page }) => {
    await page.goto(`${pageUrl}/`);
    await page.evaluate(() => {
      document.body.style.minHeight = '3000px';
    });
    await annotateByTap(page);
    const box = (await page.locator('#target').boundingBox())!;
    // Finger up the screen: on the page that is a scroll down.
    await touchDrag(page, { x: box.x + 40, y: box.y + 170 }, { x: box.x + 220, y: box.y + 30 });
    await expect(page.getByText('Annotate region')).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });

  test('annotate: tapping a button picks it without pressing it', async ({ page }) => {
    await page.goto(`${pageUrl}/`);
    await annotateByTap(page);
    await page.locator('#buy').tap();
    await expect(page.getByText('Annotate element')).toBeVisible();
    await expect(page.locator('#buy')).toHaveText('Buy now (0)');
  });

  test('the link sheet is a bottom sheet without the QR', async ({ page }) => {
    await page.goto(`${pageUrl}/?nokey=1`);
    await page.getByRole('button', { name: 'Link recorder' }).tap();
    const sheet = page.locator('[data-e2e="link-sheet"]');
    await expect(page.locator('[data-e2e="link-code"]')).toHaveText('WXYZ-1234');
    await expect(page.getByRole('link', { name: 'Open vitrinka' })).toBeVisible();
    await expect(page.getByAltText('Scan to link')).toHaveCount(0);
    const b = (await sheet.boundingBox())!;
    expect(b.width).toBeGreaterThan(360);
    expect(844 - (b.y + b.height)).toBeLessThan(24);
  });

  test('the note grip drags the cap alone: the bottom sheet keeps its width', async ({ page }) => {
    await page.goto(`${pageUrl}/`);
    await page.getByRole('button', { name: 'Start recording' }).tap();
    await page.getByRole('button', { name: 'Recorder controls' }).tap();
    await page.getByRole('button', { name: 'Note', exact: true }).tap();
    const text = page.getByPlaceholder("what's wrong / what to refine…");
    await expect.poll(() => text.evaluate((el) => el.closest('.pop')!.classList.contains('is-open'))).toBe(true);
    await text.evaluate(async (el) => {
      await Promise.all(el.closest('.pop')!.getAnimations().map((a) => a.finished));
    });
    await text.fill(Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n'));
    const before = (await text.boundingBox())!;
    const g = (await page.getByRole('button', { name: 'Resize note', exact: true }).boundingBox())!;
    const from = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    // Up the screen grows the cap; the sideways part of the drag changes nothing.
    await touchDrag(page, from, { x: from.x + 60, y: from.y - 80 });
    const after = (await text.boundingBox())!;
    expect(after.height).toBeCloseTo(before.height + 80, 0);
    expect(after.width).toBeCloseTo(before.width, 0);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('vitrinka.recorder.prefs')))!)).toMatchObject({
      sheetW: 0,
      sheetH: Math.round(before.height + 80),
    });
  });
});
