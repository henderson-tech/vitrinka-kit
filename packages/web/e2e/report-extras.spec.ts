/**
 * Report a problem's extras (vt-8020 S11, S12, S14) on the report fixture
 * (fixture/report-server.ts): keys typed in the widget never reach a host's
 * capture-phase shortcuts; picked, pasted and dropped files ride the
 * attachment leg under the project's caps; the button moves to any corner; the
 * edge drop moves along either side edge and across; the sent card only thanks;
 * on a phone the card is a sheet that keeps Send above the keyboard; Settings scales the widget and shows the technical details.
 */
import { expect, type Page, test } from '@playwright/test';

import { type ReportServer, type ReportSeen, startReportServer } from './fixture/report-server';

declare global {
  interface Window {
    /** What the page's own key listeners heard, `<where>:<key>`. */
    __heard: string[];
  }
}

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

/** The widget is armed: config read and the recorder running (report.spec.ts's armed says why both waits). */
async function armed(page: Page): Promise<void> {
  await expect.poll(() => seen.some((s) => s.path === '/vendor/rrweb-record-1.min.js')).toBe(true);
  await expect.poll(() => page.evaluate(() => (globalThis as { __rrwebStarted?: number }).__rrwebStarted ?? 0)).toBeGreaterThan(0);
}

