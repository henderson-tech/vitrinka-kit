/**
 * The report wire (vitrinka `docs/architecture/qa-studio.md` § "The report
 * wire"), under `Authorization: Bearer <vkb_ key>`:
 *
 *   POST  /api/v1/reports                  envelope → {id, custody}
 *   PATCH /api/v1/reports/{id}             {title?, description?, markers?, notify?}
 *   POST  /api/v1/reports/{id}/chunk?seq=N raw rrweb event array (≤ 4 MiB, N from 1) → {blobKey}
 *   POST  /api/v1/reports/{id}/events      {events: [{seq, ts, tabHost, kind: "rrweb", payload, blobKey}]}
 *   POST  /api/v1/reports/{id}/submit      {} → {status: "filed" | "quarantined", reportUrl?}
 *
 * LEG-RESUMABLE: a job remembers which legs landed, so a retry resumes the
 * failed one — one report, never a duplicate. Text the reporter changed
 * after the report was created rides a PATCH. A capture leg the server
 * refuses for good (a permanent 4xx) is skipped with a warning: the report
 * still files, without its replay. `reportUrl` is the server's — shown as
 * returned, never composed.
 */
import { api, type ApiTarget, permanentStatus, uploadTo, VitrinkaApiError } from '../recorder/api';
import { type BuiltCapture, type ConsoleEntry, EVENTS_PER_POST, type NetEntry } from './engine';
import type { Locale, ReportKind } from './i18n';
import type { Identity } from './identity';
import type { WireMarker } from './markers';

export interface ReportEnv {
  /** Origin + path of the page, through the redaction engine; never a query. */
  url: string;
  ua: string;
  viewport: { w: number; h: number; dpr: number };
  appVersion: string;
  /** The browser's language. */
  locale: string;
}

export interface ReportEnvelope {
  title?: string;
  description: string;
  env: ReportEnv;
  console: ConsoleEntry[];
  network: NetEntry[];
  identity?: Identity;
  markers: WireMarker[];
  /** The widget's language (the reporter reads mail and the portal in it). */
  locale: Locale;
  notify?: boolean;
  /** The reporter's own word for it (vt-8020 D11), absent when they picked none. */
  type?: ReportKind;
}

export interface SubmitReply {
  status: 'filed' | 'quarantined';
  reportUrl?: string;
}

export class ReportJob {
  id = '';
  custody: 'direct' | 'quarantined' | '' = '';
  /** The editable fields as the server last received them. */
  private sent = '';
  private readonly blobKeys = new Map<number, string>();
  private rowsPosted = 0;
  private skipCapture = false;

  /** `target`: the widget's own base and key — never whatever another widget configured. */
  constructor(
    readonly capture: BuiltCapture,
    private readonly tabHost: string,
    private readonly target: ApiTarget,
  ) {}

  /** Run the legs from wherever the last run stopped; rejects with the failing leg's error. */
  async run(env: ReportEnvelope): Promise<SubmitReply> {
    const to = { target: this.target };
    const edits = { title: env.title, description: env.description, markers: env.markers, notify: env.notify ?? false };
    const editsKey = JSON.stringify(edits);
    if (!this.id) {
      const res = await api<{ id?: unknown; custody?: unknown }>('POST', '/api/v1/reports', env, to);
      if (typeof res.id !== 'string' || !res.id) throw new Error('vitrinka: the server filed the report without an id');
      this.id = res.id;
      this.custody = res.custody === 'direct' ? 'direct' : 'quarantined';
      this.sent = editsKey;
    } else if (this.sent !== editsKey) {
      await api('PATCH', `/api/v1/reports/${encodeURIComponent(this.id)}`, edits, to);
      this.sent = editsKey;
    }
    if (!this.skipCapture) {
      try {
        await this.sendCapture();
      } catch (e) {
        if (!(e instanceof VitrinkaApiError) || !permanentStatus(e.status)) throw e;
        console.warn('vitrinka: the server refused the recording — the report goes without it', e);
        this.skipCapture = true;
      }
    }
    const reply = await api<{ status?: unknown; reportUrl?: unknown }>('POST', `/api/v1/reports/${encodeURIComponent(this.id)}/submit`, {}, to);
    return {
      status: reply.status === 'filed' ? 'filed' : 'quarantined',
      ...(typeof reply.reportUrl === 'string' && reply.reportUrl ? { reportUrl: reply.reportUrl } : {}),
    };
  }

  private async sendCapture(): Promise<void> {
    const id = encodeURIComponent(this.id);
    const { chunks, truncated } = this.capture;
    for (const c of chunks) {
      if (this.blobKeys.has(c.seq)) continue;
      const up = await uploadTo(`/api/v1/reports/${id}/chunk?seq=${c.seq}`, 'application/json', c.body, this.target);
      if (!up.blobKey) throw new Error(`vitrinka: chunk ${c.seq} came back without a blob key`);
      this.blobKeys.set(c.seq, up.blobKey);
    }
    const rows = chunks.map((c) => ({
      seq: c.seq,
      ts: c.ts,
      tabHost: this.tabHost,
      kind: 'rrweb',
      payload: { count: c.count, source: 'replay', truncated },
      blobKey: this.blobKeys.get(c.seq) ?? '',
    }));
    while (this.rowsPosted < rows.length) {
      const batch = rows.slice(this.rowsPosted, this.rowsPosted + EVENTS_PER_POST);
      await api('POST', `/api/v1/reports/${id}/events`, { events: batch }, { target: this.target });
      this.rowsPosted += batch.length;
    }
  }
}
