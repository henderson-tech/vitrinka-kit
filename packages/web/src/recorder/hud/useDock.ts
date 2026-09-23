/**
 * Where the HUD rests and how it moves (recorder-hud-subtle D2). The dock
 * sits on one of six spots by CSS insets (see `.dock` in styles.ts), so a
 * resize or rotation needs no JS; a drag moves it by `transform` only and a
 * release settles through `@vitrinka/link/dock` — a flick lands where it is
 * aimed, a push past a side edge tucks it into a tab. The move to the new
 * spot is a FLIP: the dock re-anchors, then springs from where it was let
 * go. Arrow keys on a focused handle are the non-drag alternative.
 * The place is remembered per origin in the recorder's storage.
 */
import { type Arrow, colOf, neighbour, parsePlace, type Place, rowOf, settle, type Spot, untuck } from '@vitrinka/link/dock';
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getRecorderStorage } from '../storage';

const DOCK_KEY = 'dock';
/** Travel before a press becomes a drag — below it a press stays a tap. */
const DRAG_SLOP = 4;
/** Velocity is read over the last this-many ms of the drag. */
const VELOCITY_WINDOW = 100;

export interface DockHandle {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export interface Dock {
  place: Place;
  /** The spot the dock anchors by (a tucked dock: its side and half). */
  spot: Spot;
  ref: RefObject<HTMLDivElement | null>;
  dragging: boolean;
  /** Spread on every drag handle: the capsule handle, the puck, the tab. */
  handle: DockHandle;
  /** On the dock element: swallows the click that ends a drag. */
  onClickCapture: (e: MouseEvent) => void;
  moveTo: (next: Place) => void;
}

const ARROWS = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

function reducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function margin(): number {
  return globalThis.matchMedia?.('(pointer: coarse)').matches ? 12 : 16;
}

/** The point of `r` a place is anchored by: its corner, its middle on the c column, its mid-height when tucked. */
function anchorPoint(r: DOMRect, place: Place): { x: number; y: number } {
  const spot = untuck(place);
  const x = colOf(spot) === 'l' ? r.left : colOf(spot) === 'r' ? r.right : r.left + r.width / 2;
  const y = 'tuck' in place ? r.top + r.height / 2 : rowOf(spot) === 't' ? r.top : r.bottom;
  return { x, y };
}

export function useDock(onMoveStart: () => void): Dock {
  const [place, setPlace] = useState<Place>(() => parsePlace(getRecorderStorage().getString(DOCK_KEY)));
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const from = useRef<DOMRect | null>(null);
  const press = useRef<{ id: number; x: number; y: number; moved: boolean; samples: { x: number; y: number; t: number }[] } | null>(null);
  const swallowClick = useRef(false);
  const onMoveStartRef = useRef(onMoveStart);
  onMoveStartRef.current = onMoveStart;

  const moveTo = useCallback((next: Place) => {
    const el = ref.current;
    if (el) from.current = el.getBoundingClientRect();
    setPlace(next);
    try {
      getRecorderStorage().set(DOCK_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('vitrinka: could not remember the HUD position', e);
    }
  }, []);

  // FLIP: the dock has re-anchored; spring it from where it was let go.
  useLayoutEffect(() => {
    const el = ref.current;
    const prev = from.current;
    from.current = null;
    if (!el || !prev) return;
    el.classList.remove('settling');
    el.style.transform = '';
    if (reducedMotion()) return;
    const next = el.getBoundingClientRect();
    const a = anchorPoint(prev, place);
    const b = anchorPoint(next, place);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    void el.offsetWidth;
    el.classList.add('settling');
    el.style.transform = '';
    const done = () => el.classList.remove('settling');
    el.addEventListener('transitionend', done, { once: true });
  }, [place]);

  // The centre column anchors the handle's middle: keep --hw = its width.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => {
      const h = el.querySelector<HTMLElement>('.handle, .puck, .tab');
      if (h) el.style.setProperty('--hw', `${h.offsetWidth}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A press on a handle (capsule, puck or tab) belongs to the HUD alone. On
  // the first move the browser hit-tests the press point again for a native
  // drag source. By then the dock has moved off that point, so a link or image
  // of the page underneath would start a native drag, which cancels the
  // pointer and drops the throw. Cancel any dragstart while a press is live.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (press.current) e.preventDefault();
    };
    document.addEventListener('dragstart', guard, true);
    return () => document.removeEventListener('dragstart', guard, true);
  }, []);

  const release = useCallback(
    (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
      const p = press.current;
      press.current = null;
      if (!p || p.id !== e.pointerId) return;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (!p.moved) return;
      setDragging(false);
      swallowClick.current = true;
      setTimeout(() => (swallowClick.current = false), 0);
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (cancelled) {
        moveTo(place);
        return;
      }
      const s = p.samples;
      const first = s[0];
      const last = s[s.length - 1];
      const dt = first && last ? (last.t - first.t) / 1000 : 0;
      const v = first && last && dt > 0 ? { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt } : { x: 0, y: 0 };
      const m = margin();
      moveTo(
        settle({ x: r.left, y: r.top, w: r.width, h: r.height }, v, { w: innerWidth, h: innerHeight }, { top: m, right: m, bottom: m, left: m }),
      );
    },
    [moveTo, place],
  );

  const handle = useMemo<DockHandle>(
    () => ({
      onPointerDown: (e) => {
        if (e.button !== 0 || !e.isPrimary) return;
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, samples: [] };
        // Capture at once: a fast first move would otherwise leave the handle
        // before the drag begins and the page would get the rest.
        e.currentTarget.setPointerCapture?.(e.pointerId);
      },
      onPointerMove: (e) => {
        const p = press.current;
        const el = ref.current;
        if (!p || p.id !== e.pointerId || !el) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        if (!p.moved) {
          if (Math.hypot(dx, dy) < DRAG_SLOP) return;
          p.moved = true;
          el.classList.remove('settling');
          setDragging(true);
          onMoveStartRef.current();
        }
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        const t = e.timeStamp;
        p.samples.push({ x: e.clientX, y: e.clientY, t });
        while (p.samples.length > 2 && t - p.samples[0]!.t > VELOCITY_WINDOW) p.samples.shift();
      },
      onPointerUp: (e) => release(e, false),
      onPointerCancel: (e) => release(e, true),
      onKeyDown: (e) => {
        if (!ARROWS.has(e.key) || e.altKey || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        onMoveStartRef.current();
        moveTo(neighbour(place, e.key as Arrow));
      },
    }),
    [moveTo, place, release],
  );

  const onClickCapture = useCallback((e: MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return { place, spot: untuck(place), ref, dragging, handle, onClickCapture, moveTo };
}