async function draw(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

async function openCard(page: Page) {
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(card).toBeVisible();
  return card;
}

/** A valid 1×1 PNG (every chunk's CRC checks): a decoder on either side reads it. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const file = (name: string, mimeType: string, bytes = 16) => ({ name, mimeType, buffer: name.endsWith('.png') && bytes === 16 ? PNG : Buffer.alloc(bytes, 7) });

function apiCalls(): string[] {
  return seen.filter((s) => s.path.startsWith('/api/')).map((s) => `${s.method} ${s.path}`);
}

test('keys typed in the card and in a mark’s note never reach the page’s capture-phase shortcuts; Escape still closes it', async ({ page }) => {
  // A bpmn-js-style binding: document, capture phase, "ignore while typing" by event.target — registered before the widget loads.
  await page.addInitScript(() => {
    window.__heard = [];
    const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      document.addEventListener(type, (e) => typing(e.target) || window.__heard.push(`document:${e.key}`), true);
    }
    document.addEventListener('keydown', (e) => window.__heard.push(`document-bubble:${e.key}`));
  });
  await page.goto(base);
  await armed(page);
  // The modeler mounts once the app runs (after the widget): a window capture listener from then on.
  // One the page registered on window before the widget's first host still runs first — nothing can precede it.
  await page.evaluate(() => {
    for (const type of ['keydown', 'keyup', 'keypress'] as const) window.addEventListener(type, (e) => window.__heard.push(`window:${e.key}`), true);
  });
  const card = await openCard(page);
  const desc = card.getByRole('textbox', { name: 'What went wrong?' });
  await desc.pressSequentially('Edit e fires');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ArrowLeft');
  await expect(desc).toHaveValue('Edit e fire');

  await card.getByRole('button', { name: 'Show us where' }).click();
  await draw(page, [80, 120], [200, 160]);
  const note = card.getByRole('textbox', { name: 'Mark 1 — Add a note (optional)' });
  await expect(note).toBeFocused();
  await page.keyboard.type('e here');
  await expect(note).toHaveValue('e here');
  expect(await page.evaluate(() => window.__heard)).toEqual([]);

  // Escape is no typing: it passes untouched — marking ends, then the card closes.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar', { name: 'Marking tools' })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  const heard = await page.evaluate(() => window.__heard);
  expect(heard).toContain('window:Escape');
  expect(heard.filter((k) => !k.endsWith(':Escape'))).toEqual([]);
});

test('a picked, a pasted and a dropped file ride the attachment leg between the create and the submit; the card keeps its size', async ({ page }) => {
  // No opening animation: the card's box is measured right after it opens.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  await armed(page);
  const card = await openCard(page);
  const desc = card.getByRole('textbox', { name: 'What went wrong?' });
  await desc.fill('The logo is cut off — this is how it should look');
  const empty = await card.boundingBox();

  const chooser = page.waitForEvent('filechooser');
  await card.getByRole('button', { name: 'Attach a file' }).click();
  await (await chooser).setFiles([file('steps.txt', 'text/plain')]);
  await expect(card.getByRole('button', { name: 'Remove steps.txt' })).toBeVisible();
  for (const source of ['paste', 'drop'] as const) {
    await desc.evaluate(
      (el, input) => {
        const data = new DataTransfer();
        const bytes = Uint8Array.from(atob(input.png), (c) => c.charCodeAt(0));
        data.items.add(input.source === 'paste' ? new File([bytes], 'image.png', { type: 'image/png' }) : new File(['%PDF-1.4'], 'spec.pdf', { type: 'application/pdf' }));
        el.dispatchEvent(
          input.source === 'paste'
            ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
            : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }),
        );
      },
      { source, png: PNG.toString('base64') },
    );
  }
  // A clipboard image is numbered, so two pastes read as two chips.
  await expect(card.getByRole('button', { name: 'Remove pasted-1.png' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Remove spec.pdf' })).toBeVisible();
  await expect(desc).toHaveValue('The logo is cut off — this is how it should look');
  expect(await card.boundingBox()).toEqual(empty);

  const types = new Map<string, string>();
  page.on('request', (r) => {
    const name = new URL(r.url()).searchParams.get('name');
    if (r.url().includes('/attachment?') && name) types.set(name, r.headers()['content-type'] ?? '');
  });
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByText('Thank you', { exact: true })).toBeVisible();
  const calls = apiCalls();
  const legs = calls.filter((c) => c.includes('/attachment?'));
  expect(legs).toEqual([
    'POST /api/v1/reports/rep-1/attachment?name=steps.txt',
    'POST /api/v1/reports/rep-1/attachment?name=pasted-1.png',
    'POST /api/v1/reports/rep-1/attachment?name=spec.pdf',
  ]);
  expect(calls.indexOf('POST /api/v1/reports')).toBeLessThan(calls.indexOf(legs[0]!));
  expect(calls.indexOf(legs[2]!)).toBeLessThan(calls.indexOf('POST /api/v1/reports/rep-1/submit'));
  expect(Object.fromEntries(types)).toEqual({ 'steps.txt': 'text/plain', 'pasted-1.png': 'image/png', 'spec.pdf': 'application/pdf' });
  expect(seen.filter((s) => s.path.includes('/attachment?')).every((s) => s.auth === 'Bearer vkb_e2e')).toBe(true);
});

test('a follow-up report carries a canvas-drawn PNG whole: every byte lands on the attachment leg before the submit', async ({ page }) => {
  await page.goto(base);
  await armed(page);
  let card = await openCard(page);
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('The export is empty');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByText('Thank you', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Close', exact: true }).last().click();
  seen.length = 0;

  card = await openCard(page);
  const desc = card.getByRole('textbox', { name: 'What went wrong?' });
  await desc.fill('And the chart under it is blank');
  // What a reporter's screenshot tool hands over: a real, decodable 240×100 PNG.
  const size = await desc.evaluate(async (el) => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 100;
    const g = canvas.getContext('2d')!;
    for (let x = 0; x < 240; x += 4) for (let y = 0; y < 100; y += 4) {
      g.fillStyle = `rgb(${(x * 7 + y * 13) % 256},${(x * y) % 256},${(x + y * 3) % 256})`;
      g.fillRect(x, y, 4, 4);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no blob'))), 'image/png'));
    const data = new DataTransfer();
    data.items.add(new File([blob], 'chart.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    return blob.size;
  });
  await expect(card.getByRole('button', { name: 'Remove chart.png' })).toBeVisible();
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByText('Thank you', { exact: true })).toBeVisible();
  const leg = seen.find((s) => s.path === '/api/v1/reports/rep-1/attachment?name=chart.png');
  expect(leg?.bytes).toBe(size);
  const calls = apiCalls();
  expect(calls.indexOf('POST /api/v1/reports')).toBeLessThan(calls.indexOf('POST /api/v1/reports/rep-1/attachment?name=chart.png'));
  expect(calls.indexOf('POST /api/v1/reports/rep-1/attachment?name=chart.png')).toBeLessThan(calls.indexOf('POST /api/v1/reports/rep-1/submit'));
});

test('a paste carrying text beside an image of it stays text', async ({ page }) => {
  await page.goto(base);
  await armed(page);
  const card = await openCard(page);
  const prevented = await card.getByRole('textbox', { name: 'What went wrong?' }).evaluate((el, png) => {
    // What Office puts on the clipboard for copied cells: the text and a picture of it.
    const data = new DataTransfer();
    data.setData('text/plain', 'Q3 revenue\t1 200 Kč');
    data.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'image.png', { type: 'image/png' }));
    const ev = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, PNG.toString('base64'));
  expect(prevented).toBe(false);
  await expect(card.getByRole('button', { name: /^Remove pasted-/ })).toHaveCount(0);
});

test('a file past the project’s caps is refused at once, the line naming the cap', async ({ page }) => {
  await page.route('**/api/v1/report-config', async (route) => {
    const response = await route.fetch();
    const json: Record<string, unknown> = await response.json();
    await route.fulfill({ response, json: { ...json, captureProfile: { ...(json.captureProfile as Record<string, unknown>), attachments: { maxBytes: 2048, maxCount: 2, types: ['image/*', 'application/pdf'] } } } });
  });
  await page.goto(base);
  await armed(page);
  const card = await openCard(page);
  const pick = async (files: ReturnType<typeof file>[]) => {
    const chooser = page.waitForEvent('filechooser');
    await card.getByRole('button', { name: 'Attach a file' }).click();
    await (await chooser).setFiles(files);
  };
  await pick([file('big.png', 'image/png', 4096)]);
  await expect(card.getByRole('status').filter({ hasText: 'big.png is over the 2 kB limit' })).toBeVisible();
  await pick([file('notes.zip', 'application/zip')]);
  await expect(card.getByText('notes.zip can’t be attached — images and PDF only')).toBeVisible();
  await pick([file('a.png', 'image/png'), file('b.pdf', 'application/pdf'), file('c.png', 'image/png', 32)]);
  await expect(card.getByText('Up to 2 files per report')).toBeVisible();
  await expect(card.getByRole('button', { name: /^Remove / })).toHaveCount(2);
  // Removing one makes room again, and the line goes.
  await card.getByRole('button', { name: 'Remove a.png' }).click();
  await expect(card.getByText('Up to 2 files per report')).toBeHidden();
  await expect(card.getByRole('button', { name: 'Attach a file' })).toBeFocused();
});

