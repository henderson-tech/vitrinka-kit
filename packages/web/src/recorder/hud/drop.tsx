/**
 * The draft drop (recorder HUD polish D10/D13/D14): a composer closed with
 * words or images in it parks as a 16px glass bead fused to the pill's end
 * that faces the screen's centre — a small liquid fillet joins them. At rest
 * it is the bead and an amber dot; hovered or focused it stretches into a bar
 * with the draft's crop (when the host had pixels) and first line; a click
 * resumes the composer exactly as it was. No page chrome: the region is not
 * drawn while the draft waits (D14).
 *
 * Not an SVG goo filter: a filter on the pill's ancestor would cut its
 * backdrop blur, and `url(#…)` filter references are unreliable inside a
 * shadow root. The fillet is drawn, the bead is the HUD's own glass.
 */
import type { ReactElement } from 'react';

import { PencilIcon } from './icons';

export interface DraftDropProps {
  /** The draft's first line ('' for an image-only draft). */
  text: string;
  /** The picked region's pixels, when the host could read them (D15). */
  crop: string | null;
  /** Which side of the pill it buds from: the one toward the screen's centre. */
  side: 'start' | 'end';
  onResume: () => void;
}

export function DraftDrop({ text, crop, side, onResume }: DraftDropProps): ReactElement {
  const line = text.split('\n')[0]?.trim() || 'Image draft';
  return (
    <div className="draft" data-side={side} data-e2e="draft-drop">
      <svg className="fillet" viewBox="0 0 8 16" aria-hidden="true">
        <path className="f-body" d="M0 0 C 3 4, 5 4, 8 3 L 8 13 C 5 12, 3 12, 0 16 Z" />
        {/* the rim on the two concave curves only — the glass's 1px edge, so the neck reads on any page */}
        <path className="f-rim" d="M0 0.5 C 3 4.5, 5 4.5, 8 3.5 M0 15.5 C 3 11.5, 5 11.5, 8 12.5" />
      </svg>
      <button type="button" className="bead glass" aria-label={`Resume the draft: ${line}`} onClick={onResume}>
        <span className="d-dot" />
        <span className="d-more">
          <span className="d-in">
            {crop ? <img className="d-crop" src={crop} alt="" /> : <PencilIcon />}
            <span className="d-text">{line}</span>
            <kbd>↩</kbd>
          </span>
        </span>
      </button>
    </div>
  );
}

/** The drop's CSS (appended to HUD_CSS). */
export const DROP_CSS = `
.draft { position:relative; display:flex; align-items:center; flex:none; }
.draft[data-side="start"] { order:-1; margin-right:-1px; }
.draft[data-side="end"] { order:1; margin-left:-1px; flex-direction:row-reverse; }
.draft .fillet { width:8px; height:16px; flex:none; overflow:visible; }
.draft .fillet .f-body { fill:var(--ink-pop); }
.draft .fillet .f-rim { fill:none; stroke:rgba(255,255,255,.16); stroke-width:1; vector-effect:non-scaling-stroke; }
.draft[data-side="start"] .fillet { order:1; transform:scaleX(-1); }
.hud .draft .bead { all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; height:18px; min-width:18px;
  padding:0 5px; border-radius:999px; color:var(--fg); font-size:calc(var(--fs) - 1px); font-weight:600;
  background:var(--ink); -webkit-backdrop-filter:blur(16px) saturate(1.5); backdrop-filter:blur(16px) saturate(1.5);
  box-shadow: inset 0 0 0 1px var(--edge), 0 0 0 .5px var(--rim), 0 6px 16px -8px rgba(0,0,0,.5);
  animation: drop-in var(--duration-medium) var(--ease-spring) both;
  transition: height var(--duration-fast) var(--ease-smooth-out); }
.draft .d-dot { width:8px; height:8px; flex:none; border-radius:50%; background:var(--warn); }
.draft .d-more { display:grid; grid-template-columns:0fr; opacity:0;
  transition: grid-template-columns var(--duration-resize) var(--ease-smooth-out), opacity var(--duration-quick) var(--ease-out); }
.draft .d-in { min-width:0; overflow:hidden; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; padding-left:6px; }
.draft .d-in svg { color:var(--warn); }
.draft .d-crop { width:28px; height:18px; object-fit:cover; border-radius:3px; box-shadow:0 0 0 1px var(--rec); }
.draft .d-text { max-width:calc(170px * var(--s)); overflow:hidden; text-overflow:ellipsis; color:var(--fg-2); font-weight:500; }
.draft kbd { font:600 var(--fs-s)/1 ui-monospace, "SF Mono", Menlo, monospace; color:var(--fg-3); }
.hud .draft .bead:hover, .hud .draft .bead:focus-visible { height:26px; }
.draft .bead:hover .d-more, .draft .bead:focus-visible .d-more { grid-template-columns:1fr; opacity:1; }
.draft .bead:focus-visible { outline:2px solid var(--rec); outline-offset:2px; }
@keyframes drop-in { from { transform:scale(.3); opacity:0; } }
.dock.dragging .draft { display:none; }
`;
