/** Hand-test the same recorder fixture that Playwright drives, on Devbox. */
import { parseArgs } from 'node:util';

import { startServers } from './servers';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '8080' },
  },
});
const pagePort = Number(values.port);
if (!Number.isInteger(pagePort) || pagePort < 1 || pagePort > 65535) throw new Error(`Invalid fixture port: ${pagePort}`);
const servers = await startServers('fixture/app.tsx', { host: values.host, pagePort, sameOrigin: true });
console.log(`Recorder fixture: ${servers.pageUrl}\nCaptured requests: ${servers.pageUrl}/__events`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void servers.close(); });
}
