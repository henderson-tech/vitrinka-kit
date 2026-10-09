/**
 * The composer sheet's size — HUD prefs `sheetW` (its width) and `sheetH`
 * (the cap its text box grows to with the draft before it scrolls), CSS px,
 * 0 = the HUD's default: `SHEET_W` at every HUD size, `SHEET_ROWS` rows.
 *
 * A grip on the corner facing away from the dock (`gripFor`) resizes both: a
 * pointer drag (captured) live, reporting ONCE on release; arrow keys move
 * that corner 16 px (⇧ 64) and report on key-up; Enter or a double-click
 * resets both to the default. While a vertical resize is in progress the text
 * box stands at the cap it sets, so the hand sees it; once it ends the text box
 * fits its draft again, up to that cap. An axis a drag barely moved keeps its
 * pref, so widening never pins the cap to today's draft. A phone's bottom
 * sheet spans the viewport, so its grip sizes the cap alone. The sheet never
 * outgrows the `room` it has beside the dock: past the cap, or past that
 * room, the text box scrolls.
 */
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { FloatAlign, FloatSide } from './place';

/** The default width, CSS px, at every HUD size (styles.ts `.pop.compose`). */
export const SHEET_W = 440;
export const SHEET_MIN_W = 320;
export const SHEET_MAX_W = 960;
/** The default cap: this many text rows. */
export const SHEET_ROWS = 20;
/** The largest size the server stores. */
const SHEET_PX_MAX = 1600;
const STEP = 16;
const STEP_BIG = 64;
/** A drag that moved less than this along an axis leaves that axis alone. */
const SLOP = 3;
/** What a sheet leaves free across the viewport (its CSS `100vw - 24px`). */
const SIDE_INSET = 24;
/** What a sheet leaves free down the viewport when no dock side was measured. */
const VIEW_INSET = 16;

export type GripCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface Grip {
  corner: GripCorner;
  /** 2 where the sheet is centred on the dock along that axis: it grows both ways, the corner travels half. */
  spanX: 1 | 2;
  spanY: 1 | 2;
  /** What it sizes: the width and the cap, or the cap alone (a phone's full-width bottom sheet). */
  axes: 'xy' | 'y';
}

/**
 * The free corner of a sheet opened on `side` of the dock, aligned `align`
 * (place.ts): away from the dock on both axes. Beside a vertical dock it is
 * the bottom one; above or below a centred dock, the one clear of the ✕. A
 * phone's bottom sheet opens on `top` with `axes` 'y': a top corner, away
 * from the pill's column.
 */
export function gripFor(side: FloatSide, align: FloatAlign, axes: Grip['axes'] = 'xy'): Grip {
  const centred = align === 'center' ? 2 : 1;
  if (side === 'left') return { corner: 'bl', spanX: 1, spanY: centred, axes };
  if (side === 'right') return { corner: 'br', spanX: 1, spanY: centred, axes };
  if (side === 'top') return { corner: align === 'start' ? 'tr' : 'tl', spanX: centred, spanY: 1, axes };
  return { corner: align === 'end' ? 'bl' : 'br', spanX: centred, spanY: 1, axes };
}

/** A width in [SHEET_MIN_W, SHEET_MAX_W] that leaves the viewport its sides (a narrow viewport wins). */
export function clampSheetW(w: number, viewW: number): number {
  return Math.round(Math.min(Math.max(w, SHEET_MIN_W), SHEET_MAX_W, viewW - SIDE_INSET));
}

interface TextBounds {
  min: number;
  /** The tallest the text box may stand with the rest of the sheet inside its room. */
  max: number;
  /** `SHEET_ROWS` rows: line height × rows + the vertical padding. */
  rows: number;
}

function textBounds(el: HTMLTextAreaElement, sheet: HTMLElement, room: number): TextBounds {
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  const min = px(cs.minHeight);
  const line = px(cs.lineHeight) || px(cs.fontSize) * 1.4;
  const rest = sheet.offsetHeight - el.offsetHeight;
  return {
    min,
    max: Math.max(min, Math.min(room - rest, SHEET_PX_MAX)),
    rows: line * SHEET_ROWS + px(cs.paddingTop) + px(cs.paddingBottom),
  };
}

/** The room a sheet has when nothing measured it: the visual viewport. */
function roomOr(room: number): number {
  return room > 0 ? room : (globalThis.visualViewport?.height ?? innerHeight) - VIEW_INSET;
}

/**
 * Size the text box to its draft: from its CSS min-height (at least `floor`)
 * up to `cap` (0 = `SHEET_ROWS` rows) within the sheet's `room`; past that it
 * scrolls. Its scroll position survives the measuring.
 */
export function fitText(el: HTMLTextAreaElement, sheet: HTMLElement, cap: number, floor: number, room: number): void {
  const b = textBounds(el, sheet, room);
  const top = Math.min(cap > 0 ? Math.max(cap, b.min) : b.rows, b.max);
  const scroll = el.scrollTop;
  el.style.overflowY = 'hidden';
  el.style.height = 'auto';
  const content = el.scrollHeight + el.offsetHeight - el.clientHeight;
  const h = Math.min(Math.max(content, b.min, floor), top);
  el.style.height = `${h}px`;
  el.style.overflowY = content > h ? 'auto' : 'hidden';
  el.scrollTop = scroll;
}

export interface SheetSizeOptions {
  sheet: RefObject<HTMLElement | null>;
  text: RefObject<HTMLTextAreaElement | null>;
  /** The prefs, CSS px; 0 = the default. */
  width: number;
  cap: number;
  /** The tallest the sheet may stand where it opens (viewport px); 0 = the viewport. */
  room: number;
  /** Where the grip sits and what it sizes; null = none. */
  grip: Grip | null;
  /** A resize ended: the new prefs (0, 0 = the default). */
  onResize?: ((sheetW: number, sheetH: number) => void) | undefined;
  /** The sheet's box changed size — place it again before it paints. */
  onLayout?: (() => void) | undefined;
}

