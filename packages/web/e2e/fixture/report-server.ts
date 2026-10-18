/**
 * The Report a problem fixture: `build/report-widget.mjs` (built here) served
 * as vitrinka serves it — `/vendor/report-widget-1.mjs`, its rrweb recorder
 * at `/vendor/rrweb-record-1.min.js` — beside a stub of the report wire that
 * records every call, on one origin. Pages: `/` (the tag, English), `/?mount`
 * (`mountReport({locale: 'cs'})`, the handle on `window.report`),
 * `/?nobutton` (no button; the page's Help opens the card), and any of them
 * with `balanced` (the masking profile that keeps page text). `/__events`
 * lists the recorded calls. report.spec.ts drives it; report-serve.ts
 * leaves it running for hand-testing on the devbox (app `report`).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..', '..');

export const REPORT_URL = 'https://portal.vitrinka.test/voke/reports/rep-1?k=7';

export interface ReportSeen {
  method: string;
  path: string;
  auth: string;
  body: string;
}

export interface ReportServer {
  url: string;
  seen: ReportSeen[];
  /** The next `POST /api/v1/reports` answers 503 (a failed create). */
  failNextCreate: () => void;
  close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c: Buffer) => {
      s += c.toString();
    });
    req.on('end', () => resolve(s));
  });
}

const TABLE =
  '<h1>Settlement · September 2026</h1><table><thead><tr><th>Month</th><th>Energy shared</th><th>Your credit</th></tr></thead><tbody>' +
  ['September 2026', 'August 2026', 'August 2026', 'July 2026', 'June 2026']
    .map((m, i) => `<tr><td>${m}</td><td>${400 + i} kWh</td><td>${800 + i}.20 Kč</td></tr>`)
    .join('') +
  '</tbody></table><p>IBAN CZ65 0800 0000 1920 0014 5399</p>';

function page(query: string): string {
  const head = '<!doctype html><html><head><meta charset="utf-8"><title>Voke</title><style>body{font:16px system-ui;margin:40px}td,th{padding:10px 24px;text-align:left}</style></head><body>';
  if (query.includes('mount')) {
    // The npm-style call: mountReport with the locale option.
    return `${head}${TABLE}<script type="module">import { mountReport } from '/vendor/report-widget-1.mjs'; window.report = mountReport({ key: 'vkb_e2e', locale: 'cs' });</script></body></html>`;
  }
  // A host's own recorder bundle beside the standalone widget (claim-recorder.ts).
  const recorder = query.includes('recorder') ? '<script src="/claim-recorder.js"></script>' : '';
  // Host modals (`?dialog`), both mounted up front: window.openModal(id = 'modal') shows one with showModal().
  const modal = query.includes('dialog')
    ? '<dialog id="modal"><p>Edit settlement</p><button>Save</button></dialog><dialog id="second"><p>Confirm</p></dialog>' +
      '<script>window.openModal = (id = "modal") => document.getElementById(id).showModal()</script>'
    : '';
  const tag = query.includes('nobutton')
    ? '<button id="help">Help</button><vitrinka-report key="vkb_e2e" button="false" open-selector="#help"></vitrinka-report>'
    : '<vitrinka-report key="vkb_e2e" locale="en"></vitrinka-report>';
  return `${head}${TABLE}${modal}${tag}${recorder}<script type="module" src="/vendor/report-widget-1.mjs"></script></body></html>`;
}

