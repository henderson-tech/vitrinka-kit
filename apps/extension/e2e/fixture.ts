// Synthetic-only recorder backend: never forwards requests or serves source files.
const portArg = process.argv.indexOf('--port');
const sessions = new Map<number, { id: number; workspace: string; project: string; title: string; startedAt: string; status: string; maxSeq: number; boardUrl: string }>();
type WireEvent = { seq: number; kind: string; payload?: unknown; blobKey?: string };
const events: { sessionId: number; body: { events?: WireEvent[] } }[] = [];
const chunks: { sessionId: number; body: unknown }[] = [];
// Every /shot upload — screenshots and tester attachments share the leaf.
const shots: { sessionId: number; seq: number; contentType: string; bytes: number }[] = [];
// Recorder attachments: each `attachment` event beside the /shot upload that
// carried its bytes (null until that upload lands).
const attachments = () => events.flatMap(({ sessionId, body }) => (body.events || [])
  .filter((event) => event.kind === 'attachment')
  .map((event) => ({ sessionId, event, upload: shots.find((s) => s.sessionId === sessionId && s.seq === event.seq) ?? null })));
let mode = 'default';
let nextId = 1;
const html = `<!doctype html><html><head><title>Recorder privacy fixture</title></head><body>
<h1>Recorder privacy fixture</h1><p>Only synthetic data. No production credentials.</p>
<label>Private field<input aria-label="Private field" value="fixture-input-private"></label>
<label>Private note<textarea aria-label="Private note">fixture-textarea-private</textarea></label>
<label>Choice<select aria-label="Choice"><option>fixture-option-private</option></select></label>
<p class="rr-mask">fixture-region-private</p><button>Save</button><button id="network">Send synthetic requests</button>
<script>document.querySelector('#network').onclick=async()=>{
await fetch('/target?token=fixture-query-private',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer fixture-header-private'},body:JSON.stringify({password:'fixture-json-private',note:'visible'})});
await fetch('/target',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'password=fixture-form-private&note=visible'});
const f=new FormData();f.set('password','fixture-multipart-private');f.set('note','visible');await fetch('/target',{method:'POST',body:f});
console.error('password=fixture-console-private');
};</script></body></html>`;
const server = Bun.serve({
  hostname: '0.0.0.0', port: portArg < 0 ? 8080 : Number(process.argv[portArg + 1]),
  async fetch(req) {
    const url = new URL(req.url);
    const json = (body: unknown, status = 200) => Response.json(body, { status });
    if (url.pathname === '/') return new Response(html, { headers: { 'content-type': 'text/html' } });
    if (url.pathname === '/target') return json({ password: 'fixture-response-private', note: 'visible' });
    if (url.pathname === '/__qa/mode' && req.method === 'POST') { mode = String((await req.json()).mode); return json({ mode }); }
    if (url.pathname === '/__qa/state') return json({ mode, sessions: [...sessions.values()], events, chunks, shots, attachments: attachments() });
    if (url.pathname === '/__qa/store.zip') {
      const file = Bun.file(new URL('../../../dist/webstore/vitrinka-recorder-store-0.10.0.zip', import.meta.url));
      return await file.exists() ? new Response(file) : json({ error: 'Package the store build first' }, 404);
    }
    if (url.pathname === '/api/v1/recorder/resolve') return json({ workspace: 'qa', project: 'synthetic' });
    if (url.pathname === '/api/v1/recorder/policy') {
      if (mode === 'failed') return json({ error: 'synthetic failure' }, 503);
      // `legacy` answers like a server from before recorder attachments: no `attachments` field.
      return json({ policy: mode === 'strict' ? { maskAllText: true } : mode === 'full' ? { fullFidelity: true } : null, ...(mode === 'legacy' ? {} : { attachments: true }) });
    }
    if (url.pathname === '/api/v1/recorder/me') return json({ prefs: {}, projects: [], user: { name: 'Synthetic QA' } });
    if (url.pathname === '/api/v1/sessions' && req.method === 'POST') {
      const body = await req.json();
      const session = { id: nextId++, workspace: 'qa', project: 'synthetic', title: String(body.title || 'QA'), startedAt: new Date().toISOString(), status: 'recording', maxSeq: 0, boardUrl: '' };
      sessions.set(session.id, session); return json(session);
    }
    const match = /^\/api\/v1\/sessions\/(\d+)(?:\/(.*))?$/.exec(url.pathname);
    if (match) {
      const id = Number(match[1]); const session = sessions.get(id);
      if (!session) return json({ error: 'Synthetic session not found' }, 404);
      if (!match[2]) {
        if (req.method === 'PATCH') {
          const body = await req.json(); session.status = body.status;
          if (session.status === 'done') setTimeout(() => { session.boardUrl = url.origin + '/__qa/board/' + id; }, 1200);
        }
        return json(session);
      }
      if (match[2] === 'events') {
        const body = await req.json(); events.push({ sessionId: id, body });
        for (const event of body.events || []) session.maxSeq = Math.max(session.maxSeq, Number(event.seq));
        return json({ ok: true });
      }
      if (match[2] === 'chunk') { chunks.push({ sessionId: id, body: await req.json() }); return json({ blobKey: 'synthetic-chunk-' + url.searchParams.get('seq') }); }
      if (match[2] === 'shot') {
        const seq = Number(url.searchParams.get('seq'));
        shots.push({ sessionId: id, seq, contentType: req.headers.get('content-type') || '', bytes: (await req.arrayBuffer()).byteLength });
        return json({ blobKey: 'synthetic-shot-' + seq });
      }
      if (match[2] === 'pair') return json({ items: [], replies: [] });
    }
    if (url.pathname.startsWith('/__qa/board/')) return new Response('Synthetic recording saved');
    return json({ error: 'Unknown synthetic fixture route' }, 404);
  },
});
console.log(`Recorder privacy fixture listening on ${server.port}`);
