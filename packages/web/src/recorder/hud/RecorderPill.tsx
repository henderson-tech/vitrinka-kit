/**
 * The HUD's face: ONE glass pill whose faces are collapsible segments, so a
 * change of face tweens the pill's size instead of swapping boxes.
 *
 * - Idle: a puck — a hollow ring before the device is linked, a muted dot
 *   once it is — whose label (and the ⋯ menu button) slide out on intent.
 * - Recording: the handle (rec dot + clock) that unfolds into the tray
 *   (sync chip · ⏸ ✎ ⌖ ■ ⋯) on hover, focus or tap and folds back ~2.5s
 *   after the pointer and focus leave. On the middle row it stands up into a
 *   vertical pill (a measured morph, see useMorph).
 * - Flows (flow.ts): the pill itself asks "Stop & save?" / "Unlink this
 *   device?", spins while saving, says "Saved · Open board" until dismissed,
 *   or says why it could not save (a bug report: "Sending…", "Sent",
 *   "Couldn't send"). Always horizontal.
 * - Tucked: a 6px edge tab.
 * The handle, the puck and the tab are the drag handles. Tooltips are
 * `data-tip` / `data-keys` on the triggers (Tooltip.tsx paints them).
 */
import {
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { HudRecording, HudSnapshot } from './controller';
import type { Flow } from './flow';
import { saveProgress } from './flow';
import {
  AlertIcon,
  AnnotateIcon,
  CheckIcon,
  CloseIcon,
  CircleCheckIcon,
  CloudOffIcon,
  MoreIcon,
  NewTabIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  SpinnerIcon,
  StopIcon,
  ArrowUpIcon,
} from './icons';
import { isVertical, type Place, untuck } from './spots';
import { elapsedOf, fmtClock, type SyncChip, syncChip } from './status';
import type { DockHandle } from './useDock';

export const MOD = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌥⇧' : 'Alt⇧';

/** How long the tray stays unfolded after the pointer and focus leave it. */
const FOLD_MS = 2500;
/** …and after a touch interaction inside it (no hover to keep it open). */
const FOLD_TOUCH_MS = 4000;
/** The orientation morph (a resize: `--duration-resize`). */
const MORPH_MS = 300;

export type Face = 'tab' | 'idle' | 'rec' | 'flow';

/** Which face the pill shows. A flow wins over the recording it belongs to. */
export function faceOf(snap: HudSnapshot, flow: Flow, place: Place): Face {
  if ('tuck' in place) return 'tab';
  if (flow.face !== 'none') return 'flow';
  return snap.recording ? 'rec' : 'idle';
}

function reducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * The orientation morph: when `orient` flips, tween the pill from its last
 * measured size to its new one, with the inner segments' own tweens held
 * (`.morphing`) so the target is the settled size, then fade the content in.
 */
function useMorph(ref: RefObject<HTMLDivElement | null>, orient: 'h' | 'v'): void {
  const size = useRef<{ w: number; h: number } | null>(null);
  const prev = useRef(orient);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const was = size.current;
    const flipped = prev.current !== orient;
    prev.current = orient;
    if (flipped && was && !reducedMotion() && typeof el.animate === 'function') {
      for (const a of el.getAnimations()) a.cancel();
      el.classList.add('morphing');
      const next = { w: el.offsetWidth, h: el.offsetHeight };
      size.current = next;
      const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
      const morph = el.animate(
        [
          { width: `${was.w}px`, height: `${was.h}px` },
          { width: `${next.w}px`, height: `${next.h}px` },
        ],
        { duration: MORPH_MS, easing: ease },
      );
      for (const seg of el.querySelectorAll<HTMLElement>('.seg.on > .seg-in')) {
        seg.animate([{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0)' }], {
          duration: 250,
          delay: 80,
          easing: 'ease-in-out',
          fill: 'backwards',
        });
      }
      const done = () => el.classList.remove('morphing');
      morph.onfinish = done;
      morph.oncancel = done;
      return;
    }
    size.current = { w: el.offsetWidth, h: el.offsetHeight };
  });
  // Keep the last size current between commits (the tray and labels tween).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => {
      if (!el.classList.contains('morphing')) size.current = { w: el.offsetWidth, h: el.offsetHeight };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}

/**
 * A collapsible segment: its width (height when vertical) tweens 0 ↔ content.
 * A closing one is inert at once — its exit tween must not leave a Stop or
 * Retry clickable. Imperative: React 18 and 19 disagree on the `inert` prop.
 */
function Seg({ on, className, children }: { on: boolean; className: string; children: ReactNode }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.inert = !on;
  }, [on]);
  return (
    <div ref={ref} className={`seg ${className}${on ? ' on' : ''}`} aria-hidden={!on}>
      <div className="seg-in">{children}</div>
    </div>
  );
}

