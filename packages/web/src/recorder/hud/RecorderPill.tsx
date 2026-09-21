/**
 * The pill — the extension's HUD: rec dot · timer · name · sync glyph ·
 * ⏸ ✎ ⌖ with keycaps on hover (⌥⇧P / ⌥⇧N / ⌥⇧A on Apple platforms, Alt⇧
 * elsewhere), a ⋯ menu (Open board · Stop), and a one-line health detail
 * that unfolds only when something is wrong. Idle (no session): a quiet grip
 * that starts a recording.
 */
import { type ReactElement, useEffect, useState } from 'react';

import { health, type RecorderHealth, type SessionState } from '../queue';
import { elapsedOf } from '../session';
import { AnnotateIcon, CheckIcon, MoreIcon, NewTabIcon, PauseIcon, PencilIcon, PlayIcon, StopIcon } from './icons';

export const MOD = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌥⇧' : 'Alt⇧';

function fmtAge(ms: number): string {
  return ms < 1000 ? 'just now' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`;
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The extension's renderHealth: glyph + class + optional detail line. */
export function healthLine(h: RecorderHealth, stopping: boolean): { glyph: ReactElement | string; cls: string; line: string; bad: boolean } {
  if (stopping) return { glyph: '⟳', cls: 'busy', line: `wrapping up · ${h.queued} left`, bad: false };
  switch (h.state) {
    case 'offline':
      return {
        glyph: '⚠',
        cls: 'bad',
        line: `offline${h.sinceSyncMs ? ' ' + fmtAge(h.sinceSyncMs) : ''} · ${h.queued} held · retrying`,
        bad: true,
      };
    case 'dead':
      return { glyph: '⛔', cls: 'bad', line: h.deadReason || 'this session ended on the server', bad: true };
    case 'backlog':
      return { glyph: '⟳', cls: 'busy', line: `syncing · ${h.queued} queued`, bad: false };
    default:
      return { glyph: h.synced ? <CheckIcon /> : '·', cls: '', line: '', bad: false };
  }
}

export interface RecorderPillProps {
  rec: SessionState | null;
  composing: boolean;
  annotating: boolean;
  stopping: boolean;
  starting: boolean;
  onStart: () => void;
  onPause: () => void;
  onNote: () => void;
  onAnnotate: () => void;
  onStop: () => void;
}

export function RecorderPill(p: RecorderPillProps): ReactElement {
  const [, tick] = useState(0);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!p.rec) setMenu(false);
  }, [p.rec]);

  if (!p.rec) {
    return (
      <div className="stack">
        <button
          type="button"
          className={p.starting ? 'grip busy' : 'grip'}
          aria-label="Start recording"
          title="Start a vitrinka recording"
          onClick={p.onStart}
          disabled={p.starting}
        >
          <span className="dot" />
        </button>
      </div>
    );
  }

  const rec = p.rec;
  const h = health();
  const hl = healthLine(h, p.stopping);
  const paused = rec.paused || rec.dead || p.stopping;
  const cls = ['pill', paused ? 'paused' : '', p.composing ? 'composing' : ''].filter(Boolean).join(' ');
  return (
    <div className="stack">
      <div className={cls} data-e2e="recorder-pill">
        <span className="dot" />
        <span className="time">{fmtClock(elapsedOf(rec))}</span>
        <span className="name">{rec.title || `${rec.project} · ${rec.environment}`}</span>
        <span className={`sync${hl.cls ? ' ' + hl.cls : ''}`} title="everything captured has reached vitrinka">
          {hl.glyph}
        </span>
        <button type="button" className="b-pause" aria-label={rec.paused ? 'Resume' : 'Pause'} onClick={p.onPause}>
          {rec.paused ? <PlayIcon /> : <PauseIcon />}
          <kbd>{MOD}P {rec.paused ? 'resume' : 'pause'}</kbd>
        </button>
        <button type="button" className="b-note" aria-label="Note" onClick={p.onNote}>
          <PencilIcon />
          <kbd>{MOD}N note</kbd>
        </button>
        <button
          type="button"
          className={p.annotating ? 'snap b-snap on' : 'snap b-snap'}
          aria-label="Annotate"
          aria-pressed={p.annotating}
          onClick={p.onAnnotate}
        >
          <AnnotateIcon />
          <kbd>{MOD}A annotate</kbd>
        </button>
        <span className="menuwrap">
          <button type="button" className="b-more" aria-label="More" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <MoreIcon />
          </button>
          {menu ? (
            <div className="menu" role="menu">
              {rec.boardUrl ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    window.open(rec.boardUrl, '_blank', 'noopener');
                  }}
                >
                  <NewTabIcon /> Open board
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  setMenu(false);
                  p.onStop();
                }}
              >
                <StopIcon /> Stop recording
              </button>
            </div>
          ) : null}
        </span>
      </div>
      <div className={['detail', hl.line ? 'show' : '', hl.bad ? 'bad' : ''].filter(Boolean).join(' ')}>{hl.line}</div>
    </div>
  );
}
