/**
 * Markers (QA Studio D12/D21): what a reporter draws on the frozen page —
 * circle, box, arrow, hide — numbered 1, 2, 3… with an optional note. No
 * element selector, ever: a marker is a region of the viewport in CSS
 * pixels (`viewport: {w, h, dpr}` rides on the report's env).
 *
 * `hide` is a masking box: the region is blanked in the capture before it
 * leaves the browser — an opaque box joins every full snapshot of the replay
 * (so every frame and every still shows it blank), and the text and form
 * values of the page's nodes under it (`hiddenNodeIds`, read off rrweb's
 * mirror at send) are emptied in the snapshots and in the mutations and
 * input events that carried them.
 */
import type { eventWithTime } from '@rrweb/types';

export type MarkerShape = 'circle' | 'box' | 'arrow' | 'hide';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which corner of an arrow's rect its head points into. */
export type ArrowHead = 'nw' | 'ne' | 'sw' | 'se';

export interface Marker {
  n: number;
  shape: MarkerShape;
  rect: Rect;
  note: string;
  /** Arrows only: the head's corner (the tail sits in the opposite one). */
  head?: ArrowHead;
}

/** A marker on the report wire. */
export interface WireMarker {
  n: number;
  shape: MarkerShape;
  rect: Rect;
  note?: string;
  head?: ArrowHead;
}

export interface Point {
  x: number;
  y: number;
}

/** The smallest stroke that counts as a marker; a click without moving is not one. */
export const MIN_MARK_PX = 8;

export function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function arrowHead(tail: Point, head: Point): ArrowHead {
  return `${head.y < tail.y ? 'n' : 's'}${head.x < tail.x ? 'w' : 'e'}`;
}

/** The arrow's two ends from its rect and head corner. */
export function arrowEnds(rect: Rect, head: ArrowHead): { tail: Point; tip: Point } {
  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;
  const tip = { x: head.endsWith('w') ? left : right, y: head.startsWith('n') ? top : bottom };
  const tail = { x: head.endsWith('w') ? right : left, y: head.startsWith('n') ? bottom : top };
  return { tail, tip };
}

/** Is the stroke from `a` to `b` big enough to be a `shape`? */
export function isMark(shape: MarkerShape, a: Point, b: Point): boolean {
  if (shape === 'arrow') return Math.hypot(b.x - a.x, b.y - a.y) >= MIN_MARK_PX * 2;
  return Math.abs(b.x - a.x) >= MIN_MARK_PX && Math.abs(b.y - a.y) >= MIN_MARK_PX;
}

/** Numbered 1..n in drawing order (after a removal too). */
export function renumber(markers: readonly Marker[]): Marker[] {
  return markers.map((m, i) => ({ ...m, n: i + 1 }));
}

export function toWire(markers: readonly Marker[]): WireMarker[] {
  return markers.map((m) => ({
    n: m.n,
    shape: m.shape,
    rect: { x: Math.round(m.rect.x), y: Math.round(m.rect.y), w: Math.round(m.rect.w), h: Math.round(m.rect.h) },
    ...(m.note.trim() ? { note: m.note.trim() } : {}),
    ...(m.shape === 'arrow' && m.head ? { head: m.head } : {}),
  }));
}

// -- hide: blanking the capture ------------------------------------------------

/** rrweb's numeric codes (`@rrweb/types` is type-only here). */
const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const SOURCE_MUTATION = 0;
const SOURCE_INPUT = 5;
const NODE_ELEMENT = 2;
const NODE_TEXT = 3;
/** Far above any id rrweb hands out in one recording. */
export const HIDE_NODE_ID_BASE = 2_000_000_000;
export const HIDE_ATTR = 'data-vitrinka-hidden';
const HIDE_FILL = '#1b1b1f';

/** The serialized node fields this transform touches (rrweb-snapshot's shape). */
interface SNode {
  type: number;
  id: number;
  tagName?: string;
  textContent?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SNode[];
}

interface MutationData {
  source: number;
  texts?: { id: number; value: string | null }[];
  adds?: { parentId: number; node: SNode }[];
  attributes?: { id: number; attributes: Record<string, unknown> }[];
}

interface InputData {
  source: number;
  id: number;
  text?: string;
}

function hideBox(rect: Rect, i: number): SNode {
  const style =
    `position:fixed;left:${Math.round(rect.x)}px;top:${Math.round(rect.y)}px;` +
    `width:${Math.round(rect.w)}px;height:${Math.round(rect.h)}px;` +
    `background:${HIDE_FILL};z-index:2147483647;pointer-events:none;`;
  return { type: NODE_ELEMENT, id: HIDE_NODE_ID_BASE + i, tagName: 'div', attributes: { [HIDE_ATTR]: '', style }, childNodes: [] };
}

