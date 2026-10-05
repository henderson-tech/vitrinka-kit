/**
 * The HUD seam end to end: `build/hud.iife.js` (built here) mounted on a bare
 * page — no React, no recorder — with a plain-JS `HudController`, the way the
 * browser extension will mount it. The HUD must paint the controller's
 * snapshot and drive it only through its actions.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');

let server: Server;
let pageUrl = '';

/** A controller with no recorder behind it: state in a closure, every call logged. */
const CONTROLLER = `
const calls = [];
const listeners = new Set();
let snap = {
  linked: true, canUnlink: false, annotating: false, recording: null,
  account: { kind: 'linked', workspace: { slug: 'acme', name: 'ADF' }, user: { email: 'ext@example.test', name: 'Ext' }, project: null, label: null },
  prefs: { size: 'md', verbose: false }, recents: [], workspaceUrl: 'https://vitrinka.test/w/acme', version: 'extension/9.9.9',
};
const set = (patch) => { snap = { ...snap, ...patch }; listeners.forEach((l) => l()); };
const sync = { state: 'ok', synced: true, queued: 0, chunks: 0, failures: 0, error: '', lastSyncAt: Date.now(), events: 3, serverMaxSeq: 3, deadReason: '' };
window.calls = calls;
window.controller = {
  getSnapshot: () => snap,
  subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  async start(o) { calls.push(['start', o.title]); set({ recording: { sessionId: 'ext-1', title: o.title, paused: false, dead: false, activeMs: 0, resumedAt: Date.now(), sync } }); },
  async togglePause() { calls.push(['pause']); },
  async stop() { calls.push(['stop']); set({ recording: null }); return { boardUrl: 'https://vitrinka.test/acme/b/ext-1' }; },
  note(t) { calls.push(['note', t]); },
  annotate(a) { calls.push(['annotate', a.selector]); },
  setAnnotating(on) { calls.push(['annotating', on]); set({ annotating: on }); },
  async link() { throw new Error('not in this test'); },
  unlink() { calls.push(['unlink']); },
  async getMe() { calls.push(['getMe']); return snap.account; },
  async setPrefs(p) { calls.push(['setPrefs', p]); set({ prefs: { ...snap.prefs, ...p } }); },
  async refreshRecents() { calls.push(['refreshRecents']); },
};
`;

test.beforeAll(async () => {
  execFileSync('bun', ['run', 'build:hud'], { stdio: 'inherit', cwd: pkg });
  const hud = readFileSync(join(pkg, 'build/hud.iife.js'), 'utf8');
  server = createServer((req, res) => {
    if (req.url === '/hud.js') {
      res.setHeader('content-type', 'text/javascript');
      return void res.end(hud);
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><title>Extension host</title></head><body><h1>Some page</h1>' +
        `<script>${CONTROLLER}</script><script src="/hud.js"></script>` +
        '<script>window.unmount = VitrinkaHud.mount(window.controller, { title: () => "from the extension" });</script>' +
        '</body></html>',
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  pageUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
});

test.afterAll(async () => {
  await new Promise((r) => server?.close(r));
});

test('the IIFE mounts the HUD for a foreign controller and drives it only through its actions', async ({ page }) => {
  await page.goto(pageUrl);
  expect(await page.evaluate(() => typeof (window as unknown as { React?: unknown }).React)).toBe('undefined');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Recorder controls' })).toBeVisible();
  await page.getByRole('button', { name: 'Recorder controls' }).hover();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('group', { name: 'Stop and save' }).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('[data-e2e="saved"]').getByRole('link', { name: /Open board/ })).toHaveAttribute(
    'href',
    'https://vitrinka.test/acme/b/ext-1',
  );
  await page.locator('[data-e2e="saved"]').getByRole('button', { name: 'Dismiss' }).click();
  await page.getByRole('button', { name: 'Start recording' }).hover();
  await page.locator('.seg.on .b-more').click();
  await expect(page.locator('[data-e2e="menu-account"]')).toContainText('ext@example.test');
  await page.getByRole('menuitemradio', { name: 'Size Small' }).click();
  const calls = await page.evaluate(() => (window as unknown as { calls: unknown[][] }).calls.map((c) => c[0]));
  expect(calls).toEqual(expect.arrayContaining(['start', 'stop', 'getMe', 'refreshRecents', 'setPrefs']));
  expect(await page.evaluate(() => (window as unknown as { calls: unknown[][] }).calls.find((c) => c[0] === 'start'))).toEqual([
    'start',
    'from the extension',
  ]);
  await expect(page.locator('.hud').first()).toHaveAttribute('data-size', 'sm');
  // Unmount removes the host.
  await page.evaluate(() => (window as unknown as { unmount: () => void }).unmount());
  await expect(page.locator('[data-vitrinka-hud]')).toHaveCount(0);
});