/** What this open set (shown until the prefs catch up); an axis left unset follows its pref. */
interface Held {
  w?: number;
  h?: number;
}

interface Drag {
  id: number;
  x: number;
  y: number;
  /** The sheet's width and the text box's height when it started. */
  w: number;
  h: number;
  min: number;
  max: number;
  grip: Grip;
  moved: { x: boolean; y: boolean };
  /** The size so far — reported on release. */
  now: Held;
}

const signs = (corner: GripCorner) => ({ x: corner[1] === 'r' ? 1 : -1, y: corner[0] === 'b' ? 1 : -1 });

/** The sheet's width style, its text box fitted on every commit, and the grip's handlers. */
export function useSheetSize(o: SheetSizeOptions) {
  const [held, setHeld] = useState<Held>({});
  // The cap a vertical resize in progress is setting (0 = none): the text box
  // stands at it so the hand sees it, and fits its draft again once it ends.
  const [floor, setFloor] = useState(0);
  const drag = useRef<Drag | null>(null);
  const keyed = useRef<Held | null>(null);
  const reported = useRef('');
  const onLayout = useRef(o.onLayout);
  onLayout.current = o.onLayout;

  const width = held.w ?? (o.width > 0 ? Math.min(Math.max(o.width, SHEET_MIN_W), SHEET_MAX_W) : 0);
  const cap = held.h ?? o.cap;

  // Every commit: the draft, the width or the room may have moved the text.
  useLayoutEffect(() => {
    const el = o.text.current;
    const sheet = o.sheet.current;
    if (!el || !sheet) return;
    fitText(el, sheet, cap, floor, roomOr(o.room));
    const box = `${sheet.offsetWidth}x${sheet.offsetHeight}`;
    if (box === reported.current) return;
    reported.current = box;
    onLayout.current?.();
  });

  const bounds = () => {
    const el = o.text.current;
    const sheet = o.sheet.current;
    return el && sheet ? { el, sheet, ...textBounds(el, sheet, roomOr(o.room)) } : null;
  };
  const clampH = (h: number, b: { min: number; max: number }) => Math.round(Math.min(Math.max(h, b.min), b.max));
  const report = (next: Held) => o.onResize?.(next.w ?? o.width, next.h ?? o.cap);

  const reset = () => {
    drag.current = null;
    keyed.current = null;
    setHeld({});
    setFloor(0);
    o.onResize?.(0, 0);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const b = bounds();
    if (e.button !== 0 || !o.grip || !b) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      w: b.sheet.offsetWidth,
      h: b.el.offsetHeight,
      min: b.min,
      max: b.max,
      grip: o.grip,
      moved: { x: false, y: false },
      now: held,
    };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved.x ||= d.grip.axes === 'xy' && Math.abs(dx) >= SLOP;
    d.moved.y ||= Math.abs(dy) >= SLOP;
    const s = signs(d.grip.corner);
    const h = clampH(d.h + s.y * dy * d.grip.spanY, d);
    d.now = {
      ...d.now,
      ...(d.moved.x ? { w: clampSheetW(d.w + s.x * dx * d.grip.spanX, innerWidth) } : {}),
      ...(d.moved.y ? { h } : {}),
    };
    setHeld(d.now);
    setFloor(d.moved.y ? h : 0);
  };
  // Release, cancel or a lost capture: the size shown is the size kept, and
  // the text box fits its draft again under that cap.
  const onPointerEnd = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setFloor(0);
    if (d.moved.x || d.moved.y) report(d.now);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      reset();
      return;
    }
    const b = bounds();
    if (!b || !o.grip) return;
    const step = e.shiftKey ? STEP_BIG : STEP;
    const s = signs(o.grip.corner);
    const base = keyed.current ?? held;
    let next: Held;
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && o.grip.axes === 'xy') {
      next = { ...base, w: clampSheetW((base.w ?? b.sheet.offsetWidth) + (e.key === 'ArrowRight' ? step : -step) * s.x, innerWidth) };
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      next = { ...base, h: clampH((base.h ?? b.el.offsetHeight) + (e.key === 'ArrowDown' ? step : -step) * s.y, b) };
      setFloor(next.h ?? 0);
    } else return;
    e.preventDefault();
    keyed.current = next;
    setHeld(next);
  };
  // A held arrow repeats: the size is reported once the key lets go (or focus
  // leaves), and the text box fits its draft again under the new cap.
  const flushKeys = () => {
    const next = keyed.current;
    keyed.current = null;
    setFloor(0);
    if (next) report(next);
  };

  const style: CSSProperties | undefined = width > 0 ? ({ '--sheet-w': `${width}px` } as CSSProperties) : undefined;
  return {
    style,
    grip: o.grip
      ? {
          corner: o.grip.corner,
          handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: onPointerEnd,
            onPointerCancel: onPointerEnd,
            onLostPointerCapture: onPointerEnd,
            // A press on the grip keeps the text box focused; Tab still reaches it.
            onMouseDown: (e: MouseEvent<HTMLButtonElement>) => e.preventDefault(),
            onDoubleClick: reset,
            onKeyDown,
            onKeyUp: (e: KeyboardEvent<HTMLButtonElement>) => {
              if (e.key.startsWith('Arrow')) flushKeys();
            },
            onBlur: flushKeys,
          },
        }
      : null,
  };
}
