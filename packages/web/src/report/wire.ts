/**
 * The report wire (vitrinka `docs/architecture/qa-studio.md` § "The report
 * wire"), under `Authorization: Bearer <vkb_ key>`:
 *
 *   POST  /api/v1/reports                  envelope → {id, custody, memberError?}
 *   PATCH /api/v1/reports/{id}             {title?, description?, markers?, notify?}
 *   POST  /api/v1/reports/{id}/attachment?name=<name>
 *                                          one file, raw body under its own Content-Type → {id, name, size, type}
 *   POST  /api/v1/reports/{id}/chunk?seq=N raw rrweb event array (≤ 4 MiB, N from 1) → {blobKey}
 *   POST  /api/v1/reports/{id}/events      {events: [{seq, ts, tabHost, kind: "rrweb", payload, blobKey}]}
 *   POST  /api/v1/reports/{id}/submit      {} → {status: "filed" | "quarantined", reportUrl?}
 *
 * LEG-RESUMABLE: a job remembers which legs landed — each file, each chunk —
 * so a retry resumes the failed one: one report, never a duplicate, never a
 * file twice. Text the reporter changed after the report was created rides a
 * PATCH. A file or a capture leg the server refuses for good (a permanent
 * 4xx) is skipped with a warning: the report still files, without it. The
 * reporter's files go before the replay — they are what they chose to send.
 * `reportUrl` is the server's — shown as returned, never composed.
 *
 * EVERY LEG HAS A DEADLINE (`deadline`): a request nothing answers — a server
 * stuck in a handler, a proxy or connection holding it — rejects like a
 * dropped connection, so the card shows Try again instead of "Sending…"
 * forever. An upload's allowance grows with its bytes at a slow uplink's
 * pace, so only a stalled one runs out. A create whose answer was lost after
 * the server stored it is created again by Try again: the same risk a dropped
 * connection already carries.
 *
 * OPTIONAL FIELDS NEVER COST THE REPORT: a vitrinka older than a field refuses
 * it by name (400, `unknown field "<name>"`), and the create goes again without
 * each optional field it names — `type`, `memberToken` — once. `memberToken`
 * proves this browser's vitrinka member link (vt-8020), so the member co-owns
 * the report; `memberError` says the server did not take it, and the report
 * files regardless.
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
  /** The vitrinka member link this browser holds for the widget's base (face.ts memberTokenFor), absent without one: the member co-owns the report. */
  memberToken?: string;
}

export interface SubmitReply {
  status: 'filed' | 'quarantined';
  reportUrl?: string;
}

/**
 * Hears the create's `memberError` — the server did not take the member link
 * it carried (revoked, another workspace, no longer a member) — with that
 * link's token, once, as soon as the create answers.
 */
export type MemberRefusal = (error: string, sent: string) => void;

/**
 * The top-level field a vitrinka refused as unknown — a 400 whose body names
 * it (`json: unknown field "<name>"`, its quotes escaped once more inside the
 * JSON error) — else ''. A field merely listed among the accepted ones is
 * never it.
 */
export function refusedField(e: unknown): string {
  if (!(e instanceof VitrinkaApiError) || e.status !== 400) return '';
  return /unknown field \\?"(\w+)\\?"/.exec(e.message)?.[1] ?? '';
}

/** How long a leg may go unanswered: `ms` for any leg, plus one ms per `bytesPerMs` bytes an upload carries. */
export interface LegLimits {
  ms: number;
  bytesPerMs: number;
}

/** 30 s for a JSON leg; an upload adds its bytes at 32 KiB/s (≈ 256 kbit/s), so a 10 MiB file gets about six minutes. */
export const LEG_LIMITS: LegLimits = { ms: 30_000, bytesPerMs: 32 };

/** A leg ran past its deadline: retryable, never a refusal for good. */
export class LegTimeout extends Error {
  constructor(what: string, ms: number) {
    super(`vitrinka: ${what} got no answer in ${Math.round(ms / 1000)} s — Try again resumes it`);
    this.name = 'LegTimeout';
  }
}

/**
 * Run `work` under a deadline: past `ms` its signal aborts (the fetch and its
 * answer's body stop) and the returned promise rejects with LegTimeout —
 * whether or not `work` honours the signal, so nothing waits on it forever.
 */
