/**
 * The HUD's stylesheet. Lives inside the shadow root (a `<style>` element),
 * so it never touches host CSS and host CSS never touches it.
 *
 * Shapes: ONE glass PILL whose faces are collapsible SEGMENTS — the idle puck
 * (+ ⋯), the recording handle (dot + clock), the tool tray, and the inline
 * flows (confirm · saving · saved · failed). A face change opens one segment
 * while another closes, so the pill's width tweens by itself; an orientation
 * change (the middle row stands the recording pill up) is a measured morph
 * (see useMorph). The 6px edge TAB when tucked. The `.dock` rests on one of
 * eight spots (`data-row` t|m|b × `data-col` l|c|r, no centre) by viewport
 * insets; a drag moves it by `transform` only. Tooltip, menu and details card
 * are fixed floats placed in JS (place.ts) so they never clip.
 *
 * Sizes: `data-size` sm|md|lg on `.hud` rescales every dimension through the
 * size tokens (`--h`, `--b`, `--fs`, … and `--s` for the rest).
 * Motion: the transitions.dev token scale; reduced motion stills it all.
 */
export const HUD_CSS_BASE = `
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
svg { width:1em; height:1em; vertical-align:-.125em; flex:none; }
.hud {
  --ink: rgba(26,22,23,.72); --ink-pop: rgba(26,22,23,.9); --ink-solid: #1d1a1b;
  --ink-2: rgba(255,255,255,.08); --ink-3: rgba(255,255,255,.14); --edge: rgba(255,255,255,.11); --rim: rgba(0,0,0,.30);
  --fg: #f4efea; --fg-2: rgba(244,239,234,.66); --fg-3: rgba(244,239,234,.44);
  --rec: #ff3b57; --rec-soft: rgba(255,59,87,.16); --warn: #f0a63a; --ok: #7fd6a4;
  --m: 16px;
  --s: 1; --h: 28px; --b: 24px; --vw: 36px; --fs: 12px; --fs-s: 10.5px; --ic: 13px;
  --duration-micro: 80ms; --duration-quick: 150ms; --duration-fast: 250ms; --duration-resize: 300ms;
  --duration-medium: 350ms; --duration-very-slow: 500ms; --duration-snap: 500ms;
  --ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1); --ease-in-out: ease-in-out; --ease-out: ease-out; --ease-linear: linear;
  --ease-bounce: cubic-bezier(0.34, 1.36, 0.64, 1);
  --ease-spring: var(--ease-smooth-out);
  --distance-micro: 4px; --scale-medium: .97; --scale-small: .98; --scale-tiny: .99; --blur-small: 2px; --rise: 16px;
  color: var(--fg); font-size: var(--fs);
  user-select:none; -webkit-user-select:none;
}
.hud[data-size="sm"] { --s: .88; --h: 24px; --b: 20px; --vw: 30px; --fs: 11px; --fs-s: 10px; --ic: 12px; }
.hud[data-size="lg"] { --s: 1.18; --h: 34px; --b: 30px; --vw: 44px; --fs: 13.5px; --fs-s: 11.5px; --ic: 15px; }
@supports (transition-timing-function: linear(0, 1)) {
  /* a damped spring, ~4% overshoot over 500ms — the settle after a throw */
  .hud { --ease-spring: linear(0, 0.042, 0.143, 0.274, 0.414, 0.549, 0.67, 0.773, 0.856, 0.921, 0.968, 1.001, 1.021, 1.033, 1.038, 1.038, 1.035, 1.031, 1.025, 1.02, 1.015, 1.011, 1.007, 1.004, 1); }
}
@media (pointer: coarse) {
  .hud { --m: 12px; }
  .hud[data-size="sm"] { --h: 28px; --b: 26px; --vw: 34px; }
  .hud[data-size="md"] { --h: 32px; --b: 30px; --vw: 40px; }
  .hud[data-size="lg"] { --h: 38px; --b: 34px; --vw: 46px; }
}
/* scoped under .hud so a control's own \`all:unset\` reset cannot wipe the surface */
.hud .glass, .hud .menu, .hud .pop, .hud .detail, .hud .hint, .hud .tip {
  background: var(--ink);
  -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
  box-shadow: inset 0 0 0 1px var(--edge), 0 0 0 .5px var(--rim), 0 10px 28px -10px rgba(0,0,0,.5), 0 2px 6px -2px rgba(0,0,0,.28);
  color: var(--fg);
}
.hud .menu, .hud .pop, .hud .tip { background: var(--ink-pop); }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .hud .glass, .hud .menu, .hud .pop, .hud .detail, .hud .hint, .hud .tip { background: var(--ink-solid); }
}
.sr { position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
textarea, .code { user-select:text; -webkit-user-select:text; }

/* the dock: one of eight spots, or tucked into a side edge */
.dock { position:fixed; z-index:4; display:flex; pointer-events:auto; }
.dock[data-row="b"] { bottom: calc(var(--m) + env(safe-area-inset-bottom, 0px)); }
.dock[data-row="t"] { top: calc(var(--m) + env(safe-area-inset-top, 0px)); }
.dock[data-row="m"] { top: calc(50% - var(--hh, 28px) / 2); }
.dock[data-col="l"] { left: calc(var(--m) + env(safe-area-inset-left, 0px)); }
.dock[data-col="r"] { right: calc(var(--m) + env(safe-area-inset-right, 0px)); }
.dock[data-col="c"] { left: calc(50% - var(--hw, 36px) / 2); }
.dock[data-tuck] { top: clamp(8px, calc(var(--ty, .5) * 100% - 28px), calc(100% - 64px)); }
.dock[data-tuck="left"] { left:0; }
.dock[data-tuck="right"] { right:0; }
.dock.settling { transition: transform var(--duration-snap) var(--ease-spring); }
/* a throw carries the compact capsule: the tray folds at once, not on its tween */
.dock.dragging .seg, .dock.dragging .seg-in { transition:none !important; }
.dock.dragging .glass { box-shadow: inset 0 0 0 1px var(--edge), 0 0 0 .5px var(--rim), 0 18px 40px -12px rgba(0,0,0,.55), 0 4px 10px -4px rgba(0,0,0,.3); }

/* the pill and its segments */
.pill { position:relative; display:inline-flex; align-items:center; height:var(--h); border-radius:999px; }
.dock[data-col="r"] .pill[data-orient="h"] { flex-direction:row-reverse; }
.pill[data-orient="v"] { flex-direction:column; height:auto; width:var(--vw); border-radius:calc(var(--vw) / 2); padding:2px 0 4px; }
.pill.morphing, .pill.morphing * { transition:none !important; }
.pill.morphing { overflow:hidden; }
.seg { display:grid; grid-template-columns:0fr; visibility:hidden;
  transition: grid-template-columns var(--duration-resize) var(--ease-smooth-out), visibility 0s linear var(--duration-resize); }
.seg-in { min-width:0; overflow:hidden; display:flex; align-items:center; padding:5px 0; margin:-5px 0;
  opacity:0; filter:blur(var(--blur-small));
  transition: opacity var(--duration-quick) var(--ease-in-out), filter var(--duration-quick) var(--ease-in-out); }
.seg.on { grid-template-columns:1fr; visibility:visible;
  transition: grid-template-columns var(--duration-resize) var(--ease-smooth-out), visibility 0s; }
.seg.on > .seg-in { opacity:1; filter:none; transition-duration: var(--duration-fast); transition-delay: var(--duration-micro); }
.pill[data-orient="v"] .seg { grid-template-columns:1fr; grid-template-rows:0fr;
  transition: grid-template-rows var(--duration-resize) var(--ease-smooth-out), visibility 0s linear var(--duration-resize); }
.pill[data-orient="v"] .seg.on { grid-template-rows:1fr; transition: grid-template-rows var(--duration-resize) var(--ease-smooth-out), visibility 0s; }
.pill[data-orient="v"] .seg-in { flex-direction:column; min-height:0; padding:0 5px; margin:0 -5px; }

/* the recording dot: its ripple is a pseudo-element, outside layout */
.dot { position:relative; width:8px; height:8px; flex:none; border-radius:50%; background:var(--rec); }
.dot::after { content:""; position:absolute; inset:0; border-radius:50%; background:var(--rec); opacity:0; pointer-events:none;
  animation:ripple 2s var(--ease-out) infinite; }
@keyframes ripple { 0% { transform:scale(1); opacity:.45; } 70%, 100% { transform:scale(2.75); opacity:0; } }
.pill[data-state="paused"] .dot { background:var(--fg-3); }
.pill[data-state="bad"] .dot { background:var(--warn); }
.pill[data-state="paused"] .dot::after, .pill[data-state="bad"] .dot::after { animation:none; }

/* idle: the puck — ring = not linked, dot = ready; the label slides out on intent */
.puck { all:unset; box-sizing:border-box; display:inline-flex; align-items:center; height:var(--h); min-width:var(--h);
  padding:0 calc((var(--h) - 10px) / 2); border-radius:999px; cursor:pointer; touch-action:none;
  font-weight:600; font-size:var(--fs); color:var(--fg); }
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
.pill[data-open] .lab, .puck:focus-visible .lab { grid-template-columns:1fr; opacity:1; }
.puck:focus-visible, .handle:focus-visible { outline:2px solid var(--rec); outline-offset:2px; }
@media (hover: hover) {
  .puck[data-state="ready"]:hover .ring { background:var(--rec); }
  .puck[data-state="unlinked"]:hover .ring { box-shadow:inset 0 0 0 1.5px var(--fg); }
}

/* recording: the handle (dot + clock) — symmetric: the dot centres in the pill's round end */
.handle { all:unset; box-sizing:border-box; display:inline-flex; align-items:center; gap:6px; height:var(--h);
  padding:0 calc((var(--h) - 8px) / 2); border-radius:999px; cursor:grab; touch-action:none; }
.dock.dragging .handle { cursor:grabbing; }
.pill[data-orient="v"] .handle { flex-direction:column; height:auto; width:var(--vw); gap:5px; padding:calc((var(--vw) - 8px) / 2 - 2px) 0 6px; }
.clock { display:inline-flex; align-items:center; }
.clock .seg-in { padding:0; margin:0; }
.time { font-weight:600; font-size:var(--fs); line-height:1; font-variant-numeric:tabular-nums; letter-spacing:.01em; white-space:nowrap; }
.pill[data-orient="v"] .time { font-size:var(--fs-s); letter-spacing:-.01em; }
.pill[data-orient="v"] .clock { flex-direction:column; }
.flash { display:inline-flex; align-items:center; gap:4px; color:var(--ok); font-weight:600; font-size:var(--fs); line-height:1; white-space:nowrap; }
.flash svg { font-size:var(--ic); }
.pill[data-orient="v"] .flash span { display:none; }

/* the tool tray */
.tools { display:flex; align-items:center; gap:calc(2px * var(--s)); padding-right:3px; }
.dock[data-col="r"] .pill[data-orient="h"] .tools { flex-direction:row-reverse; padding-right:0; padding-left:3px; }
.pill[data-orient="v"] .tools { flex-direction:column; padding:0 0 2px; gap:calc(3px * var(--s)); }
.sep { width:1px; height:14px; flex:none; margin:0 4px 0 0; background:var(--edge); }
.dock[data-col="r"] .pill[data-orient="h"] .sep { margin:0 0 0 4px; }
.pill[data-orient="v"] .sep { width:14px; height:1px; margin:2px 0 4px; }
button.tb { all:unset; pointer-events:auto; box-sizing:border-box; position:relative; flex:none; display:inline-grid; place-items:center;
  width:var(--b); height:var(--b); border-radius:999px; color:var(--fg-2); cursor:pointer; font-size:var(--ic);
  transition: background-color var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out); }
button.tb.b-annotate { color:var(--rec); }
button.tb.on { background:var(--rec); color:#fff; }
button.tb.b-stop svg { fill:currentColor; stroke:none; font-size:calc(var(--ic) * .82); }
button.tb:focus-visible { outline:2px solid var(--rec); outline-offset:-2px; }
@media (hover: hover) {
  button.tb:hover { background:var(--ink-2); color:var(--fg); }
  button.tb.on:hover { background:var(--rec); color:#fff; }
  button.tb.b-stop:hover { background:var(--rec-soft); color:var(--rec); }
}

/* the sync chip: legible at a glance — icon + word, colour by state */
.sync { display:inline-flex; align-items:center; gap:4px; height:var(--b); padding:0 7px 0 5px; margin-right:2px; border-radius:999px;
  font-size:var(--fs-s); font-weight:600; line-height:1; white-space:nowrap; color:var(--fg-3); background:transparent;
  transition: color var(--duration-quick) var(--ease-out), background-color var(--duration-quick) var(--ease-out); }
.sync svg { font-size:calc(var(--ic) * .95); }
.sync[data-kind="synced"] svg { color:var(--ok); }
.sync[data-kind="sending"] { color:var(--fg-2); }
.sync[data-kind="offline"] { color:var(--warn); background:rgba(240,166,58,.12); }
.sync[data-kind="error"] { color:var(--rec); background:var(--rec-soft); }
.sync .swap { display:inline-flex; animation:swap-in var(--duration-quick) var(--ease-in-out) both; }
.pill[data-orient="v"] .sync { width:var(--b); padding:0; margin:0 0 2px; justify-content:center; }
.pill[data-orient="v"] .sync .word { display:none; }
.dock[data-col="r"] .pill[data-orient="h"] .sync { margin:0 0 0 2px; }
@keyframes swap-in { from { opacity:0; transform:translateY(var(--distance-micro)); filter:blur(var(--blur-small)); } }
.spin { animation:spin .9s var(--ease-linear) infinite; transform-origin:50% 50%; }
@keyframes spin { to { transform:rotate(360deg); } }

/* inline flows: confirm · saving · saved · failed */
.flow { display:flex; align-items:center; gap:calc(6px * var(--s)); height:var(--h); padding:0 3px 0 calc(var(--h) * .42);
  white-space:nowrap; font-size:var(--fs); font-weight:600; line-height:1; color:var(--fg); }
.pill[data-face="flow-rec"] .flow { padding-left:2px; }
.dock[data-col="r"] .pill[data-face="flow-rec"] .flow { padding-left:calc(var(--h) * .42); padding-right:0; }
.flow .q { margin-right:calc(4px * var(--s)); }
.flow .muted { color:var(--fg-3); font-weight:500; }
.flow svg { font-size:var(--ic); }
.fb { all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; gap:5px; height:calc(var(--h) - 6px);
  padding:0 calc(10px * var(--s)); border-radius:999px; font-size:calc(var(--fs) - .5px); font-weight:600; line-height:1; color:var(--fg);
  background:var(--ink-2); text-decoration:none;
  transition: background-color var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out); }
.fb.primary { background:var(--rec); color:#fff; }
.fb.icon { width:calc(var(--h) - 6px); padding:0; justify-content:center; background:transparent; color:var(--fg-3); }
.fb:focus-visible { outline:2px solid var(--rec); outline-offset:1px; }
@media (hover: hover) {
  .fb:hover { background:var(--ink-3); }
  .fb.primary:hover { background:#ff5670; }
  .fb.icon:hover { color:var(--fg); background:var(--ink-2); }
}
.saving { position:relative; padding-right:calc(var(--h) * .42); }
.saving .spinner { color:var(--fg-2); }
.saving .spinner circle { stroke-dasharray:44 63; }
.bar-track { position:absolute; left:calc(var(--h) * .42); right:calc(var(--h) * .42); bottom:3px; height:2px; border-radius:1px; background:var(--ink-2); overflow:hidden; }
.bar-track > i { position:absolute; inset:0 auto 0 0; width:calc(var(--p, 0) * 100%); border-radius:1px; background:var(--fg-2);
  transition: width var(--duration-fast) var(--ease-smooth-out); }
.bar-track[data-indeterminate] > i { width:35%; animation:slide 1.1s var(--ease-in-out) infinite; }
@keyframes slide { from { transform:translateX(-100%); } to { transform:translateX(290%); } }
.saved .ok { display:inline-flex; color:var(--ok); }
.failed .warn { display:inline-flex; color:var(--warn); }
.failed .msg { max-width:calc(220px * var(--s)); overflow:hidden; text-overflow:ellipsis; }

/* the success check (transitions.dev 10, tuned to a 13px glyph) */
.t-check { display:inline-block; transform-origin:center; opacity:0; will-change:transform, opacity, filter; }
.t-check svg { display:block; overflow:visible; }
.t-check svg path { stroke-dasharray:18; stroke-dashoffset:18; }
.t-check[data-state="in"] {
  animation: t-check-fade var(--duration-very-slow) var(--ease-smooth-out) forwards,
    t-check-rotate var(--duration-very-slow) var(--ease-smooth-out) forwards,
    t-check-blur var(--duration-very-slow) var(--ease-smooth-out) forwards,
    t-check-bob var(--duration-very-slow) cubic-bezier(0.34, 1.35, 0.64, 1) forwards; }
.t-check[data-state="in"] svg path { animation: t-check-draw var(--duration-very-slow) var(--ease-smooth-out) var(--duration-micro) forwards; }
@keyframes t-check-fade { from { opacity:0; } to { opacity:1; } }
@keyframes t-check-rotate { from { transform:rotate(80deg); } to { transform:rotate(0deg); } }
@keyframes t-check-blur { from { filter:blur(8px); } to { filter:blur(0); } }
@keyframes t-check-bob { from { translate:0 8px; } to { translate:0 0; } }
@keyframes t-check-draw { to { stroke-dashoffset:0; } }

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

/* floats: fixed, placed in JS beside the dock (place.ts) */
.float { position:fixed; left:0; top:0; z-index:5; pointer-events:auto; }

/* the tooltip (transitions.dev 17): one bubble that travels between triggers */
.tip { display:inline-flex; align-items:center; gap:7px; padding:calc(5px * var(--s)) calc(8px * var(--s)); border-radius:7px; white-space:nowrap;
  font-size:calc(var(--fs) - 1px); font-weight:600; line-height:1; color:var(--fg); pointer-events:none;
  opacity:0; scale:var(--scale-small); z-index:7;
  transition: opacity 50ms var(--ease-out), scale 50ms var(--ease-out), translate 160ms var(--ease-smooth-out); }
.tip[data-show="true"] { opacity:1; scale:1;
  transition: opacity var(--duration-quick) var(--ease-out) var(--duration-micro), scale var(--duration-quick) var(--ease-out) var(--duration-micro),
    translate 160ms var(--ease-smooth-out); }
.tip.snap { transition:none !important; }
.tip kbd { font:600 calc(var(--fs-s) - .5px)/1 ui-monospace, "SF Mono", Menlo, monospace; color:var(--fg-3); letter-spacing:.02em; }

/* the ⋯ menu */
.menu { width:calc(252px * var(--s)); max-height:calc(100vh - 16px); overflow:auto; overscroll-behavior:contain; scrollbar-width:thin;
  padding:calc(5px * var(--s)); border-radius:calc(13px * var(--s)); display:flex; flex-direction:column; gap:1px; font-size:var(--fs); }
.m-head { display:flex; flex-direction:column; gap:3px; padding:calc(8px * var(--s)) calc(10px * var(--s)) calc(9px * var(--s)); }
.m-who { display:flex; align-items:baseline; gap:5px; min-width:0; font-weight:600; color:var(--fg); line-height:1.2; }
.m-who .email { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.m-who .ws { flex:none; color:var(--fg-2); font-weight:500; }
.m-who.wraps .email { white-space:normal; overflow-wrap:anywhere; }
.m-sub { font-size:var(--fs-s); color:var(--fg-3); line-height:1.25; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.m-sub .live { color:var(--ok); }
.m-rule { height:1px; margin:3px 4px; background:var(--edge); flex:none; }
.m-label { padding:calc(7px * var(--s)) calc(10px * var(--s)) 3px; font-size:var(--fs-s); font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--fg-3); }
.mi { all:unset; box-sizing:border-box; cursor:pointer; display:flex; align-items:center; gap:9px; min-height:calc(30px * var(--s));
  padding:calc(7px * var(--s)) calc(10px * var(--s)); border-radius:8px; color:var(--fg); line-height:1.2; text-decoration:none;
  transition: background-color var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out); }
.mi > svg { color:var(--fg-2); font-size:var(--ic); }
.mi .end { margin-left:auto; color:var(--fg-3); font-size:var(--ic); }
.mi:focus-visible { outline:2px solid var(--rec); outline-offset:-2px; }
.mi.danger { color:var(--fg-2); }
@media (hover: hover) {
  .mi:hover { background:var(--ink-2); }
  .mi.danger:hover, .mi.danger:hover svg { color:var(--rec); }
}
.recent { align-items:flex-start; }
.recent .r-main { display:flex; flex-direction:column; gap:3px; min-width:0; flex:1; }
.recent .r-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.recent .r-meta { display:flex; align-items:center; gap:5px; font-size:var(--fs-s); color:var(--fg-3); white-space:nowrap; }
.recent .r-meta i { width:5px; height:5px; border-radius:50%; flex:none; background:var(--fg-3); }
.recent .r-meta i[data-status="saved"] { background:var(--ok); }
.recent .r-meta i[data-status="recording"] { background:var(--rec); }
.recent .r-meta i[data-status="unsaved"] { background:var(--warn); }
.recent[aria-disabled="true"] { cursor:default; }
.recent .end { margin-top:1px; }
.m-empty { padding:4px 10px 8px; font-size:var(--fs-s); color:var(--fg-3); }
.m-row { display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:calc(32px * var(--s)); padding:2px calc(6px * var(--s)) 2px calc(10px * var(--s)); color:var(--fg-2); }
.m-row > span:first-child { color:var(--fg); }
.m-row.toggle { cursor:pointer; border-radius:8px; }
@media (hover: hover) { .m-row.toggle:hover { background:var(--ink-2); } }
.m-row.toggle:focus-visible { outline:2px solid var(--rec); outline-offset:-2px; }
.m-foot { padding:6px 10px 4px; font:500 calc(var(--fs-s) - .5px)/1.3 ui-monospace, "SF Mono", Menlo, monospace; color:var(--fg-3); }

/* size: a segmented control with a sliding pill (transitions.dev 16) */
.sizes { position:relative; display:inline-grid; grid-template-columns:repeat(3, calc(30px * var(--s))); padding:2px; border-radius:999px;
  background:rgba(0,0,0,.28); box-shadow:inset 0 0 0 1px var(--edge); --i:1; }
.sizes::before { content:""; position:absolute; top:2px; bottom:2px; left:2px; width:calc(30px * var(--s)); border-radius:999px; background:var(--ink-3);
  transform:translateX(calc(var(--i) * 100%)); transition: transform var(--duration-fast) var(--ease-smooth-out); }
.sizes button { all:unset; box-sizing:border-box; position:relative; z-index:1; cursor:pointer; display:grid; place-items:center;
  height:calc(22px * var(--s)); border-radius:999px; font-size:var(--fs-s); font-weight:700; color:var(--fg-3);
  transition: color var(--duration-fast) var(--ease-smooth-out); }
.sizes button[aria-checked="true"] { color:var(--fg); }
.sizes button:focus-visible { outline:2px solid var(--rec); outline-offset:-1px; }
@media (hover: hover) { .sizes button:hover { color:var(--fg-2); } .sizes button[aria-checked="true"]:hover { color:var(--fg); } }

/* verbose: a switch (transitions.dev 27, travel only) */
.switch { position:relative; width:calc(30px * var(--s)); height:calc(18px * var(--s)); flex:none; border-radius:999px; background:var(--ink-3);
  transition: background-color var(--duration-fast) var(--ease-smooth-out); }
.switch::after { content:""; position:absolute; top:2px; left:2px; width:calc(14px * var(--s)); height:calc(14px * var(--s)); border-radius:50%;
  background:var(--fg-2); box-shadow:0 1px 3px rgba(0,0,0,.35);
  transition: translate var(--duration-fast) var(--ease-bounce), background-color var(--duration-fast) var(--ease-smooth-out); }
.switch[data-on="true"] { background:var(--rec); }
.switch[data-on="true"]::after { translate:calc(12px * var(--s)) 0; background:#fff; }

/* Move to: a miniature screen, eight spots (no centre); middle-row marks stand up like the pill does */
.screen { position:relative; display:grid; grid-template-columns:repeat(3, calc(22px * var(--s))); grid-template-rows:repeat(3, calc(15px * var(--s)));
  padding:calc(3px * var(--s)); border-radius:7px; box-shadow:inset 0 0 0 1px var(--edge); background:rgba(0,0,0,.22); }
.screen button { all:unset; box-sizing:border-box; position:relative; cursor:pointer; border-radius:4px; display:grid; place-items:center; }
.screen button::before { content:""; width:calc(11px * var(--s)); height:calc(4px * var(--s)); border-radius:2px; background:var(--fg-3); opacity:.55;
  transition: background-color var(--duration-quick) var(--ease-out), opacity var(--duration-quick) var(--ease-out), transform var(--duration-quick) var(--ease-out); }
.screen button[data-v]::before { width:calc(4px * var(--s)); height:calc(10px * var(--s)); }
.screen button[aria-checked="true"]::before { background:var(--rec); opacity:1; }
.screen button:focus-visible { outline:2px solid var(--rec); outline-offset:-1px; }
.screen .mid { grid-column:2; grid-row:2; }
@media (hover: hover) { .screen button:hover::before { opacity:1; background:var(--fg-2); transform:scale(1.12); } .screen button[aria-checked="true"]:hover::before { background:var(--rec); } }

/* the details card: the health line when something is wrong, the technical details in verbose mode */
.detail { width:max-content; max-width:calc(260px * var(--s)); padding:calc(6px * var(--s)) calc(11px * var(--s)); border-radius:calc(10px * var(--s));
  color:var(--fg-2); font-size:calc(var(--fs) - 1px); line-height:1.4; pointer-events:none; }
.detail.line { border-radius:999px; }
/* the tooltip and the card open on the same side: the card steps back while a tooltip speaks */
.hud .tip[data-show="true"] ~ .detail.is-open { opacity:0; transition: opacity var(--duration-quick) var(--ease-out); }
.detail.bad { color:var(--fg); box-shadow: inset 0 0 0 1px rgba(240,166,58,.55), 0 10px 28px -10px rgba(0,0,0,.5); }
.detail dl { display:grid; grid-template-columns:auto auto; gap:2px 12px; margin:0; font:500 var(--fs-s)/1.35 ui-monospace, "SF Mono", Menlo, monospace; }
.detail dt { color:var(--fg-3); }
.detail dd { margin:0; color:var(--fg); font-variant-numeric:tabular-nums; }
.detail .warnline { margin-top:5px; color:var(--warn); font-size:var(--fs-s); }

/* presence: dropdown-style grow from the anchor on open, a softer shrink on close */
.grow { transform:scale(var(--scale-medium)); opacity:0;
  transition: transform var(--duration-fast) var(--ease-smooth-out), opacity var(--duration-fast) var(--ease-smooth-out); }
.grow.is-open { transform:scale(1); opacity:1; }
.grow.is-closing { transform:scale(var(--scale-tiny)); opacity:0; pointer-events:none; transition-duration: var(--duration-quick); }
/* phone: the sheet rises from the bottom edge (toast motion) */
.rise { transform:translateY(var(--rise)) scale(var(--scale-medium)); opacity:0; filter:blur(var(--blur-small));
  transition: transform var(--duration-fast) var(--ease-smooth-out), opacity var(--duration-fast) var(--ease-smooth-out), filter var(--duration-fast) var(--ease-smooth-out); }
.rise.is-open { transform:none; opacity:1; filter:none; transition-duration: var(--duration-medium); }
.rise.is-closing { pointer-events:none; }

/* pick chrome (annotate mode): dim, outline, hint — shadow-root children */
.dim { position:fixed; inset:0; z-index:1; pointer-events:none; background:rgba(0,0,0,.18); }
.outline { position:fixed; z-index:2; pointer-events:none; border:2px solid var(--rec); border-radius:6px;
  box-shadow:0 0 0 4px rgba(255,59,87,.15); }
.hint { position:fixed; top:14px; left:50%; transform:translateX(-50%); z-index:3; padding:calc(8px * var(--s)) calc(14px * var(--s));
  border-radius:999px; font-size:var(--fs); font-weight:600; line-height:1; white-space:nowrap; display:flex; gap:8px; align-items:center; }
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
.pop { width:min(calc(288px * var(--s)), calc(100vw - 24px)); padding:calc(12px * var(--s)); border-radius:calc(14px * var(--s)); font-size:var(--fs); }
/* the composer: 440px at every HUD size, or the width the tester dragged (--sheet-w, resize.ts) */
.pop.compose { position:relative; width:min(var(--sheet-w, 440px), calc(100vw - 24px)); }
.phone .pop { width:100%; border-radius:18px; padding:14px; }
.pop-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.title { display:flex; align-items:center; gap:7px; font-size:calc(var(--fs) + .5px); font-weight:600; color:var(--fg); }
.title i { width:3px; height:11px; border-radius:1px; background:var(--rec); }
.closeb { all:unset; box-sizing:border-box; cursor:pointer; width:24px; height:24px; border-radius:7px; color:var(--fg-3);
  display:inline-grid; place-items:center; font-size:12px; }
.closeb:focus-visible, .sendb:focus-visible, .retry:focus-visible, .dest button:focus-visible { outline:2px solid var(--rec); outline-offset:2px; }
@media (hover: hover) { .closeb:hover { color:var(--fg); background:var(--ink-2); } }
textarea { width:100%; margin-top:10px; padding:9px 11px; min-height:calc(64px * var(--s)); resize:none; overflow-y:hidden; background:rgba(0,0,0,.28);
  border:0; box-shadow:inset 0 0 0 1px var(--edge); border-radius:9px; color:var(--fg);
  font:400 calc(14px * var(--s))/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
@media (pointer: coarse) { textarea { font-size:16px; } .hints { display:none; } }
textarea::placeholder { color:var(--fg-3); }
textarea:focus { outline:none; box-shadow:inset 0 0 0 1px var(--fg-3); }
.row { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:10px; margin-top:10px; }
.row.nodest { grid-template-columns:minmax(0,1fr) auto; }
.ctx { font-size:var(--fs-s); line-height:1.35; color:var(--fg-3); text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row.nodest .ctx { text-align:left; }
.dest { display:inline-flex; padding:2px; border-radius:8px; background:rgba(0,0,0,.28); box-shadow:inset 0 0 0 1px var(--edge); }
.dest button { all:unset; box-sizing:border-box; cursor:pointer; padding:5px 8px; min-height:24px; border-radius:6px; color:var(--fg-3);
  font-size:calc(var(--fs) - .5px); font-weight:600; line-height:14px; transition: background-color var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out); }
.dest button[aria-pressed="true"] { background:var(--ink-2); color:var(--fg); }
.sendb { all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; gap:6px; height:calc(28px * var(--s)); padding:0 12px;
  border-radius:8px; background:var(--rec); color:#fff; font-size:calc(var(--fs) + .5px); font-weight:600; line-height:1; text-decoration:none; }
@media (hover: hover) { .sendb:hover { background:#ff5670; } }
.sendb[aria-disabled="true"] { opacity:.45; cursor:default; background:var(--rec); }
.hints { margin-top:9px; font-size:var(--fs-s); line-height:1; color:var(--fg-3); }
/* attachments: the paperclip beside Send, the thumbnail strip, the drop target; a refusal takes the ctx slot */
.acts { display:inline-flex; align-items:center; gap:6px; }
.clipb { all:unset; box-sizing:border-box; cursor:pointer; display:inline-grid; place-items:center; width:calc(28px * var(--s)); height:calc(28px * var(--s));
  border-radius:8px; color:var(--fg-2); font-size:calc(var(--ic) + 1px); transition: background-color var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out); }
@media (hover: hover) { .clipb:hover { color:var(--fg); background:var(--ink-2); } }
.clipb[aria-disabled="true"] { opacity:.45; cursor:default; }
.clipb:focus-visible, .attx:focus-visible { outline:2px solid var(--rec); outline-offset:2px; }
.ctx.bad { color:var(--warn); }
.atts { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 0; padding:0; list-style:none; }
.att { position:relative; width:calc(52px * var(--s)); height:calc(52px * var(--s)); border-radius:8px; overflow:hidden;
  background:rgba(0,0,0,.28); box-shadow:inset 0 0 0 1px var(--edge); display:grid; place-items:center; color:var(--fg-3); }
.att img { width:100%; height:100%; object-fit:cover; display:block; }
.attx { all:unset; box-sizing:border-box; cursor:pointer; position:absolute; top:3px; right:3px; width:18px; height:18px; border-radius:50%;
  display:grid; place-items:center; font-size:9px; color:#fff; background:rgba(0,0,0,.62); box-shadow:0 0 0 1px rgba(255,255,255,.18); }
@media (hover: hover) { .attx:hover { background:rgba(0,0,0,.85); } }
@media (pointer: coarse) { .attx { width:24px; height:24px; top:2px; right:2px; font-size:11px; } }
.pop.dropping { outline:2px dashed var(--fg-2); outline-offset:-5px; }
/* the resize grip on the composer's corner away from the dock (resize.ts); its hit area reaches outward, never over the ✕ */
.grip { all:unset; box-sizing:border-box; position:absolute; width:14px; height:14px; display:grid; place-items:center; border-radius:4px;
  font-size:12px; color:var(--fg-3); touch-action:none; --reach:-6px; transition: color var(--duration-quick) var(--ease-out); }
.grip::after { content:""; position:absolute; }
.grip[data-corner="tl"] { top:3px; left:3px; cursor:nwse-resize; }
.grip[data-corner="tr"] { top:3px; right:3px; cursor:nesw-resize; }
.grip[data-corner="bl"] { bottom:3px; left:3px; cursor:nesw-resize; }
.grip[data-corner="br"] { bottom:3px; right:3px; cursor:nwse-resize; }
.grip[data-corner="tl"]::after { inset:var(--reach) 0 0 var(--reach); }
.grip[data-corner="tr"]::after { inset:var(--reach) var(--reach) 0 0; }
.grip[data-corner="bl"]::after { inset:0 0 var(--reach) var(--reach); }
.grip[data-corner="br"]::after { inset:0 var(--reach) var(--reach) 0; }
.grip[data-corner="tl"] svg { transform:rotate(180deg); }
.grip[data-corner="tr"] svg { transform:rotate(-90deg); }
.grip[data-corner="bl"] svg { transform:rotate(90deg); }
@media (hover: hover) { .grip:hover { color:var(--fg); } }
@media (pointer: coarse) { .grip { --reach:-14px; } }
.grip:focus-visible { outline:2px solid var(--rec); outline-offset:1px; }
`;