function SyncGlyph({ chip }: { chip: SyncChip }): ReactElement {
  if (chip.kind === 'synced') return <CircleCheckIcon />;
  if (chip.kind === 'offline') return <CloudOffIcon />;
  if (chip.kind === 'error') return <AlertIcon />;
  return <ArrowUpIcon />;
}

/** "Couldn't save" in a few words; the full sentence rides the tooltip. */
function shortFailure(message: string, report: boolean): string {
  const offline = /unreachable|offline|fetch|network/i.test(message);
  if (report) return offline ? 'Offline — not sent' : 'Couldn’t send';
  if (offline) return 'Offline — kept here';
  if (/ended locally|rejected/i.test(message)) return 'Ended by the server';
  return 'Couldn’t save';
}

export interface RecorderPillProps {
  snap: HudSnapshot;
  now: number;
  flow: Flow;
  /** A note or annotation was just accepted: the clock briefly says so. */
  flash: boolean;
  composing: boolean;
  starting: boolean;
  menuOpen: boolean;
  place: Place;
  dragging: boolean;
  handle: DockHandle;
  pillRef: RefObject<HTMLDivElement | null>;
  onMove: (place: Place) => void;
  onLink: () => void;
  onStart: () => void;
  onPause: () => void;
  onNote: () => void;
  onAnnotate: () => void;
  /** Toggle the ⋯ menu; `byKeyboard` moves focus into it. */
  onMenu: (byKeyboard: boolean) => void;
  onAskStop: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

export function RecorderPill(p: RecorderPillProps): ReactElement {
  const [open, setOpen] = useState(false);
  const fold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const stopRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const savedRef = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);
  const puckRef = useRef<HTMLButtonElement>(null);
  const face = faceOf(p.snap, p.flow, p.place);
  const rec = p.snap.recording;
  const annotating = p.snap.annotating;
  const hold = p.menuOpen || p.composing || annotating || face === 'flow';

  // Content a closing segment keeps for its closing frames.
  const lastRec = useRef<HudRecording | null>(rec);
  if (rec) lastRec.current = rec;
  const lastFlow = useRef<Flow>(p.flow);
  if (p.flow.face !== 'none') lastFlow.current = p.flow;
  const shownRec = rec ?? lastRec.current;
  const shownFlow = p.flow.face !== 'none' ? p.flow : lastFlow.current;

  useEffect(() => {
    if (!rec) setOpen(false);
  }, [rec]);

  const cancelFold = useCallback(() => clearTimeout(fold.current), []);
  // A hovering pointer or keyboard focus inside keeps the tray; a tap's
  // focus does not (touch has no "leave" to fold on).
  const foldIn = useCallback(
    (ms: number) => {
      cancelFold();
      fold.current = setTimeout(() => {
        if (!hovered.current && !p.pillRef.current?.querySelector(':focus-visible')) setOpen(false);
      }, ms);
    },
    [cancelFold, p.pillRef],
  );
  useEffect(() => cancelFold, [cancelFold]);
  // A drag folds everything; a held tray (menu, sheet, annotate, a flow)
  // never folds, and folds on the usual delay once the hold ends.
  useEffect(() => {
    if (p.dragging) {
      cancelFold();
      setOpen(false);
    }
  }, [p.dragging, cancelFold]);
  useEffect(() => {
    if (hold) cancelFold();
    else if (open) foldIn(FOLD_MS);
  }, [hold, open, cancelFold, foldIn]);
  const unfolded = open || (hold && face !== 'flow');