export async function deadline<T>(what: string, ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new LegTimeout(what, ms);
      ctl.abort(e);
      reject(e);
    }, ms);
  });
  try {
    return await Promise.race([work(ctl.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** What a report carries when its capture could not be prepared. */
export const EMPTY_CAPTURE: BuiltCapture = { chunks: [], truncated: false, console: [], network: [] };

/**
 * The capture a report sends, under its deadline like every leg (reading an
 * earlier load's stored windows can hang): past it, or failed, the report
 * goes without one. A build that finishes later is dropped — it never
 * reaches the job this answer started.
 */
export function prepareCapture(build: () => Promise<BuiltCapture>, ms: number = LEG_LIMITS.ms): Promise<BuiltCapture> {
  return deadline('preparing the capture', ms, build).catch((e: unknown) => {
    console.warn('vitrinka: the capture could not be prepared — the report goes without it', e);
    return EMPTY_CAPTURE;
  });
}

export class ReportJob {
  id = '';
  custody: 'direct' | 'quarantined' | '' = '';
  /** The editable fields as the server last received them. */
  private sent = '';
  private readonly blobKeys = new Map<number, string>();
  private rowsPosted = 0;
  private skipCapture = false;
  /** The files (by index) the server has — landed or refused for good. */
  private readonly filesDone = new Set<number>();

  /** `target`: the widget's own base and key — never whatever another widget configured. `files`: the reporter's attachments, fixed for the job. */
  constructor(
    readonly capture: BuiltCapture,
    private readonly tabHost: string,
    private readonly target: ApiTarget,
    readonly files: readonly File[] = [],
    private readonly limits: LegLimits = LEG_LIMITS,
  ) {}

  /** One JSON call under its leg deadline. */
  private call<T = Record<string, unknown>>(method: string, path: string, body: unknown): Promise<T> {
    return deadline(`${method} ${path}`, this.limits.ms, (signal) => api<T>(method, path, body, { target: this.target, signal }));
  }

  /** One upload under a deadline that grows with its bytes. */
  private upload(path: string, contentType: string, body: string | Blob): Promise<{ blobKey?: string }> {
    // The bytes fetch sends: a JSON chunk's UTF-8, never its UTF-16 length (non-ASCII text runs up to 3× longer).
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.size;
    const ms = this.limits.ms + Math.ceil(bytes / this.limits.bytesPerMs);
    return deadline(`POST ${path}`, ms, (signal) => uploadTo(path, contentType, body, this.target, signal));
  }

  /** A file has not landed yet: the attachment leg is what a retry resumes. */
  get filesPending(): boolean {
    return this.filesDone.size < this.files.length;
  }

  /**
   * Run the legs from wherever the last run stopped; rejects with the failing
   * leg's error. `onMemberRefusal` hears the create's `memberError` the moment
   * the create answers, so a later leg failing never holds it back.
   */
  async run(env: ReportEnvelope, onMemberRefusal?: MemberRefusal): Promise<SubmitReply> {
    const edits = { title: env.title, description: env.description, markers: env.markers, notify: env.notify ?? false };
    const editsKey = JSON.stringify(edits);
    if (!this.id) {
      const { res, memberSent } = await this.create(env);
      if (typeof res.id !== 'string' || !res.id) throw new Error('vitrinka: the server filed the report without an id');
      this.id = res.id;
      this.custody = res.custody === 'direct' ? 'direct' : 'quarantined';
      this.sent = editsKey;
      if (typeof res.memberError === 'string' && res.memberError) onMemberRefusal?.(res.memberError, memberSent);
    } else if (this.sent !== editsKey) {
      await this.call('PATCH', `/api/v1/reports/${encodeURIComponent(this.id)}`, edits);
      this.sent = editsKey;
    }
    await this.sendFiles();
    if (!this.skipCapture) {
      try {
        await this.sendCapture();
      } catch (e) {
        if (!(e instanceof VitrinkaApiError) || !permanentStatus(e.status)) throw e;
        console.warn('vitrinka: the server refused the recording — the report goes without it', e);
        this.skipCapture = true;
      }
    }
    const reply = await this.call<{ status?: unknown; reportUrl?: unknown }>('POST', `/api/v1/reports/${encodeURIComponent(this.id)}/submit`, {});
    return {
      status: reply.status === 'filed' ? 'filed' : 'quarantined',
      ...(typeof reply.reportUrl === 'string' && reply.reportUrl ? { reportUrl: reply.reportUrl } : {}),
    };
  }

  /**
   * The create leg, answering with the member link the accepted body carried
   * ('' none). A vitrinka older than an optional field refuses it by name;
   * the reporter's word (`type`) and the member link (`memberToken`) are
   * optional, the report is not, so it goes again without each field named,
   * once. A refusal naming nothing still in the body fails the leg.
   */
  private async create(env: ReportEnvelope): Promise<{ res: { id?: unknown; custody?: unknown; memberError?: unknown }; memberSent: string }> {
    let body = env;
    for (;;) {
      try {
        const res = await this.call<{ id?: unknown; custody?: unknown; memberError?: unknown }>('POST', '/api/v1/reports', body);
        return { res, memberSent: body.memberToken ?? '' };
      } catch (e) {
        const field = refusedField(e);
        if (field === 'type' && body.type !== undefined) {
          console.warn('vitrinka: this server takes no report type yet — sending the report without it');
          const { type: _dropped, ...rest } = body;
          body = rest;
        } else if (field === 'memberToken' && body.memberToken !== undefined) {
          console.warn('vitrinka: this server takes no member link yet — sending the report without it');
          const { memberToken: _dropped, ...rest } = body;
          body = rest;
        } else {
          throw e;
        }
      }
    }
  }

  private async sendFiles(): Promise<void> {
    const id = encodeURIComponent(this.id);
    for (const [i, f] of this.files.entries()) {
      if (this.filesDone.has(i)) continue;
      try {
        await this.upload(`/api/v1/reports/${id}/attachment?name=${encodeURIComponent(f.name)}`, f.type || 'application/octet-stream', f);
      } catch (e) {
        if (!(e instanceof VitrinkaApiError) || !permanentStatus(e.status)) throw e;
        console.warn(`vitrinka: the server refused ${f.name} — the report goes without it`, e);
      }
      this.filesDone.add(i);
    }
  }

  private async sendCapture(): Promise<void> {
    const id = encodeURIComponent(this.id);
    const { chunks, truncated } = this.capture;
    for (const c of chunks) {
      if (this.blobKeys.has(c.seq)) continue;
      const up = await this.upload(`/api/v1/reports/${id}/chunk?seq=${c.seq}`, 'application/json', c.body);
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
      await this.call('POST', `/api/v1/reports/${id}/events`, { events: batch });
      this.rowsPosted += batch.length;
    }
  }
}
