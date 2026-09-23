/**
 * The HUD's face (recorder-hud-subtle D1/D4). Idle: a 28px glass PUCK — a
 * hollow ring before the device is linked, a muted dot once it is — whose
 * label slides out on hover/focus. Recording: a CAPSULE of rec dot + timer
 * that unfolds into the TRAY (sync · ⏸ ✎ ⌖ ⋯, keycaps on hover) on hover,
 * focus or tap and folds back ~2.5s after the pointer and focus leave; a
 * one-line health detail unfolds only when something is wrong. Tucked: a 6px
 * edge TAB. The capsule handle, the puck and the tab are the drag handles.
 */
import { type Place, SPOTS, type Spot, untuck } from '@vitrinka/link/dock';
import { type FocusEvent, type PointerEvent, type ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { health, type RecorderHealth, type SessionState } from '../queue';
import { elapsedOf } from '../session';
import { AnnotateIcon, CheckIcon, CloseIcon, MoreIcon, NewTabIcon, PauseIcon, PencilIcon, PlayIcon, StopIcon } from './icons';
import { usePresence } from './layer';
import type { DockHandle } from './useDock';

export const MOD = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌥⇧' : 'Alt⇧';

/** How long the tray stays unfolded after the pointer and focus leave it. */
const FOLD_MS = 2500;
/** …and after a touch interaction inside it (no hover to keep it open). */
const FOLD_TOUCH_MS = 4000;

export const SPOT_NAMES: Record<Spot, string> = {
  tl: 'top left',
  tc: 'top centre',
  tr: 'top right',
  bl: 'bottom left',
  bc: 'bottom centre',
  br: 'bottom right',
};

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
  /** Something to authenticate with (an explicit key or a stored link). */
  linked: boolean;
  /** A stored link can be forgotten; an explicit key cannot. */
  canUnlink: boolean;
  place: Place;
  dragging: boolean;
  handle: DockHandle;
  onMove: (place: Place) => void;
  onLink: () => void;
  onUnlink: () => void;
  onStart: () => void;
  onPause: () => void;
  onNote: () => void;
  onAnnotate: () => void;
  onStop: () => void;
}

