/**
 * Annotate mode (⌖): crosshair, the hovered element outlined, a drag past
 * 6px (12px for a finger) switches to a marquee; the page dims and a hint
 * bar says what to do. Click or tap → element pick (selector + rect), drag →
 * region (rect). The chrome lives in the shadow root so the page cannot
 * restyle it; the pointer handlers are document-level CAPTURE listeners.
 *
 * The mode owns the pointer, mouse and finger alike — the page never sees a
 * press, a pick's click or a touch, and the HUD's own surfaces are exempt:
 * - A finger never pans, zooms, selects or long-presses the page: every
 *   element gets `touch-action:none` (ANNOTATE_PAGE_CSS) and window-capture
 *   non-passive touch listeners cancel each touch, which also stops the
 *   browser synthesising a click from it. Native drags are blocked too.
 * - A pick switches the mode off inside pointerup, and React unmounts this
 *   overlay before the gesture's tail (touchend, click) is dispatched; the
 *   one-shot `swallowGestureTail` guard outlives the overlay to eat it.
 * - A pointercancel drops the marquee and stays in annotate mode; one
 *   pointer (the primary) steers a gesture, a second finger never does, and
 *   a finger's sliver of a marquee is a slip that stays in the mode too.
 */
import { type ReactElement, useEffect, useState } from 'react';

import { elementText, shortSelector } from '../capture/click';
import { RRWEB_BLOCK_ATTR } from '../capture/rrweb';
import { AnnotateIcon } from './icons';
import { insideHud } from './host';
import { ANNOTATE_PAGE_CSS } from './styles';

export interface Pick {
  /** Viewport rect in CSS pixels. */
  rect: { x: number; y: number; w: number; h: number };
  selector: string;
  text: string;
}

export interface AnnotateOverlayProps {
  onPick: (pick: Pick) => void;
  onCancel: () => void;
}

const TOUCH = ['touchstart', 'touchmove', 'touchend'] as const;
const TAIL = ['touchend', 'mousedown', 'mouseup', 'click'] as const;

/**
 * Eat the rest of the gesture that ended annotate mode. The pick flips the
 * mode off inside pointerup and React (a SyncLane commit) runs the overlay's
 * cleanup in that microtask, BEFORE the browser dispatches touchend or the
 * click — so this guard lives on `window`, not in the effect. Window capture
 * runs ahead of the page and of the click lane, so a pick is never pressed
 * nor journaled as a click. One-shot: the gesture's click or the next
 * pointerdown disarms it; keyboard (`detail` 0) and synthetic clicks pass.
 */
function swallowGestureTail(): void {
  const eat = (e: Event) => {
    if (!e.isTrusted || insideHud(e.target)) return;
    if (e.type === 'click' && (e as MouseEvent).detail === 0) return;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click') off();
  };
  const off = () => {
    for (const t of TAIL) window.removeEventListener(t, eat, true);
    window.removeEventListener('pointerdown', off, true);
  };
  for (const t of TAIL) window.addEventListener(t, eat, { capture: true, passive: false });
  window.addEventListener('pointerdown', off, true);
}