test('a file that did not land is the only one Try again sends', async ({ page }) => {
  let failed = false;
  await page.route((url) => url.pathname.endsWith('/attachment') && url.searchParams.get('name') === 'spec.pdf', async (route) => {
    if (failed) return route.continue();
    failed = true;
    await route.fulfill({ status: 503, body: 'storage unavailable' });
  });
  await page.goto(base);
  await armed(page);
  const card = await openCard(page);
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('Two files');
  const chooser = page.waitForEvent('filechooser');
  await card.getByRole('button', { name: 'Attach a file' }).click();
  await (await chooser).setFiles([file('shot.png', 'image/png'), file('spec.pdf', 'application/pdf')]);
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByText('Your report arrived, a file not yet — try again to attach it')).toBeVisible();
  // The report is on its way: its files and its type are fixed until it lands.
  await expect(card.getByRole('button', { name: 'Attach a file' })).toBeDisabled();
  await expect(card.getByRole('radio', { name: 'Bug', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card.getByText('Thank you', { exact: true })).toBeVisible();
  const calls = apiCalls();
  expect(calls.filter((c) => c === 'POST /api/v1/reports')).toHaveLength(1);
  expect(calls.filter((c) => c.includes('/attachment?'))).toEqual(['POST /api/v1/reports/rep-1/attachment?name=shot.png', 'POST /api/v1/reports/rep-1/attachment?name=spec.pdf']);
});

test('the button drags to another corner, the card opens beside it, and the corner survives a reload; Alt+arrows move it back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${base}/?corner`);
  const fab = page.getByRole('button', { name: /^Report a problem/ });
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  const home = (await fab.boundingBox())!;
  const grip = { x: home.x + 30, y: home.y + home.height / 2 };

  // A press that barely travels is still a click.
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 2, grip.y + 1);
  await page.mouse.up();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card).toBeHidden();

  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(700, 400, { steps: 6 });
  await page.mouse.move(160, 90, { steps: 6 });
  await page.mouse.up();
  // The drop docks it top left — and is no click.
  await expect.poll(async () => (await fab.boundingBox())!.x).toBeLessThan(40);
  const docked = (await fab.boundingBox())!;
  expect(docked.y).toBeLessThan(40);
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.report.dock'))).toBe('tl');

  // At the top the card opens below the button.
  await fab.click();
  const below = (await card.boundingBox())!;
  expect(below.x).toBeLessThan(40);
  expect(below.y).toBeGreaterThan(docked.y + docked.height);
  // Marking parks it from its corner, clear of the top bar.
  await card.getByRole('button', { name: 'Show us where' }).click();
  await expect.poll(async () => (await card.boundingBox())!.y).toBeGreaterThanOrEqual(72);
  expect((await card.boundingBox())!.x).toBeLessThan(40);

  await page.reload();
  await expect.poll(async () => (await fab.boundingBox())!.y).toBeLessThan(40);
  await fab.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(async () => (await fab.boundingBox())!.x).toBeGreaterThan(1000);
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(async () => (await fab.boundingBox())!).toEqual(home);
  await expect(fab).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.report.dock'))).toBe('br');
});

