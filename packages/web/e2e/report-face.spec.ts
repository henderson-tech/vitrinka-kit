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
