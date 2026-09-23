/**
 * The recorder end to end in headless Chromium: a node:http page server
 * serves the fixture (bundled with `bun build --format=iife` into a temp
 * dir), a second node:http "vitrinka" stub records every call to the session
 * doors. The test starts a recording from the pill, clicks, pushes a route,
 * sends a note, drags a region annotation and stops — then asserts what the
 * stub saw.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Locator, type Page, test } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

interface Seen {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

let tmp: string;
let bundle: string;
let pageServer: Server;
let stubServer: Server;
let pageUrl: string;
let stubUrl: string;
const seen: Seen[] = [];
let claims = 0;

function listen(server: Server): Promise<string> {
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      res(typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '');
    });
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let s = '';
    req.on('data', (c: Buffer) => {
      s += c.toString();
    });
    req.on('end', () => res(s));
  });
}

function cors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, OPTIONS');
}

test.beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'vt-web-e2e-'));
  const out = join(tmp, 'app.js');
  execFileSync(
    'bun',
    ['build', join(here, 'fixture/app.tsx'), '--format=iife', '--outfile', out, '--define', 'process.env.NODE_ENV="development"'],
    { stdio: 'inherit', cwd: join(here, '..') },
  );
  bundle = readFileSync(out, 'utf8');

  stubServer = createServer(async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const raw = await readBody(req);
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = String(v);
    const path = req.url ?? '';
    seen.push({ method: req.method ?? '', path, headers, body });
    res.setHeader('content-type', 'application/json');
    if (path === '/api/v1/cli/auth') {
      claims = 0;
      res.writeHead(201);
      return void res.end(JSON.stringify({ device_code: 'dc-e2e', user_code: 'WXYZ-1234', verify_path: '/link?c=WXYZ-1234', qr_path: '/link/qr?c=WXYZ-1234', interval: 2, expires_in: 600 }));
    }
    if (path === '/api/v1/cli/auth/claim') {
      if (++claims < 2) return void res.writeHead(202).end();
      return void res.end(JSON.stringify({ token: 'vkr_test', kind: 'recorder', workspace: 'acme', label: 'e2e', expires_in: 2592000 }));
    }
    if (path === '/api/v1/recorder/policy') return void res.end(JSON.stringify({ policy: null }));
    if (path === '/api/v1/sessions' && req.method === 'POST') {
      res.writeHead(201);
      return void res.end(
        JSON.stringify({
          id: 'sess-e2e',
          project: 'fixture',
          environment: 'development',
          title: (body as { title?: string }).title ?? '',
          workspace: 'acme',
          boardSlug: 'fixture-session-1',
          boardUrl: `${stubUrl}/acme/b/fixture-session-1`,
        }),
      );
    }
    if (path.includes('/chunk?seq=')) return void res.end(JSON.stringify({ blobKey: `blob-${path.split('seq=')[1]}` }));
    if (path.endsWith('/events') || path.endsWith('/tags')) return void res.end('{}');
    if (req.method === 'PATCH') return void res.end(JSON.stringify({ board: { url: `${stubUrl}/acme/b/fixture-session-1` } }));
    if (req.method === 'GET') return void res.end(JSON.stringify({ maxSeq: 0, status: 'recording' }));
    res.writeHead(404).end();
  });
  stubUrl = await listen(stubServer);

  pageServer = createServer((req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript');
      return void res.end(bundle);
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixture</title></head><body>` +
        `<div id="root"></div>` +
        `<script>window.__VT_CFG=${JSON.stringify({ url: stubUrl, key: (req.url ?? '').includes('nokey') ? '' : 'vkr_e2e' })}</script>` +
        `<script src="/app.js"></script></body></html>`,
    );
  });
  pageUrl = await listen(pageServer);
});

test.afterAll(async () => {
  await new Promise((r) => pageServer?.close(r));
  await new Promise((r) => stubServer?.close(r));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('records a journey: create · click · nav · note · region annotation · rrweb · stop', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const pill = page.locator('[data-e2e="recorder-pill"]');
  await expect(pill).toBeVisible();
  // At rest the capsule is the dot and the clock; the tools unfold on intent.
  const handle = page.getByRole('button', { name: 'Recorder controls' });
  await expect(pill).toHaveText(/^\d\d:\d\d/);
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

  // Stop from the menu; the drain must reach a PATCH done.
  await handle.hover();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Stop recording' }).click();
  await expect.poll(() => seen.some((s) => s.method === 'PATCH' && (s.body as { status?: string })?.status === 'done'), {
    timeout: 30_000,
  }).toBe(true);
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
  await expect(page.locator('[data-e2e="recorder-pill"]')).toBeVisible({ timeout: 20_000 });
  const start = seen.find((s) => s.path === '/api/v1/cli/auth')!;
  expect(start.body).toEqual({ kind: 'recorder', label: expect.stringMatching(/ on .* · 127\.0\.0\.1:\d+$/) });
  expect(seen.filter((s) => s.path === '/api/v1/cli/auth/claim').length).toBeGreaterThanOrEqual(2);
  const create = seen.find((s) => s.method === 'POST' && s.path === '/api/v1/sessions')!;
  expect(create.headers.authorization).toBe('Bearer vkr_test');
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.recorder.link'))).toContain('vkr_test');
  // Unlink from the menu → back to the unlinked pill.
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Unlink' }).click();
  await expect(page.getByRole('button', { name: 'Link recorder' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.recorder.link'))).toBeNull();
});

/** Drag the element's centre to (x, y) with a real pointer, then let the spring settle. */
async function dragTo(page: Page, el: Locator, x: number, y: number): Promise<void> {
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

test('moves without a drag: arrow keys on the handle and the Move to picker', async ({ page }) => {
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const handle = page.getByRole('button', { name: 'Recorder controls' });
  const dock = page.locator('.dock');
  await handle.focus();
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

test('reduced motion stills the recording ripple', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${pageUrl}/`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const dot = page.locator('[data-e2e="recorder-pill"] .dot');
  await expect(dot).toBeVisible();
  expect(await dot.evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe('none');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

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
