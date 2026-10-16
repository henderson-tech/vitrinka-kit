/**
 * Report a problem end to end (QA Studio S1, S2, S4): `build/report-widget.mjs`
 * (built here) served as vitrinka serves it — `/vendor/report-widget-1.mjs`,
 * with its rrweb recorder at `/vendor/rrweb-record-1.min.js` — on a page with
 * a stub of the report wire that records every call.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const REPORT_URL = 'https://portal.vitrinka.test/voke/reports/rep-1?k=7';

interface Seen {
  method: string;
  path: string;
  auth: string;
  body: string;
}

let server: Server;
let base = '';
let tmp = '';
const seen: Seen[] = [];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c: Buffer) => {
      s += c.toString();
    });
    req.on('end', () => resolve(s));
  });
}

const TABLE =
  '<h1>Settlement · September 2026</h1><table><thead><tr><th>Month</th><th>Energy shared</th><th>Your credit</th></tr></thead><tbody>' +
  ['September 2026', 'August 2026', 'August 2026', 'July 2026', 'June 2026']
    .map((m, i) => `<tr><td>${m}</td><td>${400 + i} kWh</td><td>${800 + i}.20 Kč</td></tr>`)
    .join('') +
  '</tbody></table><p>IBAN CZ65 0800 0000 1920 0014 5399</p>';

function page(query: string): string {
  const head = '<!doctype html><html><head><meta charset="utf-8"><title>Voke</title><style>body{font:16px system-ui;margin:40px}td,th{padding:10px 24px;text-align:left}</style></head><body>';
  if (query.includes('mount')) {
    // The npm-style call: mountReport with the locale option.
    return `${head}${TABLE}<script type="module">import { mountReport } from '/vendor/report-widget-1.mjs'; window.report = mountReport({ key: 'vkb_e2e', locale: 'cs' });</script></body></html>`;
  }
  const tag = query.includes('nobutton')
    ? '<button id="help">Help</button><vitrinka-report key="vkb_e2e" button="false" open-selector="#help"></vitrinka-report>'
    : '<vitrinka-report key="vkb_e2e" locale="en"></vitrinka-report>';
  return `${head}${TABLE}${tag}<script type="module" src="/vendor/report-widget-1.mjs"></script></body></html>`;
}

test.beforeAll(async () => {
  execFileSync('bun', ['run', 'build:report'], { stdio: 'inherit', cwd: pkg });
  const widget = readFileSync(join(pkg, 'build/report-widget.mjs'), 'utf8');
  tmp = mkdtempSync(join(tmpdir(), 'vt-report-e2e-'));
  execFileSync('bun', ['build', join(here, 'fixture/rrweb-record.ts'), '--format=esm', '--target=browser', '--outfile', join(tmp, 'rrweb.mjs')], {
    stdio: 'inherit',
    cwd: pkg,
  });
  const rrweb = readFileSync(join(tmp, 'rrweb.mjs'), 'utf8');

  server = createServer(async (req, res) => {
    const path = req.url ?? '/';
    const body = await readBody(req);
    seen.push({ method: req.method ?? 'GET', path, auth: String(req.headers.authorization ?? ''), body });
    const js = (src: string) => {
      res.setHeader('content-type', 'text/javascript');
      res.end(src);
    };
    const json = (v: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    if (path === '/vendor/report-widget-1.mjs') return js(widget);
    if (path === '/vendor/rrweb-record-1.min.js') return js(rrweb);
    if (path === '/api/v1/report-config') {
      return json({
        project: 'voke',
        captureProfile: { storage: 'memory', windowSec: 300, maxBytes: 12 * 1024 * 1024, classes: ['interactions', 'console', 'network', 'errors'] },
        profile: 'strict',
        portalUrl: 'https://portal.vitrinka.test/voke',
        flightRecorder: true,
      });
    }
    if (path === '/api/v1/reports' && req.method === 'POST') return json({ id: 'rep-1', custody: 'quarantined' }, 201);
    const chunk = /^\/api\/v1\/reports\/rep-1\/chunk\?seq=(\d+)$/.exec(path);
    if (chunk) return json({ blobKey: `reports/rep-1/chunk-${chunk[1]}`, ok: true }, 201);
    if (path === '/api/v1/reports/rep-1/events') return json({ inserted: 1 });
    if (path === '/api/v1/reports/rep-1/submit') return json({ status: 'quarantined', reportUrl: REPORT_URL });
    if (path.startsWith('/api/')) return json({ error: 'not here' }, 404);
    res.setHeader('content-type', 'text/html');
    res.end(page(path));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
});

test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(tmp, { recursive: true, force: true });
});

test.beforeEach(() => {
  seen.length = 0;
});

/** The widget is armed: config read and the recorder loaded (its first snapshot is in the buffer). */
async function armed(): Promise<void> {
  await expect.poll(() => seen.some((s) => s.path === '/vendor/rrweb-record-1.min.js')).toBe(true);
}