test('the edge drop rests on the right edge, names itself on hover, moves along it and remembers it; the card opens beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  await armed(page);
  const fab = page.getByRole('button', { name: /^Report a problem/ });
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  const label = fab.locator('.fab-label');

  // At rest: flush with the right edge, below the middle, above the bottom inset; the name is only for the ear.
  const rest = (await fab.boundingBox())!;
  expect(Math.round(rest.x + rest.width)).toBe(1440);
  expect(rest.width).toBeLessThan(60);
  expect(rest.y).toBeGreaterThan(810 / 2);
  expect(rest.y + rest.height).toBeLessThanOrEqual(810 - 136);
  expect((await label.boundingBox())?.width ?? 0).toBeLessThan(1);
  // Its body and both feet are ONE closed path: nothing can show a seam between pieces.
  await expect(fab.locator('.fab-shape path')).toHaveCount(1);
  expect(await fab.locator('.fab-shape path').getAttribute('d')).toMatch(/^M[^M]*Z$/);

  // Hovered, it grows its name toward the page and stays on the edge.
  await fab.hover();
  await expect.poll(async () => (await fab.boundingBox())!.width).toBeGreaterThan(120);
  expect(Math.round((await fab.boundingBox())!.x + (await fab.boundingBox())!.width)).toBe(1440);

  // Carried up and let go on the right half, it lands back on the right edge at that height — and the drop is no click.
  const grip = { x: rest.x + 20, y: rest.y + rest.height / 2 };
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(1100, 260, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(700, 400);
  await expect.poll(async () => Math.round((await fab.boundingBox())!.x + (await fab.boundingBox())!.width)).toBe(1440);
  const moved = (await fab.boundingBox())!;
  expect(moved.y).toBeLessThan(rest.y - 100);
  await expect(card).toBeHidden();
  const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('vitrinka.report.edge')))!) as { side: string; at: number };
  expect(stored.side).toBe('right');
  expect(stored.at).toBeGreaterThanOrEqual(0);
  expect(stored.at).toBeLessThan(0.62);

  // The card opens beside it, toward the page, and its middle sits level with the drop where there is room.
  await fab.click();
  await expect(card).toBeVisible();
  const beside = (await card.boundingBox())!;
  expect(beside.x + beside.width).toBeLessThan(moved.x);
  expect(beside.y).toBeGreaterThanOrEqual(16);
  expect(beside.y + beside.height).toBeLessThanOrEqual(810 - 16);
  await card.getByRole('button', { name: 'Close' }).first().click();

  // Remembered across a reload; Alt+↓ steps it back down the edge.
  await page.reload();
  await expect.poll(async () => Math.round((await fab.boundingBox())!.y)).toBe(Math.round(moved.y));
  await fab.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(async () => (await fab.boundingBox())!.y).toBeGreaterThan(moved.y);
  await expect(fab).toBeFocused();
  expect(Math.round((await fab.boundingBox())!.x + (await fab.boundingBox())!.width)).toBe(1440);
});