/**
 * Inline style of the HUD host: a 0×0 fixed box at the viewport origin (the
 * dock and sheets are fixed children of its shadow root). Zero-size keeps
 * rrweb's placeholder for this blocked node empty in every replay — rrweb 2
 * has no "omit entirely" mode, a blocked node always leaves a sized
 * placeholder — and `pointer-events:none` lets the page under the HUD's gaps
 * take every click. Overrides the [popover] UA sheet.
 */
export const HOST_STYLE =
  'all:initial;position:fixed;z-index:2147483647;inset:0 auto auto 0;margin:0;padding:0;border:0;' +
  'background:transparent;overflow:visible;width:0;height:0;pointer-events:none;color-scheme:normal;';

/** Inline style of a sheet host portaled into a dialog — the same 0×0 origin box. */
export const SHEET_HOST_STYLE = HOST_STYLE;

/**
 * The PAGE (light-DOM) sheet while annotate mode owns the pointer — one
 * <style> in the page head, removed on exit (it carries the rrweb block
 * attribute, so the replay never sees it). The crosshair and no text
 * selection apply to every pointer: a mouse drag over text must draw the
 * marquee, never select the page. `touch-action:none` on every element, not
 * just the root: Chromium re-enables panning inside each inner scroller, and
 * it keeps a finger's drag a marquee even where a touchstart cannot be
 * cancelled (a tap that stops a fling). The callout and tap flash only
 * matter to a finger.
 */
