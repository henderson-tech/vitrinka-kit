import { expect, type Page, test } from '@playwright/test';

import { type ReportServer, startReportServer } from './fixture/report-server';

let server: ReportServer;

test.beforeAll(async () => { server = await startReportServer(); });
test.afterAll(() => server.close());

async function member(page: Page): Promise<void> {
  await page.addInitScript((base) => {
    localStorage.setItem('vitrinka.recorder.link', JSON.stringify({
      token: 'vkr_member', workspace: 'voke', label: 'Face switch fixture', expires_in: 2592000, base,
    }));
  }, server.url);
}

async function pickRecord(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem', exact: true });
  await card.getByRole('button', { name: 'Menu', exact: true }).click();
  await card.getByRole('menuitem', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
  await expect(card).toHaveCount(0);
}

test('a reporter without a member link never sees Record in the npm report menu', async ({ page }) => {
  await page.goto(`${server.url}/npm`);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem', exact: true });
  await card.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(card.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible();
  await expect(card.getByRole('menuitem', { name: 'Record', exact: true })).toHaveCount(0);
});

test('a linked member switches to the pill through Record and returns through Report a problem', async ({ page }) => {
  await member(page);
  await page.goto(`${server.url}/npm`);
  await pickRecord(page);
  const start = page.getByRole('button', { name: 'Start recording', exact: true });
  await start.hover();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menu', { name: 'Recorder', exact: true }).getByRole('menuitem', { name: 'Report a problem', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Report a problem/ })).toBeVisible();
  await expect(start).toHaveCount(0);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  await expect(page.getByRole('dialog', { name: 'Report a problem', exact: true })).toBeVisible();
});

test('a linked member’s picked pill survives reload', async ({ page }) => {
  await member(page);
  await page.goto(`${server.url}/npm`);
  await pickRecord(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Report a problem/ })).toHaveCount(0);
});

test('a dev-mode member who never picked a face starts on the pill on the next mount', async ({ page }) => {
  await member(page);
  await page.goto(`${server.url}/npm?dev`);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vitrinka.report.mode'))).toBe('dev');
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.report.face'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Report a problem/ })).toHaveCount(0);
});

test('a member link minted on another vitrinka never sends its token to this one', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vitrinka.recorder.link', JSON.stringify({
      token: 'vkr_elsewhere', workspace: 'voke', label: 'Elsewhere', expires_in: 2592000, base: 'https://other.vitrinka.test',
    }));
  });
  await page.goto(`${server.url}/npm`);
  const asked = page.waitForRequest((r) => r.url().endsWith('/api/v1/recorder/me'), { timeout: 2_000 }).then(() => true, () => false);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem', exact: true });
  await card.getByRole('button', { name: /^Your account/ }).click();
  expect(await asked).toBe(false);
  expect(server.seen.filter((s) => s.auth === 'Bearer vkr_elsewhere')).toEqual([]);
  await expect(card.getByRole('button', { name: 'Link your vitrinka account', exact: true })).toBeVisible();
});

test('My reports read for a signed reporter leave with them: identify(null) shows this browser’s list instead', async ({ page }) => {
  await page.route('**/api/v1/report/session', (route) => route.fulfill({
    json: { reporter: { id: 'r-ann', email: 'ann@example.test', name: 'Ann Novak' }, session: 'rs_ann', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  }));
  await page.route('**/api/v1/report/mine', (route) => route.fulfill({
    json: { reports: [{ id: 'rep-ann', title: 'Ann’s chart is empty', step: 'planned', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z', url: 'https://portal.vitrinka.test/voke/reports/rep-ann' }] },
  }));
  await page.goto(`${server.url}/npm`);
  await page.evaluate(() => document.querySelector('vitrinka-report')!.identify({ token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbm4ifQ.c2lnbmVk' }));
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem', exact: true });
  await card.getByRole('button', { name: 'Menu', exact: true }).click();
  await card.getByRole('menuitem', { name: 'My reports', exact: true }).click();
  await expect(card.getByText('Ann’s chart is empty')).toBeVisible();
  await page.evaluate(() => document.querySelector('vitrinka-report')!.identify(null));
  await expect(card.getByText('Ann’s chart is empty')).toHaveCount(0);
  await expect(card.getByText('No reports yet.')).toBeVisible();
});

test('Record waits while the card holds an unsent draft, names why, and returns once it is cleared', async ({ page }) => {
  await member(page);
  await page.goto(`${server.url}/npm`);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem', exact: true });
  const desc = card.getByRole('textbox', { name: 'What went wrong?' });
  const menu = card.getByRole('button', { name: 'Menu', exact: true });
  const record = card.getByRole('menuitem', { name: 'Record', exact: true });
  await desc.fill('The export is empty');
  await card.getByRole('radio', { name: 'Bug', exact: true }).click();
  await menu.click();
  await expect(record).toBeDisabled();
  await expect(record).toHaveAccessibleDescription('Send or clear the report you started first');
  await expect(card.getByText('Send or clear the report you started first')).toBeVisible();
  // The arrows still reach it, so the reason is heard; pressing it keeps the card and the draft.
  await expect(card.getByRole('menuitem', { name: 'My reports', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(record).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(record).toBeVisible();
  await expect(desc).toHaveValue('The export is empty');
  await menu.click();
  // The words alone gone: the picked word is still the reporter's.
  await desc.fill('');
  await menu.click();
  await expect(record).toBeDisabled();
  await menu.click();
  await card.getByRole('radio', { name: 'Bug', exact: true }).click();
  await menu.click();
  await expect(record).toBeEnabled();
  await expect(record).toHaveAccessibleDescription('');
  await expect(card.getByText('Send or clear the report you started first')).toBeHidden();
  await record.click();
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
});

test('Record stays unavailable while a report waits on Try again, which the switch would lose', async ({ page }) => {
  await member(page);
  await page.route((url) => url.pathname.endsWith('/attachment'), (route) => route.fulfill({ status: 503, body: 'storage unavailable' }));
  await page.goto(`${server.url}/npm`);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  const card = page.getByRole('dialog', { name: 'Report a problem', exact: true });
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('The export is empty');
  const chooser = page.waitForEvent('filechooser');
  await card.getByRole('button', { name: 'Attach a file' }).click();
  await (await chooser).setFiles([{ name: 'steps.txt', mimeType: 'text/plain', buffer: Buffer.from('1. open the export') }]);
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByText('Your report arrived, a file not yet — try again to attach it')).toBeVisible();
  await card.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(card.getByRole('menuitem', { name: 'Record', exact: true })).toBeDisabled();
});
