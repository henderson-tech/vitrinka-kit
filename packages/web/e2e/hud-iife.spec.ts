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
let remoteStop = null;
window.remoteStop = () => remoteStop && remoteStop();
window.follow = (who) => set({ following: who || undefined });
const live = (title) => ({ sessionId: 'ext-1', title, paused: false, dead: false, activeMs: 0, resumedAt: Date.now(), sync });
// A session that appears without a Start here (resumed, joined from another tab).
window.recordNow = () => set({ recording: live('resumed') });
// Set to a reason and Start is refused with it (another recorder leads).
window.refuse = '';
window.controller = {
  getSnapshot: () => snap,
  subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  async start(o) { calls.push(['start', o.title]); if (window.refuse) throw new Error(window.refuse); set({ recording: live(o.title) }); },
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
  onRemoteStop(run) { remoteStop = run; return () => { if (remoteStop === run) remoteStop = null; }; },
  faceChanged(face) { calls.push(['face', face]); },
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

/** A chord as the extension relays it: a script-dispatched (untrusted) keydown on window. Returns defaultPrevented. */
function relayChord(page: import('@playwright/test').Page, code: string): Promise<boolean> {
  return page.evaluate((c) => {
    const e = new KeyboardEvent('keydown', { code: c, altKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }, code);
}

test('ONE recorder: the leader takes relayed chords; a follower hides, binds none and keeps its draft; a remote stop needs no confirm', async ({ page }) => {
  await page.goto(pageUrl);
  await page.getByRole('button', { name: 'Start recording' }).click();
  const controls = page.getByRole('button', { name: 'Recorder controls' });
  await expect(controls).toBeVisible();
  // D9/D10: the leader's HUD acts on an untrusted chord.
  expect(await relayChord(page, 'KeyN')).toBe(true);
  const note = page.getByRole('dialog', { name: 'Note' });
  await note.getByRole('textbox').fill('half a thought');
  // D8: becoming the other recorder's remote closes the sheet and hides the HUD…
  await page.evaluate(() => (window as unknown as { follow: (w: string) => void }).follow('extension'));
  await expect(note).toHaveCount(0);
  await expect(controls).toBeHidden();
  await expect(page.locator('[data-vitrinka-hud]')).toHaveCount(1);
  // …and binds no chord: the key is left to the leader.
  expect(await relayChord(page, 'KeyN')).toBe(false);
  await expect(note).toHaveCount(0);
  // Let go: the pill comes back idle-faced, the draft intact.
  await page.evaluate(() => (window as unknown as { follow: (w: string) => void }).follow(''));
  await expect(controls).toBeVisible();
  expect(await relayChord(page, 'KeyN')).toBe(true);
  await expect(note.getByRole('textbox')).toHaveValue('half a thought');
  // D11: the other side stops it — the sheet closes keeping the draft, straight to Saving → Saved.
  await page.evaluate(() => (window as unknown as { remoteStop: () => void }).remoteStop());
  await expect(note).toHaveCount(0);
  await expect(page.locator('[data-e2e="saved"]').getByRole('link', { name: /Open board/ })).toHaveAttribute(
    'href',
    'https://vitrinka.test/acme/b/ext-1',
  );
  const faces = await page.evaluate(() =>
    (window as unknown as { calls: unknown[][] }).calls.filter((c) => c[0] === 'face').map((c) => c[1]),
  );
  // D7: the controller hears the stop's face, so it can hold its claim as `saved`.
  expect(faces).toEqual(expect.arrayContaining(['saving', 'saved']));
  expect(faces).not.toContain('confirm');
});

test('ONE recorder: a refused Start says why and offers no Retry; a second remote stop never runs a second save', async ({ page }) => {
  await page.goto(pageUrl);
  await page.evaluate(() => {
    (window as unknown as { refuse: string }).refuse = 'the Vitrinka extension is recording in another tab — stop it there first';
  });
  await page.getByRole('button', { name: 'Start recording' }).click();
  const failed = page.getByRole('alert');
  await expect(failed).toContainText('Already recording');
  // The full reason reaches a screen reader too (the tooltip is aria-hidden).
  await expect(failed).toContainText('the Vitrinka extension is recording in another tab — stop it there first');
  // D12: the refusal stays; a session that appears meanwhile (a resume) never turns it into a Stop's Retry.
  await page.evaluate(() => (window as unknown as { recordNow: () => void }).recordNow());
  await expect(failed.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await failed.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('button', { name: 'Recorder controls' })).toBeVisible();
  // D11: two remote stops in a row (a double click in the popup) are one save.
  await page.evaluate(() => {
    const w = window as unknown as { remoteStop: () => void };
    w.remoteStop();
    w.remoteStop();
  });
  await expect(page.locator('[data-e2e="saved"]').getByRole('link', { name: /Open board/ })).toBeVisible();
  const stops = await page.evaluate(() => (window as unknown as { calls: unknown[][] }).calls.filter((c) => c[0] === 'stop').length);
  expect(stops).toBe(1);
});
