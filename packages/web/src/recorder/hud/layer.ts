/**
 * Where a sheet opens and how it enters and leaves (recorder-hud-subtle D5).
 * On desktop and tablet a sheet is a popover anchored to the dock, opening
 * toward the viewport centre from whichever spot the dock rests on (place.ts:
 * sideways from a vertical dock, never past a viewport edge); on a
 * phone (narrow + coarse pointer) it is a bottom sheet over the visual
 * viewport, so it rides above the on-screen keyboard. Coordinates are
 * relative to the sheet host's own origin box, which may sit inside a
 * transformed dialog.
 */
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { alignFor, type FloatAlign, type FloatSide, placeFloating, towardCentre } from './place';
import type { Place } from './spots';

export const PHONE_QUERY = '(max-width: 640px) and (pointer: coarse)';
export const FINE_QUERY = '(pointer: fine)';

/** A live media query (false where matchMedia is missing). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = globalThis.matchMedia?.(query);
      m?.addEventListener('change', cb);
      return () => m?.removeEventListener('change', cb);
    },
    () => globalThis.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

/** Re-render while `active` whenever the visual viewport moves (keyboard, pinch, rotate). */
export function useViewportTick(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const bump = () => setTick((n) => n + 1);
    const vv = globalThis.visualViewport;
    vv?.addEventListener('resize', bump);
    vv?.addEventListener('scroll', bump);
    addEventListener('resize', bump);
    return () => {
      vv?.removeEventListener('resize', bump);
      vv?.removeEventListener('scroll', bump);
      removeEventListener('resize', bump);
    };
  }, [active]);
  return tick;
}

/**
 * Mount-and-animate for a surface that opens and closes: `is-open` one frame
 * after mounting (so the pre-open state paints first), `is-closing` for
 * `closeMs` before unmounting.
 */
export function usePresence(open: boolean, closeMs: number): { mounted: boolean; cls: '' | 'is-open' | 'is-closing' } {
  const [mounted, setMounted] = useState(false);
  const [cls, setCls] = useState<'' | 'is-open' | 'is-closing'>('');
  useEffect(() => {
    if (open) {
      setMounted(true);
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setCls('is-open'));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setCls((c) => (c === '' ? c : 'is-closing'));
    const t = setTimeout(() => {
      setMounted(false);
      setCls('');
    }, closeMs);
    return () => clearTimeout(t);
  }, [open, closeMs]);
  return { mounted: open || mounted, cls };
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The dock's resting box in viewport px — its rect minus the translate it is
 * springing through (the FLIP), so an anchor never chases a settle in flight.
 */
export function restingBox(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  const t = getComputedStyle(el).transform;
  let dx = 0;
  let dy = 0;
  if (t && t !== 'none' && typeof DOMMatrixReadOnly === 'function') {
    const m = new DOMMatrixReadOnly(t);
    dx = m.m41;
    dy = m.m42;
  }
  return { left: r.left - dx, top: r.top - dy, right: r.right - dx, bottom: r.bottom - dy };
}

/** The viewport position of the host a sheet renders in (its 0×0 origin box). */
export function hostOrigin(mount: HTMLElement): { x: number; y: number } {
  const root = mount.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : null;
  if (!host) return { x: 0, y: 0 };
  const r = host.getBoundingClientRect();
  return { x: r.left, y: r.top };
}

/**
 * A popover anchored to the dock: toward the page centre (sideways from a
 * vertical or tucked dock), flush with the dock's outer edge, flipped and
 * shifted so the measured `size` never leaves the viewport; it grows from
 * the point nearest the dock.
 */
export function anchoredLayer(
  dock: Box,
  size: { w: number; h: number },
  place: Place,
  origin: { x: number; y: number },
): { style: CSSProperties; origin: string } {
  const p = placeFloating(
    { x: dock.left, y: dock.top, w: dock.right - dock.left, h: dock.bottom - dock.top },
    size,
    { w: innerWidth, h: innerHeight },
    towardCentre(place),
    { align: alignFor(place), gap: 8, margin: 8 },
  );
  return { style: { left: p.x - origin.x, top: p.y - origin.y }, origin: p.origin };
}

/** A phone bottom sheet: the full visual viewport, content pinned to its bottom edge. */
export function phoneLayer(origin: { x: number; y: number }): CSSProperties {
  const vv = globalThis.visualViewport;
  return {
    left: (vv?.offsetLeft ?? 0) - origin.x,
    top: (vv?.offsetTop ?? 0) - origin.y,
    width: vv?.width ?? innerWidth,
    height: vv?.height ?? innerHeight,
  };
}

/**
 * Keep a fixed float beside its anchor: placed on every commit, on a size
 * change of either (the tray unfolding, a recents list loading) and on a
 * viewport resize. Writes the style directly — no state, no re-render.
 * `anchor` returns the box to sit beside (viewport px) or null to skip.
 */
export function useFloat(
  float: RefObject<HTMLElement | null>,
  anchor: () => { el: HTMLElement; box: Box } | null,
  side: FloatSide,
  align: FloatAlign,
  active: boolean,
): void {
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const place = useCallback(() => {
    const f = float.current;
    const a = anchorRef.current();
    if (!f || !a) return;
    const p = placeFloating(
      { x: a.box.left, y: a.box.top, w: a.box.right - a.box.left, h: a.box.bottom - a.box.top },
      { w: f.offsetWidth, h: f.offsetHeight },
      { w: innerWidth, h: innerHeight },
      side,
      { align, gap: 8, margin: 8 },
    );
    f.style.translate = `${Math.round(p.x)}px ${Math.round(p.y)}px`;
    f.style.transformOrigin = p.origin;
    f.dataset.side = p.side;
  }, [float, side, align]);
  useLayoutEffect(() => {
    if (active) place();
  });
  useEffect(() => {
    if (!active || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(place);
    const f = float.current;
    const a = anchorRef.current();
    if (f) ro.observe(f);
    if (a) ro.observe(a.el);
    addEventListener('resize', place);
    return () => {
      ro.disconnect();
      removeEventListener('resize', place);
    };
  }, [active, place, float]);
}