function created(): Record<string, unknown> {
  const create = seen.find((s) => s.method === 'POST' && s.path === '/api/v1/reports');
  expect(create).toBeDefined();
  return JSON.parse(create!.body) as Record<string, unknown>;
}

async function draw(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

test('the large button opens the card, and a shortcut the reporter records opens it too', async ({ page }) => {
  await page.goto(base);
  const button = page.getByRole('button', { name: /^Report a problem/ });
  await expect(button).toBeVisible();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(card).toBeHidden();
  await button.click();
  await expect(card).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'What went wrong?' })).toBeFocused();

  // No default chord: the reporter records one by pressing it.
  await card.getByRole('button', { name: 'Settings' }).click();
  const shortcut = card.getByRole('button', { name: /^Keyboard shortcut: Not set/ });
  await shortcut.click();
  await expect(shortcut).toHaveText('Press keys · Esc cancels');
  await page.keyboard.press('r');
  await expect(card.getByText(/^Add Ctrl, Alt or ⌘/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shortcut).toHaveText('Not set');
  await shortcut.click();
  await page.keyboard.press('Alt+Shift+KeyR');
  await expect(card.getByRole('button', { name: /^Keyboard shortcut: (Alt\+Shift\+R|⌥⇧R)/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.recorder.report.keybind'))).toContain('KeyR');

  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card).toBeHidden();
  await page.keyboard.press('Alt+Shift+KeyR');
  await expect(card).toBeVisible();

  // It is the reporter's: it survives a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: /^Report a problem/ })).toBeVisible();
  await page.keyboard.press('Alt+Shift+KeyR');
  await expect(page.getByRole('dialog', { name: 'Report a problem' })).toBeVisible();
});

test('the host hides the button and opens the card from its own control', async ({ page }) => {
  await page.goto(`${base}/?nobutton`);
  await expect(page.getByRole('button', { name: 'Help' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Report a problem/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page.getByRole('dialog', { name: 'Report a problem' })).toBeVisible();
});

test('describe and send without marking', async ({ page }) => {
  await page.goto(base);
  await armed();
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(card.getByText('The last 5 minutes are attached')).toBeVisible();
  const send = card.getByRole('button', { name: 'Send' });
  await expect(send).toBeDisabled();
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('Total shows NaN after the coupon');
  await send.click();

  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
  await expect(card.getByRole('link', { name: 'See your report' })).toHaveAttribute('href', REPORT_URL);

  const body = created();
  expect(body).toMatchObject({
    title: 'Total shows NaN after the coupon',
    description: 'Total shows NaN after the coupon',
    markers: [],
    locale: 'en',
    env: { url: `${base}/`, viewport: { w: 1280, h: 720, dpr: 1 } },
  });
  expect(body).not.toHaveProperty('identity');
  expect(Array.isArray(body.console) && Array.isArray(body.network)).toBe(true);
  const calls = seen.filter((s) => s.path.startsWith('/api/')).map((s) => `${s.method} ${s.path.replace(/seq=\d+/, 'seq=N')}`);
  expect(calls[0]).toBe('GET /api/v1/report-config');
  expect(calls.slice(1, 3)).toEqual(['POST /api/v1/reports', 'POST /api/v1/reports/rep-1/chunk?seq=N']);
  expect(calls.slice(-2)).toEqual(['POST /api/v1/reports/rep-1/events', 'POST /api/v1/reports/rep-1/submit']);
  expect(seen.filter((s) => s.path.startsWith('/api/')).every((s) => s.auth === 'Bearer vkb_e2e')).toBe(true);
  const rows = JSON.parse(seen.find((s) => s.path.endsWith('/events'))!.body) as { events: { seq: number; kind: string; blobKey: string }[] };
  expect(rows.events[0]).toMatchObject({ seq: 1, kind: 'rrweb', blobKey: 'reports/rep-1/chunk-1' });
});

test('markers 1..n with notes; the coach says click, hold and move and leaves after the first; no element selector', async ({ page }) => {
  await page.goto(base);
  await armed();
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('August is listed twice');
  await card.getByRole('button', { name: 'Show us where' }).click();
  await expect(card).toBeHidden();

  const toolbar = page.getByRole('toolbar', { name: 'Marking tools' });
  await expect(toolbar).toBeVisible();
  const coach = page.getByRole('status').filter({ hasText: 'Click, hold and move around the problem.' });
  await expect(coach).toBeVisible();
  expect(await coach.textContent()).not.toMatch(/drag/i);
  // Hovering the page outlines nothing: marks are drawn, never picked.
  await page.mouse.move(300, 160);
  await expect(coach).toBeVisible();

  await draw(page, [80, 150], [420, 230]);
  await expect(page.getByRole('button', { name: 'Mark 1', exact: true })).toBeVisible();
  await expect(coach).toBeHidden();
  await page.getByRole('textbox', { name: 'Mark 1 — Add a note (optional)' }).fill('August is here twice');

  await toolbar.getByRole('button', { name: 'Box' }).click();
  await draw(page, [560, 200], [700, 260]);
  await toolbar.getByRole('button', { name: 'Arrow' }).click();
  await draw(page, [900, 120], [820, 190]);
  await toolbar.getByRole('button', { name: 'Hide' }).click();
  await draw(page, [30, 360], [520, 420]);
  for (const n of [2, 3, 4]) await expect(page.getByRole('button', { name: `Mark ${n}`, exact: true })).toBeVisible();

  await toolbar.getByRole('button', { name: 'Done' }).click();
  await expect(card).toBeVisible();
  await expect(card.getByText('4 places marked')).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'What went wrong?' })).toHaveValue('August is listed twice');
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();

  const body = created();
  const markers = body.markers as { n: number; shape: string; rect: { x: number; y: number; w: number; h: number }; note?: string; head?: string }[];
  expect(markers.map((m) => [m.n, m.shape])).toEqual([
    [1, 'circle'],
    [2, 'box'],
    [3, 'arrow'],
    [4, 'hide'],
  ]);
  expect(markers[0]).toEqual({ n: 1, shape: 'circle', rect: { x: 80, y: 150, w: 340, h: 80 }, note: 'August is here twice' });
  expect(markers[2]).toMatchObject({ rect: { x: 820, y: 120, w: 80, h: 70 }, head: 'sw' });
  // No element selector anywhere on the wire.
  for (const s of seen) expect(s.body).not.toMatch(/selector/i);
  // The hide region is blanked in the capture itself.
  const chunks = seen.filter((s) => s.path.includes('/chunk?seq=')).map((s) => s.body).join('');
  expect(chunks).toContain('data-vitrinka-hidden');
  expect(chunks).toContain('left:30px;top:360px;width:490px;height:60px');
});

