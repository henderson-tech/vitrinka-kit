/**
 * The HUD's stylesheet. Lives inside the shadow root (a `<style>` element),
 * so it never touches host CSS and host CSS never touches it.
 *
 * Shapes (recorder-hud-subtle): the 28px glass PUCK at idle, the dot+timer
 * CAPSULE while recording that unfolds into the TRAY on intent, the 6px edge
 * TAB when tucked. The `.dock` rests on one of six spots (`data-row` t|b ×
 * `data-col` l|c|r) by viewport insets, so an unfolding tray always grows
 * toward the centre; a drag moves it by `transform` only. Motion follows
 * the transitions.dev token scale.
 */
export const HUD_CSS_BASE = `
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
svg { width:1em; height:1em; vertical-align:-.125em; }
.hud {
  --ink: rgba(26,22,23,.72); --ink-pop: rgba(26,22,23,.88); --ink-solid: #1d1a1b;
  --ink-2: rgba(255,255,255,.08); --edge: rgba(255,255,255,.11); --rim: rgba(0,0,0,.30);
  --fg: #f4efea; --fg-2: rgba(244,239,234,.66); --fg-3: rgba(244,239,234,.44);
  --rec: #ff3b57; --warn: #f0a63a;
  --m: 16px; --h: 28px; --b: 24px;
  --duration-quick: 150ms; --duration-fast: 250ms; --duration-resize: 300ms; --duration-medium: 350ms; --duration-snap: 500ms;
  --ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1); --ease-in-out: ease-in-out; --ease-out: ease-out;
  --ease-spring: var(--ease-smooth-out);
  --scale-open: .97; --scale-closing: .99; --blur-small: 2px; --rise: 16px;
  color: var(--fg); font-size: 12px;
}
@supports (transition-timing-function: linear(0, 1)) {
  /* a damped spring, ~4% overshoot over 500ms — the settle after a throw */
  .hud { --ease-spring: linear(0, 0.042, 0.143, 0.274, 0.414, 0.549, 0.67, 0.773, 0.856, 0.921, 0.968, 1.001, 1.021, 1.033, 1.038, 1.038, 1.035, 1.031, 1.025, 1.02, 1.015, 1.011, 1.007, 1.004, 1); }
}
@media (pointer: coarse) { .hud { --m: 12px; --h: 32px; --b: 30px; } }
/* scoped under .hud so a control's own \`all:unset\` reset cannot wipe the surface */
.hud .glass, .hud .menu, .hud .pop, .hud .detail, .hud .hint {
  background: var(--ink);
  -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
  box-shadow: inset 0 0 0 1px var(--edge), 0 0 0 .5px var(--rim), 0 10px 28px -10px rgba(0,0,0,.5), 0 2px 6px -2px rgba(0,0,0,.28);
  color: var(--fg);
}
.hud .menu, .hud .pop { background: var(--ink-pop); }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .hud .glass, .hud .menu, .hud .pop, .hud .detail, .hud .hint { background: var(--ink-solid); }
}
.sr { position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }

/* the dock: one of six spots, or tucked into a side edge */
.dock { position:fixed; z-index:4; display:flex; pointer-events:auto; }
.dock[data-row="b"] { bottom: calc(var(--m) + env(safe-area-inset-bottom, 0px)); }
.dock[data-row="t"] { top: calc(var(--m) + env(safe-area-inset-top, 0px)); }
.dock[data-col="l"] { left: calc(var(--m) + env(safe-area-inset-left, 0px)); }
.dock[data-col="r"] { right: calc(var(--m) + env(safe-area-inset-right, 0px)); }
.dock[data-col="c"] { left: calc(50% - var(--hw, 36px) / 2); }
.dock[data-tuck] { top: clamp(8px, calc(var(--ty, .5) * 100% - 28px), calc(100% - 64px)); }
.dock[data-tuck="left"] { left:0; }
.dock[data-tuck="right"] { right:0; }
.dock.settling { transition: transform var(--duration-snap) var(--ease-spring); }
.dock.dragging .glass { box-shadow: inset 0 0 0 1px var(--edge), 0 0 0 .5px var(--rim), 0 18px 40px -12px rgba(0,0,0,.55), 0 4px 10px -4px rgba(0,0,0,.3); }

/* the recording dot: a soft ripple while recording, still otherwise */
.dot { position:relative; width:8px; height:8px; flex:none; border-radius:50%; background:var(--rec); }
.dot::after { content:""; position:absolute; inset:0; border-radius:50%; box-shadow:0 0 0 0 rgba(255,59,87,.5); animation:ripple 2s var(--ease-out) infinite; }
@keyframes ripple { 0% { box-shadow:0 0 0 0 rgba(255,59,87,.45); } 70%, 100% { box-shadow:0 0 0 7px rgba(255,59,87,0); } }
.bar[data-state="paused"] .dot { background:var(--fg-3); }
.bar[data-state="bad"] .dot { background:var(--warn); }
.bar[data-state="paused"] .dot::after, .bar[data-state="bad"] .dot::after { animation:none; }

/* idle: the puck — ring = not linked, dot = ready; the label slides out on intent */
.puck { all:unset; box-sizing:border-box; display:inline-flex; align-items:center; height:var(--h); min-width:var(--h);
  padding:0 calc((var(--h) - 10px) / 2); border-radius:999px; cursor:pointer; touch-action:none; user-select:none; -webkit-user-select:none;
  font-weight:600; font-size:12px; color:var(--fg); }
.dock[data-col="r"] .puck { flex-direction:row-reverse; }
.ring { width:10px; height:10px; flex:none; border-radius:50%; box-shadow:inset 0 0 0 1.5px var(--fg-2);
  transition: background-color var(--duration-quick) var(--ease-out), box-shadow var(--duration-quick) var(--ease-out); }
.puck[data-state="ready"] .ring { background:var(--fg-2); box-shadow:none; }
.puck[data-state="busy"] .ring { background:var(--fg-3); box-shadow:none; animation:breathe 1.2s var(--ease-in-out) infinite; }
@keyframes breathe { 50% { opacity:.35; } }
.lab { display:grid; grid-template-columns:0fr; opacity:0;
  transition: grid-template-columns var(--duration-resize) var(--ease-smooth-out), opacity var(--duration-quick) var(--ease-out); }
/* the gap to the ring is a clipped pseudo-element: padding would keep a folded label 10px wide */
.lab > span { min-width:0; overflow:hidden; white-space:nowrap; }
.lab > span::before, .lab > span::after { content:""; display:inline-block; }
.lab > span::before { width:8px; }
.lab > span::after { width:2px; }
.dock[data-col="r"] .lab > span::before { width:2px; }
.dock[data-col="r"] .lab > span::after { width:8px; }
.puck:focus-visible .lab { grid-template-columns:1fr; opacity:1; }
.puck:focus-visible { outline:2px solid var(--rec); outline-offset:2px; }
@media (hover: hover) {
  .puck:hover .lab { grid-template-columns:1fr; opacity:1; }
  .puck[data-state="ready"]:hover .ring { background:var(--rec); }
  .puck[data-state="unlinked"]:hover .ring { box-shadow:inset 0 0 0 1.5px var(--fg); }
}

/* recording: the capsule (handle) + the tray it unfolds */
.bar { position:relative; display:inline-flex; align-items:center; height:var(--h); border-radius:999px; }
.dock[data-col="r"] .bar, .dock[data-col="r"] .tray-in { flex-direction:row-reverse; }
.handle { all:unset; box-sizing:border-box; display:inline-flex; align-items:center; gap:7px; height:var(--h);
  padding:0 11px 0 10px; border-radius:999px; cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none; }
.dock.dragging .handle { cursor:grabbing; }
.handle:focus-visible { outline:2px solid var(--rec); outline-offset:2px; }
.time { font-weight:600; font-size:12px; line-height:1; font-variant-numeric:tabular-nums; letter-spacing:.01em; min-width:34px; }
.tray { display:grid; grid-template-columns:0fr; transition: grid-template-columns var(--duration-resize) var(--ease-smooth-out); }
.tray-in { min-width:0; overflow:hidden; display:flex; align-items:center; gap:1px; padding:34px 3px; margin:-34px 0;
  pointer-events:none; opacity:0; filter:blur(var(--blur-small));
  transition: opacity var(--duration-quick) var(--ease-in-out), filter var(--duration-quick) var(--ease-in-out); }
.tray-in > * { pointer-events:auto; }
.bar[data-open] .tray { grid-template-columns:1fr; }
.bar[data-open] .tray-in { opacity:1; filter:none; transition-duration: var(--duration-fast); transition-delay: 60ms; }
.sep { width:1px; height:14px; flex:none; margin:0 5px; background:var(--edge); }
.sync { display:inline-grid; place-items:center; width:18px; flex:none; font-size:11px; color:var(--fg-3); }
.sync.warn, .sync.bad { color:var(--warn); }
button.tb { all:unset; pointer-events:auto; box-sizing:border-box; position:relative; flex:none; display:inline-grid; place-items:center;
  width:var(--b); height:var(--b); border-radius:999px; color:var(--fg-2); cursor:pointer; font-size:13px;
  transition: background-color var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out); }
button.tb.b-annotate { color:var(--rec); }
button.tb.on { background:var(--rec); color:#fff; }
button.tb:focus-visible { outline:2px solid var(--rec); outline-offset:-2px; }
@media (hover: hover) { button.tb:hover { background:var(--ink-2); color:var(--fg); } button.tb.on:hover { background:var(--rec); color:#fff; } }
kbd { position:absolute; left:50%; bottom:calc(100% + 8px); transform:translateX(-50%); padding:4px 6px; border-radius:6px;
  background:var(--ink-pop); box-shadow:inset 0 0 0 1px var(--edge); color:var(--fg-2); font:600 10px/1 -apple-system, BlinkMacSystemFont, sans-serif;
  letter-spacing:.02em; white-space:nowrap; opacity:0; pointer-events:none; transition:opacity var(--duration-quick) var(--ease-out); }
.dock[data-row="t"] kbd { bottom:auto; top:calc(100% + 8px); }
@media (hover: hover) { button.tb:hover kbd { opacity:1; transition-delay:400ms; } }
button.tb:focus-visible kbd { opacity:1; }
.bar.composing kbd { opacity:0 !important; }

/* the health line: only when something needs saying */
.detail { position:absolute; width:max-content; max-width:260px; padding:6px 11px; border-radius:999px; color:var(--fg-2); font-size:11px; line-height:1.35;
  opacity:0; transform:translateY(4px); pointer-events:none;
  transition: opacity var(--duration-fast) var(--ease-smooth-out), transform var(--duration-fast) var(--ease-smooth-out); }
.dock[data-row="b"] .detail { bottom:calc(100% + 6px); }
.dock[data-row="t"] .detail { top:calc(100% + 6px); transform:translateY(-4px); }
.dock[data-col="r"] .detail { right:0; }
.dock[data-col="l"] .detail, .dock[data-col="c"] .detail { left:0; }
.detail.show { opacity:1; transform:none; }
.detail.bad { color:var(--fg); box-shadow: inset 0 0 0 1px rgba(240,166,58,.55), 0 10px 28px -10px rgba(0,0,0,.5); }

/* the edge tab a tucked HUD becomes */
.tab { all:unset; box-sizing:border-box; position:relative; display:block; width:22px; height:56px; cursor:pointer; touch-action:none; }
.tab::before { content:""; position:absolute; top:0; bottom:0; width:6px; background:var(--ink);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  box-shadow: inset 0 0 0 1px var(--edge), 0 0 0 .5px var(--rim), 0 6px 18px -6px rgba(0,0,0,.5);
  transition: width var(--duration-quick) var(--ease-out); }
.tab::after { content:""; position:absolute; top:16px; bottom:16px; width:2px; border-radius:1px; background:var(--fg-3); }
.dock[data-tuck="left"] .tab::before { left:0; border-radius:0 7px 7px 0; }
.dock[data-tuck="right"] .tab::before { right:0; border-radius:7px 0 0 7px; }
.dock[data-tuck="left"] .tab::after { left:2px; }
.dock[data-tuck="right"] .tab::after { right:2px; }
.tab[data-state="rec"]::after { background:var(--rec); }
.tab[data-state="bad"]::after { background:var(--warn); }
.tab:focus-visible::before { width:10px; outline:2px solid var(--rec); outline-offset:1px; }
@media (hover: hover) { .tab:hover::before { width:9px; } }

/* the ⋯ menu — grows from the bar toward the viewport centre */
.menu { position:absolute; min-width:188px; padding:5px; border-radius:12px; display:flex; flex-direction:column; gap:1px; z-index:5; }
.dock[data-row="b"] .menu { bottom:calc(100% + 8px); }
.dock[data-row="t"] .menu { top:calc(100% + 8px); }
.dock[data-col="r"] .menu { right:0; }
.dock[data-col="l"] .menu, .dock[data-col="c"] .menu { left:0; }
.menu > button { all:unset; box-sizing:border-box; cursor:pointer; padding:8px 10px; border-radius:7px; color:var(--fg);
  font-size:12.5px; line-height:1; display:flex; gap:9px; align-items:center; }
.menu > button svg { color:var(--fg-2); }
.menu > button:focus-visible { outline:2px solid var(--rec); outline-offset:-2px; }
@media (hover: hover) { .menu > button:hover { background:var(--ink-2); } .menu > button.danger:hover, .menu > button.danger:hover svg { color:var(--rec); } }
.moveto { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 6px 6px 10px; margin-top:3px;
  border-top:1px solid var(--edge); color:var(--fg-2); font-size:12px; }
.spots { display:grid; grid-template-columns:repeat(3, 24px); grid-template-rows:repeat(2, 24px); gap:0 2px; }
.spots button { all:unset; box-sizing:border-box; position:relative; cursor:pointer; border-radius:5px; }
.spots button::before { content:""; position:absolute; inset:7px 5px; border-radius:3px; background:var(--ink-2); box-shadow:inset 0 0 0 1px var(--edge); }
.spots button[aria-checked="true"]::before { background:var(--rec); box-shadow:none; }
.spots button:focus-visible { outline:2px solid var(--rec); outline-offset:-2px; }
@media (hover: hover) { .spots button:hover::before { background:var(--fg-3); } .spots button[aria-checked="true"]:hover::before { background:var(--rec); } }

/* presence: dropdown-style grow from the anchor on open, a softer shrink on close */
.grow { transform:scale(var(--scale-open)); opacity:0;
  transition: transform var(--duration-fast) var(--ease-smooth-out), opacity var(--duration-fast) var(--ease-smooth-out); }
.grow[data-origin="bottom-right"] { transform-origin:bottom right; }
.grow[data-origin="bottom-left"] { transform-origin:bottom left; }
.grow[data-origin="bottom-center"] { transform-origin:bottom center; }
.grow[data-origin="top-right"] { transform-origin:top right; }
.grow[data-origin="top-left"] { transform-origin:top left; }
.grow[data-origin="top-center"] { transform-origin:top center; }
.grow.is-open { transform:scale(1); opacity:1; }
.grow.is-closing { transform:scale(var(--scale-closing)); opacity:0; pointer-events:none;
  transition-duration: var(--duration-quick); }
/* phone: the sheet rises from the bottom edge (toast motion) */
.rise { transform:translateY(var(--rise)) scale(var(--scale-open)); opacity:0; filter:blur(var(--blur-small));
  transition: transform var(--duration-fast) var(--ease-smooth-out), opacity var(--duration-fast) var(--ease-smooth-out), filter var(--duration-fast) var(--ease-smooth-out); }
.rise.is-open { transform:none; opacity:1; filter:none; transition-duration: var(--duration-medium); }
.rise.is-closing { pointer-events:none; }

/* pick chrome (annotate mode): dim, outline, hint — shadow-root children */
.dim { position:fixed; inset:0; z-index:1; pointer-events:none; background:rgba(0,0,0,.18); }
.outline { position:fixed; z-index:2; pointer-events:none; border:2px solid var(--rec); border-radius:6px;
  box-shadow:0 0 0 4px rgba(255,59,87,.15); }
.hint { position:fixed; top:14px; left:50%; transform:translateX(-50%); z-index:3; padding:8px 14px;
  border-radius:999px; font-size:12px; font-weight:600; line-height:1; white-space:nowrap; display:flex; gap:8px; align-items:center; }
.hint svg { color:var(--rec); }
.hint .keys { color:var(--fg-3); font-weight:500; margin-left:-4px; }
@media (pointer: coarse) { .hint .keys { display:none; } }
.hud[data-spot="tc"] .hint { top:auto; bottom:14px; }

/* sheets: a popover anchored to the dock, or a phone bottom sheet */
.anchor { position:fixed; z-index:6; pointer-events:none; }
.anchor > * { pointer-events:auto; }
.phone { position:fixed; z-index:6; display:flex; flex-direction:column; justify-content:flex-end;
  padding:0 8px calc(8px + env(safe-area-inset-bottom, 0px)); pointer-events:none; }
.phone > * { pointer-events:auto; }
.pop { width:min(288px, calc(100vw - 24px)); padding:12px; border-radius:14px; }
.phone .pop { width:100%; border-radius:18px; padding:14px; }
.pop-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.title { display:flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; color:var(--fg); }
.title i { width:3px; height:11px; border-radius:1px; background:var(--rec); }
.closeb { all:unset; box-sizing:border-box; cursor:pointer; width:24px; height:24px; border-radius:7px; color:var(--fg-3);
  display:inline-grid; place-items:center; font-size:12px; }
.closeb:focus-visible, .sendb:focus-visible, .retry:focus-visible, .dest button:focus-visible { outline:2px solid var(--rec); outline-offset:2px; }
@media (hover: hover) { .closeb:hover { color:var(--fg); background:var(--ink-2); } }
textarea { width:100%; margin-top:10px; padding:9px 11px; min-height:64px; resize:vertical; background:rgba(0,0,0,.28);
  border:0; box-shadow:inset 0 0 0 1px var(--edge); border-radius:9px; color:var(--fg);
  font:400 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
@media (pointer: coarse) { textarea { font-size:16px; } .hints { display:none; } }
textarea::placeholder { color:var(--fg-3); }
textarea:focus { outline:none; box-shadow:inset 0 0 0 1px var(--fg-3); }
.row { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:10px; margin-top:10px; }
.row.nodest { grid-template-columns:minmax(0,1fr) auto; }
.ctx { font-size:11px; line-height:1.35; color:var(--fg-3); text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row.nodest .ctx { text-align:left; }
.dest { display:inline-flex; padding:2px; border-radius:8px; background:rgba(0,0,0,.28); box-shadow:inset 0 0 0 1px var(--edge); }
.dest button { all:unset; box-sizing:border-box; cursor:pointer; padding:5px 8px; min-height:24px; border-radius:6px; color:var(--fg-3);
  font-size:11.5px; font-weight:600; line-height:14px; transition: background-color var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out); }
.dest button[aria-pressed="true"] { background:var(--ink-2); color:var(--fg); }
.sendb { all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 12px;
  border-radius:8px; background:var(--rec); color:#fff; font-size:12.5px; font-weight:600; line-height:1; text-decoration:none; }
@media (hover: hover) { .sendb:hover { background:#ff5670; } }
.hints { margin-top:9px; font-size:11px; line-height:1; color:var(--fg-3); }
`;

