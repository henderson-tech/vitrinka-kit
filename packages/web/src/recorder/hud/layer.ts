/**
 * Where a sheet opens and how it enters and leaves (recorder-hud-subtle D5).
 * On desktop and tablet a sheet is a popover anchored to the dock, opening
 * toward the viewport centre from whichever spot the dock rests on; on a
 * phone (narrow + coarse pointer) it is a bottom sheet over the visual
 * viewport, so it rides above the on-screen keyboard. Coordinates are
 * relative to the sheet host's own origin box, which may sit inside a
 * transformed dialog.
 */
import { colOf, type Place, rowOf, untuck } from '@vitrinka/link/dock';
import { type CSSProperties, useEffect, useState, useSyncExternalStore } from 'react';

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

/** The dock's resting box — layout only, so a spring in flight does not skew the anchor. */
export function restingBox(el: HTMLElement): Box {
  const left = el.offsetLeft;
  const top = el.offsetTop;
  return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
}

/** The viewport position of the host a sheet renders in (its 0×0 origin box). */
export function hostOrigin(mount: HTMLElement): { x: number; y: number } {
  const root = mount.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : null;
  if (!host) return { x: 0, y: 0 };
  const r = host.getBoundingClientRect();
  return { x: r.left, y: r.top };
}

const GAP = 8;

/** A popover anchored to the dock, growing from the corner nearest it. */
export function anchoredLayer(dock: Box, place: Place, origin: { x: number; y: number }): { style: CSSProperties; origin: string } {
  const spot = untuck(place);
  const row = rowOf(spot);
  const col = colOf(spot);
  let ax: number;
  let tx: string;
  let ay: number;
  let ty: string;
  if ('tuck' in place) {
    ax = place.tuck === 'left' ? dock.right + GAP : dock.left - GAP;
    tx = place.tuck === 'left' ? '0' : '-100%';
    ay = row === 't' ? dock.top : dock.bottom;
    ty = row === 't' ? '0' : '-100%';
  } else {
    ax = col === 'l' ? dock.left : col === 'r' ? dock.right : innerWidth / 2;
    tx = col === 'l' ? '0' : col === 'r' ? '-100%' : '-50%';
    ay = row === 't' ? dock.bottom + GAP : dock.top - GAP;
    ty = row === 't' ? '0' : '-100%';
  }
  return {
    style: { left: ax - origin.x, top: ay - origin.y, translate: `${tx} ${ty}` },
    origin: `${row === 't' ? 'top' : 'bottom'}-${col === 'l' ? 'left' : col === 'c' ? 'center' : 'right'}`,
  };
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
