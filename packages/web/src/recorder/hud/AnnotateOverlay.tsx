/**
 * Annotate mode (⌖): crosshair, the hovered element outlined, a drag past
 * 6px switches to a marquee; the page dims and a hint bar says what to do.
 * Click → element pick (selector + rect), drag → region (rect). The chrome
 * lives in the shadow root so the page cannot restyle it; the pointer
 * handlers are document-level CAPTURE listeners so the page never sees the
 * pick click.
 */
import { type ReactElement, useEffect, useState } from 'react';

import { elementText, shortSelector } from '../capture/click';
import { AnnotateIcon } from './icons';
import { insideHud } from './host';

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

export function AnnotateOverlay({ onPick, onCancel }: AnnotateOverlayProps): ReactElement {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    let downAt: { x: number; y: number } | null = null;
    let dragging = false;
    document.documentElement.style.cursor = 'crosshair';
    const move = (e: PointerEvent) => {
      if (downAt && (dragging || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6)) {
        dragging = true;
        setBox({
          x: Math.min(downAt.x, e.clientX),
          y: Math.min(downAt.y, e.clientY),
          w: Math.abs(e.clientX - downAt.x),
          h: Math.abs(e.clientY - downAt.y),
        });
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || insideHud(el)) {
        setBox(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setBox({ x: r.x - 3, y: r.y - 3, w: r.width + 2, h: r.height + 2 });
    };
    const down = (e: PointerEvent) => {
      if (insideHud(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      downAt = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (!downAt) return;
      e.preventDefault();
      e.stopPropagation();
      const start = downAt;
      const wasDrag = dragging;
      downAt = null;
      dragging = false;
      if (wasDrag) {
        const x = Math.min(start.x, e.clientX);
        const y = Math.min(start.y, e.clientY);
        const w = Math.abs(e.clientX - start.x);
        const h = Math.abs(e.clientY - start.y);
        if (w < 4 || h < 4) {
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
    const swallowClick = (e: MouseEvent) => {
      if (insideHud(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
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
    return () => {
      document.documentElement.style.cursor = '';
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('click', swallowClick, true);
      document.removeEventListener('keydown', key, true);
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
        <AnnotateIcon /> annotate — click an element or drag an area · enter sends · esc cancels
      </div>
    </>
  );
}