test('carried across the screen the drop comes off the wall as a pill, lands on the left edge, opens the card toward the middle and stays there; Alt+→ takes it back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.goto(base);
  await armed(page);
  const fab = page.getByRole('button', { name: /^Report a problem/ });
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  const rest = (await fab.boundingBox())!;

  // A press that barely travels is still a click.
  await page.mouse.move(rest.x + 20, rest.y + 24);
  await page.mouse.down();
  await page.mouse.move(rest.x + 22, rest.y + 25);
  await page.mouse.up();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Close' }).first().click();
  await expect(card).toBeHidden();

  // Carried, it leaves the wall: a free pill under the pointer, its feet gone (every corner round).
  await page.mouse.move(rest.x + 20, rest.y + 24);
  await page.mouse.down();
  await page.mouse.move(900, 400, { steps: 6 });
  await page.mouse.move(220, 300, { steps: 8 });
  await expect(fab).toHaveClass(/dragging/);
  await expect.poll(async () => {
    const b = (await fab.boundingBox())!;
    return Math.abs(b.x + b.width / 2 - 220) < 30 && Math.abs(b.y + b.height / 2 - 300) < 30;
  }).toBe(true);
  // Let go on the left half: it lands on the LEFT edge at that height, inside the band.
  await page.mouse.up();
  await page.mouse.move(700, 700);
  await expect.poll(async () => Math.round((await fab.boundingBox())!.x)).toBe(0);
  await expect(fab).not.toHaveClass(/dragging/);
  const landed = (await fab.boundingBox())!;
  expect(landed.y + landed.height / 2).toBeGreaterThan(300 - 40);
  expect(landed.y + landed.height / 2).toBeLessThan(300 + 40);
  await expect(card).toBeHidden();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('vitrinka.report.edge')))!)).toMatchObject({ side: 'left' });

  // The drop becomes the card: it gives its place up while the card is open, and the card opens toward the middle.
  await fab.click();
  await expect(card).toBeVisible();
  await expect.poll(() => fab.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await expect.poll(async () => (await card.boundingBox())!.x).toBeGreaterThan(landed.x + landed.width);
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect.poll(() => fab.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

  // Remembered across a reload, side and height.
  await page.reload();
  await expect.poll(async () => Math.round((await fab.boundingBox())!.x)).toBe(0);
  expect(Math.round((await fab.boundingBox())!.y)).toBe(Math.round(landed.y));
  // Alt+→ crosses back to the right edge at the same height; Alt+← returns.
  await fab.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(async () => Math.round((await fab.boundingBox())!.x + (await fab.boundingBox())!.width)).toBe(1440);
  // Same height, once its landing wobble has settled.
  await expect.poll(async () => Math.round((await fab.boundingBox())!.y)).toBe(Math.round(landed.y));
  await expect(fab).toBeFocused();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('vitrinka.report.edge')))!)).toMatchObject({ side: 'right' });
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(async () => Math.round((await fab.boundingBox())!.x)).toBe(0);

  // A place stored by 0.12.0 (the fraction alone) is the right edge; a tampered one is the default place.
  await page.evaluate(() => localStorage.setItem('vitrinka.report.edge', '0.3'));
  await page.reload();
  await expect.poll(async () => Math.round((await fab.boundingBox())!.x + (await fab.boundingBox())!.width)).toBe(1440);
  await page.evaluate(() => localStorage.setItem('vitrinka.report.edge', '{"side":"top","at":9}'));
  await page.reload();
  await expect.poll(async () => Math.round((await fab.boundingBox())!.x + (await fab.boundingBox())!.width)).toBe(1440);
  expect((await fab.boundingBox())!.y).toBeGreaterThan(810 / 2);
});

test('after Send the card says only thank you, with the way to the report and Close', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.goto(base);
  await armed(page);
  const card = await openCard(page);
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('The totals are off');
  await card.getByRole('button', { name: 'Send' }).click();
  const sent = card.locator('.pane.sent');
  await expect(sent.getByText('Thank you', { exact: true })).toBeVisible();
  // The old pane has faded out over it: the card shows nothing but the thanks.
  await expect(card.locator('.pane:not([hidden])')).toHaveCount(1);
  // Nothing about what the team does next: the thanks, the way to the report, Close.
  await expect(sent).toHaveText(/^\s*Thank you\s*(See your report)?\s*Close\s*$/);
  await expect(card.getByRole('button', { name: 'Send' })).toHaveCount(0);
});

/** iOS Safari's keyboard: the visual viewport shrinks, the layout viewport (innerHeight) stays. `__vv(h, top)` plays it. */
const FAKE_KEYBOARD = `(() => {
  const fake = new EventTarget(); let h = 0, top = 0, on = false;
  Object.defineProperties(fake, {
    height: { get: () => (on ? h : innerHeight) }, width: { get: () => innerWidth },
    offsetTop: { get: () => (on ? top : 0) }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 },
    pageTop: { get: () => scrollY + (on ? top : 0) }, pageLeft: { get: () => scrollX },
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
  window.__vv = (hh, tt = 0) => { on = true; h = hh; top = tt; fake.dispatchEvent(new Event('resize')); };
})();`;

