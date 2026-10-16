/**
 * Report a problem end to end (QA Studio S1, S2, S4): the report fixture
 * (fixture/report-server.ts) serves `build/report-widget.mjs` as vitrinka
 * serves it, with its rrweb recorder and a stub of the report wire that
 * records every call.
 */
import { expect, type Page, test } from '@playwright/test';

import { REPORT_URL, type ReportServer, type ReportSeen, startReportServer } from './fixture/report-server';

let server: ReportServer;
let base = '';
let seen: ReportSeen[] = [];

test.beforeAll(async () => {
  server = await startReportServer();
  base = server.url;
  seen = server.seen;
});

test.afterAll(() => server.close());

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

test('a hide blanks what was under it when it was drawn, even when the page changes before Send', async ({ page }) => {
  await page.goto(`${base}/?balanced`);
  await armed();
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('My IBAN is wrong');
  await card.getByRole('button', { name: 'Show us where' }).click();
  await page.getByRole('toolbar', { name: 'Marking tools' }).getByRole('button', { name: 'Hide' }).click();
  const iban = (await page.getByText(/^IBAN/).boundingBox())!;
  await draw(page, [iban.x - 6, iban.y - 6], [iban.x + iban.width + 6, iban.y + iban.height + 6]);
  await page.getByRole('toolbar', { name: 'Marking tools' }).getByRole('button', { name: 'Done' }).click();
  // The app re-renders that line before the reporter sends.
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((el) => el.textContent?.startsWith('IBAN'))!;
    p.replaceChildren(document.createTextNode('IBAN CZ65 0800 0000 1920 0014 5399'));
  });
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
  const chunks = seen.filter((s) => s.path.includes('/chunk?seq=')).map((s) => s.body).join('');
  expect(chunks).toContain('Settlement'); // balanced: page text is kept…
  expect(chunks).not.toContain('1920 0014 5399'); // …except under the hide
});

test('a hide added after a failed send is blanked in the retried capture', async ({ page }) => {
  await page.goto(`${base}/?balanced`);
  await armed();
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('My IBAN is wrong');
  server.failNextCreate();
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByText('Couldn’t send — your text is safe, try again')).toBeVisible();
  await card.getByRole('button', { name: 'Show us where' }).click();
  const tools = page.getByRole('toolbar', { name: 'Marking tools' });
  await tools.getByRole('button', { name: 'Hide' }).click();
  const iban = (await page.getByText(/^IBAN/).boundingBox())!;
  await draw(page, [iban.x - 6, iban.y - 6], [iban.x + iban.width + 6, iban.y + iban.height + 6]);
  await tools.getByRole('button', { name: 'Done' }).click();
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
  const creates = seen.filter((s) => s.method === 'POST' && s.path === '/api/v1/reports');
  expect(JSON.parse(creates.at(-1)!.body).markers).toMatchObject([{ n: 1, shape: 'hide' }]);
  const chunks = seen.filter((s) => s.path.includes('/chunk?seq=')).map((s) => s.body).join('');
  expect(chunks).toContain('Settlement');
  expect(chunks).not.toContain('1920 0014 5399');
});

test('a widget told identify(null) reports anonymously, whatever the page-wide identity', async ({ page }) => {
  await page.goto(base);
  await armed();
  await page.evaluate(async () => {
    const widget: { identify: (who: { email: string } | null) => void } = await import('/vendor/report-widget-1.mjs' as string);
    widget.identify({ email: 'jana@example.test' });
    document.querySelector('vitrinka-report')!.identify(null);
  });
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('Anonymous, please');
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
  expect(created()).not.toHaveProperty('identity');
});

test('a tag that gets its key after it connected mounts then', async ({ page }) => {
  await page.goto(`${base}/?nobutton`);
  await page.evaluate(() => {
    const late = document.createElement('vitrinka-report');
    late.id = 'late';
    document.body.append(late);
  });
  await page.evaluate(() => document.querySelector('vitrinka-report[button]')!.remove());
  await expect(page.getByRole('button', { name: /^Report a problem/ })).toHaveCount(0);
  await page.evaluate(() => document.getElementById('late')!.setAttribute('key', 'vkb_e2e'));
  await expect(page.getByRole('button', { name: /^Report a problem/ })).toBeVisible();
});

test('marks can be made from the keyboard alone', async ({ page }) => {
  await page.goto(base);
  await armed();
  await page.getByRole('button', { name: /^Report a problem/ }).focus();
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await page.keyboard.type('Totals are off');
  await card.getByRole('button', { name: 'Show us where' }).focus();
  await page.keyboard.press('Enter');

  const canvas = page.getByRole('application', { name: 'Marking' });
  await expect(canvas).toBeFocused();
  await expect(page.getByText(/Enter to start, arrows to move, Shift\+arrows to resize/)).toBeVisible();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Enter');
  const note = page.getByRole('textbox', { name: 'Mark 1 — Add a note (optional)' });
  await expect(note).toBeFocused();
  await page.keyboard.type('the total');
  await page.keyboard.press('Enter');
  await expect(canvas).toBeFocused();

  await page.getByRole('toolbar', { name: 'Marking tools' }).getByRole('button', { name: 'Hide' }).focus();
  await page.keyboard.press('Enter');
  await expect(canvas).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Mark 2', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(card.getByText('2 places marked')).toBeVisible();
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
  const markers = created().markers as { n: number; shape: string; note?: string }[];
  expect(markers.map((m) => [m.n, m.shape, m.note])).toEqual([
    [1, 'circle', 'the total'],
    [2, 'hide', undefined],
  ]);
});
