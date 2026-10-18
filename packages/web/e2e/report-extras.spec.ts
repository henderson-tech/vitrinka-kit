/**
 * Report a problem's extras (vt-8020 S11, S12, S14) on the report fixture
 * (fixture/report-server.ts): keys typed in the widget never reach a host's
 * capture-phase shortcuts; picked, pasted and dropped files ride the
 * attachment leg under the project's caps; the button moves to any corner;
 * Settings scales the widget and shows the technical details.
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

/** The widget is armed: config read and the recorder loaded. */
async function armed(): Promise<void> {
  await expect.poll(() => seen.some((s) => s.path === '/vendor/rrweb-record-1.min.js')).toBe(true);
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
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
  await armed();
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
  await armed();
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
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
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

test('a file past the project’s caps is refused at once, the line naming the cap', async ({ page }) => {
  await page.route('**/api/v1/report-config', async (route) => {
    const response = await route.fetch();
    const json: Record<string, unknown> = await response.json();
    await route.fulfill({ response, json: { ...json, captureProfile: { ...(json.captureProfile as Record<string, unknown>), attachments: { maxBytes: 2048, maxCount: 2, types: ['image/*', 'application/pdf'] } } } });
  });
  await page.goto(base);
  await armed();
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
  await armed();
  const card = await openCard(page);
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('Two files');
  const chooser = page.waitForEvent('filechooser');
  await card.getByRole('button', { name: 'Attach a file' }).click();
  await (await chooser).setFiles([file('shot.png', 'image/png'), file('spec.pdf', 'application/pdf')]);
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByText('Your report arrived, a file not yet — try again to attach it')).toBeVisible();
  // The report is on its way: its files are fixed until it lands.
  await expect(card.getByRole('button', { name: 'Attach a file' })).toBeDisabled();
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
  const calls = apiCalls();
  expect(calls.filter((c) => c === 'POST /api/v1/reports')).toHaveLength(1);
  expect(calls.filter((c) => c.includes('/attachment?'))).toEqual(['POST /api/v1/reports/rep-1/attachment?name=shot.png', 'POST /api/v1/reports/rep-1/attachment?name=spec.pdf']);
});

test('the button drags to another corner, the card opens beside it, and the corner survives a reload; Alt+arrows move it back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
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

test('Settings: Large and Small scale the card and the button, remembered; technical details list version, capture, buffer and server', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  await armed();
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
