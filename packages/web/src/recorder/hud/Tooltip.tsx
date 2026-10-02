/**
 * The HUD's one tooltip (transitions.dev 17): any element carrying
 * `data-tip` (and optionally `data-keys`, the shortcut) under `root` shows it
 * on mouse hover or keyboard focus. It is a fixed float placed by place.ts —
 * toward the page centre from the dock, flipped and shifted into the
 * viewport — so it never clips at the pill's or the screen's edge. The first
 * appearance waits a beat (CSS); moving to a neighbour while it shows makes
 * the bubble travel; leaving hides it at once. Visual only (`aria-hidden`):
 * every trigger already carries its accessible name and `aria-keyshortcuts`.
 */
import { type ReactElement, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { type FloatSide, placeFloating } from './place';

function triggerOf(t: EventTarget | null): HTMLElement | null {
  return t instanceof Element ? t.closest<HTMLElement>('[data-tip]') : null;
}

export interface TooltipProps {
  root: RefObject<HTMLElement | null>;
  side: FloatSide;
  /** A drag, an open menu or sheet: no tooltip. */
  suppressed: boolean;
}

export function Tooltip({ root, side, suppressed }: TooltipProps): ReactElement {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const showing = useRef(false);

  useEffect(() => {
    const r = root.current;
    if (!r) return;
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const t = triggerOf(e.target);
      if (t) setTarget(t);
    };
    const out = (e: PointerEvent) => {
      const t = triggerOf(e.target);
      if (!t) return;
      const to = e.relatedTarget;
      if (to instanceof Node && t.contains(to)) return;
      if (!triggerOf(to)) setTarget(null);
    };
    const focusIn = (e: FocusEvent) => {
      const t = triggerOf(e.target);
      if (t?.matches(':focus-visible')) setTarget(t);
    };
    const hide = () => setTarget(null);
    r.addEventListener('pointerover', over);
    r.addEventListener('pointerout', out);
    r.addEventListener('focusin', focusIn);
    r.addEventListener('focusout', hide);
    r.addEventListener('pointerdown', hide, true);
    return () => {
      r.removeEventListener('pointerover', over);
      r.removeEventListener('pointerout', out);
      r.removeEventListener('focusin', focusIn);
      r.removeEventListener('focusout', hide);
      r.removeEventListener('pointerdown', hide, true);
    };
  }, [root]);

  const text = target?.dataset.tip ?? '';
  const keys = target?.dataset.keys ?? '';
  // A trigger inside a folded segment (the tray closing) has nothing to explain.
  const visible = target !== null && text !== '' && !suppressed && target.isConnected && !target.closest('.seg:not(.on)');

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;
    if (!visible || !target) {
      tip.dataset.show = 'false';
      showing.current = false;
      return;
    }
    const r = target.getBoundingClientRect();
    const p = placeFloating(
      { x: r.left, y: r.top, w: r.width, h: r.height },
      { w: tip.offsetWidth, h: tip.offsetHeight },
      { w: innerWidth, h: innerHeight },
      side,
      { gap: 8, margin: 6 },
    );
    const at = `${Math.round(p.x)}px ${Math.round(p.y)}px`;
    if (!showing.current) {
      // Hidden: snap the geometry under the trigger so only the appear plays.
      tip.classList.add('snap');
      tip.style.translate = at;
      tip.style.transformOrigin = p.origin;
      void tip.offsetWidth;
      tip.classList.remove('snap');
    } else {
      tip.style.translate = at;
      tip.style.transformOrigin = p.origin;
    }
    tip.dataset.side = p.side;
    tip.dataset.show = 'true';
    showing.current = true;
  }, [visible, target, text, keys, side]);

  return (
    <div ref={tipRef} className="float tip" aria-hidden="true" data-show="false" data-e2e="tooltip">
      <span>{text}</span>
      {keys ? <kbd>{keys}</kbd> : null}
    </div>
  );
}
