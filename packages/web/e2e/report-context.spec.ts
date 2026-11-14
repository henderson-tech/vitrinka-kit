/**
 * The host's context on a report (vt-9515): what `setContext` holds rides
 * the create's JSON body as `context`, the next report carries whatever was
 * set last, an empty map sends nothing, an invalid entry is dropped and
 * warned about without throwing, and the identity token goes untouched.
 */
import { expect, type Page, test } from '@playwright/test';

import { type ReportServer, startReportServer } from './fixture/report-server';

let server: ReportServer;

test.beforeAll(async () => { server = await startReportServer(); });
test.afterAll(() => server.close());
test.beforeEach(() => { server.seen.length = 0; });

const HOST_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJjdHgiOnsiZW52aXJvbm1lbnQiOiJwcm9kIn19.c2lnbmVk';

async function setContext(page: Page, next: unknown): Promise<void> {
  await page.evaluate((n) => document.querySelector('vitrinka-report')!.setContext(n as never), next);
}

/** Open the card, describe, send, close: one report through the real widget. */
async function report(page: Page, words: string): Promise<void> {
  await page.evaluate(() => document.querySelector('vitrinka-report')!.open());
  const card = page.getByRole('dialog', { name: 'Report a problem' });
  await card.getByRole('textbox', { name: 'What went wrong?' }).fill(words);
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByText('Thanks — we’ve got it')).toBeVisible();
  await page.evaluate(() => document.querySelector('vitrinka-report')!.close());
}

function creates(): Record<string, unknown>[] {
  return server.seen.filter((s) => s.method === 'POST' && s.path === '/api/v1/reports').map((s) => JSON.parse(s.body) as Record<string, unknown>);
}

test('each report carries the context set last; an empty map or null sends none; the token rides untouched', async ({ page }) => {
  await page.goto(server.url);
  await page.evaluate((t) => document.querySelector('vitrinka-report')!.identify({ token: t }), HOST_TOKEN);

  await setContext(page, { environment: 'demo', organization: { id: 'org_42', label: 'Turena' } });
  await report(page, 'The export is empty');
  await setContext(page, { environment: 'staging' });
  await report(page, 'The chart is blank');
  await setContext(page, {});
  await report(page, 'The total is NaN');
  await setContext(page, { environment: 'demo' });
  await setContext(page, null);
  await report(page, 'The menu sticks');

  const bodies = creates();
  expect(bodies).toHaveLength(4);
  expect(bodies[0]).toMatchObject({ identity: { token: HOST_TOKEN }, context: { environment: 'demo', organization: { id: 'org_42', label: 'Turena' } } });
  expect(bodies[1]!.context).toEqual({ environment: 'staging' });
  expect('context' in bodies[2]!).toBe(false);
  expect('context' in bodies[3]!).toBe(false);
  expect(bodies.every((b) => (b.identity as { token?: string }).token === HOST_TOKEN)).toBe(true);
});

test('an invalid entry is dropped and warned about by name, never thrown; the rest still rides', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.goto(server.url);

  await setContext(page, { environment: 'demo', 'Bad-Key': 'x', note: 'x'.repeat(101) });
  await report(page, 'The export is empty');

  expect(creates()[0]!.context).toEqual({ environment: 'demo' });
  expect(warnings.filter((w) => w.includes('setContext dropped'))).toEqual([
    'vitrinka: setContext dropped "Bad-Key" (a key is 1 to 32 characters of [a-z0-9_]); "note" (a value is a string of 1 to 100 characters after trimming, or {id, label?}). The report goes without them.',
  ]);
});
