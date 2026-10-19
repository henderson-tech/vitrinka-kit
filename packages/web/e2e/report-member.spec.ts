/**
 * A vitrinka member link proved on the report wire (vt-8020): a browser
 * linked to a member on the widget's own base sends the link's token in the
 * body of the create and of the reporter session, so the member co-owns the
 * report and sees it in My reports. The `vkb_` key stays the bearer.
 */
import { expect, type Page, test } from '@playwright/test';

import { type ReportServer, startReportServer } from './fixture/report-server';

let server: ReportServer;

test.beforeAll(async () => { server = await startReportServer(); });
test.afterAll(() => server.close());
test.beforeEach(() => { server.seen.length = 0; });

const HOST_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbm4ifQ.c2lnbmVk';
const UNKNOWN_MEMBER_TOKEN = 'invalid JSON body: json: unknown field "memberToken"; accepted top-level fields: title, description, env, console, network, identity, markers, locale, notify, type';
const ANN = { id: 'rep-ann', title: 'Ann’s chart is empty', step: 'planned', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z', url: 'https://portal.vitrinka.test/voke/reports/rep-ann' };
const MEMBER = { ...ANN, id: 'rep-member', title: 'The member’s export fails', url: 'https://portal.vitrinka.test/voke/reports/rep-member' };

async function linked(page: Page, base: string): Promise<void> {
  await page.addInitScript((b) => {
    localStorage.setItem('vitrinka.recorder.link', JSON.stringify({ token: 'vkr_member', workspace: 'voke', label: 'Member fixture', expires_in: 2592000, base: b }));
  }, base);
}

/** The reporter session door, answered here: each trade's body; a session per pairing (`rs_both` with the link). */
async function sessionDoor(page: Page): Promise<Record<string, unknown>[]> {
  const trades: Record<string, unknown>[] = [];
  await page.route('**/api/v1/report/session', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    trades.push(body);
    return route.fulfill({
      json: { reporter: { id: 'r-ann', email: 'ann@example.test', name: 'Ann Novak' }, session: 'memberToken' in body ? 'rs_both' : 'rs_ann', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    });
  });
  return trades;
}

async function openSigned(page: Page) {
  await page.goto(server.url);
  await page.evaluate((t) => document.querySelector('vitrinka-report')!.identify({ token: t }), HOST_TOKEN);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  return page.getByRole('dialog', { name: 'Report a problem' });
}

async function send(page: Page): Promise<void> {
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill('The export is empty');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
}

function created(): { auth: string; body: Record<string, unknown> } {
  const create = server.seen.find((s) => s.method === 'POST' && s.path === '/api/v1/reports');
  expect(create).toBeDefined();
  return { auth: create!.auth, body: JSON.parse(create!.body) as Record<string, unknown> };
}

test('a linked browser proves its member link on the reporter session and on the report, under the vkb_ key', async ({ page }) => {
  await linked(page, server.url);
  const trades = await sessionDoor(page);
  await openSigned(page);
  await send(page);
  expect(trades).toEqual([{ token: HOST_TOKEN, memberToken: 'vkr_member' }]);
  expect(created()).toMatchObject({ auth: 'Bearer vkb_e2e', body: { memberToken: 'vkr_member' } });
});

for (const [who, base] of [['an unlinked browser', ''], ['a link minted on another vitrinka', 'https://other.vitrinka.test']] as const) {
  test(`${who} sends no member link to either door`, async ({ page }) => {
    if (base) await linked(page, base);
    const trades = await sessionDoor(page);
    await openSigned(page);
    await send(page);
    expect(trades).toEqual([{ token: HOST_TOKEN }]);
    expect(created().body).not.toHaveProperty('memberToken');
    expect(server.seen.filter((s) => s.body.includes('vkr_member') || s.auth.includes('vkr_member'))).toEqual([]);
  });
}

test('a vitrinka that takes no member link yet gets the report again without it, and the link stays', async ({ page }) => {
  await linked(page, server.url);
  const creates: Record<string, unknown>[] = [];
  await page.route('**/api/v1/reports', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    creates.push(body);
    return 'memberToken' in body ? route.fulfill({ status: 400, json: { error: UNKNOWN_MEMBER_TOKEN } }) : route.fallback();
  });
  await page.goto(server.url);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  await send(page);
  expect(creates.map((b) => 'memberToken' in b)).toEqual([true, false]);
  expect(created().body).not.toHaveProperty('memberToken');
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.recorder.link'))).not.toBeNull();
});

