/**
 * Report a problem — the report face's UI (QA Studio D12 C, D21 B).
 *
 * - The launcher (hidden with `button: false`; the host then opens the card
 *   from its own control, `open-selector`, or `open()`), and the reporter's
 *   own shortcut (keybind.ts). By default it is the edge drop (vt-3811,
 *   edge.ts): a drop resting on a side edge, one seamless path with its
 *   meniscus feet, that grows its name on hover; carried, it comes off the
 *   wall as a liquid pill and lands on the nearer side edge. Opened, the drop
 *   becomes the card (morphCard) and closing runs it back; `launcher:
 *   'corner'` is the large button.
 * - ONE card (vt-8020 D10 A), one fixed size from drafting through sending
 *   to thanks (its views cross-fade, part()); on a phone a bottom sheet pinned
 *   to the visual viewport, above the on-screen keyboard (pinSheet): the reporter's word for it (vt-8020 D11 chips), "What went wrong?",
 *   one numbered note line per mark, and Send — the capture frozen when the
 *   card opens (the buffer rolls on).
 * - "Show us where" marks the frozen page under a top bar (vt-8020 D6 A): a segmented
 *   box · circle · arrow · cover, and Cancel, which leaves marking and drops
 *   this pass's marks (vt-8020 D12). The card stays on screen while marking, parked
 *   in the corner that covers none of the marks (place.ts). No element
 *   selector. While marking, a coach rides on the card's top edge, never over
 *   the page: a tiny run of the picked shape's gesture and the words "click,
 *   hold and move", until the person presses "Got it, don't show again".
 * - The reporter's files (vt-8020 D9, attachments.ts): 📎 in the card's foot,
 *   paste or drop onto the card; chips above the foot, refused at once past
 *   the project's caps, sent on the wire's attachment leg.
 * - The corner button drags to any corner, or moves with Alt+arrows (drag.ts);
 *   the edge drop is carried to either side edge, or moves with Alt+arrows
 *   (edge.ts); the card rests beside either. Settings adds the size (S · M · L, settings.ts)
 *   and the technical details a support conversation asks for.
 * - Rendered once into the shared HUD host's shadow root (top layer,
 *   shielded, blocked from rrweb); `paint()` rewrites text and state in place,
 *   so a locale switch keeps the typed draft, the marks and their notes.
 *   Drafts live in memory only.
 */
import { LinkExpired, type LinkStart, linkWorkspace, pollLink, startLink } from '@vitrinka/link';

import { api, VitrinkaApiError } from '../recorder/api';
import { redactUrl } from '../recorder/capture/redact';
import { clearLink, defaultLinkLabel, readLink, storeLink } from '../recorder/config';
import { readRecents } from '../recorder/recents';
import { createHudHost, createSheetHost, type HudHost, insideHud, sheetTarget } from '../recorder/hud/host';
import { listen } from '../recorder/hud/listen';
import { forgetLink } from '../recorder/link';
import { RECORDER_VERSION } from '../recorder/version';
import { admit, type AttachmentCaps, DEFAULT_ATTACHMENT_CAPS, formatBytes, pastedName, type Refusal, typesLabel } from './attachments';
import { contextField, type ReportContext } from './context';
import { cornerToward, DRAG_THRESHOLD, nearestCorner, readDock, saveDock } from './drag';
import {
  cardTopBeside,
  DROP_FOOT,
  dropForm,
  dropPath,
  edgeCorner,
  edgeFraction,
  type EdgeInsets,
  edgeInsets,
  type EdgePlace,
  edgeTop,
  edgeToward,
  type Launcher,
  nearerSide,
  readEdge,
  saveEdge,
} from './edge';
import { memberLinked, memberLinkGone, memberTokenFor, rememberDisplayMode, watchMemberLink } from './face';
import { acquireEngine, type BuiltCapture, type CaptureEngine, type Frozen, type RecordLoader, releaseEngine, type ReportConfig } from './engine';
import { browserLocale, type Locale, parseLocale, REPORT_KINDS, type ReportKind, strings, type Strings } from './i18n';
import { type Identity, type IdentifyInput, normalizeIdentity, onSharedIdentity, sharedIdentity } from './identity';
import { type Keybind, keybindAria, keybindLabel, loadKeybind, matchesKeybind, readKeybindPress, saveKeybind, watchKeybind } from './keybind';
import {
  type ArrowHead,
  arrowEnds,
  arrowHead,
  isMark,
  type Marker,
  type MarkerShape,
  type Point,
  type Rect,
  rectBetween,
  renumber,
  toWire,
} from './markers';
import { coachSide, type Corner, cornerRect, type Frame, pickCorner } from './place';
import type { CaptureNarrowing } from './profile';
import { listMine, type MyReport, openSession, type ReporterSession, sessionKey, sessionLive } from './reader';
import { noteSent, readSent } from './sent';
import { COACH_KEY, readCoach, readSize, SIZE_KEY, SIZE_SCALE, SIZES, techDetails, type WidgetSize, writePref } from './settings';
import { REPORT_CSS } from './styles';
import { roundFor } from './round';
import { EMPTY_CAPTURE, prepareCapture, ReportJob, type ReportEnvelope, type SubmitReply } from './wire';

export interface WidgetOptions {
  base: string;
  key: string;
  /** null/absent = the browser's language. */
  locale?: Locale | null;
  /** The floating button; `false` = the host opens the card itself. */
  button: boolean;
  /** CSS selector of the host's own control(s) that open the card. */
  openSelector?: string | null;
  /** `edge` (default): the drop on a side edge (edge.ts); `corner`: the four-corner button (drag.ts). */
  launcher?: Launcher;
  /** The clear space the edge drop keeps at the top and the bottom of the viewport (px). */
  edgeInsets?: Partial<EdgeInsets> | null;
  identity?: IdentifyInput;
  /** The host's claimed context, already validated by element.ts (context.ts, vt-9515). */
  context?: ReportContext;
  appVersion?: string;
  capture?: CaptureNarrowing;
  sanitizeUrl?: (url: string) => string;
  loadRecord: RecordLoader;
}

type View = 'describe' | 'settings' | 'sent' | 'reports' | 'recents' | 'link';
type Popover = 'account' | 'more';
type LinkFlow = { start: LinkStart | null; state: 'starting' | 'waiting' | 'expired' | 'failed'; abort: AbortController };
type Drawn = Marker & { key: number };
/**
 * The morph's one surface (vt-3811), in painted viewport px: its box, its corner radii (top-left, top-right,
 * bottom-right, bottom-left), how far its fill has turned from the drop's to the card's (0–1), and how much
 * of the card's content shows through it (0–1).
 */
interface Geo {
  x: number;
  y: number;
  w: number;
  h: number;
  r: readonly [number, number, number, number];
  fill: number;
  alpha: number;
}
/**
 * How the card comes and goes: `surface` — the drop grows into it (and back); `rise` — no drop on screen on
 * a phone, the sheet rises from the bottom; `fade` — no drop on screen on a desk, it fades up in place.
 */
type MorphMode = 'surface' | 'rise' | 'fade';
interface Morph {
  mode: MorphMode;
  open: boolean;
  from: Geo;
  to: Geo;
  /** Spring progress from `from` (0) to `to` (1), and its velocity per second. */
  q: number;
  v: number;
  raf: number;
  last: number;
  /** The card's painted box and scale, read when this run started. */
  card: DOMRect;
  k: number;
}
/** A press on the button; past DRAG_THRESHOLD a drag. The edge drop also keeps where it is carried, and how fast. */
interface FabDrag {
  pointer: number;
  start: Point;
  grab: Point;
  moved: boolean;
  left: number;
  top: number;
  vx: number;
  vy: number;
  at: number;
  raf: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const TITLE_CAP = 100;
/** The box leads and is the default: most problems are a region, and a box is the one gesture nobody has to learn. */
const TOOLS: readonly MarkerShape[] = ['box', 'circle', 'arrow', 'hide'];
/** A keyboard mark starts as this, centred; arrows move it 10 px, Shift+arrows resize it. */
const KB_DRAFT = { w: 160, h: 80 } as const;
const MIN_KB_SIZE = 16;
/** The one card's size (vt-8020 D10: it never changes between states) and the clear band the marking bar keeps at the top. */
const CARD = { w: 380, h: 460 } as const;
const BAR_CLEAR = 72;
/** The edge drop's height and the gap the card keeps to it, before the size setting scales them (styles: `.vr[data-launcher="edge"]`). */
const DROP = { h: 48, w: 44, gap: 12 } as const;
/** The coach's box beside the card (styles: `.coach`), before the size setting scales it, and its gap to the card. */
const COACH = { w: 300, h: 160, gap: 10 } as const;
/** The gap a parked card keeps on a side it did not rest against. */
const PARK_EDGE = 16;
/** A phone (styles: the `max-width: 520px` block): the card is a bottom sheet pinned to the visual viewport. */
const PHONE = '(max-width: 520px)';
/** Pane swaps inside the open card (vt-3811): the old content fades out over the new one as it fades in. */
const SWAP = { out: 140, in: 220 } as const;
const KB_STEPS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-10, 0],
  ArrowRight: [10, 0],
  ArrowUp: [0, -10],
  ArrowDown: [0, 10],
};

const ICON = {
  close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  // A toothed cog: the sun-like ring of rays read as brightness, not settings.
  gear:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.9 1.5h2.2l.35 1.75a5 5 0 011.3.75l1.7-.57 1.1 1.9-1.35 1.18a5 5 0 010 1.5l1.35 1.18-1.1 1.9-1.7-.57a5 5 0 01-1.3.75L9.1 14.5H6.9l-.35-1.75a5 5 0 01-1.3-.75l-1.7.57-1.1-1.9 1.35-1.18a5 5 0 010-1.5L2.45 6.81l1.1-1.9 1.7.57a5 5 0 011.3-.75z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  circle: '<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="8" rx="6" ry="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  box: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.2" y="3.4" width="11.6" height="9.2" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  arrow: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13L12.5 3.5M7 3.5h5.5V9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  hide: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8s2.3-4 6-4 6 4 6 4-2.3 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M3 13L13 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  dots: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor"/></svg>',
  left: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ext: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  list: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.8V8l2.2 1.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  rec: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.8" fill="currentColor"/></svg>',
  link: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 9a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.8.8M9 7a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.8-.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  clip: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 4.5l-5 5a1.6 1.6 0 002.3 2.3l5.4-5.4a3 3 0 00-4.2-4.2L3.6 7.6a4.4 4.4 0 006.2 6.2l4-4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pen: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.8 2.7l2.5 2.5-7.6 7.6-3.1 0.6 0.6-3.1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  // A speech bubble with an exclamation mark: the edge drop's glyph (vt-3811).
  report:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.4A8.5 8.5 0 1 1 21 12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 8v4.2M12 15.6h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
} as const;

/**
 * The coach's run of the picked shape (D21): a pointer presses, holds and moves, and the shape grows under it.
 * ONE clock: every moving part is SMIL in the same SVG with the same keyTimes and linear timing, so the pointer
 * and the stroke stay locked frame for frame (a CSS-eased stroke beside a linear SMIL pointer drew ahead of it).
 */
const COACH_TIMES = '0;0.18;0.72;1';
const COACH_DUR = '2.8s';
const LOOP_PATH = 'M 134 14 C 200 14, 214 50, 134 50 C 54 50, 68 14, 134 14';
const POINTER_SHAPE = '<path d="M0 0 L0 15 L4 11 L7 18 L10 16.6 L7 10 L12.5 10 Z" fill="#fff" stroke="#151417" stroke-width="1"/>';

/** One value run on the coach clock: still at `from`, moving to `to`, still at `to`. */
function coachAnim(attr: string, from: number, to: number): string {
  return `<animate attributeName="${attr}" values="${from};${from};${to};${to}" keyTimes="${COACH_TIMES}" calcMode="linear" dur="${COACH_DUR}" repeatCount="indefinite"/>`;
}

function coachArt(shape: MarkerShape, reduced: boolean): string {
  const still = (from: number, to: number) => (reduced ? to : from);
  const anim = (attr: string, from: number, to: number) => (reduced ? '' : coachAnim(attr, from, to));
  // The finished shape fades as the loop turns over; the press ring shows while the button is held.
  const fade = reduced ? '' : `<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.9;1" dur="${COACH_DUR}" repeatCount="indefinite"/>`;
  const hold = reduced
    ? ''
    : `<animate attributeName="opacity" values="0;0;.9;.9;0;0" keyTimes="0;0.08;0.14;0.72;0.8;1" dur="${COACH_DUR}" repeatCount="indefinite"/>`;
  let scene: string;
  let path: string;
  let end: Point;
  if (shape === 'circle') {
    path = LOOP_PATH;
    end = { x: 134, y: 14 };
    scene =
      '<rect class="bar" x="84" y="27" width="100" height="10" rx="5"/>' +
      `<path class="loop" d="${LOOP_PATH}" pathLength="200" stroke-dasharray="200" stroke-dashoffset="${still(200, 0)}">${anim('stroke-dashoffset', 200, 0)}${fade}</path>`;
  } else if (shape === 'arrow') {
    path = 'M 74 54 L 128 33';
    end = { x: 128, y: 33 };
    // A zero-length line still paints its head, pointing nowhere: the arrow shows only once it moves.
    const show = reduced ? '' : `<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.18;0.19;0.9;1" dur="${COACH_DUR}" repeatCount="indefinite"/>`;
    scene =
      '<defs><marker id="vr-coach-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#e6455f"/></marker></defs>' +
      '<rect class="bar" x="136" y="27" width="70" height="10" rx="5"/>' +
      `<line class="loop" x1="74" y1="54" x2="${still(74, 128)}" y2="${still(54, 33)}" marker-end="url(#vr-coach-head)"${reduced ? '' : ' opacity="0"'}>${anim('x2', 74, 128)}${anim('y2', 54, 33)}${show}</line>`;
  } else {
    // box and cover share the drag; a cover fills, so what is under it reads as gone.
    const cover = shape === 'hide';
    path = cover ? 'M 90 10 L 178 54' : 'M 96 12 L 172 52';
    end = cover ? { x: 178, y: 54 } : { x: 172, y: 52 };
    const x = cover ? 90 : 96;
    const y = cover ? 10 : 12;
    const w = end.x - x;
    const hgt = end.y - y;
    scene =
      (cover
        ? '<rect class="bar" x="102" y="20" width="64" height="8" rx="4"/><rect class="bar" x="102" y="35" width="44" height="8" rx="4"/>'
        : '<rect class="bar" x="110" y="27" width="48" height="10" rx="5"/>') +
      `<rect class="${cover ? 'veil' : 'loop'}" x="${x}" y="${y}" width="${still(0, w)}" height="${still(0, hgt)}" rx="${cover ? 4 : 6}">${anim('width', 0, w)}${anim('height', 0, hgt)}${fade}</rect>`;
  }
  const motion = reduced
    ? ''
    : `<animateMotion dur="${COACH_DUR}" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="${COACH_TIMES}" calcMode="linear" path="${path}"/>`;
  return (
    `<svg viewBox="0 0 268 64" aria-hidden="true" data-shape="${shape}">${scene}` +
    `<g class="pointer"${reduced ? ` transform="translate(${end.x} ${end.y})"` : ''}>` +
    `<circle class="hold" r="9"${reduced ? ' opacity=".9"' : ' opacity="0"'}>${hold}</circle>${POINTER_SHAPE}${motion}</g></svg>`
  );
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string>> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}

