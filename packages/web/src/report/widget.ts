/**
 * Report a problem — the report face's UI (QA Studio D12 C, D21 B).
 *
 * - A large floating "Report a problem" button (hidden with `button: false`;
 *   the host then opens it from its own control, `open-selector`, or
 *   `open()`), and the reporter's own shortcut (keybind.ts).
 * - ONE card (vt-8020 D10 A), one fixed size from drafting through sending
 *   to thanks: the reporter's word for it (vt-8020 D11 chips), "What went wrong?",
 *   one numbered note line per mark, and Send — the capture frozen when the
 *   card opens (the buffer rolls on).
 * - "Show us where" marks the frozen page under a top bar (vt-8020 D6 A): a segmented
 *   circle · box · arrow · hide, and Cancel, which leaves marking and drops
 *   this pass's marks (vt-8020 D12). The card stays on screen while marking, parked
 *   in the corner that covers none of the marks (place.ts). No element
 *   selector. Until the first mark exists a coach card rides beside the
 *   pointer with a tiny loop of the gesture and the words "click, hold and
 *   move".
 * - The reporter's files (vt-8020 D9, attachments.ts): 📎 in the card's foot,
 *   paste or drop onto the card; chips above the foot, refused at once past
 *   the project's caps, sent on the wire's attachment leg.
 * - The button drags to any corner, or moves with Alt+arrows (drag.ts); the
 *   card rests beside it. Settings adds the size (S · M · L, settings.ts)
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
import { RECORDER_VERSION } from '../recorder/version';
import { admit, type AttachmentCaps, DEFAULT_ATTACHMENT_CAPS, formatBytes, pastedName, type Refusal, typesLabel } from './attachments';
import { cornerToward, DRAG_THRESHOLD, nearestCorner, readDock, saveDock } from './drag';
import { rememberDisplayMode } from './face';
import { acquireEngine, type BuiltCapture, type CaptureEngine, type Frozen, type RecordLoader, releaseEngine, type ReportConfig } from './engine';
import { browserLocale, type Locale, parseLocale, REPORT_KINDS, type ReportKind, strings, type Strings } from './i18n';
import { type Identity, type IdentifyInput, normalizeIdentity, onSharedIdentity, sharedIdentity } from './identity';
import { type Keybind, keybindLabel, loadKeybind, matchesKeybind, readKeybindPress, saveKeybind, watchKeybind } from './keybind';
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
import { type Corner, cornerRect, type Frame, pickCorner } from './place';
import type { CaptureNarrowing } from './profile';
import { listMine, type MyReport, openSession, type ReporterSession, sessionLive } from './reader';
import { noteSent, readSent } from './sent';
import { readSize, SIZE_KEY, SIZE_SCALE, SIZES, techDetails, type WidgetSize, writePref } from './settings';
import { REPORT_CSS } from './styles';
import { ReportJob, type ReportEnvelope, type SubmitReply } from './wire';

export interface WidgetOptions {
  base: string;
  key: string;
  /** null/absent = the browser's language. */
  locale?: Locale | null;
  /** The floating button; `false` = the host opens the card itself. */
  button: boolean;
  /** CSS selector of the host's own control(s) that open the card. */
  openSelector?: string | null;
  identity?: IdentifyInput;
  appVersion?: string;
  capture?: CaptureNarrowing;
  sanitizeUrl?: (url: string) => string;
  loadRecord: RecordLoader;
}

type View = 'describe' | 'settings' | 'sent' | 'reports' | 'recents' | 'link';
type Popover = 'account' | 'more';
type LinkFlow = { start: LinkStart | null; state: 'starting' | 'waiting' | 'expired' | 'failed'; abort: AbortController };
type Drawn = Marker & { key: number };

const SVG_NS = 'http://www.w3.org/2000/svg';
const TITLE_CAP = 100;
const EMPTY_CAPTURE: BuiltCapture = { chunks: [], truncated: false, console: [], network: [] };
const TOOLS: readonly MarkerShape[] = ['circle', 'box', 'arrow', 'hide'];
/** A keyboard mark starts as this, centred; arrows move it 10 px, Shift+arrows resize it. */
const KB_DRAFT = { w: 160, h: 80 } as const;
const MIN_KB_SIZE = 16;
/** The one card's size (vt-8020 D10: it never changes between states) and the clear band the marking bar keeps at the top. */
const CARD = { w: 380, h: 460 } as const;
const BAR_CLEAR = 72;
/** The gap a parked card keeps on a side it did not rest against. */
const PARK_EDGE = 16;
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
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
} as const;

