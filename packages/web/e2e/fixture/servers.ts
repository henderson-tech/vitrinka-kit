/**
 * The e2e servers: a node:http page server for the fixture (bundled with
 * `bun build --format=iife` into a temp dir) and a second node:http
 * "vitrinka" stub that records every call to the doors it serves — the
 * device link, the policy, the session doors and `/recorder/me`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export interface Seen {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MePrefs {
  size: 'sm' | 'md' | 'lg';
  verbose: boolean;
}

export interface Servers {
  pageUrl: string;
  stubUrl: string;
  seen: Seen[];
  policy: { attachments?: boolean };
  /** What `/recorder/me` answers as the user's prefs (PATCH merges into it). */
  me: { prefs: MePrefs };
  /** Hold the next stop's PATCH done until released (the saving state stays visible). */
  holdStop: () => () => void;
  /**
   * Answer like the live server since rrweb stills (vitrinka D8): the board is
   * projected AFTER the stop, so neither the create nor the done carries its
   * link, and the session read says the projection is running — until the
   * returned `ready()`, after which every answer carries the board.
   */
  boardLater: () => () => void;
  close: () => Promise<void>;
}

function listen(server: Server, host = '127.0.0.1', port = 0): Promise<string> {
  return new Promise((res) => {
    server.listen(port, host, () => {
      const addr = server.address();
      res(typeof addr === 'object' && addr ? `http://${host}:${addr.port}` : '');
    });
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let s = '';
    req.on('data', (c: Buffer) => {
      s += c.toString();
    });
    req.on('end', () => res(s));
  });
}

function cors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, OPTIONS');
}

/** Bundle `entry` (relative to e2e/) into one IIFE script. */
function bundle(entry: string, tmp: string): string {
  const out = join(tmp, 'app.js');
  execFileSync(
    'bun',
    ['build', join(here, '..', entry), '--format=iife', '--outfile', out, '--define', 'process.env.NODE_ENV="development"'],
    { stdio: 'inherit', cwd: join(here, '..', '..') },
  );
  return readFileSync(out, 'utf8');
}