/** One of the constant icons above as a node. */
function icon(markup: string): Element {
  const t = document.createElement('template');
  t.innerHTML = markup;
  const el = t.content.firstElementChild;
  if (!el) throw new Error('vitrinka: icon markup is empty');
  return el;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string | number>>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function titleOf(description: string): string {
  const line = description.split('\n')[0]?.trim() ?? '';
  return line.length > TITLE_CAP ? `${line.slice(0, TITLE_CAP - 1)}…` : line;
}

function reducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 0 below `a`, 1 above `b`, a smooth S between. */
function smoothstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Past the end and back: a foot regrowing overshoots a little, like liquid. */
const easeBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

function lerp(a: number, b: number, q: number): number {
  return a + (b - a) * q;
}

/**
 * The surface `q` of the way from `a` to `b`. Its box follows the spring past the end and back (the overshoot
 * is the liquid); fill and radii stop at the ends. The content shows late on the way in — once the surface
 * nearly holds it — and goes early on the way out, so it never shows outside a surface too small for it.
 */
function lerpGeo(a: Geo, b: Geo, q: number, opening: boolean): Geo {
  const c = clamp(q, 0, 1);
  const shown = opening ? smoothstep(0.35, 0.9, q) : smoothstep(0, 0.45, q);
  return {
    x: lerp(a.x, b.x, q),
    y: lerp(a.y, b.y, q),
    w: Math.max(0, lerp(a.w, b.w, q)),
    h: Math.max(0, lerp(a.h, b.h, q)),
    r: [0, 1, 2, 3].map((i) => Math.max(0, lerp(a.r[i]!, b.r[i]!, c))) as unknown as Geo['r'],
    fill: lerp(a.fill, b.fill, c),
    alpha: lerp(a.alpha, b.alpha, shown),
  };
}

const px = (v: number) => `${Math.round(v * 100) / 100}px`;

/** The focused element (HTML or SVG: an SVG link or a tabindexed shape is a control too), through open shadow roots; null when nothing but <body> has it. */
function deepActiveElement(): HTMLElement | SVGElement | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (active === document.body) return null;
  return active instanceof HTMLElement || active instanceof SVGElement ? active : null;
}