test('the locale option, the locale attribute and setLocale() repaint live without losing the draft', async ({ page }) => {
  await page.goto(`${base}/?mount`);
  await page.getByRole('button', { name: /^Nahlásit problém/ }).click();
  const czech = page.getByRole('dialog', { name: 'Nahlásit problém' });
  const draft = czech.getByRole('textbox', { name: 'Co se pokazilo?' });
  await draft.fill('Srpen je ve vyúčtování dvakrát');
  await czech.getByRole('button', { name: 'Ukažte nám kde' }).click();
  await expect(page.getByText('Klikněte, podržte a pohybujte kolem problému.')).toBeVisible();
  await draw(page, [80, 150], [420, 230]);
  await page.getByRole('textbox', { name: 'Značka 1 — Přidejte poznámku (nepovinné)' }).fill('tady');
  await page.getByRole('toolbar').getByRole('button', { name: 'Hotovo' }).click();
  await expect(czech.getByText('1 označené místo')).toBeVisible();

  // The attribute, live.
  await page.evaluate(() => document.querySelector('vitrinka-report')!.setAttribute('locale', 'en'));
  const english = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(english.getByRole('textbox', { name: 'What went wrong?' })).toHaveValue('Srpen je ve vyúčtování dvakrát');
  await expect(english.getByText('1 place marked')).toBeVisible();
  await expect(english.getByRole('button', { name: 'Send' })).toBeVisible();

  // setLocale('cs') from the handle, live — the marks and their notes too.
  await page.evaluate(() => (window as unknown as { report: { setLocale(l: string): void } }).report.setLocale('cs'));
  await expect(czech.getByRole('textbox', { name: 'Co se pokazilo?' })).toHaveValue('Srpen je ve vyúčtování dvakrát');
  await expect(czech.getByText('1 označené místo')).toBeVisible();
  await czech.getByRole('button', { name: 'Ukažte nám kde' }).click();
  await expect(page.getByRole('textbox', { name: 'Značka 1 — Přidejte poznámku (nepovinné)' })).toHaveValue('tady');
  await expect(page.getByRole('toolbar').getByRole('button', { name: 'Zpět' })).toBeEnabled();
});