/** The coach's loop (D21): a pointer presses, holds and goes round the problem. */
const LOOP_PATH = 'M 134 14 C 200 14, 214 50, 134 50 C 54 50, 68 14, 134 14';
function coachArt(reduced: boolean): string {
  const motion = reduced
    ? ''
    : `<animateMotion dur="2.8s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;0.18;0.72;1" calcMode="linear" path="${LOOP_PATH}"/>`;
  return (
    '<svg viewBox="0 0 268 64" aria-hidden="true">' +
    '<rect class="bar" x="84" y="27" width="100" height="10" rx="5"/>' +
    `<path class="loop" d="${LOOP_PATH}" pathLength="200"/>` +
    `<g class="pointer"${reduced ? ' transform="translate(134 14)"' : ''}>` +
    '<circle class="hold" r="9"/>' +
    '<path d="M0 0 L0 15 L4 11 L7 18 L10 16.6 L7 10 L12.5 10 Z" fill="#fff" stroke="#151417" stroke-width="1"/>' +
    `${motion}</g></svg>`
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

/** A segmented control's sliding indicator under its picked segment (the marking bar's shapes, the settings' sizes); unmeasurable while hidden. */
function placeIndicator(seg: HTMLElement, ind: HTMLElement, btn: HTMLElement | undefined): void {
  if (!btn || !btn.offsetWidth) return;
  ind.style.width = `${btn.offsetWidth}px`;
  ind.style.transform = `translateX(${btn.offsetLeft}px)`;
  seg.classList.add('measured');
}

/** A text field has the focus — its own editing keys (⌘Z included) are its. */
function typing(): boolean {
  const el = deepActiveElement();
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

/** The widget's DOM, built once into the HUD host's shadow mount. */
function buildDom(mount: HTMLElement) {
  const fabLabel = h('span');
  const fabKbd = h('kbd');
  const fab = h('button', { class: 'fab', type: 'button', part: 'button', 'aria-haspopup': 'dialog' }, fabLabel, fabKbd);

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
    h('div', { class: 'tech-wrap' }, techBtn, tech),
    h('div', { class: 'settings-foot' }, back, unbind),
  );

  const sentTitle = h('h3');
  const sentBody = h('p', { class: 'sent-body' });
  const seeText = h('span');
  const see = h('a', { class: 'see', target: '_blank', rel: 'noopener noreferrer' }, seeText);
  const sentClose = h('button', { class: 'link', type: 'button' });
  const sent = h(
    'div',
    { class: 'pane sent', role: 'status' },
    h('div', { class: 'sent-head' }, icon(ICON.check), sentTitle),
    sentBody,
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

  const body = h('div', { class: 'body' }, describe, settings, sent, reports, recents, linking);
  const card = h('section', { class: 'card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'vr-title' }, head, accountPop, morePop, body, tray, foot);

  const ink = svgEl('svg', { class: 'ink', 'aria-hidden': 'true' });
  const defs = svgEl('defs', {});
  const headMarker = svgEl('marker', { id: 'vr-head', viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' });
  headMarker.append(svgEl('path', { d: 'M0 0L10 5L0 10z', fill: '#dc2f4c' }));
  defs.append(headMarker);
  const shapes = svgEl('g', {});
  const draft = svgEl('g', { class: 'draft' });
  ink.append(defs, shapes, draft);
  const pins = h('div', { class: 'pins' });
  const coachText = h('p');
  const coachMore = h('p');
  const coachKeys = h('p', { class: 'keys', id: 'vr-keys' });
  const coach = h('div', { class: 'coach', role: 'status' });
  coach.append(icon(coachArt(reducedMotion())), coachText, coachMore, coachKeys);
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
  const mark = h('div', { class: 'mark', tabindex: '0', role: 'application', 'aria-describedby': 'vr-keys' }, pins, coach, toolbar);
  mark.prepend(ink);

  // The card after the marking layer: it stays on top of it, usable, while the reporter marks.
  const root = h('div', { class: 'vr' }, fab, mark, card);
  const style = h('style');
  style.textContent = REPORT_CSS;
  // The sheet rides inside the root: the whole tree moves into an open dialog and back (followDialog).
  root.prepend(style);
  mount.append(root);
  return {
    root, fab, fabLabel, fabKbd, card, head, title, whoBtn, whoAv, whoName, more, closeBtn, body, foot,
    accountPop, accName, accMail, accVia, accLinked, accUnlink, accLink, accPortal,
    morePop, mReports, mRecents, mRecord, mSettings, mOpen,
    reports, repBack, repStatus, repRows, repLocal, repPortal, recents, recBack, recStatus, recRows,
    linking, linkBack, linkLabel, linkCode, linkOpen, linkOpenText, linkQr, linkHint, linkWait, linkRetry,
    describe, kinds, kindsLabel, kindButtons, prompt, desc, lines, linesEmpty, attached, attachedText, disclose, discloseText, included,
    notify, notifyBox, notifyText, error, where, whereText, send,
    attach, fileInput, fileNote, files, tray,
    settings, bindLabel, bindBtn, unbind, bindHint, bindReason, back,
    sizeLabel, sizeButtons, sizeInd, sizeSeg, techText, techBtn, tech,
    sent, sentTitle, sentBody, see, seeText, sentClose,
    mark, ink, shapes, draft, pins, coach, coachText, coachMore, coachKeys,
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
  private keybind: Keybind | null;

  private isOpen = false;
  /** Where focus was when the card opened, outside the report: close() hands it back. */
  private opener: HTMLElement | SVGElement | null = null;
  private view: View = 'describe';
  private marking = false;
  private markers: Drawn[] = [];
  private nextKey = 1;
  private tool: MarkerShape = 'circle';
  private frozen: Frozen | null = null;
  private job: ReportJob | null = null;
  private sending = false;
  /** Which leg a failed send stopped at: nothing reached the server, a file, or the replay. */
  private error: '' | 'create' | 'files' | 'capture' = '';
  private result: SubmitReply | null = null;
  private notify = false;
  private sentNotify = false;
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
  private size: WidgetSize = readSize();
  private techOpen = false;
  /** A press on the button: it becomes a drag once it travels DRAG_THRESHOLD; `grab` is where the pointer holds it. */
  private fabDrag: { pointer: number; start: Point; grab: Point; moved: boolean } | null = null;
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
  /** The reporter session the host's signed token was traded for (vt-8020 D4), and that token. */
  private session: ReporterSession | null = null;
  private sessionToken = '';
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
    this.openSelector = opts.openSelector ?? null;
    this.identity = opts.identity === undefined ? undefined : normalizeIdentity(opts.identity);
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
   * Live inside the topmost open dialog while there is one (the recorder's
   * sheet path, hud/host.ts): a modal makes everything outside it inert and
   * its focus trap pulls focus back. The one DOM tree moves, so the draft,
   * the marks and their notes go along; focus is restored after the move.
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
    this.isOpen = true;
    this.opener = insideHud(document.activeElement) ? null : deepActiveElement();
    if (this.view !== 'describe') this.view = 'describe';
    this.result = null;
    // The minutes before THIS open; a half-sent report keeps the capture it started with.
    if (!this.job) this.frozen = this.engine?.freeze() ?? null;
    this.paint();
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
    this.view = 'describe';
    this.unpark();
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
    this.paint();
  }

  unmount(): void {
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
        // A parked card is placed by its painted size: re-place it at the new one.
        if (this.parked) this.placeCard();
      });
    }
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
    on(e.mReports, 'click', fromMenu(() => void this.openReports()));
    on(e.mRecents, 'click', fromMenu(() => this.show('recents')));
    on(e.mRecord, 'click', fromMenu(() => this.recordSwitch?.()));
    on(e.mSettings, 'click', fromMenu(() => this.show('settings')));
    on(e.mOpen, 'click', fromMenu(() => undefined));
    on(e.accPortal, 'click', fromMenu(() => undefined));
    on(e.accLink, 'click', fromMenu(() => this.startLinkFlow()));
    on(e.accUnlink, 'click', () => {
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
    on(e.card, 'keydown', (ev) => {
      // Marking's own Escape (the window listener) already acted on it.
      if (ev.key !== 'Escape' || this.recordingBind || ev.defaultPrevented) return;
      ev.preventDefault();
      // Esc steps back one layer: an open popover, then a list or settings, then the card itself.
      if (this.menu) {
        const opener = this.menu === 'account' ? e.whoBtn : e.more;
        this.menu = null;
        this.paint();
        opener.focus();
      } else if (this.view !== 'describe' && this.view !== 'sent') this.show('describe');
      else this.close();
    });
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
          if (this.recordingBind) return;
          if (this.marking && ev.key === 'Escape') {
            ev.preventDefault();
            // Esc answers an open "Discard?" with Keep, drops a keyboard mark being placed, and only then leaves marking — keeping the marks.
            if (this.confirming) e.keep.click();
            else if (this.kbDraft) this.cancelDraft();
            else this.endMarking(true);
            return;
          }
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
        const sel = this.openSelector;
        const t = ev.target;
        if (!sel || !(t instanceof Element)) return;
        let hit: Element | null = null;
        try {
          hit = t.closest(sel);
        } catch {
          return; // not a selector: nothing of the page opens the card
        }
        if (!hit) return;
        ev.preventDefault();
        this.open();
      }),
    );
    this.offs.push(listen(window, 'resize', () => {
      if (this.parked) this.placeCard();
      if (this.marking) this.placeSeg();
    }));
    this.offs.push(watchKeybind((b) => {
      this.keybind = b;
      this.paint();
    }));
    this.offs.push(onSharedIdentity(() => this.paint()));
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

  /** The host's signed token traded once for a reporter session; renewed only when it is about to lapse. Answers the session in force. */
  private async refreshWho(): Promise<ReporterSession | null> {
    const who = this.who();
    if (!who || !('token' in who)) {
      this.session = null;
      this.sessionToken = '';
      return null;
    }
    if (this.sessionToken === who.token && sessionLive(this.session)) return this.session;
    this.sessionToken = who.token;
    try {
      this.session = await openSession(this.target(), who.token);
    } catch (e) {
      this.session = null;
      console.warn('vitrinka: the reporter session could not be opened — My reports shows this browser’s reports only', e);
    }
    this.paint();
    return this.session;
  }

  private async refreshMember(): Promise<void> {
    const link = readLink();
    if (!link) {
      if (this.member) {
        this.member = null;
        this.paint();
      }
      return;
    }
    try {
      const me = await api<{ user?: { email?: string; name?: string } | null; workspace?: { slug?: string }; displayMode?: string }>(
        'GET',
        '/api/v1/recorder/me',
        undefined,
        { target: { url: this.opts.base, key: link.token } },
      );
      this.member = { email: me.user?.email ?? '', name: me.user?.name ?? '', workspace: me.workspace?.slug ?? link.workspace };
      // A dev-mode member starts on the pill next mount (face.ts startFace).
      rememberDisplayMode(me.displayMode);
    } catch (e) {
      console.warn('vitrinka: the linked vitrinka account could not be read', e);
      this.member = { email: '', name: '', workspace: link.workspace };
    }
    this.paint();
  }

  private async openReports(): Promise<void> {
    this.show('reports');
    const session = await this.refreshWho();
    if (!session) {
      this.mine = { rows: [], state: 'ok' };
      this.paint();
      return;
    }
    this.mine = { rows: [], state: 'loading' };
    this.paint();
    try {
      this.mine = { rows: await this.listMineRenewing(session), state: 'ok' };
    } catch (e) {
      console.warn('vitrinka: My reports could not be loaded', e);
      this.mine = { rows: [], state: 'failed' };
    }
    this.paint();
  }

  /** My reports; a 401 means the reporter session lapsed or the host's key rotated: trade the token again, then ask once more. */
  private async listMineRenewing(session: ReporterSession): Promise<MyReport[]> {
    try {
      return (await listMine(this.target(), session.session)).reports;
    } catch (e) {
      if (!(e instanceof VitrinkaApiError) || e.status !== 401) throw e;
      this.session = null;
      this.sessionToken = '';
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
        storeLink({ ...linked, base });
        this.linkFlow = null;
        this.show('describe');
        await this.refreshMember();
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
    this.fabDrag = { pointer: ev.pointerId, start: { x: ev.clientX, y: ev.clientY }, grab: { x: ev.clientX - r.left, y: ev.clientY - r.top }, moved: false };
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
    d.moved = true;
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
    const fab = this.e.fab;
    const at = fab.getBoundingClientRect();
    fab.classList.remove('dragging');
    for (const p of ['left', 'top', 'right', 'bottom']) fab.style.removeProperty(p);
    // The click this pointerup is about to fire is the drop; a click that never comes must not eat the next one.
    this.swallowClick = true;
    setTimeout(() => {
      this.swallowClick = false;
    }, 0);
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

  // -- marking --------------------------------------------------------------

  private startMarking(): void {
    if (this.job?.id) return; // the report is on its way: Retry finishes it as it was marked
    this.marking = true;
    this.confirming = false;
    this.passKeys = new Set(this.markers.map((m) => m.key));
    // Marking parks the card from where it is (beside the button's dock, or a corner an earlier pass
    // chose), with the insets it has there: starting never moves it — only a mark landing under it does.
    const corner = this.parked ?? this.dock;
    this.parkInsets = this.insetsAt(corner, this.e.card.getBoundingClientRect());
    this.parked = corner;
    this.renderMarks();
    this.paint();
    this.placeCard();
    this.placeSeg();
    const vw = globalThis.innerWidth || 800;
    this.placeCoach({ x: vw / 2 - 150, y: BAR_CLEAR + 12 }, false);
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

  /** Parks the card in the corner that covers none of the marks; it glides there (styles: `.card.parked`). */
  private placeCard(): void {
    if (!this.parked) return;
    const f = this.frame();
    this.parked = pickCorner(this.parked, this.markers.map((m) => m.rect), f);
    const r = cornerRect(this.parked, f);
    const s = this.e.card.style;
    this.e.card.classList.add('parked');
    s.left = `${r.x}px`;
    s.top = `${r.y}px`;
  }

  private unpark(): void {
    this.parked = null;
    this.parkInsets = null;
    this.e.card.classList.remove('parked');
    this.e.card.style.removeProperty('left');
    this.e.card.style.removeProperty('top');
  }

  /** The segmented control's indicator under the picked shape. */
  private placeSeg(): void {
    placeIndicator(this.e.seg, this.e.segInd, this.e.toolButtons.get(this.tool));
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
    if (!this.markers.length) this.placeCoach({ x: ev.clientX, y: ev.clientY }, true);
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

  /** The coach rides beside the pointer, inside the viewport. */
  private placeCoach(p: Point, beside: boolean): void {
    const vw = globalThis.innerWidth || 800;
    const vh = globalThis.innerHeight || 600;
    const w = this.e.coach.offsetWidth || 300;
    const hgt = this.e.coach.offsetHeight || 140;
    let x = beside ? p.x + 20 : p.x;
    let y = beside ? p.y + 20 : p.y;
    if (x + w > vw - 8) x = beside ? p.x - w - 20 : vw - w - 8;
    if (y + hgt > vh - 90) y = beside ? p.y - hgt - 20 : vh - hgt - 90;
    this.e.coach.style.left = `${Math.max(8, x)}px`;
    this.e.coach.style.top = `${Math.max(8, y)}px`;
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
    label.textContent = w > 60 && hh > 20 ? this.s.hidden : '';
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
    };
  }

  /** The words the report goes with: the description, else the first mark's note — either one is enough to send. */
  private words(): string {
    return this.e.desc.value.trim() || (this.markers.find((m) => m.note.trim())?.note.trim() ?? '');
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
        const capture = this.engine
          ? await this.engine.build(this.frozen ?? { clip: null, stored: Promise.resolve(new Map()) }, this.markers, marked).catch((e: unknown) => {
              console.warn('vitrinka: the capture could not be prepared — the report goes without it', e);
              return EMPTY_CAPTURE;
            })
          : EMPTY_CAPTURE;
        this.job = new ReportJob(capture, globalThis.location?.host ?? '', { url: this.opts.base, key: this.opts.key }, this.files);
      }
      this.result = await this.job.run(this.envelope(description, this.job.capture));
      noteSent(this.opts.base, globalThis.location?.host ?? '', {
        title: titleOf(description),
        at: Date.now(),
        status: this.result.status,
        ...(this.result.reportUrl ? { url: this.result.reportUrl } : {}),
      });
      this.sentNotify = this.notify && this.who() !== null;
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
    e.accVia.textContent = who ? s.signedInByApp : s.anonymousHint;
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
    e.fileInput.setAttribute('accept', this.caps().types.join(','));
    e.tray.hidden = this.view !== 'describe' || (this.files.length === 0 && !this.fileRefusal);
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
    e.root.style.setProperty('--vr-scale', String(SIZE_SCALE[this.size]));

    e.fab.hidden = !this.button || this.marking;
    e.fabLabel.textContent = s.button;
    e.fab.setAttribute('aria-expanded', String(this.isOpen));
    e.fab.setAttribute('aria-description', s.moveHint);
    e.fab.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
    e.fabKbd.hidden = !this.keybind;
    e.fabKbd.textContent = this.keybind ? keybindLabel(this.keybind) : '';

    // The one card stays up while marking (vt-8020 D10): its note lines and Send are where the reporter finishes.
    e.card.hidden = !this.isOpen;
    e.card.classList.toggle('busy', this.sending);
    e.title.textContent = s.title;
    e.closeBtn.setAttribute('aria-label', s.close);
    this.paintAccount();
    e.describe.hidden = this.view !== 'describe';
    e.settings.hidden = this.view !== 'settings';
    e.sent.hidden = this.view !== 'sent';
    e.reports.hidden = this.view !== 'reports';
    e.recents.hidden = this.view !== 'recents';
    e.linking.hidden = this.view !== 'link';
    if (this.view === 'reports') this.paintReports();
    if (this.view === 'recents') this.paintRecents();
    if (this.view === 'link') this.paintLink();
    e.foot.hidden = this.view !== 'describe';
    this.paintFiles();

    e.kindsLabel.textContent = s.kindsLabel;
    for (const [kind, btn] of e.kindButtons) {
      btn.textContent = s.kinds[kind];
      btn.setAttribute('aria-checked', String(this.kind === kind));
      btn.disabled = this.sending;
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

    e.sentTitle.textContent = s.sentTitle;
    // Filed or waiting: an unsigned report is checked by the team before it is filed, and says so.
    e.sentBody.textContent = this.result?.status === 'quarantined' ? s.sentQueued : this.sentNotify ? s.sentNotify : s.sentBody;
    e.seeText.textContent = s.seeReport;
    const url = this.result?.reportUrl;
    e.see.hidden = !url;
    if (url) e.see.setAttribute('href', url);
    else e.see.removeAttribute('href');
    e.sentClose.textContent = s.close;

    e.mark.hidden = !this.marking;
    e.toolbar.setAttribute('aria-label', s.toolbar);
    e.seg.setAttribute('aria-label', s.toolbar);
    e.barLead.textContent = s.barLead;
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
    e.coach.hidden = !this.marking || this.markers.length > 0;
    e.coachText.textContent = s.coach;
    e.coachMore.textContent = s.coachMore;
    e.coachKeys.textContent = s.keyboardHint;
    e.mark.setAttribute('aria-label', s.marking);
    if (this.marking) {
      for (const label of e.shapes.querySelectorAll('.veil-label')) {
        if (label.textContent) label.textContent = s.hidden;
      }
    }
    // Always: the note lines live in the card, so their labels follow the locale outside marking too.
    this.renderPins();
  }
}

function renumberDrawn(markers: readonly Drawn[]): Drawn[] {
  return renumber(markers).map((m, i) => ({ ...m, key: markers[i]!.key }));
}