  // Hover is read with NATIVE pointerenter/leave: React synthesises enter
  // from over/out pairs and drops an `over` whose related target belongs to
  // any React root — on a React page the pointer always arrives from the
  // app's own tree, so a synthetic onPointerEnter never fires on the HUD.
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const hasPill = face !== 'tab';
  useLayoutEffect(() => {
    const pill = p.pillRef.current;
    if (!pill) return;
    // The pill often changes face UNDER a resting pointer (the capsule
    // replaces the puck that was just clicked): that pointer never "enters".
    if (pill.matches(':hover')) {
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
    pill.addEventListener('pointerenter', enter);
    pill.addEventListener('pointerleave', leave);
    return () => {
      pill.removeEventListener('pointerenter', enter);
      pill.removeEventListener('pointerleave', leave);
    };
  }, [hasPill, cancelFold, foldIn, p.pillRef]);

  // Focus follows the flow while the HUD holds it: Keep on a confirm, Open
  // board once saved; back to ■ (or the puck) when the flow ends.
  const prevFace = useRef(p.flow.face);
  useEffect(() => {
    const was = prevFace.current;
    prevFace.current = p.flow.face;
    if (was === p.flow.face) return;
    const pill = p.pillRef.current;
    const root = pill?.getRootNode();
    const active = root instanceof ShadowRoot ? root.activeElement : null;
    const ours = active === null || Boolean(pill?.contains(active));
    if (!ours && p.flow.face !== 'confirm') return;
    const target =
      p.flow.face === 'confirm'
        ? keepRef.current
        : p.flow.face === 'saved'
          ? savedRef.current
          : p.flow.face === 'none'
            ? (rec ? stopRef.current : puckRef.current)
            : null;
    // After the segment turns visible (visibility flips with the commit).
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  }, [p.flow.face, rec, p.pillRef]);

  const orient: 'h' | 'v' = face === 'rec' && 'spot' in p.place && isVertical(p.place.spot) ? 'v' : 'h';
  useMorph(p.pillRef, orient);

  if (face === 'tab') {
    const bad = rec ? rec.sync.state === 'offline' || rec.sync.state === 'dead' : false;
    return (
      <button
        type="button"
        className="tab"
        aria-label="Show recorder"
        data-state={bad ? 'bad' : rec && !rec.paused ? 'rec' : 'idle'}
        {...p.handle}
        onClick={() => p.onMove({ spot: untuck(p.place) })}
      />
    );
  }

  const chip = shownRec ? syncChip(shownRec.sync, p.now) : null;
  const bad = chip?.kind === 'offline' || chip?.kind === 'error';
  const state = bad ? 'bad' : !shownRec || shownRec.paused || shownRec.dead ? 'paused' : 'rec';
  const unlinked = !p.snap.linked;
  const puckLabel = unlinked ? 'Link recorder' : 'Start recording';
  const confirming = p.flow.face === 'confirm';
  const dataFace = face === 'flow' && confirming && rec ? 'flow-rec' : face;
  const progress = saveProgress(p.flow, rec?.sync.queued ?? 0);

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
    if (p.pillRef.current?.contains(e.relatedTarget as Node | null)) return;
    if (!hold) foldIn(FOLD_MS);
  };
  const toggle = () => {
    setOpen((o) => !o);
    foldIn(FOLD_TOUCH_MS);
  };
  // The menu-button keys: ↓ opens the menu with focus on its first item (Enter/Space click through onMenu).
  const onMoreKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' || p.menuOpen) return;
    e.preventDefault();
    e.stopPropagation();
    p.onMenu(true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (p.flow.face === 'confirm') p.onCancel();
    else if (p.flow.face === 'saved' || p.flow.face === 'failed') p.onDismiss();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const flowShown = shownFlow.face;
  const confirmAction = shownFlow.face === 'confirm' ? shownFlow.action : 'stop';
  const savedUrl = shownFlow.face === 'saved' ? shownFlow.boardUrl : undefined;
  const failure = shownFlow.face === 'failed' ? shownFlow.message : '';
  // A bug report's send: "Sending…", "Sent", "Couldn't send" — and it can always be retried.
  const report = 'report' in shownFlow && shownFlow.report === true;

  return (
    <div
      ref={p.pillRef}
      className="pill glass"
      data-e2e="recorder-pill"
      data-face={dataFace}
      data-orient={orient}
      data-state={state}
      data-open={unfolded && face !== 'flow' ? '' : undefined}
      onPointerDown={onTouch}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKey}
    >
      <Seg on={face === 'idle'} className="s-idle">
        <button
          ref={puckRef}
          type="button"
          className="puck"
          data-state={unlinked ? 'unlinked' : p.starting ? 'busy' : 'ready'}
          aria-label={puckLabel}
          onClick={unlinked ? p.onLink : p.onStart}
          disabled={p.starting}
          {...p.handle}
        >
          <span className="ring" />
          <span className="lab" aria-hidden="true">
            <span>{puckLabel}</span>
          </span>
        </button>
      </Seg>
      <Seg on={face === 'idle' && unfolded} className="s-more">
        <button
          type="button"
          className="tb b-more"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={p.menuOpen}
          data-tip="Recents · settings"
          onClick={(e) => p.onMenu(e.detail === 0)}
          onKeyDown={onMoreKey}
        >
          <MoreIcon />
        </button>
      </Seg>
      <Seg on={face === 'rec' || (confirming && rec !== null)} className="s-handle">
        <button
          type="button"
          className="handle"
          aria-label="Recorder controls"
          aria-expanded={unfolded && face === 'rec'}
          onClick={toggle}
          {...p.handle}
        >
          <span className="dot" />
          <span className="clock">
            <Seg on={!p.flash} className="c-time">
              <span className="time">{shownRec ? fmtClock(elapsedOf(shownRec, p.now)) : '00:00'}</span>
            </Seg>
            <Seg on={p.flash} className="c-flash">
              <span className="flash" data-e2e="saved-flash">
                <CheckIcon />
                <span>Saved</span>
              </span>
            </Seg>
          </span>
        </button>
      </Seg>
      <Seg on={face === 'rec' && unfolded} className="s-tray">
        <div className="tools seg-row">
          <span className="sep" />
          {chip ? (
            <span className="sync" data-kind={chip.kind} data-tip={chip.title} role="status" aria-label={chip.title} data-e2e="sync-chip">
              <span className="swap" key={`glyph-${chip.kind}`}>
                <SyncGlyph chip={chip} />
              </span>
              <span className="word swap" key={`word-${chip.label}`}>
                {chip.label}
              </span>
            </span>
          ) : null}
          <button
            type="button"
            className="tb b-pause"
            aria-label={shownRec?.paused ? 'Resume' : 'Pause'}
            aria-keyshortcuts="Alt+Shift+P"
            data-tip={shownRec?.paused ? 'Resume' : 'Pause'}
            data-keys={`${MOD}P`}
            onClick={p.onPause}
          >
            {shownRec?.paused ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button
            type="button"
            className="tb b-note"
            aria-label="Note"
            aria-keyshortcuts="Alt+Shift+N"
            data-tip="Note"
            data-keys={`${MOD}N`}
            onClick={p.onNote}
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            className={annotating ? 'tb b-annotate on' : 'tb b-annotate'}
            aria-label="Annotate"
            aria-pressed={annotating}
            aria-keyshortcuts="Alt+Shift+A"
            data-tip="Annotate"
            data-keys={`${MOD}A`}
            onClick={p.onAnnotate}
          >
            <AnnotateIcon />
          </button>
          <button
            ref={stopRef}
            type="button"
            className="tb b-stop"
            aria-label="Stop"
            aria-keyshortcuts="Alt+Shift+S"
            data-tip="Stop & save"
            data-keys={`${MOD}S`}
            onClick={p.onAskStop}
          >
            <StopIcon />
          </button>
          <button
            type="button"
            className="tb b-more"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={p.menuOpen}
            data-tip="More"
            onClick={(e) => p.onMenu(e.detail === 0)}
            onKeyDown={onMoreKey}
          >
            <MoreIcon />
          </button>
        </div>
      </Seg>
      <Seg on={p.flow.face === 'confirm'} className="s-confirm">
        <div className="flow confirm" role="group" aria-label={confirmAction === 'stop' ? 'Stop and save' : 'Unlink'}>
          <span className="q">{confirmAction === 'stop' ? 'Stop & save?' : 'Unlink this device?'}</span>
          <button type="button" className="fb primary" onClick={p.onConfirm}>
            {confirmAction === 'stop' ? 'Stop' : 'Unlink'}
          </button>
          <button ref={keepRef} type="button" className="fb" onClick={p.onCancel}>
            {confirmAction === 'stop' ? 'Keep recording' : 'Cancel'}
          </button>
        </div>
      </Seg>
      <Seg on={p.flow.face === 'saving'} className="s-saving">
        <div className="flow saving" role="status" data-e2e="saving">
          <SpinnerIcon />
          <span>{report ? 'Sending…' : 'Saving…'}</span>
          {progress !== null && rec ? <span className="muted">{rec.sync.queued} left</span> : null}
          <span
            className="bar-track"
            data-indeterminate={progress === null ? '' : undefined}
            role="progressbar"
            aria-label={report ? 'Sending' : 'Saving'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
            style={{ '--p': String(progress ?? 0) } as Record<string, string>}
          >
            <i />
          </span>
        </div>
      </Seg>
      <Seg on={p.flow.face === 'saved'} className="s-saved">
        <div className="flow saved" data-e2e="saved">
          <span className="ok t-check" data-state={flowShown === 'saved' ? 'in' : undefined}>
            <CheckIcon />
          </span>
          <span>{report ? 'Sent' : 'Saved'}</span>
          {savedUrl ? (
            <a
              ref={(el) => {
                savedRef.current = el;
              }}
              className="fb"
              href={savedUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open board <NewTabIcon />
            </a>
          ) : (
            <span className="muted">in Recents</span>
          )}
          <button
            ref={savedUrl ? undefined : (el) => void (savedRef.current = el)}
            type="button"
            className="fb icon"
            aria-label="Dismiss"
            onClick={p.onDismiss}
          >
            <CloseIcon />
          </button>
        </div>
      </Seg>
      <Seg on={p.flow.face === 'failed'} className="s-failed">
        <div className="flow failed" role="alert" data-tip={failure}>
          <span className="warn">
            <AlertIcon />
          </span>
          <span className="msg">{shortFailure(failure, report)}</span>
          {rec || report ? (
            <button type="button" className="fb" onClick={p.onRetry}>
              Retry
            </button>
          ) : null}
          <button type="button" className="fb icon" aria-label="Dismiss" onClick={p.onDismiss}>
            <CloseIcon />
          </button>
        </div>
      </Seg>
    </div>
  );
}