export async function startServers(entry = 'fixture/app.tsx', options: { host?: string; pagePort?: number; sameOrigin?: boolean } = {}): Promise<Servers> {
  const tmp = mkdtempSync(join(tmpdir(), 'vt-web-e2e-'));
  const script = bundle(entry, tmp);
  const seen: Seen[] = [];
  const policy: { attachments?: boolean } = { attachments: true };
  const me = { prefs: { size: 'md', verbose: false } as MePrefs };
  let claims = 0;
  let stubUrl = '';
  let stopGate: Promise<void> | null = null;
  let projecting = false;
  const board = () =>
    projecting ? { boardSlug: '' } : { boardSlug: 'fixture-session-1', boardUrl: `${stubUrl}/acme/b/fixture-session-1` };
  const projection = () => ({ state: projecting ? 'running' : 'ready' });

  const handleStub = async (req: IncomingMessage, res: ServerResponse) => {
    cors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const raw = await readBody(req);
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = String(v);
    const path = req.url ?? '';
    seen.push({ method: req.method ?? '', path, headers, body });
    res.setHeader('content-type', 'application/json');
    if (path === '/api/v1/cli/auth') {
      claims = 0;
      res.writeHead(201);
      return void res.end(JSON.stringify({ device_code: 'dc-e2e', user_code: 'WXYZ-1234', verify_path: '/link?c=WXYZ-1234', qr_path: '/link/qr?c=WXYZ-1234', interval: 2, expires_in: 600 }));
    }
    if (path === '/api/v1/cli/auth/claim') {
      if (++claims < 2) return void res.writeHead(202).end();
      return void res.end(JSON.stringify({ token: 'vkr_test', kind: 'recorder', workspace: 'acme', label: 'e2e', expires_in: 2592000 }));
    }
    if (path === '/api/v1/recorder/policy') return void res.end(JSON.stringify({ policy: null, ...policy }));
    if (path === '/api/v1/recorder/me') {
      // The fixture's baked key is an admin recorder key: no user, no server prefs.
      if (headers.authorization === 'Bearer vkr_e2e') {
        if (req.method === 'PATCH') return void res.writeHead(409).end('{"error":"key build"}');
        return void res.end(
          JSON.stringify({ kind: 'key', workspace: { slug: 'acme', name: 'ADF' }, user: null, project: 'fixture', label: 'e2e key', prefs: null }),
        );
      }
      if (req.method === 'PATCH') me.prefs = { ...me.prefs, ...((body as { prefs?: Partial<MePrefs> }).prefs ?? {}) };
      return void res.end(
        JSON.stringify({
          kind: 'linked',
          workspace: { slug: 'acme', name: 'ADF' },
          user: { email: 'lukas@henderson.tech', name: 'Lukáš' },
          project: null,
          label: 'Chrome on macOS',
          prefs: me.prefs,
        }),
      );
    }
    if (path === '/api/v1/sessions' && req.method === 'POST') {
      res.writeHead(201);
      return void res.end(
        JSON.stringify({
          id: 'sess-e2e',
          project: 'fixture',
          environment: 'development',
          title: (body as { title?: string }).title ?? '',
          workspace: 'acme',
          ...board(),
        }),
      );
    }
    if (path.includes('/shot?seq=')) return void res.end(JSON.stringify({ blobKey: `image-${path.split('seq=')[1]}` }));
    if (path.includes('/chunk?seq=')) return void res.end(JSON.stringify({ blobKey: `blob-${path.split('seq=')[1]}` }));
    if (path.endsWith('/events') || path.endsWith('/tags')) return void res.end('{}');
    if (req.method === 'PATCH') {
      if ((body as { status?: string })?.status === 'done' && stopGate) await stopGate;
      // The server's session shape: `boardUrl` only once a board exists, `projection` always.
      return void res.end(JSON.stringify({ id: 'sess-e2e', status: (body as { status?: string })?.status, ...board(), projection: projection() }));
    }
    if (req.method === 'GET') return void res.end(JSON.stringify({ maxSeq: 0, status: 'recording', ...board(), projection: projection() }));
    res.writeHead(404).end();
  };
  const stubServer = createServer(handleStub);
  stubUrl = await listen(stubServer);

  const pageServer = createServer((req, res) => {
    if (options.sameOrigin) {
      // Advertise the address the browser actually used, never the VM's
      // private bind address. The hand-test stub shares the page's origin.
      stubUrl = `http://${req.headers.host}`;
      if (req.url?.startsWith('/api/')) return void handleStub(req, res);
    }
    if (req.url === '/__events') {
      res.setHeader('content-type', 'application/json');
      return void res.end(JSON.stringify(seen));
    }
    if (req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript');
      return void res.end(script);
    }
    res.setHeader('content-type', 'text/html');
    const dark = (req.url ?? '').includes('dark');
    res.end(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixture</title>` +
        (dark ? '<style>html,body{background:#15171c;color:#e8e6e3}</style>' : '') +
        `</head><body>` +
        `<div id="root"></div>` +
        `<script>window.__VT_CFG=${JSON.stringify({ url: stubUrl, key: (req.url ?? '').includes('nokey') ? '' : 'vkr_e2e' })}</script>` +
        `<script src="/app.js"></script></body></html>`,
    );
  });
  const pageUrl = await listen(pageServer, options.host, options.pagePort);

  return {
    pageUrl,
    stubUrl,
    seen,
    policy,
    me,
    holdStop: () => {
      let release = () => undefined as void;
      stopGate = new Promise<void>((r) => {
        release = () => {
          stopGate = null;
          r();
        };
      });
      return release;
    },
    boardLater: () => {
      projecting = true;
      return () => {
        projecting = false;
      };
    },
    close: async () => {
      await new Promise((r) => pageServer.close(r));
      await new Promise((r) => stubServer.close(r));
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}