export const ANNOTATE_PAGE_CSS =
  '*{touch-action:none!important;cursor:crosshair!important;-webkit-user-select:none!important;user-select:none!important}' +
  '@media (any-pointer:coarse){*{-webkit-touch-callout:none!important;-webkit-tap-highlight-color:transparent!important}}';

/** Link-sheet additions (appended to HUD_CSS). */
export const LINK_CSS = `
.linkgrid { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px 12px; align-items:center; margin-top:10px; }
.linkgrid.noqr { grid-template-columns:minmax(0,1fr); }
.code { font-size:calc(22px * var(--s)); font-weight:700; line-height:1.2; letter-spacing:.08em; font-variant-numeric:tabular-nums; color:var(--fg); }
.linkgrid .sendb { justify-self:start; margin-top:6px; }
.qr { grid-column:2; grid-row:1 / span 3; width:76px; height:76px; border-radius:8px; background:#fff; padding:4px; }
.linkline { margin-top:8px; font-size:var(--fs-s); line-height:1.4; color:var(--fg-2); display:flex; gap:10px; align-items:center; }
.linkline.bad { color:var(--warn); }
.retry { all:unset; box-sizing:border-box; cursor:pointer; min-height:24px; padding:4px 9px; border-radius:7px; box-shadow:inset 0 0 0 1px var(--edge);
  color:var(--fg); font-size:calc(var(--fs) - .5px); font-weight:600; line-height:1; }
@media (hover: hover) { .retry:hover { background:var(--ink-2); } }
`;

/** Reduced motion: no ripple, no springs, no slides — every state change is instant. */
export const MOTION_CSS = `
@media (prefers-reduced-motion: reduce) {
  .hud *, .hud *::before, .hud *::after { transition-duration:0ms !important; transition-delay:0ms !important; animation:none !important; }
  .t-check { opacity:1; }
  .t-check svg path { stroke-dashoffset:0; }
}
`;

export const HUD_CSS = HUD_CSS_BASE + LINK_CSS + MOTION_CSS;