/** Build the widget and the rrweb stand-in, then serve both and the stub on `host:port` (0 = any). */
export async function startReportServer(options: { host?: string; port?: number } = {}): Promise<ReportServer> {
  execFileSync('bun', ['run', 'build:report'], { stdio: 'inherit', cwd: pkg });
  const widget = readFileSync(join(pkg, 'build/report-widget.mjs'), 'utf8');
  const tmp = mkdtempSync(join(tmpdir(), 'vt-report-fixture-'));
  execFileSync('bun', ['build', join(here, 'rrweb-record.ts'), '--format=esm', '--target=browser', '--outfile', join(tmp, 'rrweb.mjs')], {
    stdio: 'inherit',
    cwd: pkg,
  });
  const rrweb = readFileSync(join(tmp, 'rrweb.mjs'), 'utf8');
  execFileSync('bun', ['build', join(here, 'claim-recorder.ts'), '--format=iife', '--target=browser', '--outfile', join(tmp, 'claim-recorder.js')], {
    stdio: 'inherit',
    cwd: pkg,
  });
  const claimRecorder = readFileSync(join(tmp, 'claim-recorder.js'), 'utf8');
  const seen: ReportSeen[] = [];
  let failCreate = false;

  const server = createServer(async (req, res) => {
    const path = req.url ?? '/';
    const body = await readBody(req);
    const js = (src: string) => {
      res.setHeader('content-type', 'text/javascript');
      res.end(src);
    };
    const json = (v: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    if (path === '/__events') return json(seen);
    seen.push({ method: req.method ?? 'GET', path, auth: String(req.headers.authorization ?? ''), body });
    if (path === '/vendor/report-widget-1.mjs') return js(widget);
    if (path === '/vendor/rrweb-record-1.min.js') return js(rrweb);
    if (path === '/claim-recorder.js') return js(claimRecorder);
    if (path === '/api/v1/report-config') {
      return json({
        project: 'voke',
        captureProfile: {
          storage: 'memory', windowSec: 300, maxBytes: 12 * 1024 * 1024, classes: ['interactions', 'console', 'network', 'errors'],
          // The capture profile's attachment caps (vt-8020 D9), where vitrinka serves them; a spec narrows them with page.route.
          attachments: { maxBytes: 10 * 1024 * 1024, maxCount: 5, types: ['image/*', 'application/pdf', 'text/*'] },
        },
        // A page opened with `?balanced` gets the profile that keeps page text.
        profile: String(req.headers.referer ?? '').includes('balanced') ? 'balanced' : 'strict',
        portalUrl: 'https://portal.vitrinka.test/voke',
        flightRecorder: true,
      });
    }
    if (path === '/api/v1/reports' && req.method === 'POST') {
      if (failCreate) {
        failCreate = false;
        return json({ error: 'unavailable' }, 503);
      }
      return json({ id: 'rep-1', custody: 'quarantined' }, 201);
    }
    const chunk = /^\/api\/v1\/reports\/rep-1\/chunk\?seq=(\d+)$/.exec(path);
    if (chunk) return json({ blobKey: `reports/rep-1/chunk-${chunk[1]}`, ok: true }, 201);
    // The attachment leg: one file, raw body under its own Content-Type (the recorded body is lossy for binaries).
    const file = /^\/api\/v1\/reports\/rep-1\/attachment\?name=([^&]+)$/.exec(path);
    if (file && req.method === 'POST') {
      const name = decodeURIComponent(file[1] ?? '');
      return json({ id: `att-${seen.length}`, name, size: Number(req.headers['content-length'] ?? 0), type: String(req.headers['content-type'] ?? '') }, 201);
    }
    if (path === '/api/v1/reports/rep-1/events') return json({ inserted: 1 });
    if (path === '/api/v1/reports/rep-1/submit') return json({ status: 'quarantined', reportUrl: REPORT_URL });
    if (path.startsWith('/api/')) return json({ error: 'not here' }, 404);
    res.setHeader('content-type', 'text/html');
    res.end(page(path));
  });
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((r) => server.listen(options.port ?? 0, host, r));
  const addr = server.address();
  const url = typeof addr === 'object' && addr ? `http://${host}:${addr.port}` : '';
  return {
    url,
    seen,
    failNextCreate: () => {
      failCreate = true;
    },
    close: async () => {
      await new Promise((r) => server.close(r));
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}