test('on a phone the card opened from the host’s own control is a bottom sheet that keeps Send above the keyboard', async ({ page }) => {
  await page.addInitScript(FAKE_KEYBOARD);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/?nobutton`);
  await armed(page);
  await expect(page.getByRole('button', { name: /^Report a problem/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  const send = card.getByRole('button', { name: 'Send', exact: true });
  // A sheet across the width, its bottom on the screen's bottom (it rises there).
  await expect.poll(async () => {
    const b = (await card.boundingBox())!;
    return [Math.round(b.x), Math.round(b.width), Math.round(b.y + b.height)];
  }).toEqual([0, 390, 844]);

  const draft = card.getByRole('textbox', { name: 'What went wrong?' });
  await draft.fill('The month picker jumps');
  await draft.focus();
  // The keyboard rises over the bottom 344 px; the layout viewport stays 844 px tall, as on iOS Safari.
  await page.evaluate(() => (window as unknown as { __vv(h: number, t?: number): void }).__vv(500));
  expect(await page.evaluate(() => innerHeight)).toBe(844);
  await expect.poll(async () => Math.round((await card.boundingBox())!.y + (await card.boundingBox())!.height)).toBe(500);
  const above = (await send.boundingBox())!;
  expect(above.y).toBeGreaterThanOrEqual(0);
  expect(above.y + above.height).toBeLessThanOrEqual(500);
  const field = (await draft.boundingBox())!;
  expect(field.y).toBeGreaterThanOrEqual(0);
  // Scrolled under the keyboard (the visual viewport moved down the layout one), the sheet follows it.
  await page.evaluate(() => (window as unknown as { __vv(h: number, t?: number): void }).__vv(460, 120));
  await expect.poll(async () => Math.round((await card.boundingBox())!.y + (await card.boundingBox())!.height)).toBe(580);
  expect((await card.boundingBox())!.y).toBeGreaterThanOrEqual(120);
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('The month picker jumps');
});

test('on a phone whose window itself shrinks under the keyboard (Android), Send stays in view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/?nobutton`);
  await armed(page);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  const draft = card.getByRole('textbox', { name: 'What went wrong?' });
  await draft.focus();
  await page.setViewportSize({ width: 390, height: 500 });
  const send = card.getByRole('button', { name: 'Send', exact: true });
  await expect.poll(async () => {
    const b = (await send.boundingBox())!;
    return b.y >= 0 && b.y + b.height <= 500;
  }).toBe(true);
  await expect.poll(async () => Math.round((await card.boundingBox())!.y + (await card.boundingBox())!.height)).toBe(500);
  await expect(draft).toBeFocused();
});

test('Settings: Large and Small scale the card and the button, remembered; technical details list version, capture, buffer and server', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${base}/?corner`);
  await armed(page);
  const fab = page.getByRole('button', { name: /^Report a problem/ });
  const fabMedium = (await fab.boundingBox())!;
  const card = await openCard(page);
  const medium = (await card.boundingBox())!;
  await card.getByRole('button', { name: 'Menu', exact: true }).click();
  await card.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const sizes = card.getByRole('radiogroup', { name: 'Size' });
  await expect(sizes.getByRole('radio', { name: 'Medium', exact: true })).toHaveAttribute('aria-checked', 'true');

  await sizes.getByRole('radio', { name: 'Large', exact: true }).click();
  await expect(sizes.getByRole('radio', { name: 'Large', exact: true })).toHaveAttribute('aria-checked', 'true');
  const large = (await card.boundingBox())!;
  expect(large.width).toBeCloseTo(medium.width * 1.18, 0);
  expect(large.height).toBeCloseTo(medium.height * 1.18, 0);
  // It still rests at its corner: the painted card grows up and to the left.
  expect(large.x + large.width).toBeCloseTo(medium.x + medium.width, 0);
  expect((await fab.boundingBox())!.width).toBeCloseTo(fabMedium.width * 1.18, 0);
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.report.size'))).toBe('lg');

  const details = card.getByRole('button', { name: 'Technical details' });
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByRole('term')).toHaveText(['Version', 'Capture window', 'Capture', 'Buffer', 'Server']);
  await expect(card.getByRole('definition')).toHaveText([/^@vitrinka\/web \d+\.\d+\.\d+/, '5 minutes', 'Running', 'In memory · 12 MB', new URL(base).host]);

  await page.reload();
  const again = await openCard(page);
  expect((await again.boundingBox())!.width).toBeCloseTo(large.width, 0);
  await again.getByRole('button', { name: 'Menu', exact: true }).click();
  await again.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await again.getByRole('radiogroup', { name: 'Size' }).getByRole('radio', { name: 'Small', exact: true }).click();
  expect((await again.boundingBox())!.width).toBeCloseTo(medium.width * 0.88, 0);
});