/** A copy of the tree with hidden texts and values emptied and the boxes appended to <body>. */
function blankTree(node: SNode, ids: ReadonlySet<number>, boxes: readonly SNode[], appended: { done: boolean }): SNode {
  const out: SNode = { ...node };
  if (node.type === NODE_TEXT && ids.has(node.id)) out.textContent = '';
  if (node.attributes && ids.has(node.id) && 'value' in node.attributes) out.attributes = { ...node.attributes, value: '' };
  if (node.childNodes) {
    out.childNodes = node.childNodes.map((c) => blankTree(c, ids, boxes, appended));
    if (!appended.done && node.type === NODE_ELEMENT && node.tagName === 'body') {
      out.childNodes.push(...boxes);
      appended.done = true;
    }
  }
  return out;
}

/** The last <html>-ish element to hang the boxes on when a snapshot has no <body> (a frameset). */
function appendToRoot(root: SNode, boxes: readonly SNode[]): void {
  const html = root.childNodes?.find((c) => c.type === NODE_ELEMENT);
  (html ?? root).childNodes?.push(...boxes);
}

function blankAdded(node: SNode, ids: ReadonlySet<number>): SNode {
  return blankTree(node, ids, [], { done: true });
}

/**
 * The capture with every `hide` region blanked: the boxes join each full
 * snapshot, and the nodes in `hiddenIds` lose their text and values in the
 * snapshots, in mutations and in input events. Returns new events; the
 * input is never mutated (the buffer still holds it).
 */
export function applyHides(events: readonly eventWithTime[], hides: readonly Rect[], hiddenIds: ReadonlySet<number>): eventWithTime[] {
  if (!hides.length && !hiddenIds.size) return events.slice();
  const boxes = hides.map(hideBox);
  return events.map((ev) => {
    // boundary: rrweb's serialized JSON, read through the fields above.
    const data = ev.data as unknown as { node?: SNode; source?: number };
    if (ev.type === FULL_SNAPSHOT && data.node) {
      const appended = { done: false };
      const node = blankTree(data.node, hiddenIds, boxes, appended);
      if (!appended.done) appendToRoot(node, boxes);
      return { ...ev, data: { ...ev.data, node } } as eventWithTime;
    }
    if (ev.type !== INCREMENTAL || !hiddenIds.size) return ev;
    if (data.source === SOURCE_MUTATION) {
      const m = ev.data as unknown as MutationData;
      const blanked: MutationData = {
        ...m,
        ...(m.texts ? { texts: m.texts.map((t) => (hiddenIds.has(t.id) ? { ...t, value: '' } : t)) } : {}),
        ...(m.adds ? { adds: m.adds.map((a) => ({ ...a, node: blankAdded(a.node, hiddenIds) })) } : {}),
        ...(m.attributes
          ? {
              attributes: m.attributes.map((a) =>
                hiddenIds.has(a.id) && 'value' in a.attributes ? { ...a, attributes: { ...a.attributes, value: '' } } : a,
              ),
            }
          : {}),
      };
      return { ...ev, data: blanked } as unknown as eventWithTime;
    }
    if (data.source === SOURCE_INPUT) {
      const input = ev.data as unknown as InputData;
      if (hiddenIds.has(input.id)) return { ...ev, data: { ...input, text: '' } } as unknown as eventWithTime;
    }
    return ev;
  });
}

/** What `hiddenNodeIds` needs of rrweb's mirror. */
export interface NodeIds {
  getId(n: Node): number;
}

function inside(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function centerOf(r: DOMRect): Point {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * The rrweb ids of the page's text nodes and form controls whose box is
 * centred inside a hide region right now (the page is frozen while the
 * reporter marks). Our own surfaces are skipped.
 */
export function hiddenNodeIds(hides: readonly Rect[], mirror: NodeIds | null, doc: Document = document): Set<number> {
  const ids = new Set<number>();
  if (!hides.length || !mirror || !doc.body) return ids;
  const within = (r: DOMRect) => r.width > 0 && r.height > 0 && hides.some((h) => inside(centerOf(r), h));
  const take = (n: Node) => {
    const id = mirror.getId(n);
    if (id > 0) ids.add(id);
  };
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (!n.textContent?.trim()) continue;
      range.selectNodeContents(n);
      if (within(range.getBoundingClientRect())) take(n);
    } else if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement || n instanceof HTMLSelectElement) {
      if (within(n.getBoundingClientRect())) take(n);
    }
  }
  range.detach();
  return ids;
}
