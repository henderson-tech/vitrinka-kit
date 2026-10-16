/** Hand-test the Report a problem fixture that Playwright drives, on Devbox (app `report`). */
import { parseArgs } from 'node:util';

import { startReportServer } from './report-server';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '8081' },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid fixture port: ${port}`);
const server = await startReportServer({ host: values.host, port });
console.log(`Report a problem fixture: ${server.url} (also /?mount, /?nobutton)\nCaptured requests: ${server.url}/__events`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close();
  });
}
