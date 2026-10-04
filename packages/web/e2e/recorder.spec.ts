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
  // It stays until dismissed.
  await page.mouse.move(600, 400);
  await page.waitForTimeout(3000);
  await expect(saved).toBeVisible();

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
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('vitrinka.recorder.prefs'))) ?? '{}')).toEqual({ size: 'lg', verbose: true });
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
});
