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
  await card.getByRole('button', { name: 'Menu', exact: true }).click();
  await card.getByRole('menuitem', { name: 'Settings', exact: true }).click();
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

test('the host hides the button, opens the card from its own control and gets the focus back', async ({ page }) => {
  await page.goto(`${base}/?nobutton`);
  const help = page.getByRole('button', { name: 'Help' });
  await expect(help).toBeVisible();
  await expect(page.getByRole('button', { name: /^Report a problem/ })).toHaveCount(0);
  await help.click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'What went wrong?' })).toBeFocused();
  // No button to fall back on: closing hands focus to the control that opened the card, never to <body>.
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(help).toBeFocused();
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
  expect(body).not.toHaveProperty('type');
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
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Show us where' })).toHaveAttribute('aria-pressed', 'true');

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

  await toolbar.getByRole('radio', { name: 'Box' }).click();
  await draw(page, [560, 200], [700, 260]);
  await toolbar.getByRole('radio', { name: 'Arrow' }).click();
  await draw(page, [900, 120], [820, 190]);
  await toolbar.getByRole('radio', { name: 'Hide' }).click();
  await draw(page, [30, 360], [520, 420]);
  for (const n of [2, 3, 4]) await expect(page.getByRole('button', { name: `Mark ${n}`, exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(card).toBeVisible();
  await expect(card.getByRole('textbox', { name: /^Mark \d+ —/ })).toHaveCount(4);
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
  await expect(page.getByText('Klikněte, podržte a veďte kolem problému.')).toBeVisible();
  await draw(page, [80, 150], [420, 230]);
  await page.getByRole('textbox', { name: 'Značka 1 — Přidejte poznámku (nepovinné)' }).fill('tady');
  await page.keyboard.press('Escape');
  await expect(czech.getByRole('textbox', { name: 'Značka 1 — Přidejte poznámku (nepovinné)' })).toHaveValue('tady');

  // The attribute, live.
  await page.evaluate(() => document.querySelector('vitrinka-report')!.setAttribute('locale', 'en'));
  const english = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(english.getByRole('textbox', { name: 'What went wrong?' })).toHaveValue('Srpen je ve vyúčtování dvakrát');
  await expect(english.getByRole('textbox', { name: 'Mark 1 — Add a note (optional)' })).toHaveValue('tady');
  await expect(english.getByRole('button', { name: 'Send' })).toBeVisible();

  // setLocale('cs') from the handle, live — the marks and their notes too.
  await page.evaluate(() => (window as unknown as { report: { setLocale(l: string): void } }).report.setLocale('cs'));
  await expect(czech.getByRole('textbox', { name: 'Co se pokazilo?' })).toHaveValue('Srpen je ve vyúčtování dvakrát');
  await expect(czech.getByRole('textbox', { name: 'Značka 1 — Přidejte poznámku (nepovinné)' })).toHaveValue('tady');
  await czech.getByRole('button', { name: 'Ukažte nám kde' }).click();
  await expect(page.getByRole('textbox', { name: 'Značka 1 — Přidejte poznámku (nepovinné)' })).toHaveValue('tady');
  await expect(page.getByRole('toolbar').getByRole('radio', { name: 'Kruh', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('a hide blanks what was under it when it was drawn, even when the page changes before Send', async ({ page }) => {
  await page.goto(`${base}/?balanced`);
  await armed();
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('My IBAN is wrong');
  await card.getByRole('button', { name: 'Show us where' }).click();
  await page.getByRole('toolbar', { name: 'Marking tools' }).getByRole('radio', { name: 'Hide' }).click();
  const iban = (await page.getByText(/^IBAN/).boundingBox())!;
  await draw(page, [iban.x - 6, iban.y - 6], [iban.x + iban.width + 6, iban.y + iban.height + 6]);
  await page.keyboard.press('Escape');
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
  await tools.getByRole('radio', { name: 'Hide' }).click();
  const iban = (await page.getByText(/^IBAN/).boundingBox())!;
  await draw(page, [iban.x - 6, iban.y - 6], [iban.x + iban.width + 6, iban.y + iban.height + 6]);
  await page.keyboard.press('Escape');
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

test('mountReport({identity: null}) reports anonymously under a page-wide identity', async ({ page }) => {
  await page.goto(`${base}/?nobutton`);
  await page.evaluate(async () => {
    document.querySelector('vitrinka-report')!.remove();
    const widget: { identify: (who: { email: string }) => void; mountReport: (o: { key: string; identity: null }) => unknown } = await import(
      '/vendor/report-widget-1.mjs' as string
    );
    widget.identify({ email: 'jana@example.test' });
    widget.mountReport({ key: 'vkb_e2e', identity: null });
  });
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('Anonymous from the options');
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
  expect(created()).not.toHaveProperty('identity');
});

test('the standalone widget yields to a host recorder from another bundle', async ({ page }) => {
  await page.goto(`${base}/?recorder`);
  await armed();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  const fab = page.getByRole('button', { name: /^Report a problem/ });
  await fab.click();
  await expect(card.getByText('The last 5 minutes are attached')).toBeVisible();
  await card.getByRole('button', { name: 'Close' }).click();

  // The host's recorder (its own copy of the runtime registry) mounts.
  await page.evaluate(() => (window as unknown as { vtRecorder: { mount(): void } }).vtRecorder.mount());
  await fab.click();
  await expect(card.getByText('The last 5 minutes are attached')).toBeHidden();
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('Sent beside the recorder');
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
  expect(seen.some((s) => s.path.includes('/chunk?seq='))).toBe(false);
});

test('under an open modal dialog the report stays reachable, and keeps its draft when the dialog closes', async ({ page }) => {
  await page.goto(`${base}/?dialog`);
  await armed();
  await page.evaluate(() => (window as unknown as { openModal(): void }).openModal());
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  const draft = card.getByRole('textbox', { name: 'What went wrong?' });
  await draft.fill('The modal saves the wrong month');
  await expect(draft).toBeFocused();
  await page.evaluate(() => (document.getElementById('modal') as HTMLDialogElement).close());
  await expect(draft).toHaveValue('The modal saves the wrong month');
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
});

test('the report follows the modal shown last, not the last dialog in the page', async ({ page }) => {
  await page.goto(`${base}/?dialog`);
  await armed();
  // The later sibling opens first; the earlier one opens on top of it.
  await page.evaluate(() => {
    const w = window as unknown as { openModal(id?: string): void };
    w.openModal('second');
    w.openModal('modal');
  });
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const draft = page.getByRole('dialog', { name: 'Report a problem' }).getByRole('textbox', { name: 'What went wrong?' });
  await draft.fill('Typed above two modals');
  await expect(draft).toBeFocused();
});

test('a redundant write to an open dialog never promotes it over the modal on top', async ({ page }) => {
  await page.goto(`${base}/?dialog`);
  await armed();
  await page.evaluate(async () => {
    const w = window as unknown as { openModal(id?: string): void };
    w.openModal('modal');
    w.openModal('second');
    await new Promise((r) => requestAnimationFrame(r));
    document.getElementById('modal')!.setAttribute('open', '');
  });
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const draft = page.getByRole('dialog', { name: 'Report a problem' }).getByRole('textbox', { name: 'What went wrong?' });
  await draft.fill('Still reachable');
  await expect(draft).toBeFocused();
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

  await page.getByRole('toolbar', { name: 'Marking tools' }).getByRole('radio', { name: 'Hide' }).focus();
  await page.keyboard.press('Enter');
  await expect(canvas).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Mark 2', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(card.getByRole('textbox', { name: /^Mark \d+ —/ })).toHaveCount(2);
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
  const markers = created().markers as { n: number; shape: string; note?: string }[];
  expect(markers.map((m) => [m.n, m.shape, m.note])).toEqual([
    [1, 'circle', 'the total'],
    [2, 'hide', undefined],
  ]);
});

for (const viewport of [{ width: 1440, height: 810 }, { width: 390, height: 844 }]) {
  test(`the card keeps its bounding box through drafting, two marks, sending and thanks at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(base);
    await armed();
    await page.getByRole('button', { name: /^Report a problem/ }).click();
    const card = page.getByRole('dialog', { name: 'Report a problem' });
    await card.getByRole('textbox', { name: 'What went wrong?' }).fill('The card stays put');
    const drafting = await card.boundingBox();
    await card.getByRole('button', { name: 'Show us where' }).click();
    await draw(page, [40, 100], [140, 140]);
    await draw(page, [180, 170], [280, 210]);
    await expect(card.getByRole('textbox', { name: /^Mark \d+ —/ })).toHaveCount(2);
    const marking = await card.boundingBox();
    let release = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/v1/reports', async (route) => {
      await pending;
      await route.continue();
    });
    await card.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    const sending = await card.boundingBox();
    release();
    await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
    const thanks = await card.boundingBox();
    expect(created().description).toBe('The card stays put');
    expect(drafting).not.toBeNull();
    expect({ marking, sending, thanks }).toEqual({ marking: drafting, sending: drafting, thanks: drafting });
  });
}

test('the card moves to another corner instead of covering a box drawn under its resting corner', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await card.getByRole('button', { name: 'Show us where' }).click();
  await page.getByRole('toolbar', { name: 'Marking tools' }).getByRole('radio', { name: 'Box', exact: true }).click();
  const resting = (await card.boundingBox())!;
  // Start beside the card: pointer capture lets the box extend beneath it.
  const box = { x: resting.x - 30, y: resting.y + 40, width: 150, height: 80 };
  await draw(page, [box.x, box.y], [box.x + box.width, box.y + box.height]);
  await expect(card.getByRole('textbox', { name: 'Mark 1 — Add a note (optional)' })).toBeFocused();
  await expect.poll(async () => {
    const moved = (await card.boundingBox())!;
    return moved.x + moved.width <= box.x || box.x + box.width <= moved.x || moved.y + moved.height <= box.y || box.y + box.height <= moved.y;
  }).toBe(true);
  expect(await card.boundingBox()).not.toEqual(resting);
});

test('the shape indicator is in place on the marking bar’s first frame and slides only from one pick to the next', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(base);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  const indicator = page.locator('.tb .seg-ind');
  await indicator.evaluate((el) => {
    const w = window as unknown as { indicatorRuns: string[] };
    w.indicatorRuns = [];
    el.addEventListener('transitionrun', (e) => w.indicatorRuns.push((e as TransitionEvent).propertyName));
  });
  const runs = () => page.evaluate(() => [...(window as unknown as { indicatorRuns: string[] }).indicatorRuns].sort());
  await card.getByRole('button', { name: 'Show us where' }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Marking tools' });
  await expect(toolbar).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Slid to its first place, it would grow from width 0 at the control's edge, Circle bare until it arrived.
  expect(await runs()).toEqual([]);
  const circle = (await toolbar.getByRole('radio', { name: 'Circle', exact: true }).boundingBox())!;
  const placed = (await indicator.boundingBox())!;
  expect(Math.abs(placed.x - circle.x)).toBeLessThan(1);
  expect(Math.abs(placed.width - circle.width)).toBeLessThan(1);
  await toolbar.getByRole('radio', { name: 'Box', exact: true }).click();
  await expect.poll(runs).toEqual(['transform', 'width']);
});

for (const answer of ['Discard', 'Keep'] as const) {
  test(`Cancel asks before discarding two new marks; ${answer} ${answer === 'Discard' ? 'removes them and leaves marking' : 'keeps them'}`, async ({ page }) => {
    await page.goto(base);
    await page.getByRole('button', { name: /^Report a problem/ }).click();
    const card = page.getByRole('dialog', { name: 'Report a problem' });
    await card.getByRole('button', { name: 'Show us where' }).click();
    await draw(page, [80, 120], [200, 160]);
    await draw(page, [300, 180], [420, 220]);
    const toolbar = page.getByRole('toolbar', { name: 'Marking tools' });
    await toolbar.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(toolbar.getByText('Discard 2 marks?', { exact: true })).toBeVisible();
    await expect(card.getByRole('textbox', { name: /^Mark \d+ —/ })).toHaveCount(2);
    await toolbar.getByRole('button', { name: answer, exact: true }).click();
    await expect(card.getByRole('textbox', { name: /^Mark \d+ —/ })).toHaveCount(answer === 'Discard' ? 0 : 2);
    if (answer === 'Discard') {
      await expect(toolbar).toBeHidden();
      await expect(card.getByRole('button', { name: 'Show us where' })).toHaveAttribute('aria-pressed', 'false');
    } else {
      await expect(toolbar).toBeVisible();
      await expect(toolbar.getByText('Discard 2 marks?', { exact: true })).toBeHidden();
      await expect(card.getByRole('button', { name: 'Show us where' })).toHaveAttribute('aria-pressed', 'true');
    }
  });
}

for (const shortcut of ['Meta+z', 'Control+z']) {
  test(`${shortcut} removes the newest mark when no field is focused`, async ({ page }) => {
    await page.goto(base);
    await armed();
    await page.getByRole('button', { name: /^Report a problem/ }).click();
    const card = page.getByRole('dialog', { name: 'Report a problem' });
    await card.getByRole('textbox', { name: 'What went wrong?' }).fill('Keep the first mark');
    await card.getByRole('button', { name: 'Show us where' }).click();
    await draw(page, [80, 120], [200, 160]);
    await draw(page, [300, 180], [420, 220]);
    const canvas = page.getByRole('application', { name: 'Marking', exact: true });
    await canvas.focus();
    await page.keyboard.press(shortcut);
    await expect(card.getByRole('textbox', { name: /^Mark \d+ —/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Mark 2', exact: true })).toHaveCount(0);
    await card.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
    expect(created().markers).toMatchObject([{ n: 1, rect: { x: 80, y: 120, w: 120, h: 40 } }]);
    expect(created().markers).toHaveLength(1);
  });
}

for (const [label, type] of [['Bug', 'bug'], ['Suggestion', 'suggestion'], ['Question', 'question'], ['Other', 'other']] as const) {
  test(`the ${label} chip reaches the report envelope as type ${type}`, async ({ page }) => {
    await page.goto(base);
    await armed();
    await page.getByRole('button', { name: /^Report a problem/ }).click();
    const card = page.getByRole('dialog', { name: 'Report a problem' });
    const chip = card.getByRole('radiogroup', { name: 'What is it?' }).getByRole('radio', { name: label, exact: true });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-checked', 'true');
    await card.getByRole('textbox', { name: 'What went wrong?' }).fill('About this page');
    await card.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
    expect(created().type).toBe(type);
  });
}

test('a mark note alone enables Send and reaches the report with an empty description field', async ({ page }) => {
  await page.goto(base);
  await armed();
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  const send = card.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await card.getByRole('button', { name: 'Show us where' }).click();
  await draw(page, [80, 120], [200, 160]);
  const note = card.getByRole('textbox', { name: 'Mark 1 — Add a note (optional)' });
  await expect(note).toBeFocused();
  await expect(send).toBeDisabled();
  await note.fill('This total is wrong');
  await expect(card.getByRole('textbox', { name: 'What went wrong?' })).toHaveValue('');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
  expect(created()).toMatchObject({ description: 'This total is wrong', markers: [{ n: 1, note: 'This total is wrong' }] });
});

test('Menu opens the report menu; Escape closes it and returns focus to Menu', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  const trigger = card.getByRole('button', { name: 'Menu', exact: true });
  await trigger.click();
  await expect(card.getByRole('menu')).toBeVisible();
  await expect(card.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card.getByRole('menu')).toBeHidden();
  await expect(card).toBeVisible();
  await expect(trigger).toBeFocused();
});

test('the report menu moves its focus with the arrows, Home and End', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await card.getByRole('button', { name: 'Menu', exact: true }).click();
  // A reporter's items: My reports and Settings (no portal session, no member link).
  const reports = card.getByRole('menuitem', { name: 'My reports', exact: true });
  const settings = card.getByRole('menuitem', { name: 'Settings', exact: true });
  await expect(reports).toBeFocused();
  for (const [key, focused] of [['ArrowDown', settings], ['ArrowDown', reports], ['ArrowUp', settings], ['Home', reports], ['End', settings]] as const) {
    await page.keyboard.press(key);
    await expect(focused).toBeFocused();
  }
});