export function AnnotateOverlay({ onPick, onCancel }: AnnotateOverlayProps): ReactElement {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    let downAt: { x: number; y: number } | null = null;
    let dragging = false;
    let pid = -1; // the pointer steering the gesture
    let slop = 6;
    document.documentElement.style.cursor = 'crosshair';
    const pageCss = document.createElement('style');
    pageCss.setAttribute(RRWEB_BLOCK_ATTR, '');
    pageCss.textContent = ANNOTATE_PAGE_CSS;
    (document.head ?? document.documentElement).append(pageCss);
    // Pointer events arrive well above frame rate (120 Hz+ on a trackpad);
    // hit-testing and re-rendering on each would burn the frame budget of the
    // page under test. Coalesce to ONE hit-test per animation frame and skip
    // the state write when the box did not move.
    type Box = { x: number; y: number; w: number; h: number };
    let raf = 0;
    let last: { x: number; y: number } | null = null;
    const same = (a: Box | null, b: Box | null) =>
      a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
    const place = (next: Box | null) => setBox((prev) => (same(prev, next) ? prev : next));
    const frame = () => {
      raf = 0;
      if (!last) return;
      const { x, y } = last;
      if (downAt && (dragging || Math.hypot(x - downAt.x, y - downAt.y) > slop)) {
        dragging = true;
        place({
          x: Math.min(downAt.x, x),
          y: Math.min(downAt.y, y),
          w: Math.abs(x - downAt.x),
          h: Math.abs(y - downAt.y),
        });
        return;
      }
      const el = document.elementFromPoint(x, y);
      if (!el || insideHud(el)) {
        place(null);
        return;
      }
      const r = el.getBoundingClientRect();
      place({ x: r.x - 3, y: r.y - 3, w: r.width + 2, h: r.height + 2 });
    };
    const move = (e: PointerEvent) => {
      if (downAt && e.pointerId !== pid) return; // a second finger never steers the marquee
      last = { x: e.clientX, y: e.clientY };
      if (raf === 0) raf = requestAnimationFrame(frame);
    };
    /** Drop the gesture and its outline; annotate mode stays on. */
    const reset = () => {
      downAt = null;
      dragging = false;
      pid = -1;
      last = null;
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      place(null);
    };
    const down = (e: PointerEvent) => {
      if (insideHud(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.isPrimary) return;
      pid = e.pointerId;
      slop = e.pointerType === 'touch' ? 12 : 6;
      dragging = false;
      downAt = { x: e.clientX, y: e.clientY };
      move(e); // a finger has no hover: outline what is under it now
    };
    const up = (e: PointerEvent) => {
      if (!downAt || e.pointerId !== pid) return;
      e.preventDefault();
      e.stopPropagation();
      swallowGestureTail();
      const start = downAt;
      const wasDrag = dragging;
      downAt = null;
      dragging = false;
      pid = -1;
      if (wasDrag) {
        const x = Math.min(start.x, e.clientX);
        const y = Math.min(start.y, e.clientY);
        const w = Math.abs(e.clientX - start.x);
        const h = Math.abs(e.clientY - start.y);
        if (w < 4 || h < 4) {
          if (e.pointerType === 'touch') return reset(); // a finger's slip, not a request to leave
          onCancel();
          return;
        }
        onPick({ rect: { x, y, w, h }, selector: '', text: '' });
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || insideHud(el)) {
        onCancel();
        return;
      }
      const r = el.getBoundingClientRect();
      onPick({
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        selector: shortSelector(el),
        text: elementText(el),
      });
    };
    // The browser took the pointer (a pan that slipped through, a native drag).
    const cancel = (e: PointerEvent) => {
      if (e.pointerId === pid) reset();
    };
    const swallowClick = (e: MouseEvent) => {
      if (insideHud(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    // A cancelled touchstart stops pan, zoom, pull-to-refresh, long-press and
    // the click synthesised from a tap — iOS included, where touch-action is
    // not always honoured; stopping it keeps swipers and responders out.
    const blockTouch = (e: TouchEvent) => {
      if (insideHud(e.target)) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    };
    const noDrag = (e: DragEvent) => {
      if (!insideHud(e.target)) e.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('click', swallowClick, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('dragstart', noDrag, true);
    // Explicitly non-passive: window/document touch listeners default to passive.
    for (const t of TOUCH) window.addEventListener(t, blockTouch, { capture: true, passive: false });
    return () => {
      document.documentElement.style.cursor = '';
      pageCss.remove();
      if (raf !== 0) cancelAnimationFrame(raf);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('click', swallowClick, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('dragstart', noDrag, true);
      for (const t of TOUCH) window.removeEventListener(t, blockTouch, true);
    };
  }, [onPick, onCancel]);

  return (
    <>
      <div className="dim" data-e2e="annotate-dim" />
      {box ? (
        <div
          className="outline"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      ) : null}
      <div className="hint">
        <AnnotateIcon /> Click an element or drag an area<span className="keys"> · esc cancels</span>
      </div>
    </>
  );
}