/**
 * Inline style of the HUD host: a 0×0 fixed box at the viewport origin (the
 * dock and sheets are fixed children of its shadow root). Zero-size keeps
 * rrweb's placeholder for this blocked node empty in every replay, and
 * `pointer-events:none` lets the page under the HUD's gaps take every
 * click. Overrides the [popover] UA sheet.
 */
export const HOST_STYLE =
  'all:initial;position:fixed;z-index:2147483647;inset:0 auto auto 0;margin:0;padding:0;border:0;' +
  'background:transparent;overflow:visible;width:0;height:0;pointer-events:none;color-scheme:normal;';

/** Inline style of a sheet host portaled into a dialog — the same 0×0 origin box. */
export const SHEET_HOST_STYLE = HOST_STYLE;

/** Link-sheet additions (appended to HUD_CSS). */
export const LINK_CSS = `
.linkgrid { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px 12px; align-items:center; margin-top:10px; }
.linkgrid.noqr { grid-template-columns:minmax(0,1fr); }
.code { font-size:22px; font-weight:700; line-height:1.2; letter-spacing:.08em; font-variant-numeric:tabular-nums; color:var(--fg); }
.linkgrid .sendb { justify-self:start; margin-top:6px; }
.qr { grid-column:2; grid-row:1 / span 3; width:76px; height:76px; border-radius:8px; background:#fff; padding:4px; }
.linkline { margin-top:8px; font-size:11px; line-height:1.4; color:var(--fg-2); display:flex; gap:10px; align-items:center; }
.linkline.bad { color:var(--warn); }
.retry { all:unset; box-sizing:border-box; cursor:pointer; min-height:24px; padding:4px 9px; border-radius:7px; box-shadow:inset 0 0 0 1px var(--edge);
  color:var(--fg); font-size:11.5px; font-weight:600; line-height:1; }
@media (hover: hover) { .retry:hover { background:var(--ink-2); } }
`;

/** Reduced motion: no ripple, no springs, no slides — every state change is instant. */
export const MOTION_CSS = `
@media (prefers-reduced-motion: reduce) {
  .hud *, .hud *::before, .hud *::after { transition-duration:0ms !important; transition-delay:0ms !important; animation:none !important; }
}
`;

export const HUD_CSS = HUD_CSS_BASE + LINK_CSS + MOTION_CSS;
