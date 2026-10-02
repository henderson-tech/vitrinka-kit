/**
 * What the HUD says about a session, as plain strings: the sync chip, the
 * health line, the clock, ages and durations. Pure, so the wording is tested
 * without a DOM.
 */
import type { HudRecording, HudSync } from './controller';

export type SyncKind = 'synced' | 'sending' | 'offline' | 'error';

export interface SyncChip {
  kind: SyncKind;
  /** Reads without hovering: `synced`, `sending 12`, `offline · 40`, `ended`. */
  label: string;
  /** The longer sentence for a tooltip and screen readers. */
  title: string;
}

/**
 * Anything undelivered for this long reads as sending; below it the chip
 * stays on synced so a routine 2s flush never flickers it.
 */
export const SENDING_AFTER_MS = 4000;

export function syncChip(sync: HudSync, now: number): SyncChip {
  if (sync.state === 'dead')
    return { kind: 'error', label: 'ended', title: sync.deadReason || 'this session ended on the server' };
  if (sync.state === 'offline')
    return {
      kind: 'offline',
      label: `offline · ${sync.queued}`,
      title: `offline — ${sync.queued} held on this device, retrying; nothing is dropped`,
    };
  const stale = sync.lastSyncAt === null || now - sync.lastSyncAt > SENDING_AFTER_MS;
  if (sync.state === 'backlog' || (!sync.synced && sync.queued > 0 && stale))
    return { kind: 'sending', label: `sending ${sync.queued}`, title: `sending — ${sync.queued} not yet on vitrinka` };
  return { kind: 'synced', label: 'synced', title: 'everything captured is on vitrinka' };
}

/** The one-line health detail that opens by itself when something is wrong ('' = nothing to say). */
export function healthLine(sync: HudSync, now: number): string {
  if (sync.state === 'dead') return sync.deadReason || 'this session ended on the server';
  if (sync.state === 'offline') {
    const age = sync.lastSyncAt === null ? '' : ` ${fmtAge(now - sync.lastSyncAt)}`;
    return `offline${age} · ${sync.queued} held · retrying`;
  }
  return '';
}

export function elapsedOf(rec: HudRecording, now: number): number {
  return rec.activeMs + (rec.resumedAt === null ? 0 : Math.max(0, now - rec.resumedAt));
}

/** mm:ss, h:mm:ss past the hour. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** A compact duration: `42s`, `3m 12s`, `1h 04m`. */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** How long ago, compactly: `just now`, `12s`, `3m`, `2h`, `4d`. */
export function fmtAge(ms: number): string {
  if (ms < 5000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

/** `fmtAge` as a phrase: `just now`, `3m ago`. */
export function fmtAgo(ms: number): string {
  const a = fmtAge(ms);
  return a === 'just now' ? a : `${a} ago`;
}