export function RecorderPill(p: RecorderPillProps): ReactElement {
  const [, tick] = useState(0);
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState(false);
  const fold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuP = usePresence(menu, 150);
  const hold = menu || p.composing || p.annotating;

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!p.rec) {
      setMenu(false);
      setOpen(false);
    }
  }, [p.rec]);

  const cancelFold = useCallback(() => clearTimeout(fold.current), []);
  // A hovering pointer or keyboard focus inside keeps the tray; a tap's
  // focus does not (touch has no "leave" to fold on).
  const foldIn = useCallback(
    (ms: number) => {
      cancelFold();
      fold.current = setTimeout(() => {
        if (!hovered.current && !barRef.current?.querySelector(':focus-visible')) setOpen(false);
      }, ms);
    },
    [cancelFold],
  );
  useEffect(() => cancelFold, [cancelFold]);
  // A drag folds everything; a held tray (menu, sheet, annotate) never folds,
  // and folds on the usual delay once the hold ends and nothing keeps it.
  useEffect(() => {
    if (p.dragging) {
      cancelFold();
      setMenu(false);
      setOpen(false);
    }
  }, [p.dragging, cancelFold]);
  useEffect(() => {
    if (hold) cancelFold();
    else if (open) foldIn(FOLD_MS);
  }, [hold, open, cancelFold, foldIn]);
  // Folded tools are out of the tab order and the accessibility tree
  // (imperative: React 18 and 19 disagree on the `inert` prop).
  const trayRef = useRef<HTMLDivElement>(null);
  const unfolded = open || hold;
  useLayoutEffect(() => {
    if (trayRef.current) trayRef.current.inert = !unfolded;
  });
  // Hover is read with NATIVE pointerenter/leave: React synthesises enter
  // from over/out pairs and drops an `over` whose related target belongs to
  // any React root — on a React page the pointer always arrives from the
  // app's own tree, so a synthetic onPointerEnter never fires on the HUD.
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const hasBar = p.rec !== null && !('tuck' in p.place);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    // The capsule often appears UNDER a resting pointer (it replaces the
    // puck that was just clicked): that pointer never "enters", so seed it.
    if (bar.matches(':hover')) {
      hovered.current = true;
      setOpen(true);
    }
    const enter = (e: globalThis.PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      hovered.current = true;
      cancelFold();
      setOpen(true);
    };
    const leave = (e: globalThis.PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      hovered.current = false;
      if (!holdRef.current) foldIn(FOLD_MS);
    };
    bar.addEventListener('pointerenter', enter);
    bar.addEventListener('pointerleave', leave);
    return () => {
      bar.removeEventListener('pointerenter', enter);
      bar.removeEventListener('pointerleave', leave);
    };
  }, [hasBar, cancelFold, foldIn]);

  // The menu closes on Esc (focus back on ⋯) and on a press anywhere else.
  useEffect(() => {
    if (!menu) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setMenu(false);
      moreRef.current?.focus();
    };
    const down = (e: Event) => {
      if (!e.composedPath().includes(barRef.current as EventTarget)) setMenu(false);
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', down, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', down, true);
    };
  }, [menu]);

  if ('tuck' in p.place) {
    const h = p.rec ? healthLine(health(), p.stopping) : null;
    return (
      <button
        type="button"
        className="tab"
        aria-label="Show recorder"
        data-state={h?.bad ? 'bad' : p.rec && !p.rec.paused ? 'rec' : 'idle'}
        {...p.handle}
        onClick={() => p.onMove({ spot: untuck(p.place) })}
      />
    );
  }

  if (!p.rec) {
    const unlinked = !p.linked;
    const label = unlinked ? 'Link recorder' : 'Start recording';
    return (
      <button
        type="button"
        className="puck glass"
        data-state={unlinked ? 'unlinked' : p.starting ? 'busy' : 'ready'}
        aria-label={label}
        onClick={unlinked ? p.onLink : p.onStart}
        disabled={p.starting}
        {...p.handle}
      >
        <span className="ring" />
        <span className="lab" aria-hidden="true">
          <span>{label}</span>
        </span>
      </button>
    );
  }

  const rec = p.rec;
  const hl = healthLine(health(), p.stopping);
  const state = hl.bad ? 'bad' : rec.paused || rec.dead || p.stopping ? 'paused' : 'rec';
  const current = 'spot' in p.place ? p.place.spot : null;
  const origin = `${current?.[0] === 't' ? 'top' : 'bottom'}-${current?.[1] === 'r' ? 'right' : 'left'}`;

  const onTouch = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && open) foldIn(FOLD_TOUCH_MS);
  };
  // Keyboard focus unfolds; a tap's focus is left to the tap's own toggle.
  const onFocus = (e: FocusEvent) => {
    if (!(e.target as Element).matches(':focus-visible')) return;
    cancelFold();
    setOpen(true);
  };
  const onBlur = (e: FocusEvent) => {
    if (barRef.current?.contains(e.relatedTarget as Node | null)) return;
    if (!hold) foldIn(FOLD_MS);
  };
  const toggle = () => {
    setOpen((o) => !o);
    foldIn(FOLD_TOUCH_MS);
  };
  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  return (
    <>
      <div
        ref={barRef}
        className={p.composing ? 'bar glass composing' : 'bar glass'}
        data-e2e="recorder-pill"
        data-state={state}
        data-open={unfolded ? '' : undefined}
        onPointerDown={onTouch}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <button type="button" className="handle" aria-label="Recorder controls" aria-expanded={unfolded} onClick={toggle} {...p.handle}>
          <span className="dot" />
          <span className="time">{fmtClock(elapsedOf(rec))}</span>
        </button>
        <div ref={trayRef} className="tray">
          <div className="tray-in">
            <span className="sep" />
            <span className={`sync${hl.cls ? ' ' + hl.cls : ''}`} title="everything captured has reached vitrinka">
              {hl.glyph}
            </span>
            <button type="button" className="tb b-pause" aria-label={rec.paused ? 'Resume' : 'Pause'} onClick={p.onPause}>
              {rec.paused ? <PlayIcon /> : <PauseIcon />}
              <kbd>
                {MOD}P {rec.paused ? 'resume' : 'pause'}
              </kbd>
            </button>
            <button type="button" className="tb b-note" aria-label="Note" onClick={p.onNote}>
              <PencilIcon />
              <kbd>{MOD}N note</kbd>
            </button>
            <button
              type="button"
              className={p.annotating ? 'tb b-annotate on' : 'tb b-annotate'}
              aria-label="Annotate"
              aria-pressed={p.annotating}
              onClick={p.onAnnotate}
            >
              <AnnotateIcon />
              <kbd>{MOD}A annotate</kbd>
            </button>
            <button
              ref={moreRef}
              type="button"
              className="tb b-more"
              aria-label="More"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
            >
              <MoreIcon />
            </button>
          </div>
        </div>
        {menuP.mounted ? (
          <div className={`menu grow ${menuP.cls}`} data-origin={origin} role="menu" aria-label="Recorder">
            {rec.boardUrl ? (
              <button type="button" role="menuitem" onClick={act(() => window.open(rec.boardUrl, '_blank', 'noopener'))}>
                <NewTabIcon /> Open board
              </button>
            ) : null}
            <button type="button" role="menuitem" className="danger" onClick={act(p.onStop)}>
              <StopIcon /> Stop recording
            </button>
            {p.canUnlink ? (
              <button type="button" role="menuitem" onClick={act(p.onUnlink)}>
                <CloseIcon /> Unlink
              </button>
            ) : null}
            <div className="moveto" role="group" aria-label="Move to">
              <span aria-hidden="true">Move to</span>
              <span className="spots">
                {SPOTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current === s}
                    aria-label={`Move to ${SPOT_NAMES[s]}`}
                    onClick={act(() => p.onMove({ spot: s }))}
                  />
                ))}
              </span>
            </div>
          </div>
        ) : null}
      </div>
      <div className={['detail', hl.line ? 'show' : '', hl.bad ? 'bad' : ''].filter(Boolean).join(' ')} aria-hidden={!hl.line}>
        {hl.line}
      </div>
    </>
  );
}