test('a memberError saying the link was revoked forgets it, warns once, and the report files', async ({ page }) => {
  await linked(page, server.url);
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await page.route('**/api/v1/reports', (route) => route.fulfill({ status: 201, json: { id: 'rep-1', custody: 'quarantined', memberError: 'revoked' } }));
  await page.goto(server.url);
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  await send(page);
  expect(await page.evaluate(() => localStorage.getItem('vitrinka.recorder.link'))).toBeNull();
  expect(warnings.filter((w) => w.includes('member link'))).toEqual([expect.stringContaining('revoked')]);
  expect(server.seen.some((s) => s.path === '/api/v1/reports/rep-1/submit')).toBe(true);
});

test('a link replaced in another tab names its own member and opens a fresh session for it', async ({ page, context }) => {
  await linked(page, server.url);
  const trades = await sessionDoor(page);
  await page.route('**/api/v1/recorder/me', (route) => {
    const other = route.request().headers().authorization === 'Bearer vkr_other';
    return route.fulfill({ json: { kind: 'linked', workspace: { slug: 'voke' }, user: { email: other ? 'bea@example.test' : 'member@example.test' }, prefs: null, displayMode: 'regular' } });
  });
  const card = await openSigned(page);
  await card.getByRole('button', { name: /^Your account/ }).click();
  await expect(card.getByText('Linked to vitrinka as member@example.test')).toBeVisible();
  const tab = await context.newPage();
  await tab.goto(`${server.url}/__events`);
  await tab.evaluate((b) => {
    localStorage.setItem('vitrinka.recorder.link', JSON.stringify({ token: 'vkr_other', workspace: 'voke', label: 'Other tab', expires_in: 2592000, base: b }));
  }, server.url);
  await expect(card.getByText('Linked to vitrinka as bea@example.test')).toBeVisible();
  await expect.poll(() => trades).toEqual([{ token: HOST_TOKEN, memberToken: 'vkr_member' }, { token: HOST_TOKEN, memberToken: 'vkr_other' }]);
});

test('Unlink drops the session and a list still loading for the linked pairing; My reports reloads for the reporter alone', async ({ page }) => {
  await linked(page, server.url);
  const trades = await sessionDoor(page);
  let release = (): void => undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/v1/report/mine', async (route) => {
    const both = route.request().headers()['x-vitrinka-reporter'] === 'rs_both';
    if (both) await held;
    await route.fulfill({ json: { reports: both ? [ANN, MEMBER] : [ANN] } });
  });
  const card = await openSigned(page);
  await expect(card.getByRole('button', { name: 'Your account: Ann Novak' })).toBeVisible();
  await card.getByRole('button', { name: 'Menu', exact: true }).click();
  await card.getByRole('menuitem', { name: 'My reports', exact: true }).click();
  await expect(card.getByText('Loading…')).toBeVisible();
  await card.getByRole('button', { name: /^Your account/ }).click();
  await card.getByRole('button', { name: 'Unlink', exact: true }).click();
  await expect(card.getByText(ANN.title)).toBeVisible();
  // The linked pairing's list lands only now: the page has read it once two frames have passed.
  const landed = page.waitForEvent('requestfinished', (r) => r.url().endsWith('/api/v1/report/mine') && r.headers()['x-vitrinka-reporter'] === 'rs_both');
  release();
  await landed;
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(card.getByText(ANN.title)).toBeVisible();
  await expect(card.getByText(MEMBER.title)).toHaveCount(0);
  expect(trades).toEqual([{ token: HOST_TOKEN, memberToken: 'vkr_member' }, { token: HOST_TOKEN }]);
});