/** Up to two initials of a name, or an email's first letter. */
function initials(label: string): string {
  const words = label.split('@')[0]?.split(/[\s._-]+/).filter(Boolean) ?? [];
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

/** A menu row's text: the span after its icon. */
function setLabel(el: HTMLElement, text: string): void {
  const span = el.querySelector('span');
  if (span) span.textContent = text;
}

/**
 * A segmented control's sliding indicator under its picked segment (the marking bar's shapes, the settings' sizes);
 * unmeasurable while hidden. It slides only from one pick to the next: its first placement, and `land` (its bar just
 * appeared), put it in place on the frame it shows — slid there, it would grow from width 0 at the control's edge
 * (or from where a hidden bar last left it), with the picked segment bare until it arrived.
 */
function placeIndicator(seg: HTMLElement, ind: HTMLElement, btn: HTMLElement | undefined, land = false): void {
  if (!btn || !btn.offsetWidth) return;
  const jump = land || !seg.classList.contains('measured');
  if (jump) ind.style.transition = 'none';
  ind.style.width = `${btn.offsetWidth}px`;
  ind.style.transform = `translateX(${btn.offsetLeft}px)`;
  seg.classList.add('measured');
  if (!jump) return;
  // The read commits the placement as the style the slide starts from, so restoring the slide animates nothing.
  void ind.offsetWidth;
  ind.style.removeProperty('transition');
}

/** A text field has the focus — its own editing keys (⌘Z included) are its. */
function typing(): boolean {
  const el = deepActiveElement();
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

/** The click landed on the host's own control (`open-selector`) — the widget's, and the pill face's while it shows (element.ts). */
export function hitsOpener(ev: Event, sel: string | null): boolean {
  const t = ev.target;
  if (!sel || !(t instanceof Element)) return false;
  try {
    return t.closest(sel) !== null;
  } catch {
    return false; // not a selector: nothing of the page opens the card
  }
}

/** The widget's DOM, built once into the HUD host's shadow mount. */
function buildDom(mount: HTMLElement) {
  const fabLabel = h('span', { class: 'fab-label' });
  // The chord is painted for the eye only: in the name it would rename the button ("Report a problem Alt+Shift+A");
  // assistive technology hears it from aria-keyshortcuts (paint).
  const fabKbd = h('kbd', { 'aria-hidden': 'true' });
  // The edge drop shows the glyph and grows the label out of it; the corner button shows the label alone (styles).
  const fabGlyph = h('span', { class: 'fab-glyph', 'aria-hidden': 'true' }, icon(ICON.report));
  // The edge drop's painted shape: ONE path for the body and both feet (edge.ts dropPath, widget shapeDrop).
  const fabFill = svgEl('path', { class: 'fill' });
  const fabShape = svgEl('svg', { class: 'fab-shape', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  fabShape.append(fabFill);
  const fab = h('button', { class: 'fab', type: 'button', part: 'button', 'aria-haspopup': 'dialog' }, fabShape, fabGlyph, fabLabel, fabKbd);

  const title = h('h2', { id: 'vr-title' });
  // Who you are, at a glance (vt-8020 D5 A): the chip opens the account popover, ⋯ the menu.
  const whoAv = h('span', { class: 'av', 'aria-hidden': 'true' });
  const whoName = h('span', { class: 'who-name' });
  const whoBtn = h('button', { class: 'who', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, whoAv, whoName);
  const more = h('button', { class: 'icon', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon(ICON.dots));
  const closeBtn = h('button', { class: 'icon', type: 'button' }, icon(ICON.close));
  const head = h('header', { class: 'head' }, title, whoBtn, more, closeBtn);

  const accName = h('strong');
  const accMail = h('span', { class: 'acc-mail' });
  const accVia = h('p', { class: 'acc-via' });
  const accLinked = h('p', { class: 'acc-linked' });
  const accUnlink = h('button', { class: 'link', type: 'button' });
  const accLink = h('button', { class: 'pop-item', type: 'button' }, icon(ICON.link), h('span'));
  const accPortal = h('a', { class: 'pop-item', target: '_blank', rel: 'noopener noreferrer' }, icon(ICON.ext), h('span'));
  const accountPop = h(
    'div',
    { class: 'pop acc', role: 'dialog' },
    h('div', { class: 'acc-who' }, accName, accMail, accVia),
    h('div', { class: 'acc-member' }, accLinked, accUnlink),
    accLink,
    accPortal,
  );
  const menuItem = (glyph: string) => h('button', { class: 'pop-item', type: 'button', role: 'menuitem' }, icon(glyph), h('span'));
  const mReports = menuItem(ICON.list);
  const mRecents = menuItem(ICON.clock);
  const mRecord = menuItem(ICON.rec);
  // Why Record waits, a second line under its label: its description, so aria-hidden keeps it out of the name.
  const mRecordWhy = h('small', { class: 'pop-why', id: 'vr-record-why', 'aria-hidden': 'true' });
  mRecord.append(mRecordWhy);
  const mSettings = menuItem(ICON.gear);
  const mOpen = h('a', { class: 'pop-item', role: 'menuitem', target: '_blank', rel: 'noopener noreferrer' }, icon(ICON.ext), h('span'));
  const morePop = h('div', { class: 'pop more', role: 'menu' }, mReports, mRecents, mRecord, mSettings, mOpen);

  const kindsLabel = h('span', { class: 'sr', id: 'vr-kinds' });
  const kindButtons = new Map<ReportKind, HTMLButtonElement>();
  for (const k of REPORT_KINDS) kindButtons.set(k, h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-kind': k }));
  const kinds = h('div', { class: 'kinds', role: 'radiogroup', 'aria-labelledby': 'vr-kinds' }, kindsLabel, ...kindButtons.values());
  const prompt = h('label', { class: 'prompt', for: 'vr-desc' });
  const desc = h('textarea', { class: 'desc', id: 'vr-desc', rows: '3' });
  const lines = h('ol', { class: 'lines' });
  const linesEmpty = h('p', { class: 'ln-empty' });
  const attachedText = h('span');
  const discloseText = h('span');
  const disclose = h('button', { class: 'link', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'vr-included' }, discloseText, icon(ICON.chevron));
  const attached = h('div', { class: 'attached' }, icon(ICON.clip), attachedText, h('span', { 'aria-hidden': 'true' }, '·'), disclose);
  const included = h('ul', { class: 'included', id: 'vr-included' });
  const notifyBox = h('input', { type: 'checkbox' });
  const notifyText = h('span');
  const notify = h('label', { class: 'notify' }, notifyBox, notifyText);
  const error = h('p', { class: 'error', role: 'alert' });
  const whereText = h('span');
  const where = h('button', { class: 'where', type: 'button', 'aria-pressed': 'false' }, icon(ICON.pen), whereText);
  const send = h('button', { class: 'send', type: 'button' });
  const describe = h('div', { class: 'pane describe' }, kinds, prompt, desc, h('div', { class: 'lines-wrap' }, lines, linesEmpty), attached, included, notify, error);
  // The reporter's files (vt-8020 D9): 📎 opens the picker (paste and drop land on the card too);
  // the chips sit in a tray above the foot that scrolls — the card never grows.
  const attach = h('button', { class: 'icon', type: 'button' }, icon(ICON.clip));
  const fileInput = h('input', { type: 'file', multiple: '', tabindex: '-1', 'aria-hidden': 'true', hidden: '' });
  const fileNote = h('p', { class: 'file-note', role: 'status' });
  const files = h('ul', { class: 'files' });
  const tray = h('div', { class: 'tray' }, fileNote, files);
  // The bottom actions, the chat-input foot of the board's composer: attachments, `where`, Send.
  const foot = h('div', { class: 'foot' }, attach, fileInput, where, send);

  const bindLabel = h('span', { class: 'label', id: 'vr-bind-label' });
  const bindBtn = h('button', { class: 'bind', type: 'button', 'aria-pressed': 'false', 'aria-describedby': 'vr-bind-label' });
  const unbind = h('button', { class: 'link', type: 'button' });
  const bindHint = h('p', { class: 'hint' });
  const bindReason = h('p', { class: 'reason', role: 'status' });
  const back = h('button', { class: 'link', type: 'button' });
  // Size (vt-8020 D9): the marking bar's segmented control, its indicator sliding under the pick.
  const sizeLabel = h('span', { class: 'label', id: 'vr-size-label' });
  const sizeButtons = new Map<WidgetSize, HTMLButtonElement>();
  for (const z of SIZES) sizeButtons.set(z, h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-size': z }));
  const sizeInd = h('span', { class: 'seg-ind', 'aria-hidden': 'true' });
  const sizeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': 'vr-size-label' }, sizeInd, ...sizeButtons.values());
  // The marking tips: the way back after "Got it, don't show again".
  const coachLabel = h('span', { class: 'label', id: 'vr-coach-label' });
  const coachSwitch = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'true', 'aria-labelledby': 'vr-coach-label' }, h('span', { class: 'knob', 'aria-hidden': 'true' }));
  // Technical details: read-only, for support conversations.
  const techText = h('span');
  const techBtn = h('button', { class: 'link', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'vr-tech' }, techText, icon(ICON.chevron));
  const tech = h('dl', { class: 'tech', id: 'vr-tech' });
  const settings = h(
    'div',
    { class: 'pane settings' },
    h('div', { class: 'row' }, bindLabel, bindBtn),
    bindReason,
    bindHint,
    h('div', { class: 'row size-row' }, sizeLabel, sizeSeg),
    h('div', { class: 'row tips-row' }, coachLabel, coachSwitch),
    h('div', { class: 'tech-wrap' }, techBtn, tech),
    h('div', { class: 'settings-foot' }, back, unbind),
  );

  // Sent (vt-3811): thanks and nothing more to read — the way to the report when the server gave one, and Close.
  const sentTitle = h('h3');
  const seeText = h('span');
  const see = h('a', { class: 'see', target: '_blank', rel: 'noopener noreferrer' }, seeText);
  const sentClose = h('button', { class: 'link', type: 'button' });
  const sent = h(
    'div',
    { class: 'pane sent', role: 'status' },
    h('div', { class: 'sent-head' }, icon(ICON.check), sentTitle),
    h('div', { class: 'sent-actions' }, see, sentClose),
  );

  // A list opens in the card body with ← back (vt-8020 D5); the card keeps its size.
  const backRow = () => h('button', { class: 'back', type: 'button' }, icon(ICON.left), h('span'));
  const repBack = backRow();
  const repStatus = h('p', { class: 'list-status' });
  const repRows = h('ul', { class: 'rows' });
  const repLocal = h('p', { class: 'list-note' });
  const repPortal = h('a', { class: 'link', target: '_blank', rel: 'noopener noreferrer' });
  const reports = h('div', { class: 'pane list' }, repBack, repStatus, repRows, repLocal, repPortal);
  const recBack = backRow();
  const recStatus = h('p', { class: 'list-status' });
  const recRows = h('ul', { class: 'rows' });
  const recents = h('div', { class: 'pane list' }, recBack, recStatus, recRows);
  const linkBack = backRow();
  const linkLabel = h('p', { class: 'list-note' });
  const linkCode = h('div', { class: 'code' });
  const linkOpenText = h('span');
  const linkOpen = h('a', { class: 'see', target: '_blank', rel: 'noopener noreferrer' }, linkOpenText);
  const linkQr = h('img', { class: 'qr', alt: '' });
  const linkHint = h('p', { class: 'hint' });
  const linkWait = h('p', { class: 'list-status', role: 'status' });
  const linkRetry = h('button', { class: 'link', type: 'button' });
  const linking = h('div', { class: 'pane linking' }, linkBack, linkLabel, linkCode, h('div', { class: 'link-go' }, linkOpen, linkQr), linkHint, linkWait, linkRetry);

  // The coach (vt-8020) rides on the card's top edge while marking, never over the page it teaches about;
  // its art follows the picked shape (paint), and one button turns it off for good.
  const coachArtSlot = h('div', { class: 'coach-art' });
  const coachText = h('p');
  const coachMore = h('p');
  const coachDismiss = h('button', { class: 'coach-ok', type: 'button' });
  const coach = h('div', { class: 'coach', role: 'status' }, coachArtSlot, coachText, coachMore, coachDismiss);
  // How to mark from the keyboard: the marking layer's description, for assistive technology only.
  const coachKeys = h('p', { class: 'sr-only', id: 'vr-keys' });
  const body = h('div', { class: 'body' }, describe, settings, sent, reports, recents, linking);
  const card = h('section', { class: 'card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'vr-title' }, head, accountPop, morePop, body, tray, foot, coach);

  const ink = svgEl('svg', { class: 'ink', 'aria-hidden': 'true' });
  const defs = svgEl('defs', {});
  const headMarker = svgEl('marker', { id: 'vr-head', viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
  headMarker.append(svgEl('path', { d: 'M0 0L10 5L0 10z', fill: '#dc2f4c' }));
  defs.append(headMarker);
  const shapes = svgEl('g', {});
  const draft = svgEl('g', { class: 'draft' });
  ink.append(defs, shapes, draft);
  const pins = h('div', { class: 'pins' });
  // The top bar (vt-8020 D6): one plain line, the shape as a segmented control whose indicator slides, Cancel.
  const toolButtons = new Map<MarkerShape, HTMLButtonElement>();
  const toolLabels = new Map<MarkerShape, HTMLSpanElement>();
  for (const t of TOOLS) {
    const label = h('span');
    toolLabels.set(t, label);
    toolButtons.set(t, h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-tool': t }, icon(ICON[t]), label));
  }
  const segInd = h('span', { class: 'seg-ind', 'aria-hidden': 'true' });
  const seg = h('div', { class: 'seg', role: 'radiogroup' }, segInd, ...toolButtons.values());
  const barLead = h('span', { class: 'tb-lead' });
  const cancel = h('button', { type: 'button', class: 'tb-quiet' });
  const askText = h('span', { class: 'tb-ask' });
  const discard = h('button', { type: 'button', class: 'tb-discard' });
  const keep = h('button', { type: 'button', class: 'tb-quiet' });
  const ask = h('span', { class: 'tb-confirm', role: 'group' }, askText, discard, keep);
  const toolbar = h('div', { class: 'tb', role: 'toolbar' }, barLead, seg, h('span', { class: 'tb-sep', 'aria-hidden': 'true' }), cancel, ask);
  // Focusable: from the keyboard, Enter places a mark the arrows then move (markKey).
  const mark = h('div', { class: 'mark', tabindex: '0', role: 'application', 'aria-describedby': 'vr-keys' }, pins, coachKeys, toolbar);
  mark.prepend(ink);

  // The card after the marking layer: it stays on top of it, usable, while the reporter marks.
  // The morph surface (vt-3811) under the card: the drop grows into the card through it, and back.
  const morph = h('div', { class: 'morph', 'aria-hidden': 'true', hidden: '' });
  const root = h('div', { class: 'vr' }, fab, mark, morph, card);
  const style = h('style');
  style.textContent = REPORT_CSS;
  // The sheet rides inside the root: the whole tree moves into an open dialog and back (followDialog).
  root.prepend(style);
  mount.append(root);
  return {
    root, fab, fabGlyph, fabLabel, fabKbd, fabShape, fabFill, morph, card, head, title, whoBtn, whoAv, whoName, more, closeBtn, body, foot,
    accountPop, accName, accMail, accVia, accLinked, accUnlink, accLink, accPortal,
    morePop, mReports, mRecents, mRecord, mRecordWhy, mSettings, mOpen,
    reports, repBack, repStatus, repRows, repLocal, repPortal, recents, recBack, recStatus, recRows,
    linking, linkBack, linkLabel, linkCode, linkOpen, linkOpenText, linkQr, linkHint, linkWait, linkRetry,
    describe, kinds, kindsLabel, kindButtons, prompt, desc, lines, linesEmpty, attached, attachedText, disclose, discloseText, included,
    notify, notifyBox, notifyText, error, where, whereText, send,
    attach, fileInput, fileNote, files, tray,
    settings, bindLabel, bindBtn, unbind, bindHint, bindReason, back,
    sizeLabel, sizeButtons, sizeInd, sizeSeg, coachLabel, coachSwitch, techText, techBtn, tech,
    sent, sentTitle, see, seeText, sentClose,
    mark, ink, shapes, draft, pins, coach, coachArtSlot, coachText, coachMore, coachDismiss, coachKeys,
    toolbar, barLead, seg, segInd, toolButtons, toolLabels, cancel, ask, askText, discard, keep,
  };
}

type Els = ReturnType<typeof buildDom>;

/** A mark's number on the page; its note lives in the card (vt-8020 D10), the pin only points there. */
interface Pin {
  el: HTMLElement;
  num: HTMLButtonElement;
  rm: HTMLButtonElement;
}

/** A mark's note line in the card. */
interface Line {
  el: HTMLLIElement;
  num: HTMLSpanElement;
  note: HTMLInputElement;
  rm: HTMLButtonElement;
}

/** An attached file's chip: its name, its size, its ✕. */
interface Chip {
  el: HTMLLIElement;
  size: HTMLSpanElement;
  rm: HTMLButtonElement;
}

export class ReportWidget {
  private readonly hud: HudHost;
  private readonly engine: CaptureEngine | null;
  private config: ReportConfig | null = null;
  private locale: Locale;
  private s: Strings;
  private button: boolean;
  private openSelector: string | null;
  /** This widget's own word: undefined defers to the page-wide identity; null is anonymous. */
  private identity: Identity | null | undefined;
  /** What the next report carries as `context` (vt-9515): replaced whole by setContext, empty sends none. */
  private context: ReportContext;
  private keybind: Keybind | null;

  private isOpen = false;
  /** Where focus was when the card opened, outside the report: close() hands it back. */
  private opener: HTMLElement | SVGElement | null = null;
  private view: View = 'describe';
  private marking = false;
  private markers: Drawn[] = [];
  private nextKey = 1;
  private tool: MarkerShape = TOOLS[0]!;
  /** The coach shows while marking until dismissed (settings.ts readCoach). */
  private coachOn = readCoach();
  /** The shape the coach's art shows; its SVG is rebuilt (and its clock restarted) when the pick changes. */
  private coachShape: MarkerShape | null = null;
  private frozen: Frozen | null = null;
  private job: ReportJob | null = null;
  private sending = false;
  /** Which leg a failed send stopped at: nothing reached the server, a file, or the replay. */
  private error: '' | 'create' | 'files' | 'capture' = '';
  private result: SubmitReply | null = null;
  private notify = false;
  private includedOpen = false;
  private recordingBind = false;
  private bindRefused = false;
  /** The reporter's own word for it (vt-8020 D11); null until they pick one. */
  private kind: ReportKind | null = null;
  /** The marks that existed when this marking pass began: Cancel keeps exactly these (vt-8020 D12). */
  private passKeys = new Set<number>();
  /** Cancel asked "Discard N marks?" and waits for the answer. */
  private confirming = false;
  /** The corner the card is parked in once marking has moved it; null = its anchored place. */
  private parked: Corner | null = null;
  /** The insets marking parks the card with, read where it rested when marking started (insetsAt). */
  private parkInsets: Pick<Frame, 'top' | 'bottom' | 'edge'> | null = null;
  /** The corner the button docks in (drag.ts); the card rests beside it and marking parks it from there. */
  private dock: Corner = readDock();
  /** Which launcher shows (edge.ts); the edge drop's place — its side and a fraction of its band — and that band's insets. */
  private launcher: Launcher;
  private edge: EdgePlace = readEdge();
  /** How attached the drop is to its wall (edge.ts dropForm: 1 with feet, 0.5 the bare body, 0 the free pill), and its tween. */
  private attach = 1;
  private attachRaf = 0;
  /** The card coming or going (vt-3811), and the surface where it is now; null at rest. */
  private morph: Morph | null = null;
  private morphGeo: Geo | null = null;
  /** Panes fading out over the one fading in (vt-3811 SWAP); paint() leaves them shown until they are gone. */
  private readonly leaving = new Map<HTMLElement, Animation>();
  /** This paint may cross-fade the card's panes: the card was already open and showing. */
  private fadeParts = false;
  private readonly insets: EdgeInsets;
  private size: WidgetSize = readSize();
  private techOpen = false;
  /** A press on the button: it becomes a drag once it travels DRAG_THRESHOLD; `grab` is where the pointer holds it. */
  private fabDrag: FabDrag | null = null;
  /** The click that ends a drag is the drop, not a press of the button. */
  private swallowClick = false;
  /** The button's glide to its new corner, while it runs. */
  private glide: AbortController | null = null;
  /** The reporter's attachments (vt-8020 D9), in the order added, and the reason the last refused one got. */
  private files: File[] = [];
  private fileRefusal: Refusal | null = null;
  private pastes = 0;
  private readonly chips = new Map<File, Chip>();
  /** Swaps this widget for the recorder pill; set only for a linked member (setRecordSwitch). */
  private recordSwitch: (() => void) | null = null;
  private menu: Popover | null = null;
  /** The reporter session the host's signed token was traded for (vt-8020 D4), and whose it is: that token and the member link it proved (reader.ts sessionKey). */
  private session: ReporterSession | null = null;
  private sessionKey = '';
  /** The member link this widget last saw for its base ('' none): a change is another person's session (linkChanged). */
  private linkSeen = '';
  /** The vitrinka member this browser is linked to (vt-8020 D3), read with the link's own token. */
  private member: { name: string; email: string; workspace: string } | null = null;
  private mine: { rows: MyReport[]; state: 'loading' | 'failed' | 'ok' } = { rows: [], state: 'ok' };
  private linkFlow: LinkFlow | null = null;
  private drawing: { start: Point; shape: MarkerShape; pointer: number } | null = null;
  private readonly offs: (() => void)[] = [];
  private readonly pins = new Map<number, Pin>();
  private readonly lines = new Map<number, Line>();
  /** Per hide mark: the page nodes it covered when drawn (they are blanked in the capture). */
  private readonly hideIds = new Map<number, Set<number>>();
  /** Native dialogs in the order they opened (seeded with those already open, in DOM order). */
  private dialogOrder: HTMLDialogElement[] = [...document.querySelectorAll('dialog[open]')].filter(
    (d): d is HTMLDialogElement => d instanceof HTMLDialogElement,
  );

  /**
   * Where the report must live: the modal shown last (only the top modal is
   * not inert), else the dialog opened last, else the recorder's rule
   * (`sheetTarget`: ARIA dialogs included).
   */
  private activeDialog(): Element | null {
    this.dialogOrder = this.dialogOrder.filter((d) => d.isConnected && d.open);
    const isModal = (d: HTMLDialogElement) => {
      try {
        return d.matches(':modal');
      } catch {
        return false; // a browser without :modal: opening order decides
      }
    };
    const modal = [...this.dialogOrder].reverse().find(isModal);
    return modal ?? this.dialogOrder.at(-1) ?? sheetTarget();
  }

  /** The open dialog the report lives in while one is up (a modal makes everything outside it inert). */
  private sheet: { target: Element; host: { mount: HTMLElement; destroy: () => void } } | null = null;
  private readonly e: Els;

  constructor(private readonly opts: WidgetOptions) {
    this.locale = opts.locale ?? browserLocale();
    this.s = strings(this.locale);
    this.button = opts.button;
    this.launcher = opts.launcher ?? 'edge';
    this.insets = edgeInsets(opts.edgeInsets);
    this.openSelector = opts.openSelector ?? null;
    this.identity = opts.identity === undefined ? undefined : normalizeIdentity(opts.identity);
    this.context = opts.context ?? {};
    this.keybind = loadKeybind();
    this.hud = createHudHost();
    this.e = buildDom(this.hud.mount);
    this.engine = acquireEngine({
      base: opts.base,
      key: opts.key,
      appVersion: opts.appVersion,
      capture: opts.capture,
      sanitizeUrl: opts.sanitizeUrl,
      loadRecord: opts.loadRecord,
    });
    void this.engine?.ready.then((c) => {
      this.config = c;
      this.paint();
    });
    this.bind();
    this.paint();
    this.followDialog();
  }

  /**
   * Associate with the topmost open dialog so its inert/focus rules leave
   * reporting usable. The sheet host's top-layer popover keeps the button,
   * card and marks anchored to the viewport, independent of the dialog's box.
   * The one DOM tree moves with its draft and marks; focus survives the move.
   */
  private followDialog(): void {
    const target = this.activeDialog();
    if ((this.sheet?.target ?? null) === target) return;
    const root = this.e.root.getRootNode();
    const focused = root instanceof ShadowRoot && root.activeElement instanceof HTMLElement ? root.activeElement : null;
    const previous = this.sheet;
    if (target) {
      const host = createSheetHost(target);
      host.mount.append(this.e.root);
      this.sheet = { target, host };
    } else {
      this.hud.mount.append(this.e.root);
      this.sheet = null;
    }
    previous?.host.destroy();
    focused?.focus();
  }

  // -- public -------------------------------------------------------------

  open(): void {
    if (this.isOpen) return;
    // The drop as it is this moment — its name grown, its swell — is what becomes the card (morphCard).
    const drop = this.morph ? null : this.dropBox();
    this.isOpen = true;
    // Reopened while it was closing: the card it ran back from leaves its parking (close() kept it there).
    if (this.morph) this.unpark();
    this.opener = insideHud(document.activeElement) ? null : deepActiveElement();
    if (this.view !== 'describe') this.view = 'describe';
    this.result = null;
    // The minutes before THIS open; a half-sent report keeps the capture it started with.
    if (!this.job) this.frozen = this.engine?.freeze() ?? null;
    this.paint();
    if (this.morphCard(true, drop)) this.attachTo(0.5, 140);
    requestAnimationFrame(() => this.e.desc.focus());
    // Who you are fills the chip as soon as the server says it.
    void this.refreshWho();
    void this.refreshMember();
  }

  close(): void {
    if (!this.isOpen) return;
    if (this.marking) this.endMarking(false);
    this.stopRecordingBind();
    this.isOpen = false;
    // Morphing back into the drop, the card keeps its view and its place until it is gone (finishMorph).
    if (!this.morphCard(false)) this.closed();
    this.paint();
    // Focus goes back where it came from — the host's control, the field the
    // shortcut fired in — else to the button; never lost to <body> when the
    // host hid the button and opened the card from its own control.
    const opener = this.opener;
    this.opener = null;
    opener?.focus();
    if (opener && deepActiveElement() === opener) return;
    if (this.button) this.e.fab.focus();
  }

  setLocale(raw: string | null | undefined): void {
    const next = parseLocale(raw) ?? browserLocale();
    if (next === this.locale) return;
    this.locale = next;
    this.s = strings(next);
    this.paint();
  }

  setButton(on: boolean): void {
    this.button = on;
    this.paint();
  }

  setLauncher(l: Launcher): void {
    if (l === this.launcher) return;
    this.stopMorph();
    this.launcher = l;
    this.paint();
  }

  setOpenSelector(sel: string | null): void {
    this.openSelector = sel || null;
  }

  /**
   * The way to the recorder pill (vt-8020 D8): element.ts sets it only for a
   * linked vitrinka member — the menu then offers "Record" — and clears it
   * with null; reporters never get one.
   */
  setRecordSwitch(fn: (() => void) | null): void {
    this.recordSwitch = fn;
    this.paint();
  }

  identify(input: IdentifyInput): void {
    // null (or a malformed identity) is this widget going anonymous; undefined hands it back to the page-wide one.
    this.identity = input === undefined ? undefined : normalizeIdentity(input);
    this.whoChanged();
  }

  /** Replace what the next report carries as `context` (vt-9515); element.ts has validated it. A report already created keeps what it was created with. */
  setContext(context: ReportContext): void {
    this.context = context;
  }

  unmount(): void {
    this.stopMorph();
    cancelAnimationFrame(this.attachRaf);
    if (this.fabDrag) cancelAnimationFrame(this.fabDrag.raf);
    this.stopRecordingBind();
    this.linkFlow?.abort.abort();
    for (const off of this.offs.splice(0).reverse()) off();
    releaseEngine(this.engine);
    this.sheet?.host.destroy();
    this.sheet = null;
    this.hud.destroy();
  }

  // -- behaviour ------------------------------------------------------------

  private bind(): void {
    const e = this.e;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (ev: HTMLElementEventMap[K]) => void) => {
      el.addEventListener(type, fn);
    };
    on(e.fab, 'click', () => {
      if (this.swallowClick) {
        this.swallowClick = false;
        return;
      }
      if (this.isOpen) this.close();
      else this.open();
    });
    // The button moves to any corner (vt-8020 D9): dragged, or Alt+arrows while it has the focus.
    on(e.fab, 'pointerdown', (ev) => this.fabDown(ev));
    on(e.fab, 'pointermove', (ev) => this.fabMove(ev));
    on(e.fab, 'pointerup', (ev) => this.fabUp(ev, true));
    on(e.fab, 'pointercancel', (ev) => this.fabUp(ev, false));
    on(e.fab, 'keydown', (ev) => {
      if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      if (this.launcher === 'edge') {
        // ↑/↓ along the edge, ←/→ across to the other one (Alt+← is the browser's Back).
        const to = edgeToward(this.edge, ev.key);
        if (to === null) return;
        ev.preventDefault();
        if (to.side !== this.edge.side || to.at !== this.edge.at) this.moveEdge(to);
        return;
      }
      const next = cornerToward(this.dock, ev.key);
      if (!next) return;
      ev.preventDefault(); // Alt+← is the browser's Back
      if (next !== this.dock) this.moveDock(next);
    });
    on(e.attach, 'click', () => e.fileInput.click());
    on(e.fileInput, 'change', () => {
      this.addFiles([...(e.fileInput.files ?? [])]);
      e.fileInput.value = ''; // the same file picked again is a new pick
    });
    // A pasted or dropped file joins the attachments; pasted or dropped text stays the field's.
    on(e.card, 'paste', (ev) => {
      const pasted = [...(ev.clipboardData?.files ?? [])];
      if (!pasted.length || !this.canAttach()) return;
      // Office puts copied text beside an image of it: the text wins, unless it is only the copied file's name (the pill's rule, Sheet.tsx).
      const text = ev.clipboardData?.getData('text/plain').trim() ?? '';
      if (text && !pasted.some((f) => f.name && text.includes(f.name))) return;
      ev.preventDefault();
      this.addFiles(
        pasted.map((f) => {
          const name = pastedName(f.name, ++this.pastes);
          return name === f.name ? f : new File([f], name, { type: f.type, lastModified: f.lastModified });
        }),
      );
    });
    on(e.card, 'dragover', (ev) => {
      if (!ev.dataTransfer?.types.includes('Files') || !this.canAttach()) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      e.card.classList.add('dropping');
    });
    on(e.card, 'dragleave', (ev) => {
      if (ev.relatedTarget instanceof Node && e.card.contains(ev.relatedTarget)) return;
      e.card.classList.remove('dropping');
    });
    on(e.card, 'drop', (ev) => {
      e.card.classList.remove('dropping');
      const dropped = [...(ev.dataTransfer?.files ?? [])];
      if (!dropped.length || !this.canAttach()) return;
      ev.preventDefault();
      this.addFiles(dropped);
    });
    for (const [z, btn] of e.sizeButtons) {
      on(btn, 'click', () => {
        this.size = z;
        writePref(SIZE_KEY, z);
        this.paint();
        // A parked card is placed by its painted size: re-place it at the new one, in its corner at once.
        if (this.parked) this.placeCard(true);
      });
    }
    const setCoach = (shown: boolean) => {
      this.coachOn = shown;
      writePref(COACH_KEY, shown ? 'on' : 'off');
      this.paint();
    };
    on(e.coachDismiss, 'click', () => {
      setCoach(false);
      // The button that had focus is gone: drawing goes on from the layer.
      if (this.marking) e.mark.focus();
    });
    on(e.coachSwitch, 'click', () => setCoach(!this.coachOn));
    on(e.techBtn, 'click', () => {
      this.techOpen = !this.techOpen;
      this.paint();
    });
    on(e.closeBtn, 'click', () => this.close());
    on(e.whoBtn, 'click', () => this.toggleMenu('account'));
    on(e.more, 'click', () => this.toggleMenu('more'));
    const fromMenu = (fn: () => void) => () => {
      this.menu = null;
      fn();
      this.paint();
    };
    // A role=menu moves its focus with the arrows, Home and End over the items on show (the pill's Menu.tsx onKey).
    on(e.morePop, 'keydown', (ev) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) return;
      const items = [...e.morePop.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((el) => !el.hidden && !(el instanceof HTMLButtonElement && el.disabled));
      if (!items.length) return;
      ev.preventDefault();
      const root = e.morePop.getRootNode() as ShadowRoot | Document;
      const at = items.indexOf(root.activeElement as HTMLElement);
      const last = items.length - 1;
      const down = ev.key === 'ArrowDown';
      const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? last : at < 0 ? (down ? 0 : last) : (at + (down ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    });
    on(e.mReports, 'click', fromMenu(() => void this.openReports()));
    on(e.mRecents, 'click', fromMenu(() => this.show('recents')));
    const switchFace = fromMenu(() => this.recordSwitch?.());
    // A waiting Record stays focusable so it can say why (paintAccount), so its press must do nothing: the menu stays open.
    on(e.mRecord, 'click', () => {
      if (!this.recordWaits()) switchFace();
    });
    on(e.mSettings, 'click', fromMenu(() => this.show('settings')));
    on(e.mOpen, 'click', fromMenu(() => undefined));
    on(e.accPortal, 'click', fromMenu(() => undefined));
    on(e.accLink, 'click', fromMenu(() => this.startLinkFlow()));
    on(e.accUnlink, 'click', () => {
      // clearLink notifies: linkChanged drops the session and the list read with the link, a response in flight included.
      clearLink();
      this.member = null;
      this.paint();
    });
    for (const b of [e.repBack, e.recBack, e.linkBack]) on(b, 'click', () => this.show('describe'));
    on(e.linkRetry, 'click', () => this.startLinkFlow());
    // A press anywhere in the card but the open popover (or its button) closes it.
    on(e.card, 'pointerdown', (ev) => {
      const t = ev.target;
      if (!this.menu || !(t instanceof Node)) return;
      if ([e.accountPop, e.morePop, e.whoBtn, e.more].some((el) => el.contains(t))) return;
      this.menu = null;
      this.paint();
    });
    on(e.back, 'click', () => this.show('describe'));
    on(e.sentClose, 'click', () => this.close());
    on(e.desc, 'input', () => this.paint());
    on(e.disclose, 'click', () => {
      this.includedOpen = !this.includedOpen;
      this.paint();
    });
    on(e.notifyBox, 'change', () => {
      this.notify = e.notifyBox.checked;
    });
    on(e.where, 'click', () => (this.marking ? this.endMarking(true) : this.startMarking()));
    on(e.send, 'click', () => void this.send());
    on(e.bindBtn, 'click', () => (this.recordingBind ? this.stopRecordingBind() : this.startRecordingBind()));
    on(e.unbind, 'click', () => {
      this.keybind = null;
      saveKeybind(null);
      this.paint();
    });
    for (const [kind, btn] of e.kindButtons) {
      // A second press on the picked word unpicks it: the word is optional.
      on(btn, 'click', () => {
        this.kind = this.kind === kind ? null : kind;
        this.paint();
      });
    }
    for (const [tool, btn] of e.toolButtons) {
      on(btn, 'click', (ev) => {
        this.tool = tool;
        this.renderKbDraft();
        this.paint();
        this.placeSeg();
        // From the keyboard (no pointer: detail 0), go straight back to drawing with it.
        if (ev.detail === 0) e.mark.focus();
      });
    }
    on(e.mark, 'keydown', (ev) => this.markKey(ev));
    on(e.cancel, 'click', () => this.cancelMarking());
    on(e.discard, 'click', () => {
      this.markers = renumberDrawn(this.markers.filter((m) => this.passKeys.has(m.key)));
      this.renderMarks();
      this.endMarking(true);
    });
    on(e.keep, 'click', () => {
      this.confirming = false;
      this.paint();
      e.cancel.focus();
    });
    on(e.mark, 'pointerdown', (ev) => this.pointerDown(ev));
    on(e.mark, 'pointermove', (ev) => this.pointerMove(ev));
    on(e.mark, 'pointerup', (ev) => this.pointerUp(ev));
    on(e.mark, 'pointercancel', () => this.cancelDraft());
    // The page is frozen while marking: it never scrolls under the marks.
    this.offs.push(listen(e.mark, 'wheel', (ev) => ev.preventDefault()));
    this.offs.push(listen(e.mark, 'touchmove', (ev) => ev.preventDefault()));

    this.offs.push(
      listen(
        window,
        'keydown',
        (ev) => {
          const inCard = ev.composedPath().includes(e.card);
          // A modal's document-capture listener runs before a card listener.
          // Own this Escape at window capture so it never dismisses the app's dialog.
          if (ev.key === 'Escape' && this.isOpen && (this.marking || inCard)) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            if (this.recordingBind) {
              this.stopRecordingBind();
            } else if (this.marking) {
              if (this.confirming) e.keep.click();
              else if (this.kbDraft) this.cancelDraft();
              else this.endMarking(true);
            } else if (this.menu) {
              const opener = this.menu === 'account' ? e.whoBtn : e.more;
              this.menu = null;
              this.paint();
              opener.focus();
            } else if (this.view !== 'describe' && this.view !== 'sent') this.show('describe');
            else this.close();
            return;
          }
          if (this.recordingBind) return;
          // ⌘Z / Ctrl+Z takes the newest mark back — unless a field is being typed in, whose own undo wins.
          if (this.marking && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'z' && !typing()) {
            ev.preventDefault();
            this.markers = renumberDrawn(this.markers.slice(0, -1));
            this.renderMarks();
            this.paint();
            return;
          }
          if (this.keybind && matchesKeybind(ev, this.keybind)) {
            ev.preventDefault();
            if (this.isOpen) this.close();
            else this.open();
          }
        },
        { capture: true },
      ),
    );
    this.offs.push(
      listen(document, 'click', (ev) => {
        if (!hitsOpener(ev, this.openSelector)) return;
        ev.preventDefault();
        this.open();
      }),
    );
    // The drop's one path follows its width as its name grows and shrinks — in the frame the width changes.
    if (typeof ResizeObserver === 'function') {
      const shape = new ResizeObserver(() => this.shapeDrop());
      shape.observe(e.fab);
      this.offs.push(() => shape.disconnect());
    }
    // A phone's sheet rides the visual viewport: above the on-screen keyboard, as tall as what is left (styles).
    const vv = globalThis.visualViewport;
    if (vv) {
      const pin = () => this.pinSheet();
      this.offs.push(listen(vv, 'resize', pin), listen(vv, 'scroll', pin));
    }
    this.pinSheet();
    this.offs.push(listen(window, 'resize', () => {
      this.pinSheet();
      if (this.launcher === 'edge') this.placeEdge();
      if (this.parked) this.placeCard(true);
      if (this.marking) this.placeSeg();
    }));
    this.offs.push(watchKeybind((b) => {
      this.keybind = b;
      this.paint();
    }));
    this.offs.push(onSharedIdentity(() => this.whoChanged()));
    // Linked, unlinked or relinked — here, in the link flow, or in another tab: the session belongs to the pairing it proved.
    this.linkSeen = memberTokenFor(this.opts.base);
    this.offs.push(watchMemberLink(() => this.linkChanged()));
    // The recorder took the page's capture over: stop saying minutes are attached.
    if (this.engine) this.offs.push(this.engine.onChange(() => this.paint()));
    // Dialogs open and close anywhere: follow them, at most once a frame.
    let frame = 0;
    const dialogs = new MutationObserver((records) => {
      // The order dialogs open in: a modal shown later sits on top, whatever the DOM order.
      // Only a closed → open transition is an opening; a redundant write to an open dialog changes nothing.
      for (const r of records) {
        if (r.type !== 'attributes' || r.attributeName !== 'open' || !(r.target instanceof HTMLDialogElement)) continue;
        const target = r.target;
        if (!target.open) this.dialogOrder = this.dialogOrder.filter((d) => d !== target);
        else if (r.oldValue === null) this.dialogOrder = [...this.dialogOrder.filter((d) => d !== target), target];
      }
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        this.followDialog();
      });
    });
    dialogs.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['open', 'data-state'],
    });
    this.offs.push(() => {
      dialogs.disconnect();
      if (frame) cancelAnimationFrame(frame);
    });
  }

  private show(view: View): void {
    this.stopRecordingBind();
    if (view !== 'link' && this.linkFlow) {
      this.linkFlow.abort.abort();
      this.linkFlow = null;
    }
    this.view = view;
    this.paint();
    const focus = { describe: this.e.desc, settings: this.e.bindBtn, sent: null, reports: this.e.repBack, recents: this.e.recBack, link: this.e.linkBack }[view];
    if (focus) requestAnimationFrame(() => focus.focus());
  }

  // -- the account and the lists (vt-8020 D2–D5) ------------------------------

  private target(): { url: string; key: string } {
    return { url: this.opts.base, key: this.opts.key };
  }

  private toggleMenu(which: Popover): void {
    this.menu = this.menu === which ? null : which;
    if (this.menu === 'account') {
      void this.refreshWho();
      void this.refreshMember();
    }
    this.paint();
    const pop = this.menu === 'account' ? this.e.accountPop : this.menu === 'more' ? this.e.morePop : null;
    const first = pop?.querySelector<HTMLElement>('button:not([hidden]), a:not([hidden])');
    first?.focus();
  }

  /**
   * The host's signed token traded once for a reporter session, with the
   * member link beside it when this browser holds one for the base; renewed
   * only when it is about to lapse. Answers the session in force.
   */
  private async refreshWho(): Promise<ReporterSession | null> {
    const token = this.whoToken();
    if (!token) {
      this.session = null;
      this.sessionKey = '';
      return null;
    }
    const member = memberTokenFor(this.opts.base);
    const key = sessionKey(token, member);
    if (this.sessionKey === key && sessionLive(this.session)) return this.session;
    this.sessionKey = key;
    let opened: ReporterSession | null = null;
    try {
      opened = await openSession(this.target(), token, member);
    } catch (e) {
      console.warn('vitrinka: the reporter session could not be opened — My reports shows this browser’s reports only', e);
    }
    // The person or the member link changed while the trade was in flight (whoChanged): this session is someone else's now.
    if (this.sessionKey !== key) return null;
    this.session = opened;
    this.paint();
    // A link forgotten here moves the key (linkChanged), and the session for the reporter alone is opened instead.
    if (opened?.memberError) this.memberRefused(opened.memberError, member);
    return this.sessionKey === key ? this.session : null;
  }

  /** Whose session the widget should hold now (reader.ts sessionKey). */
  private whoKey(): string {
    return sessionKey(this.whoToken(), memberTokenFor(this.opts.base));
  }

  /**
   * identify(), the page-wide identity or the member link moved: a session
   * and a list read for the previous person never stay on screen for the
   * next one, and an open My reports reloads for whoever is here now.
   */
  private whoChanged(): void {
    if (this.whoKey() !== this.sessionKey) {
      this.session = null;
      this.sessionKey = '';
      this.mine = { rows: [], state: 'ok' };
      if (this.isOpen) void (this.view === 'reports' ? this.loadReports() : this.refreshWho());
    }
    this.paint();
  }

  /**
   * The stored link moved (watchMemberLink: Unlink, the link flow, another
   * tab, a refused link forgotten). Only a change of this base's link counts;
   * the recorder's other notifications pass. The member the popover named was
   * the previous link's: an open card reads the new link's (refreshMember).
   */
  private linkChanged(): void {
    const now = memberTokenFor(this.opts.base);
    if (now === this.linkSeen) return;
    this.linkSeen = now;
    this.member = null;
    if (now && this.isOpen) void this.refreshMember();
    this.whoChanged();
  }

  /**
   * vitrinka did not take the member link a report or a session proved
   * (`memberError`): they stand as the reporter's alone. A link revoked, or
   * whose person is no longer a member, is forgotten as a 401 on a session
   * door forgets it (recorder/link.ts) — only the one that was sent, never a
   * link made since. Any other answer keeps it.
   */
  private memberRefused(err: string, sent: string): void {
    const gone = memberLinkGone(err);
    console.warn(`vitrinka: vitrinka did not take this browser’s member link (${err}) — ${gone ? 'it is forgotten; link the account again' : 'it stays linked, and the reporter alone owns what goes with it'}`);
    if (gone && sent && readLink()?.token === sent) forgetLink();
  }

  private async refreshMember(): Promise<void> {
    // The browser-wide link goes only to the vitrinka it was minted on: its token never reaches another widget's base.
    const link = memberLinked(this.opts.base) ? readLink() : null;
    if (!link) {
      if (this.member) {
        this.member = null;
        this.paint();
      }
      return;
    }
    let member: { name: string; email: string; workspace: string };
    let mode: string | undefined;
    try {
      const me = await api<{ user?: { email?: string; name?: string } | null; workspace?: { slug?: string }; displayMode?: string }>(
        'GET',
        '/api/v1/recorder/me',
        undefined,
        { target: { url: this.opts.base, key: link.token } },
      );
      member = { email: me.user?.email ?? '', name: me.user?.name ?? '', workspace: me.workspace?.slug ?? link.workspace };
      mode = me.displayMode;
    } catch (e) {
      console.warn('vitrinka: the linked vitrinka account could not be read', e);
      member = { email: '', name: '', workspace: link.workspace };
    }
    // The link moved while vitrinka answered (linkChanged): this member, and their mode, are the previous link's.
    if (memberTokenFor(this.opts.base) !== link.token) return;
    this.member = member;
    // A dev-mode member starts on the pill next mount (face.ts startFace).
    rememberDisplayMode(mode);
    this.paint();
  }

  private async openReports(): Promise<void> {
    this.show('reports');
    await this.loadReports();
  }

  private async loadReports(): Promise<void> {
    const asked = this.whoKey();
    const session = await this.refreshWho();
    // The person or the member link changed meanwhile: whoChanged already reloads for the next one.
    if (this.whoKey() !== asked) return;
    if (!session) {
      this.mine = { rows: [], state: 'ok' };
      this.paint();
      return;
    }
    this.mine = { rows: [], state: 'loading' };
    this.paint();
    let mine: typeof this.mine;
    try {
      mine = { rows: await this.listMineRenewing(session), state: 'ok' };
    } catch (e) {
      console.warn('vitrinka: My reports could not be loaded', e);
      mine = { rows: [], state: 'failed' };
    }
    // A list read for the previous person or link is dropped; whoChanged already reloads for the next one.
    if (this.whoKey() !== asked) return;
    this.mine = mine;
    this.paint();
  }

  /** My reports; a 401 means the reporter session lapsed or the host's key rotated: trade the token again, then ask once more. */
  private async listMineRenewing(session: ReporterSession): Promise<MyReport[]> {
    try {
      return (await listMine(this.target(), session.session)).reports;
    } catch (e) {
      if (!(e instanceof VitrinkaApiError) || e.status !== 401) throw e;
      this.session = null;
      this.sessionKey = '';
      const renewed = await this.refreshWho();
      if (!renewed) throw e;
      return (await listMine(this.target(), renewed.session)).reports;
    }
  }

  /** The pill's member link (vt-8020 D3): a code approved in vitrinka mints this browser's own recorder key. */
  private startLinkFlow(): void {
    this.linkFlow?.abort.abort();
    const flow: LinkFlow = { start: null, state: 'starting', abort: new AbortController() };
    this.linkFlow = flow;
    this.show('link');
    const base = this.opts.base;
    const workspace = linkWorkspace(base);
    void (async () => {
      try {
        flow.start = await startLink(base, { label: defaultLinkLabel(), workspace });
        flow.state = 'waiting';
        this.paint();
        const linked = await pollLink(base, flow.start.device_code, {
          interval: flow.start.interval,
          expiresIn: flow.start.expires_in,
          workspace,
          signal: flow.abort.signal,
        });
        // The link names the vitrinka it belongs to: face.ts offers the pill only on that base.
        // Storing it notifies: linkChanged reads the new member for an open card.
        storeLink({ ...linked, base });
        this.linkFlow = null;
        this.show('describe');
      } catch (e) {
        if (flow.abort.signal.aborted) return;
        flow.state = e instanceof LinkExpired ? 'expired' : 'failed';
        if (flow.state === 'failed') console.warn('vitrinka: linking the vitrinka account failed', e);
        this.paint();
      }
    })();
  }

  /** "2 h ago" in the widget's language. */
  private ago(at: number): string {
    const rtf = new Intl.RelativeTimeFormat(this.locale, { numeric: 'auto' });
    const s = Math.round((at - Date.now()) / 1000);
    const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
    let v = s;
    for (const [size, unit] of steps) {
      if (Math.abs(v) < size) return rtf.format(v, unit);
      v = Math.round(v / size);
    }
    return rtf.format(v, 'year');
  }

  /** One list row: a title, a quiet state chip and its age; a link when the server minted an address. */
  private row(title: string, state: string, at: number, url?: string): HTMLLIElement {
    const kids = [h('span', { class: 'row-t' }, title), h('span', { class: 'step' }, state), h('span', { class: 'age' }, this.ago(at))];
    const inner = url ? h('a', { class: 'row', href: url, target: '_blank', rel: 'noopener noreferrer' }, ...kids) : h('div', { class: 'row' }, ...kids);
    return h('li', {}, inner);
  }

  private who(): Identity | null {
    return this.identity !== undefined ? this.identity : sharedIdentity();
  }

  /** The signed token of the person here now; '' for an asserted or anonymous reporter. */
  private whoToken(): string {
    const who = this.who();
    return who && 'token' in who ? who.token : '';
  }

  // -- the shortcut recorder ----------------------------------------------

  private stopBindListener: (() => void) | null = null;

  private startRecordingBind(): void {
    this.recordingBind = true;
    this.bindRefused = false;
    this.stopBindListener = listen(
      window,
      'keydown',
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const verdict = readKeybindPress(ev);
        if (verdict.kind === 'wait') return;
        if (verdict.kind === 'bare') {
          this.bindRefused = true;
          this.paint();
          return;
        }
        if (verdict.kind === 'bind') {
          this.keybind = verdict.bind;
          saveKeybind(verdict.bind);
        }
        this.stopRecordingBind();
      },
      { capture: true },
    );
    this.paint();
  }

  private stopRecordingBind(): void {
    if (!this.recordingBind) return;
    this.recordingBind = false;
    this.bindRefused = false;
    this.stopBindListener?.();
    this.stopBindListener = null;
    this.paint();
  }

  // -- the reporter's files (vt-8020 D9) ---------------------------------------

  /** Files join while the report is being written — not while it is on its way (Retry sends it as it was). */
  private canAttach(): boolean {
    return this.isOpen && this.view === 'describe' && !this.sending && !this.job?.id;
  }

  private caps(): AttachmentCaps {
    return this.config?.attachments ?? DEFAULT_ATTACHMENT_CAPS;
  }

  private addFiles(incoming: readonly File[]): void {
    if (!incoming.length) return;
    const { files, refusal } = admit(this.files, incoming, this.caps());
    this.files = [...this.files, ...files];
    this.fileRefusal = refusal;
    this.renderFiles();
    this.paint();
  }

  private removeFile(f: File): void {
    this.files = this.files.filter((x) => x !== f);
    this.fileRefusal = null;
    this.renderFiles();
    this.paint();
    // Its ✕ is gone: the focus goes to 📎, never lost to <body>.
    this.e.attach.focus();
  }

  /** One chip per file, built once; paint() writes their sizes and labels. */
  private renderFiles(): void {
    const live = new Set(this.files);
    for (const [f, chip] of this.chips) {
      if (live.has(f)) continue;
      chip.el.remove();
      this.chips.delete(f);
    }
    for (const f of this.files) {
      if (this.chips.has(f)) continue;
      const size = h('span', { class: 'file-size' });
      const rm = h('button', { class: 'ln-x', type: 'button' }, icon(ICON.close));
      const el = h('li', { class: 'file' }, h('span', { class: 'file-name' }, f.name), size, rm);
      rm.addEventListener('click', () => this.removeFile(f));
      this.e.files.append(el);
      this.chips.set(f, { el, size, rm });
    }
  }

  /** The one line a refused file gets: the cap it broke, by name. */
  private refusalText(r: Refusal | null): string {
    const s = this.s;
    if (!r) return '';
    if (r.kind === 'size') return s.fileTooBig(r.name, formatBytes(r.cap, this.locale));
    if (r.kind === 'count') return s.tooManyFiles(r.cap);
    return s.fileType(r.name, typesLabel(this.caps().types, s.typeNames, this.locale));
  }

  // -- the button's corner (vt-8020 D9) ---------------------------------------

  private fabDown(ev: PointerEvent): void {
    this.swallowClick = false;
    if (ev.button !== 0 || !ev.isPrimary) return;
    const r = this.e.fab.getBoundingClientRect();
    this.fabDrag = {
      pointer: ev.pointerId,
      start: { x: ev.clientX, y: ev.clientY },
      grab: { x: ev.clientX - r.left, y: ev.clientY - r.top },
      moved: false,
      left: r.left,
      top: r.top,
      vx: 0,
      vy: 0,
      at: ev.timeStamp,
      raf: 0,
    };
    try {
      this.e.fab.setPointerCapture(ev.pointerId);
    } catch {
      // a synthetic pointer: no capture needed
    }
  }

  /** Past the threshold the press is a drag: the button rides the pointer, inside the viewport. */
  private fabMove(ev: PointerEvent): void {
    const d = this.fabDrag;
    if (!d || ev.pointerId !== d.pointer) return;
    if (!d.moved && Math.hypot(ev.clientX - d.start.x, ev.clientY - d.start.y) < DRAG_THRESHOLD) return;
    const first = !d.moved;
    d.moved = true;
    if (this.launcher === 'edge') {
      this.carryDrop(d, ev, first);
      return;
    }
    const fab = this.e.fab;
    fab.classList.add('dragging');
    const r = fab.getBoundingClientRect();
    const vw = globalThis.innerWidth || 800;
    const vh = globalThis.innerHeight || 600;
    const s = fab.style;
    s.left = `${Math.min(Math.max(0, ev.clientX - d.grab.x), vw - r.width)}px`;
    s.top = `${Math.min(Math.max(0, ev.clientY - d.grab.y), vh - r.height)}px`;
    s.right = 'auto';
    s.bottom = 'auto';
  }

  /** A drop docks the button in the nearest corner (a cancelled drag goes home); a press that never travelled stays a click. */
  private fabUp(ev: PointerEvent, drop: boolean): void {
    const d = this.fabDrag;
    if (!d || ev.pointerId !== d.pointer) return;
    this.fabDrag = null;
    if (!d.moved) return;
    // The click this pointerup is about to fire is the drop; a click that never comes must not eat the next one.
    this.swallowClick = true;
    setTimeout(() => {
      this.swallowClick = false;
    }, 0);
    if (this.launcher === 'edge') {
      this.landDrop(d, drop);
      return;
    }
    const fab = this.e.fab;
    const at = fab.getBoundingClientRect();
    fab.classList.remove('dragging');
    for (const p of ['left', 'top', 'right', 'bottom']) fab.style.removeProperty(p);
    const vw = globalThis.innerWidth || 800;
    const vh = globalThis.innerHeight || 600;
    this.moveDock(drop ? nearestCorner({ x: at.left + at.width / 2, y: at.top + at.height / 2 }, vw, vh) : this.dock, at);
  }

  /** Docks the button in `c` and remembers it; it glides there from `from` (the drop point, else where it was). */
  private moveDock(c: Corner, from?: DOMRect): void {
    const fab = this.e.fab;
    const before = from ?? fab.getBoundingClientRect();
    this.dock = c;
    saveDock(c);
    this.paint();
    if (fab.hidden || reducedMotion()) return;
    const after = fab.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (!dx && !dy) return;
    // FLIP: start where it was, then let the placement transition carry it home.
    this.glide?.abort();
    const glide = new AbortController();
    this.glide = glide;
    fab.classList.remove('gliding');
    fab.style.setProperty('translate', `${dx}px ${dy}px`);
    void fab.offsetWidth;
    fab.classList.add('gliding');
    fab.style.setProperty('translate', '0px 0px');
    // Only this glide's own end: the hover lift transitions too, and a newer glide replaces this one.
    const done = (ev: TransitionEvent) => {
      if (ev.propertyName !== 'translate') return;
      glide.abort();
      fab.classList.remove('gliding');
      fab.style.removeProperty('translate');
    };
    fab.addEventListener('transitionend', done, { signal: glide.signal });
    fab.addEventListener('transitioncancel', done, { signal: glide.signal });
  }

  // -- the edge drop (vt-3811) -------------------------------------------------

  /** The corner the launcher rests in, for marking and the coach: the dock, or the drop's side and half of its edge. */
  private rest(): Corner {
    return this.launcher === 'edge' ? edgeCorner(this.edge.at, this.edge.side) : this.dock;
  }

  /**
   * Moves the drop to `place` and remembers it. Along the edge the stylesheet's transition carries it; across
   * to the other edge (Alt+←/→) it lands there at once and regrows its feet on that wall with a wobble.
   */
  private moveEdge(place: EdgePlace): void {
    const crossed = place.side !== this.edge.side;
    this.edge = place;
    saveEdge(place);
    this.paint();
    if (!crossed) return;
    this.attach = 0.5;
    this.attachTo(1, 320, true);
    this.settle();
  }

  /** One damped wobble after a drag (styles: `.settle`); nothing under reduced motion. */
  private settle(): void {
    const fab = this.e.fab;
    if (reducedMotion()) return;
    fab.classList.remove('settle');
    void fab.offsetWidth;
    fab.classList.add('settle');
    fab.addEventListener('animationend', () => fab.classList.remove('settle'), { once: true });
  }

  /**
   * Places the drop on its edge and the card beside it, centred on it (edge.ts). Both go through custom
   * properties so the stylesheet keeps every other rule; a drag in progress places the drop itself.
   */
  private placeEdge(): void {
    const root = this.e.root;
    const vh = globalThis.innerHeight || 600;
    const k = SIZE_SCALE[this.size];
    const dropH = DROP.h * k;
    const top = edgeTop(this.edge.at, vh, dropH, this.insets);
    root.style.setProperty('--vr-drop-top', `${top}px`);
    const cardH = Math.min(CARD.h * k, vh - 32);
    root.style.setProperty('--vr-card-top', `${cardTopBeside(top, dropH, cardH, vh)}px`);
  }

  /**
   * Redraws the drop's one outline (edge.ts dropPath) for its width now, its side and how attached it is —
   * the body and both feet a single area, so no seam or outline shows anywhere.
   */
  private shapeDrop(): void {
    if (this.launcher !== 'edge') return;
    const e = this.e;
    const w = e.fab.offsetWidth;
    const hgt = e.fab.offsetHeight;
    if (!w || !hgt) return;
    const { foot, round } = dropForm(this.attach);
    e.fabShape.setAttribute('viewBox', `0 0 ${w} ${hgt + 2 * DROP_FOOT}`);
    e.fabFill.setAttribute('d', dropPath(w, hgt, this.edge.side, foot, round));
  }

  /** Tweens how attached the drop is (dropForm) to `target` over `ms`; at once under reduced motion. */
  private attachTo(target: number, ms: number, overshoot = false): void {
    cancelAnimationFrame(this.attachRaf);
    this.attachRaf = 0;
    if (ms <= 0 || reducedMotion() || typeof requestAnimationFrame !== 'function') {
      this.attach = target;
      this.shapeDrop();
      return;
    }
    const from = this.attach;
    const ease = overshoot ? easeBack : easeOut;
    let t0 = 0;
    const step = (now: number) => {
      t0 ||= now;
      const t = Math.min(1, (now - t0) / ms);
      this.attach = lerp(from, target, ease(t));
      this.shapeDrop();
      if (t < 1) this.attachRaf = requestAnimationFrame(step);
      else this.attachRaf = 0;
    };
    this.attachRaf = requestAnimationFrame(step);
  }

  /**
   * Carried (vt-3811): the drop comes off the wall — its feet retract and it rounds into a free pill — and
   * rides the pointer anywhere in the viewport, centred under it, stretching the way it moves (stretchDrop).
   */
  private carryDrop(d: FabDrag, ev: PointerEvent, first: boolean): void {
    const fab = this.e.fab;
    if (first) {
      this.glide?.abort();
      this.glide = null;
      fab.classList.remove('gliding', 'settle');
      fab.style.removeProperty('translate');
      fab.classList.add('dragging');
      this.attachTo(0, 200);
      if (!reducedMotion() && typeof requestAnimationFrame === 'function') d.raf = requestAnimationFrame(() => this.stretchDrop());
    }
    const vw = globalThis.innerWidth || 800;
    const vh = globalThis.innerHeight || 600;
    const w = fab.offsetWidth || DROP.w;
    const hgt = fab.offsetHeight || DROP.h;
    const left = clamp(ev.clientX - w / 2, 0, Math.max(0, vw - w));
    const top = clamp(ev.clientY - hgt / 2, 0, Math.max(0, vh - hgt));
    const dt = Math.max(1, ev.timeStamp - d.at);
    // Smoothed px per ms: one jittery event never flicks the stretch.
    d.vx = d.vx * 0.6 + ((left - d.left) / dt) * 0.4;
    d.vy = d.vy * 0.6 + ((top - d.top) / dt) * 0.4;
    d.left = left;
    d.top = top;
    d.at = ev.timeStamp;
    fab.style.left = `${left}px`;
    fab.style.top = `${top}px`;
  }

  /** While carried, once a frame: the pill stretches along its motion and eases back round when it slows. */
  private stretchDrop(): void {
    const d = this.fabDrag;
    if (!d?.moved || this.launcher !== 'edge') return;
    // No move for a moment: the motion dies away, and so does the stretch.
    if (performance.now() - d.at > 48) {
      d.vx *= 0.8;
      d.vy *= 0.8;
    }
    const s = Math.min(0.24, Math.hypot(d.vx, d.vy) * 0.09);
    const a = (Math.atan2(d.vy, d.vx) * 180) / Math.PI;
    this.e.fab.style.transform = s < 0.004 ? '' : `rotate(${a.toFixed(1)}deg) scale(${(1 + s).toFixed(3)}, ${(1 - s * 0.6).toFixed(3)}) rotate(${(-a).toFixed(1)}deg)`;
    d.raf = requestAnimationFrame(() => this.stretchDrop());
  }

  /**
   * Let go (vt-3811): the pill lands on the NEARER side edge at the height it was let go, inside the band
   * (a cancelled drag goes home). It glides onto that wall (FLIP on translate), then straightens against it,
   * regrows its feet and settles with one damped wobble. The side and the fraction are remembered.
   */
  private landDrop(d: FabDrag, drop: boolean): void {
    const fab = this.e.fab;
    cancelAnimationFrame(d.raf);
    fab.style.transition = 'none';
    fab.style.removeProperty('transform');
    const before = fab.getBoundingClientRect();
    const vw = globalThis.innerWidth || 800;
    const vh = globalThis.innerHeight || 600;
    // Read from where the drag put it (its top), never the painted box alone: the stretch scaled that box.
    const place: EdgePlace = drop
      ? { side: nearerSide(before.left + before.width / 2, vw), at: edgeFraction(d.top, vh, DROP.h * SIZE_SCALE[this.size], this.insets) }
      : this.edge;
    fab.classList.remove('dragging');
    for (const p of ['left', 'top', 'right']) fab.style.removeProperty(p);
    this.edge = place;
    if (drop) saveEdge(place);
    this.paint();
    const after = fab.getBoundingClientRect();
    if (reducedMotion() || fab.hidden) {
      fab.style.removeProperty('transition');
      this.attachTo(1, 0);
      return;
    }
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    this.glide?.abort();
    const glide = new AbortController();
    this.glide = glide;
    fab.style.setProperty('translate', `${dx}px ${dy}px`);
    void fab.offsetWidth;
    fab.style.removeProperty('transition');
    fab.classList.add('gliding');
    fab.style.setProperty('translate', '0px 0px');
    const arrive = () => {
      glide.abort();
      if (this.glide === glide) this.glide = null;
      fab.classList.remove('gliding');
      fab.style.removeProperty('translate');
      this.attachTo(1, 340, true);
      this.settle();
    };
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      arrive();
      return;
    }
    const done = (ev: TransitionEvent) => {
      if (ev.propertyName === 'translate') arrive();
    };
    fab.addEventListener('transitionend', done, { signal: glide.signal });
    fab.addEventListener('transitioncancel', done, { signal: glide.signal });
  }

  /** The drop's painted box while it shows (null when the launcher is hidden, marking hid it, or it is the corner button). */
  private dropBox(): DOMRect | null {
    const fab = this.e.fab;
    if (this.launcher !== 'edge' || !this.button || fab.hidden) return null;
    const r = fab.getBoundingClientRect();
    return r.width && r.height ? r : null;
  }

  // -- the drop becomes the card (vt-3811) ----------------------------------------

  private phone(): boolean {
    return globalThis.matchMedia?.(PHONE).matches ?? false;
  }

  /**
   * Pins a phone's sheet to the visual viewport (styles: the `max-width: 520px` block): its height and its
   * offset in the layout viewport, which iOS Safari leaves in place while the keyboard covers its bottom.
   * While something covers the layout viewport's bottom (the keyboard), the home indicator's inset is not
   * padded: the keyboard is already there. Pinch-zoomed, the visual viewport is a magnified piece of the
   * page, not the screen: the sheet keeps to the layout viewport.
   */
  private pinSheet(): void {
    const st = this.e.root.style;
    const vv = globalThis.visualViewport;
    const vars = ['--vr-vv-h', '--vr-vv-top', '--vr-sheet-safe'];
    if (!vv || !(vv.height > 0) || vv.scale > 1.01) {
      for (const v of vars) st.removeProperty(v);
      return;
    }
    st.setProperty('--vr-vv-h', px(vv.height));
    st.setProperty('--vr-vv-top', px(Math.max(0, vv.offsetTop)));
    const layout = document.documentElement.clientHeight || globalThis.innerHeight || vv.height;
    if (layout - (vv.offsetTop + vv.height) > 40) st.setProperty('--vr-sheet-safe', '0px');
    else st.removeProperty('--vr-sheet-safe');
  }

  /**
   * Opens or closes the card as ONE surface (vt-3811). With the drop on screen, the morph layer starts as the
   * drop — its box, its round page side and square wall side, its fill — and springs into the card's box,
   * radii and fill while the card's content, clipped to it, fades in once it nearly fits; closing runs back
   * into the drop. With no drop (the host hid it), a phone's sheet rises from the bottom and a desk's card
   * fades up in place. Interruptible: a run reversed midway starts from the surface where it is. Returns false
   * where nothing animates (reduced motion, the corner button): the swap is instant.
   */
  private morphCard(open: boolean, drop: DOMRect | null = null): boolean {
    const card = this.e.card;
    if (this.launcher !== 'edge' || reducedMotion() || typeof requestAnimationFrame !== 'function') {
      this.stopMorph();
      return false;
    }
    const cr = card.getBoundingClientRect();
    if (!cr.width || !cr.height) {
      this.stopMorph();
      return false;
    }
    const k = card.offsetWidth ? cr.width / card.offsetWidth : 1;
    const cs = getComputedStyle(card);
    const rad = (v: string) => (Number.parseFloat(v) || 0) * k;
    const shown: Geo = {
      x: cr.left,
      y: cr.top,
      w: cr.width,
      h: cr.height,
      r: [rad(cs.borderTopLeftRadius), rad(cs.borderTopRightRadius), rad(cs.borderBottomRightRadius), rad(cs.borderBottomLeftRadius)],
      fill: 1,
      alpha: 1,
    };
    const box = drop ?? this.dropBox();
    const mode: MorphMode = box ? 'surface' : this.phone() ? 'rise' : 'fade';
    let away: Geo;
    if (box) {
      const R = box.height / 2;
      away = { x: box.left, y: box.top, w: box.width, h: box.height, r: this.edge.side === 'right' ? [R, 0, 0, R] : [0, R, R, 0], fill: 0, alpha: 0 };
    } else if (mode === 'rise') {
      // Below the visual viewport's bottom: the sheet comes up from under the screen's edge.
      away = { ...shown, y: Math.max(cr.bottom, (globalThis.visualViewport?.offsetTop ?? 0) + (globalThis.visualViewport?.height ?? cr.bottom)) + 8 };
    } else {
      away = { ...shown, y: cr.top + 10, alpha: 0 };
    }
    const prev = this.morph;
    if (prev) cancelAnimationFrame(prev.raf);
    // A run of another kind (the drop appeared or went meanwhile) does not blend: it ends where it was going.
    if (prev && prev.mode !== mode) this.clearMorph();
    const from = prev && prev.mode === mode && this.morphGeo ? this.morphGeo : open ? away : shown;
    this.morph = { mode, open, from, to: open ? shown : away, q: 0, v: 0, raf: 0, last: 0, card: cr, k };
    card.classList.toggle('morphing', mode === 'surface');
    card.inert = !open;
    this.e.morph.hidden = mode !== 'surface';
    // The first frame now, before the browser paints the card this task just showed: it never flashes whole.
    this.renderMorph(from);
    this.morph.raf = requestAnimationFrame((t) => this.stepMorph(t));
    return true;
  }

  /** One frame of the spring: a little bounce into the card, none into the drop (it lands, it does not shrink past). */
  private stepMorph(now: number): void {
    const m = this.morph;
    if (!m) return;
    const dt = m.last ? Math.min(1 / 30, (now - m.last) / 1000) : 1 / 60;
    m.last = now;
    const response = m.open ? 0.42 : 0.3;
    const zeta = m.open ? 0.8 : 1;
    const stiff = (2 * Math.PI / response) ** 2;
    const damp = 2 * zeta * Math.sqrt(stiff);
    for (let i = 0; i < 4; i++) {
      const h = dt / 4;
      m.v += (stiff * (1 - m.q) - damp * m.v) * h;
      m.q += m.v * h;
    }
    const done = Math.abs(1 - m.q) < 0.002 && Math.abs(m.v) < 0.05;
    if (done) m.q = 1;
    this.renderMorph(lerpGeo(m.from, m.to, m.q, m.open));
    if (done) this.finishMorph();
    else m.raf = requestAnimationFrame((t) => this.stepMorph(t));
  }

  /** Paints the surface at `g`: the morph layer, and the card's content clipped to it in the card's own (unscaled) box. */
  private renderMorph(g: Geo): void {
    const m = this.morph;
    if (!m) return;
    this.morphGeo = g;
    const card = this.e.card;
    if (m.mode === 'rise') {
      card.style.translate = `0 ${px(g.y - m.card.top)}`;
      return;
    }
    if (m.mode === 'fade') {
      card.style.translate = `0 ${px(g.y - m.card.top)}`;
      card.style.opacity = String(clamp(g.alpha, 0, 1));
      return;
    }
    const f = clamp(g.fill, 0, 1);
    const s = this.e.morph.style;
    s.width = px(g.w);
    s.height = px(g.h);
    s.transform = `translate(${px(g.x)}, ${px(g.y)})`;
    s.borderRadius = g.r.map(px).join(' ');
    s.background = `color-mix(in srgb, var(--bg) ${Math.round(f * 100)}%, var(--drop-fill))`;
    // The drop's soft shadow deepens into the card's, and the card's hairline edge comes in with its fill.
    s.boxShadow =
      `0 ${px(4 + 24 * f)} ${px(8 + 62 * f)} rgba(0, 0, 0, ${(0.2 + 0.18 * f).toFixed(3)}), ` +
      `0 2px 8px rgba(0, 0, 0, ${(0.2 * f).toFixed(3)}), inset 0 0 0 1px rgba(255, 255, 255, ${(0.08 * f).toFixed(3)})`;
    const c = m.card;
    const k = m.k || 1;
    const inset = [g.y - c.top, c.right - (g.x + g.w), c.bottom - (g.y + g.h), g.x - c.left].map((v) => px(Math.max(0, v / k)));
    card.style.clipPath = `inset(${inset.join(' ')} round ${g.r.map((r) => px(r / k)).join(' ')})`;
    card.style.setProperty('--vr-morph-alpha', String(clamp(g.alpha, 0, 1).toFixed(3)));
  }

  /** The run is over: the card is itself again, or — closed — it is gone and the drop grows its feet back. */
  private finishMorph(): void {
    const m = this.morph;
    if (!m) return;
    this.clearMorph();
    if (m.open) return;
    this.closed();
    this.paint();
    if (m.mode === 'surface') this.attachTo(1, 320, true);
  }

  /** Ends a run where it was going, at once (reduced motion asked mid-run, the launcher changed, unmount). */
  private stopMorph(): void {
    if (this.morph) this.finishMorph();
  }

  private clearMorph(): void {
    const m = this.morph;
    if (m) cancelAnimationFrame(m.raf);
    this.morph = null;
    this.morphGeo = null;
    const card = this.e.card;
    this.e.morph.hidden = true;
    card.classList.remove('morphing');
    card.inert = false;
    for (const p of ['clip-path', 'translate', 'opacity', '--vr-morph-alpha']) card.style.removeProperty(p);
  }

  /** What a close leaves once the card is gone: the next open starts on the describe view, anchored by its launcher. */
  private closed(): void {
    this.view = 'describe';
    this.unpark();
  }

  /**
   * Shows or hides one of the card's parts. Inside the open card (vt-3811) a part that goes fades out over
   * the one that comes — lifted out of the flow where it stood, so nothing below it moves — while the new one
   * fades up; the card keeps its one size, so nothing jumps. Elsewhere, and under reduced motion, it swaps.
   */
  private part(el: HTMLElement, shown: boolean): void {
    const leave = this.leaving.get(el);
    if (shown) {
      if (leave) {
        leave.cancel();
        this.leaving.delete(el);
        this.unlift(el);
      }
      const coming = el.hidden || Boolean(leave);
      el.hidden = false;
      if (coming && this.fadeParts) {
        el.animate(
          [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: SWAP.in, delay: leave ? 0 : 40, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
        );
      }
      return;
    }
    if (el.hidden || leave) return;
    if (!this.fadeParts || typeof el.animate !== 'function') {
      el.hidden = true;
      return;
    }
    // Lifted where it stands (offsets are the card's: no part between them is positioned), above what comes.
    const scroll = el.parentElement === this.e.body ? this.e.body.scrollTop : 0;
    const st = el.style;
    st.position = 'absolute';
    st.top = `${el.offsetTop - scroll}px`;
    st.left = `${el.offsetLeft}px`;
    st.width = `${el.offsetWidth}px`;
    st.margin = '0';
    st.pointerEvents = 'none';
    st.zIndex = '1';
    el.setAttribute('aria-hidden', 'true');
    el.inert = true;
    const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SWAP.out, easing: 'ease-in', fill: 'forwards' });
    this.leaving.set(el, a);
    a.onfinish = () => {
      if (this.leaving.get(el) !== a) return;
      this.leaving.delete(el);
      el.hidden = true;
      this.unlift(el);
      a.cancel();
    };
  }

  private unlift(el: HTMLElement): void {
    for (const p of ['position', 'top', 'left', 'width', 'margin', 'pointer-events', 'z-index']) el.style.removeProperty(p);
    el.removeAttribute('aria-hidden');
    el.inert = false;
  }

  // -- marking --------------------------------------------------------------

  private startMarking(): void {
    if (this.job?.id) return; // the report is on its way: Retry finishes it as it was marked
    this.marking = true;
    this.confirming = false;
    this.passKeys = new Set(this.markers.map((m) => m.key));
    // Marking parks the card from where it is (beside the button's dock, or a corner an earlier pass
    // chose), with the insets it has there: starting never moves it — only a mark landing under it does.
    const corner = this.parked ?? this.rest();
    this.parkInsets = this.insetsAt(corner, this.e.card.getBoundingClientRect());
    this.parked = corner;
    this.renderMarks();
    this.paint();
    this.placeCard();
    this.placeSeg(true);
    this.e.mark.focus();
  }

  /** Leaves marking; the card stays where marking parked it until it closes (it never jumps back). */
  private endMarking(backToCard: boolean): void {
    this.cancelDraft();
    this.marking = false;
    this.confirming = false;
    this.paint();
    if (backToCard && this.isOpen) requestAnimationFrame(() => this.e.desc.focus());
  }

  /** Cancel (vt-8020 D12): leave marking and drop this pass's marks — asking first when there are any. */
  private cancelMarking(): void {
    const added = this.markers.filter((m) => !this.passKeys.has(m.key)).length;
    if (added === 0) {
      this.endMarking(true);
      return;
    }
    this.confirming = true;
    this.paint();
    this.e.discard.focus();
  }

  /**
   * The card's live insets in `corner` (the nearer side, and the bottom or the top — never above the
   * marking bar's band), the far side at the default: `cornerRect(corner)` is then exactly where it is.
   */
  private insetsAt(corner: Corner, r: DOMRect): Pick<Frame, 'top' | 'bottom' | 'edge'> {
    const vw = globalThis.innerWidth || 800;
    const vh = globalThis.innerHeight || 600;
    const bar = BAR_CLEAR * SIZE_SCALE[this.size];
    const atBottom = corner === 'br' || corner === 'bl';
    return {
      edge: Math.max(0, Math.min(r.left, vw - r.right)),
      top: atBottom ? bar : Math.max(bar, r.top),
      bottom: atBottom ? Math.max(0, vh - r.bottom) : PARK_EDGE,
    };
  }

  /** The card's box as painted (the size setting scales it, styles: `--vr-scale`) and the insets marking parks it with. */
  private frame(): Frame {
    const vw = globalThis.innerWidth || 800;
    const vh = globalThis.innerHeight || 600;
    const k = SIZE_SCALE[this.size];
    const insets = this.parkInsets ?? { top: BAR_CLEAR * k, bottom: PARK_EDGE, edge: PARK_EDGE };
    const r = this.e.card.getBoundingClientRect();
    return { vw, vh, w: r.width || Math.min(CARD.w * k, vw - 32), h: r.height || Math.min(CARD.h * k, vh - insets.top - insets.bottom), ...insets };
  }

  /**
   * Parks the card in the corner that covers none of the marks; it glides there (styles: `.card.parked`).
   * `reanchor`: the corner itself changed (a new size, a resized viewport) — kept in the same corner, the card
   * lands there on the frame it changes, as an anchored card does; slid there, a parked card (scaled from its
   * top-left) would first overhang its corner by the size difference, then glide back.
   */
  private placeCard(reanchor = false): void {
    if (!this.parked) return;
    const f = this.frame();
    const was = this.parked;
    this.parked = pickCorner(this.parked, this.markers.map((m) => m.rect), f);
    const r = cornerRect(this.parked, f);
    const card = this.e.card;
    const land = reanchor && this.parked === was;
    if (land) card.style.transition = 'none';
    card.classList.add('parked');
    card.style.left = `${r.x}px`;
    card.style.top = `${r.y}px`;
    this.placeCoachSide();
    if (!land) return;
    // The read commits the new place as the style the glide starts from, so restoring the glide moves nothing.
    void card.offsetWidth;
    card.style.removeProperty('transition');
  }

  /** The coach takes the card's edge that faces the open page (place.ts coachSide); styles place it by `data-side`. */
  private placeCoachSide(): void {
    const k = SIZE_SCALE[this.size];
    // Measured in the layout it takes on the card's edge — the art shown, the card's width — never the one it
    // holds now ('over' hides the art), so a window grown back from a phone's size finds it above again. Both
    // writes land before the next paint: the trial layout is never seen. Hidden, it reads 0: the usual height.
    const coach = this.e.coach;
    coach.dataset.side = 'above';
    const h = coach.offsetHeight || COACH.h;
    coach.dataset.side = coachSide(this.parked ?? this.rest(), this.frame(), { w: COACH.w * k, h: h * k }, COACH.gap * k);
  }

  private unpark(): void {
    this.parked = null;
    this.parkInsets = null;
    this.e.card.classList.remove('parked');
    this.e.card.style.removeProperty('left');
    this.e.card.style.removeProperty('top');
  }

  /** The segmented control's indicator under the picked shape; `land`: the bar just appeared, so it does not slide. */
  private placeSeg(land = false): void {
    placeIndicator(this.e.seg, this.e.segInd, this.e.toolButtons.get(this.tool), land);
  }

  private onChrome(t: EventTarget | null): boolean {
    return t instanceof Node && (this.e.toolbar.contains(t) || this.e.pins.contains(t));
  }

  private pointerDown(ev: PointerEvent): void {
    if (this.onChrome(ev.target) || ev.button !== 0 || !ev.isPrimary) return;
    ev.preventDefault();
    const root = this.e.root.getRootNode();
    if (root instanceof ShadowRoot && root.activeElement instanceof HTMLElement) root.activeElement.blur();
    this.drawing = { start: { x: ev.clientX, y: ev.clientY }, shape: this.tool, pointer: ev.pointerId };
    try {
      this.e.mark.setPointerCapture(ev.pointerId);
    } catch {
      // a synthetic pointer: no capture needed
    }
    this.e.coach.classList.add('pressing');
  }

  private pointerMove(ev: PointerEvent): void {
    const d = this.drawing;
    if (!d || ev.pointerId !== d.pointer) return;
    this.e.draft.replaceChildren(...this.shapeNodes({ shape: d.shape, rect: rectBetween(d.start, { x: ev.clientX, y: ev.clientY }), head: arrowHead(d.start, { x: ev.clientX, y: ev.clientY }) }));
  }

  private pointerUp(ev: PointerEvent): void {
    const d = this.drawing;
    if (!d || ev.pointerId !== d.pointer) return;
    const end = { x: ev.clientX, y: ev.clientY };
    this.cancelDraft();
    if (!isMark(d.shape, d.start, end)) return;
    this.addMarker(d.shape, rectBetween(d.start, end), d.shape === 'arrow' ? arrowHead(d.start, end) : undefined);
  }

  /** A new numbered mark; a hide also names the page nodes under it now, while the page sits frozen. */
  private addMarker(shape: MarkerShape, rect: Rect, head?: ArrowHead): void {
    const key = this.nextKey++;
    if (shape === 'hide') {
      const ids = this.engine?.hiddenIdsAt(rect);
      if (ids) this.hideIds.set(key, ids);
    }
    this.markers = renumberDrawn([...this.markers, { key, n: this.markers.length + 1, shape, rect, note: '', ...(head ? { head } : {}) }]);
    this.renderMarks();
    this.paint();
    // Drawing a shape opens its note: the new line in the card takes the typing.
    this.lines.get(key)?.note.focus();
  }

  private cancelDraft(): void {
    this.drawing = null;
    this.kbDraft = null;
    this.e.draft.replaceChildren();
    this.e.coach.classList.remove('pressing');
  }

  // -- marking from the keyboard (Enter starts, arrows move, Shift+arrows resize, Enter places) --

  private kbDraft: Rect | null = null;

  private markKey(ev: KeyboardEvent): void {
    if (ev.target !== this.e.mark) return;
    const vw = globalThis.innerWidth || 800;
    const vh = globalThis.innerHeight || 600;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      if (!this.kbDraft) {
        this.kbDraft = { x: Math.round(vw / 2 - KB_DRAFT.w / 2), y: Math.round(vh / 2 - KB_DRAFT.h / 2), ...KB_DRAFT };
        this.renderKbDraft();
        return;
      }
      const rect = this.kbDraft;
      this.cancelDraft();
      this.addMarker(this.tool, rect, this.tool === 'arrow' ? 'se' : undefined);
      return;
    }
    const step = KB_STEPS[ev.key];
    if (!step || !this.kbDraft) return;
    ev.preventDefault();
    const d = this.kbDraft;
    const [dx, dy] = step;
    this.kbDraft = ev.shiftKey
      ? { ...d, w: Math.min(vw - d.x, Math.max(MIN_KB_SIZE, d.w + dx)), h: Math.min(vh - d.y, Math.max(MIN_KB_SIZE, d.h + dy)) }
      : { ...d, x: Math.min(vw - d.w, Math.max(0, d.x + dx)), y: Math.min(vh - d.h, Math.max(0, d.y + dy)) };
    this.renderKbDraft();
  }

  private renderKbDraft(): void {
    const r = this.kbDraft;
    if (!r) return;
    this.e.draft.replaceChildren(...this.shapeNodes({ shape: this.tool, rect: r, head: 'se' }));
  }

  private shapeNodes(m: Pick<Marker, 'shape' | 'rect' | 'head'>): SVGElement[] {
    const { x, y, w, h: hh } = m.rect;
    if (m.shape === 'circle') {
      return [svgEl('ellipse', { class: 'stroke', cx: x + w / 2, cy: y + hh / 2, rx: Math.max(1, w / 2), ry: Math.max(1, hh / 2) })];
    }
    if (m.shape === 'box') return [svgEl('rect', { class: 'stroke', x, y, width: w, height: hh, rx: 6 })];
    if (m.shape === 'arrow') {
      const { tail, tip } = arrowEnds(m.rect, m.head ?? 'se');
      return [svgEl('line', { class: 'stroke', x1: tail.x, y1: tail.y, x2: tip.x, y2: tip.y, 'marker-end': 'url(#vr-head)' })];
    }
    const veil = svgEl('rect', { class: 'veil', x, y, width: w, height: hh, rx: 4 });
    const label = svgEl('text', { class: 'veil-label', x: x + w / 2, y: y + hh / 2 + 4, 'text-anchor': 'middle' });
    label.textContent = w > 150 && hh > 20 ? this.s.hidden : '';
    return [veil, label];
  }

  private renderMarks(): void {
    this.e.shapes.replaceChildren(...this.markers.flatMap((m) => this.shapeNodes(m)));
    const live = new Set(this.markers.map((m) => m.key));
    for (const [key, pin] of this.pins) {
      if (live.has(key)) continue;
      pin.el.remove();
      this.pins.delete(key);
    }
    for (const [key, line] of this.lines) {
      if (live.has(key)) continue;
      line.el.remove();
      this.lines.delete(key);
    }
    const remove = (key: number) => {
      this.markers = renumberDrawn(this.markers.filter((x) => x.key !== key));
      this.renderMarks();
      this.paint();
    };
    for (const m of this.markers) {
      if (this.pins.has(m.key)) continue;
      const num = h('button', { class: 'num', type: 'button' });
      const rm = h('button', { class: 'rm', type: 'button' }, icon(ICON.close));
      const el = h('div', { class: 'pin' }, num, rm);
      // The pin points at its note: a press on the number puts the caret in its line.
      num.addEventListener('click', () => this.lines.get(m.key)?.note.focus());
      rm.addEventListener('click', () => remove(m.key));
      this.e.pins.append(el);
      this.pins.set(m.key, { el, num, rm });

      const lineNum = h('span', { class: 'ln-n', 'aria-hidden': 'true' });
      const note = h('input', { class: 'ln-t', type: 'text', maxlength: '500' });
      const lineRm = h('button', { class: 'ln-x', type: 'button' }, icon(ICON.close));
      const line = h('li', { class: 'ln' }, lineNum, note, lineRm);
      note.addEventListener('input', () => {
        this.markers = this.markers.map((x) => (x.key === m.key ? { ...x, note: note.value } : x));
        this.paint();
      });
      note.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' || !this.marking) return;
        ev.preventDefault();
        // Back to the page, ready for the next mark from the keyboard.
        this.e.mark.focus();
      });
      lineRm.addEventListener('click', () => remove(m.key));
      this.e.lines.append(line);
      this.lines.set(m.key, { el: line, num: lineNum, note, rm: lineRm });
    }
    // Renumbering after a removal keeps the lines in mark order.
    for (const m of this.markers) {
      const line = this.lines.get(m.key);
      if (line) this.e.lines.append(line.el);
    }
    this.renderPins();
    if (this.parked) this.placeCard();
  }

  /** Pin numbers and positions, line numbers and labels; text in place (the locale may have changed). */
  private renderPins(): void {
    const vw = globalThis.innerWidth || 800;
    for (const m of this.markers) {
      const pin = this.pins.get(m.key);
      const line = this.lines.get(m.key);
      if (!pin || !line) continue;
      const anchor = m.shape === 'arrow' ? arrowEnds(m.rect, m.head ?? 'se').tail : { x: m.rect.x, y: m.rect.y };
      pin.el.style.left = `${Math.min(Math.max(4, anchor.x - 12), vw - 60)}px`;
      pin.el.style.top = `${Math.max(BAR_CLEAR - 12, anchor.y - 12)}px`;
      pin.num.textContent = String(m.n);
      pin.num.setAttribute('aria-label', this.s.mark(m.n));
      pin.rm.setAttribute('aria-label', this.s.removeMark(m.n));
      line.num.textContent = String(m.n);
      line.el.classList.toggle('hide', m.shape === 'hide');
      line.note.placeholder = this.s.notePlaceholder;
      line.note.setAttribute('aria-label', `${this.s.mark(m.n)} — ${this.s.notePlaceholder}`);
      line.rm.setAttribute('aria-label', this.s.removeMark(m.n));
    }
  }

  // -- sending --------------------------------------------------------------

  private envelope(description: string, capture: BuiltCapture): ReportEnvelope {
    const who = this.who();
    const member = memberTokenFor(this.opts.base);
    // The test round this browser is in (vt-3094): the report joins it while vitrinka says it stands.
    const round = roundFor({ url: this.opts.base, key: this.opts.key });
    const loc = globalThis.location;
    return {
      title: titleOf(description),
      description,
      env: {
        url: redactUrl(loc ? `${loc.origin}${loc.pathname}` : ''),
        ua: globalThis.navigator?.userAgent ?? '',
        viewport: { w: globalThis.innerWidth || 0, h: globalThis.innerHeight || 0, dpr: globalThis.devicePixelRatio || 1 },
        appVersion: this.opts.appVersion ?? '',
        locale: globalThis.navigator?.language ?? '',
      },
      console: capture.console,
      network: capture.network,
      ...(who ? { identity: who, notify: this.notify } : {}),
      markers: toWire(this.markers),
      locale: this.locale,
      ...(this.kind ? { type: this.kind } : {}),
      ...(round ? { round: round.token } : {}),
      // A member linked on this base co-owns the report; the `vkb_` key stays the bearer.
      ...(member ? { memberToken: member } : {}),
      ...contextField(this.context),
    };
  }

  /** The words the report goes with: the description, else the first mark's note — either one is enough to send. */
  private words(): string {
    return this.e.desc.value.trim() || (this.markers.find((m) => m.note.trim())?.note.trim() ?? '');
  }

  /**
   * The card holds something the reporter made and has not sent: words in the
   * description or a mark's note (a note lives on its mark), a mark, the
   * picked word for it, a file.
   */
  private hasDraft(): boolean {
    return this.e.desc.value.trim() !== '' || this.markers.length > 0 || this.kind !== null || this.files.length > 0;
  }

  /** Record unmounts this card for the pill (vt-8020 D8), so it waits while the card holds a draft or a report sending or waiting on Try again — the switch would lose it. */
  private recordWaits(): boolean {
    return this.sending || this.job !== null || this.hasDraft();
  }

  private async send(): Promise<void> {
    const description = this.words();
    if (this.sending || !description) return;
    if (this.marking) this.endMarking(false);
    this.sending = true;
    this.error = '';
    this.paint();
    // Nothing reached the server yet: build again, with the marks as they are now.
    if (this.job && !this.job.id) this.job = null;
    try {
      if (!this.job) {
        const marked = new Set<number>();
        for (const m of this.markers) for (const id of this.hideIds.get(m.key) ?? []) marked.add(id);
        const engine = this.engine;
        const frozen = this.frozen ?? { clip: null, stored: Promise.resolve(new Map()) };
        const capture = engine ? await prepareCapture(() => engine.build(frozen, this.markers, marked)) : EMPTY_CAPTURE;
        this.job = new ReportJob(capture, globalThis.location?.host ?? '', { url: this.opts.base, key: this.opts.key }, this.files);
      }
      // A refused member link is handled when the create answers, even if a later leg then fails.
      this.result = await this.job.run(this.envelope(description, this.job.capture), (err, sent) => this.memberRefused(err, sent));
      noteSent(this.opts.base, globalThis.location?.host ?? '', {
        title: titleOf(description),
        at: Date.now(),
        status: this.result.status,
        ...(this.result.reportUrl ? { url: this.result.reportUrl } : {}),
      });
      this.view = 'sent';
      this.job = null;
      this.frozen = null;
      this.e.desc.value = '';
      this.markers = [];
      this.hideIds.clear();
      this.kind = null;
      this.notify = false;
      this.e.notifyBox.checked = false;
      this.includedOpen = false;
      this.files = [];
      this.fileRefusal = null;
      this.renderMarks();
      this.renderFiles();
      this.engine?.clear();
    } catch (e) {
      console.warn('vitrinka: the report did not go through — Retry resumes it', e);
      this.error = !this.job?.id ? 'create' : this.job.filesPending ? 'files' : 'capture';
    } finally {
      this.sending = false;
      this.paint();
    }
    if (this.view === 'sent') requestAnimationFrame(() => (this.result?.reportUrl ? this.e.see : this.e.sentClose).focus());
  }

  // -- paint: every string and state, in place -------------------------------

  private includedItems(): string[] {
    const s = this.s;
    const items: string[] = [];
    const lanes = this.config?.lanes;
    if (lanes?.replay) items.push(`${s.incReplay} — ${s.incReplayMasked[this.config?.masking ?? 'strict'].toLowerCase()}`);
    if (lanes?.errors) items.push(s.incErrors);
    if (lanes?.console) items.push(s.incConsole);
    if (lanes?.network) items.push(s.incNetwork);
    else if (lanes?.errors) items.push(s.incFailedRequests);
    items.push(s.incEnv);
    if (this.who()) items.push(s.incIdentity);
    if (this.markers.length) items.push(s.incMarks);
    if (this.files.length) items.push(s.incFiles);
    return items;
  }

  /** Who the face says you are (vt-8020 D2): the host's person, then the linked member; never a guess. */
  private paintAccount(): void {
    const { e, s } = this;
    const who = this.who();
    const person = !who ? null : 'email' in who ? { name: who.name ?? '', email: who.email } : this.session ? { name: this.session.reporter.name ?? '', email: this.session.reporter.email } : null;
    const label = person?.name || person?.email || '';
    e.whoAv.textContent = who ? initials(label) : '?';
    e.whoName.textContent = label.split(/[\s@]/)[0] ?? '';
    e.whoName.hidden = !label;
    e.whoBtn.setAttribute('aria-label', `${s.account}: ${label || (who ? '' : s.anonymous)}`.replace(/: $/, ''));
    e.whoBtn.setAttribute('aria-expanded', String(this.menu === 'account'));
    e.more.setAttribute('aria-label', s.menu);
    e.more.setAttribute('aria-expanded', String(this.menu === 'more'));
    e.accountPop.hidden = this.menu !== 'account';
    e.morePop.hidden = this.menu !== 'more';
    e.accountPop.setAttribute('aria-label', s.account);
    e.morePop.setAttribute('aria-label', s.menu);

    e.accName.textContent = who ? person?.name || person?.email || '' : s.anonymous;
    e.accMail.textContent = person?.name ? person.email : '';
    e.accMail.hidden = !e.accMail.textContent;
    // Only a token the host signed is a sign-in; an asserted email waits for the team like an anonymous report.
    e.accVia.textContent = who && 'token' in who ? s.signedInByApp : s.anonymousHint;
    const member = this.member;
    e.accLinked.hidden = !member;
    e.accUnlink.hidden = !member;
    e.accLinked.textContent = member ? s.linkedAs(member.email || member.name || member.workspace) : '';
    e.accUnlink.textContent = s.unlink;
    e.accLink.hidden = Boolean(member);
    setLabel(e.accLink, s.linkVitrinka);
    const portal = this.session?.portalUrl;
    e.accPortal.hidden = !portal;
    if (portal) e.accPortal.setAttribute('href', portal);
    setLabel(e.accPortal, s.openPortal);

    setLabel(e.mReports, s.myReports);
    setLabel(e.mRecents, s.recentRecordings);
    setLabel(e.mRecord, s.record);
    setLabel(e.mSettings, s.settings);
    // Recording lives where the pill does: only a linked member gets it, its recents and the way to vitrinka.
    e.mRecents.hidden = !this.recordSwitch;
    e.mRecord.hidden = !this.recordSwitch;
    // A waiting Record says why (recordWaits). aria-disabled, never `disabled`: the menu's arrows still reach it,
    // so a keyboard and screen-reader user hears the reason too; its click is guarded in bind().
    const waits = this.recordWaits();
    if (waits) e.mRecord.setAttribute('aria-disabled', 'true');
    else e.mRecord.removeAttribute('aria-disabled');
    e.mRecordWhy.hidden = !waits;
    e.mRecordWhy.textContent = s.recordHasDraft;
    if (waits) e.mRecord.setAttribute('aria-describedby', e.mRecordWhy.id);
    else e.mRecord.removeAttribute('aria-describedby');
    const open = member ? this.opts.base : portal;
    e.mOpen.hidden = !open;
    if (open) e.mOpen.setAttribute('href', open);
    setLabel(e.mOpen, member ? s.openVitrinka : s.openPortal);
  }

  private paintReports(): void {
    const { e, s } = this;
    setLabel(e.repBack, s.myReports);
    const local = !this.session;
    const rows = local
      ? readSent(this.opts.base, globalThis.location?.host ?? '').map((r) => this.row(r.title, r.status === 'quarantined' ? s.waiting : s.steps.received ?? '', r.at, r.url))
      : this.mine.rows.map((r) => this.row(r.title, s.steps[r.step] ?? r.step, Date.parse(r.updatedAt), r.url));
    e.repRows.replaceChildren(...rows);
    const state = local ? 'ok' : this.mine.state;
    e.repStatus.hidden = state === 'ok' && rows.length > 0;
    e.repStatus.textContent = state === 'loading' ? s.loading : state === 'failed' ? s.listFailed : s.noReports;
    e.repLocal.hidden = !local || rows.length === 0;
    e.repLocal.textContent = s.fromThisBrowser;
    const portal = this.session?.portalUrl;
    e.repPortal.hidden = !portal;
    if (portal) e.repPortal.setAttribute('href', portal);
    e.repPortal.textContent = s.openPortal;
  }

  private paintRecents(): void {
    const { e, s } = this;
    setLabel(e.recBack, s.recentRecordings);
    const rows = readRecents().map((r) => this.row(r.title, '', r.startedAt, r.boardUrl));
    e.recRows.replaceChildren(...rows);
    e.recStatus.hidden = rows.length > 0;
    e.recStatus.textContent = s.noRecordings;
  }

  private paintLink(): void {
    const { e, s } = this;
    const flow = this.linkFlow;
    setLabel(e.linkBack, s.linkVitrinka);
    e.linkLabel.textContent = s.linkCode;
    e.linkCode.textContent = flow?.start?.user_code ?? '…';
    e.linkOpenText.textContent = s.openVitrinka;
    const start = flow?.start;
    e.linkOpen.hidden = !start;
    if (start) e.linkOpen.setAttribute('href', start.verifyUrl);
    // The QR is for another device: a fine pointer (a desk) shows it, a phone is already the other device.
    const fine = globalThis.matchMedia?.('(pointer: fine)').matches ?? true;
    e.linkQr.hidden = !start || !fine;
    if (start && fine && e.linkQr.getAttribute('src') !== start.qrUrl) e.linkQr.setAttribute('src', start.qrUrl);
    e.linkHint.textContent = s.linkHint;
    const state = flow?.state ?? 'failed';
    e.linkWait.textContent = state === 'expired' ? s.linkExpired : state === 'failed' ? s.linkFailed : state === 'waiting' ? s.linkWaiting : s.loading;
    e.linkRetry.hidden = state !== 'expired' && state !== 'failed';
    e.linkRetry.textContent = s.retry;
  }

  /** 📎, the picker's types, the tray of chips and the refusal line — the tray shows only while there is something in it. */
  private paintFiles(): void {
    const { e, s } = this;
    const locked = this.sending || Boolean(this.job?.id);
    e.attach.setAttribute('aria-label', s.attach);
    e.attach.disabled = locked;
    // maxCount 0: the project switched attaching off — no 📎 to press.
    e.attach.hidden = this.caps().maxCount === 0;
    e.fileInput.setAttribute('accept', this.caps().types.join(','));
    this.part(e.tray, this.view === 'describe' && (this.files.length > 0 || Boolean(this.fileRefusal)));
    e.files.hidden = this.files.length === 0;
    e.files.setAttribute('aria-label', s.incFiles);
    e.fileNote.hidden = !this.fileRefusal;
    e.fileNote.textContent = this.refusalText(this.fileRefusal);
    for (const [f, chip] of this.chips) {
      chip.size.textContent = formatBytes(f.size, this.locale);
      chip.rm.setAttribute('aria-label', s.removeFile(f.name));
      chip.rm.disabled = locked;
    }
  }

  /** Size and technical details (vt-8020 D9); the size indicator is measured once the pane shows. */
  private paintSettings(): void {
    const { e, s } = this;
    e.sizeLabel.textContent = s.size;
    e.coachLabel.textContent = s.coachSetting;
    e.coachSwitch.setAttribute('aria-checked', String(this.coachOn));
    for (const [z, btn] of e.sizeButtons) {
      btn.textContent = s.sizes[z];
      btn.setAttribute('aria-checked', String(this.size === z));
    }
    e.techText.textContent = s.techDetails;
    e.techBtn.setAttribute('aria-expanded', String(this.techOpen));
    e.tech.hidden = !this.techOpen;
    if (this.techOpen && this.view === 'settings') {
      const rows = techDetails({ version: RECORDER_VERSION, base: this.opts.base, config: this.config, engine: this.engine !== null, locale: this.locale }, s);
      e.tech.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    }
    if (this.view === 'settings') placeIndicator(e.sizeSeg, e.sizeInd, e.sizeButtons.get(this.size));
  }

  private paint(): void {
    const { e, s } = this;
    const who = this.who();
    e.root.setAttribute('lang', this.locale);
    e.root.classList.toggle('nobutton', !this.button);
    // The dock and the size (vt-8020 D9): the stylesheet places and scales everything from these two.
    e.root.dataset.dock = this.dock;
    e.root.dataset.launcher = this.launcher;
    e.root.dataset.side = this.edge.side;
    if (this.launcher === 'edge') this.placeEdge();
    e.root.style.setProperty('--vr-scale', String(SIZE_SCALE[this.size]));
    // A view swapped inside a card already on screen cross-fades (part); the card's own coming is the morph's.
    this.fadeParts = this.isOpen && !e.card.hidden && !reducedMotion() && typeof e.card.animate === 'function';

    e.fab.hidden = !this.button || this.marking;
    // Open — or still morphing back — the drop IS the card: it gives its place to the morph surface.
    e.fab.classList.toggle('lifted', this.launcher === 'edge' && (this.isOpen || this.morph !== null));
    e.fabLabel.textContent = s.button;
    e.fab.setAttribute('aria-expanded', String(this.isOpen));
    const edge = this.launcher === 'edge';
    e.fab.setAttribute('aria-description', edge ? s.edgeHint : s.moveHint);
    e.fab.setAttribute('aria-keyshortcuts', `${this.keybind ? `${keybindAria(this.keybind)} ` : ''}Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight`);
    // The drop is a glyph that grows its name; the chord stays in aria-keyshortcuts and the settings.
    e.fabKbd.hidden = !this.keybind || edge;
    e.fabKbd.textContent = this.keybind ? keybindLabel(this.keybind) : '';

    // The one card stays up while marking (vt-8020 D10): its note lines and Send are where the reporter finishes.
    e.card.hidden = !this.isOpen && this.morph === null;
    e.card.classList.toggle('busy', this.sending);
    e.title.textContent = s.title;
    e.closeBtn.setAttribute('aria-label', s.close);
    this.paintAccount();
    this.part(e.describe, this.view === 'describe');
    this.part(e.settings, this.view === 'settings');
    this.part(e.sent, this.view === 'sent');
    this.part(e.reports, this.view === 'reports');
    this.part(e.recents, this.view === 'recents');
    this.part(e.linking, this.view === 'link');
    if (this.view === 'reports') this.paintReports();
    if (this.view === 'recents') this.paintRecents();
    if (this.view === 'link') this.paintLink();
    this.part(e.foot, this.view === 'describe');
    this.paintFiles();

    e.kindsLabel.textContent = s.kindsLabel;
    for (const [kind, btn] of e.kindButtons) {
      btn.textContent = s.kinds[kind];
      btn.setAttribute('aria-checked', String(this.kind === kind));
      // The type rides only the create: once the report is on its way a retry cannot change it.
      btn.disabled = this.sending || Boolean(this.job?.id);
    }
    e.prompt.textContent = s.prompt;
    e.desc.placeholder = s.placeholder;
    e.attachedText.textContent = s.attached(this.config?.profile.windowSec ?? 60);
    // Only a widget that captures says the minutes are attached.
    e.attached.hidden = this.engine === null || this.config?.capturing === false;
    e.discloseText.textContent = s.included;
    e.disclose.setAttribute('aria-expanded', String(this.includedOpen));
    e.included.hidden = !this.includedOpen;
    e.included.replaceChildren(...this.includedItems().map((t) => h('li', {}, t)));
    e.desc.disabled = this.sending;
    e.lines.hidden = this.markers.length === 0;
    e.linesEmpty.hidden = !this.marking || this.markers.length > 0;
    e.linesEmpty.textContent = s.linesEmpty;
    for (const line of this.lines.values()) {
      line.note.disabled = this.sending;
      line.rm.disabled = this.sending;
    }
    e.notify.hidden = who === null;
    e.notifyText.textContent = s.notify;
    e.error.hidden = this.error === '';
    e.error.textContent = { '': '', create: s.errorCreate, files: s.errorFiles, capture: s.errorCapture }[this.error];
    e.whereText.textContent = s.showWhere;
    e.where.setAttribute('aria-pressed', String(this.marking));
    e.where.disabled = this.sending || Boolean(this.job?.id);
    e.send.textContent = this.sending ? s.sending : this.error ? s.retry : s.send;
    e.send.disabled = this.sending || this.words() === '';

    e.bindLabel.textContent = s.shortcut;
    e.bindBtn.setAttribute('aria-pressed', String(this.recordingBind));
    e.bindBtn.setAttribute('aria-label', `${s.shortcut}: ${this.keybind ? keybindLabel(this.keybind) : s.notSet} — ${s.recordShortcut}`);
    e.bindBtn.textContent = this.recordingBind ? s.pressKeys : this.keybind ? keybindLabel(this.keybind) : s.notSet;
    e.unbind.textContent = s.removeShortcut;
    e.unbind.hidden = !this.keybind || this.recordingBind;
    e.bindHint.textContent = s.shortcutHint;
    e.bindReason.hidden = !this.bindRefused;
    e.bindReason.textContent = this.bindRefused ? s.needModifier : '';
    e.back.textContent = s.back;
    this.paintSettings();

    // Thanks, and nothing more to read (vt-3811): what the team does next is the team's to say.
    e.sentTitle.textContent = s.sentTitle;
    e.seeText.textContent = s.seeReport;
    const url = this.result?.reportUrl;
    e.see.hidden = !url;
    if (url) e.see.setAttribute('href', url);
    else e.see.removeAttribute('href');
    e.sentClose.textContent = s.close;

    e.mark.hidden = !this.marking;
    e.toolbar.setAttribute('aria-label', s.toolbar);
    e.seg.setAttribute('aria-label', s.toolbar);
    // Cover says what it is for the moment it is picked: the one tool that hides instead of points.
    e.barLead.textContent = this.tool === 'hide' ? s.barLeadHide : s.barLead;
    for (const [tool, btn] of e.toolButtons) {
      const label = e.toolLabels.get(tool);
      if (label) label.textContent = s.tools[tool];
      btn.setAttribute('aria-checked', String(this.tool === tool));
    }
    e.cancel.textContent = s.cancelMarking;
    e.cancel.hidden = this.confirming;
    e.ask.hidden = !this.confirming;
    e.askText.textContent = s.discardMarks(this.markers.filter((m) => !this.passKeys.has(m.key)).length);
    e.discard.textContent = s.discard;
    e.keep.textContent = s.keep;
    e.coach.hidden = !this.marking || !this.coachOn;
    if (e.coach.hidden) this.coachShape = null; // shown again, it starts its run from the top
    else if (this.coachShape !== this.tool) {
      this.coachShape = this.tool;
      e.coachArtSlot.replaceChildren(icon(coachArt(this.tool, reducedMotion())));
      this.placeCoachSide();
    }
    e.coachText.textContent = s.coach[this.tool];
    e.coachMore.textContent = s.coachMore;
    e.coachDismiss.textContent = s.coachDismiss;
    e.coachKeys.textContent = s.keyboardHint;
    e.mark.setAttribute('aria-label', s.marking);
    if (this.marking) {
      for (const label of e.shapes.querySelectorAll('.veil-label')) {
        if (label.textContent) label.textContent = s.hidden;
      }
    }
    // Always: the note lines live in the card, so their labels follow the locale outside marking too.
    this.renderPins();
    this.shapeDrop();
  }
}

function renumberDrawn(markers: readonly Drawn[]): Drawn[] {
  return renumber(markers).map((m, i) => ({ ...m, key: markers[i]!.key }));
}
