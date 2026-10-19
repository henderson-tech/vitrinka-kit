/**
 * Report a problem's stylesheet — it lives in the widget's shadow root (the
 * shared HUD host), so the page restyles nothing of it and it styles nothing
 * of the page. A dark card on any page (the D12 / D21 mockups): one accent
 * red for the act of sending and marking, everything else quiet.
 */
export const REPORT_CSS = `
:host { all: initial; }
.vr {
  --ink: #f2f1ef;
  --dim: rgba(242, 241, 239, .62);
  --faint: rgba(242, 241, 239, .14);
  --bg: #1a191d;
  --bg-deep: #121115;
  --accent: #dc2f4c;
  --accent-soft: rgba(220, 47, 76, .28);
  /* Motion (transitions-dev tokens): a sliding indicator rides --dur-fast, the card's one glide --dur-slow. */
  --dur-quick: 150ms;
  --dur-fast: 250ms;
  --dur-slow: 400ms;
  --ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1);
  /* Size (vt-8020 D9, settings.ts): ONE factor, written by the widget, scales the button, the card and
     the marking bar — fonts and boxes together — each from its anchored corner. */
  --vr-scale: 1;
  /* The dock: the gap to the viewport edge, and where the card rests — clear of the button above or below it. */
  --edge: 24px;
  --lift: calc(var(--edge) + 72px * var(--vr-scale));
  font: 400 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  letter-spacing: normal;
  text-align: left;
}
.vr *, .vr *::before, .vr *::after { box-sizing: border-box; }
.vr [hidden] { display: none !important; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible {
  outline: 2px solid #fff; outline-offset: 2px;
}

/* -- the floating button -------------------------------------------------- */
.fab {
  position: fixed; right: var(--edge); bottom: var(--edge);
  scale: var(--vr-scale); transform-origin: 100% 100%;
  /* A press can become a drag to another corner: the page never scrolls under it. */
  touch-action: none;
  display: inline-flex; align-items: center; gap: 12px;
  padding: 15px 22px; border: 0; border-radius: 999px;
  background: #131216; color: #fff;
  font-size: 17px; font-weight: 600; letter-spacing: -.005em;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .28), 0 0 0 1px rgba(255, 255, 255, .08) inset;
  pointer-events: auto;
  transition: transform .14s ease, box-shadow .14s ease;
}
.fab:hover { transform: translateY(-1px); box-shadow: 0 16px 36px rgba(0, 0, 0, .32), 0 0 0 1px rgba(255, 255, 255, .12) inset; }
.fab:active { transform: translateY(0); }
kbd {
  font: 500 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  padding: 4px 7px; border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, .26); color: rgba(255, 255, 255, .78);
}

/* -- the card: ONE size from drafting to thanks (vt-8020 D10) ---------------- */
.card {
  position: fixed; right: var(--edge); bottom: var(--lift);
  display: flex; flex-direction: column;
  /* The box is divided by the scale so the painted card (scale × box) still fits the viewport. */
  width: min(380px, calc((100vw - 32px) / var(--vr-scale)));
  height: min(460px, calc((100vh - var(--lift) - var(--edge)) / var(--vr-scale)));
  scale: var(--vr-scale); transform-origin: 100% 100%;
  background: var(--bg); color: var(--ink);
  border: 1px solid rgba(255, 255, 255, .08); border-radius: 16px;
  box-shadow: 0 28px 70px rgba(0, 0, 0, .38), 0 2px 8px rgba(0, 0, 0, .2);
  pointer-events: auto;
  animation: vr-in .16s ease-out;
}
.vr.nobutton .card { bottom: var(--edge); }
/* The dock (vt-8020 D9, drag.ts): the button in any corner; the card rests beside it — above it at the
   bottom, below it at the top — and both scale from that corner. */
.vr[data-dock$="l"] .fab, .vr[data-dock$="l"] .card { right: auto; left: var(--edge); }
.vr[data-dock^="t"] .fab { bottom: auto; top: var(--edge); }
.vr[data-dock^="t"] .card { bottom: auto; top: var(--lift); }
.vr.nobutton[data-dock^="t"] .card { top: var(--edge); }
.vr[data-dock="bl"] .fab, .vr[data-dock="bl"] .card { transform-origin: 0 100%; }
.vr[data-dock="tr"] .fab, .vr[data-dock="tr"] .card { transform-origin: 100% 0; }
.vr[data-dock="tl"] .fab, .vr[data-dock="tl"] .card { transform-origin: 0 0; }
/* Dragged, the button rides the pointer by its left/top; dropped, it glides into its corner (FLIP on translate). */
.vr .fab.dragging { transform-origin: 0 0; transition: none; cursor: grabbing; }
.fab.gliding { transition: translate var(--dur-slow) var(--ease-smooth-out), transform .14s ease, box-shadow .14s ease; }
/* Parked by marking: placed by left/top where it already is (place.ts, from its painted box) — the same size,
   so starting to mark never moves it; it glides once to a corner clear of the marks. */
.card.parked { right: auto; bottom: auto; transition: left var(--dur-slow) var(--ease-smooth-out), top var(--dur-slow) var(--ease-smooth-out); }
.vr .card.parked { transform-origin: 0 0; }
@keyframes vr-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.head {
  position: relative; flex: none; display: flex; align-items: center; gap: 4px;
  padding: 12px 10px 12px 18px; border-bottom: 1px solid rgba(255, 255, 255, .07);
}
/* Sending: a quiet sweep along the head's edge, the card's size untouched. */
.card.busy .head::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px;
  background: linear-gradient(90deg, transparent, rgba(242, 241, 239, .6), transparent) no-repeat;
  background-size: 40% 100%; animation: vr-sweep 1.3s linear infinite;
}
@keyframes vr-sweep { from { background-position: -70% 0; } to { background-position: 170% 0; } }
.body { flex: 1; min-height: 0; overflow: auto; }
.head h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
.icon {
  display: inline-grid; place-items: center; width: 32px; height: 32px;
  border: 0; border-radius: 8px; background: transparent; color: var(--dim);
}
.icon:hover { background: var(--faint); color: var(--ink); }
.icon svg { width: 16px; height: 16px; }
.icon[aria-expanded="true"] { background: var(--faint); color: var(--ink); }

/* -- who you are and the menu (vt-8020 D5 A) -------------------------------- */
.who {
  display: inline-flex; align-items: center; gap: 7px; max-width: 132px; height: 32px; padding: 0 11px 0 5px; margin-right: 2px;
  border: 1px solid rgba(255, 255, 255, .14); border-radius: 999px; background: transparent; color: var(--ink);
  font-size: 13px; font-weight: 600;
}
.who:hover, .who[aria-expanded="true"] { background: var(--faint); }
.who .av {
  display: inline-grid; place-items: center; flex: none; width: 22px; height: 22px; border-radius: 50%;
  background: #3a3940; font-size: 10.5px; font-weight: 700; letter-spacing: .02em;
}
.who-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pop {
  position: absolute; top: 52px; right: 10px; z-index: 2; min-width: 240px; max-width: calc(100% - 20px); padding: 6px;
  background: #222126; border: 1px solid rgba(255, 255, 255, .1); border-radius: 12px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, .42); animation: vr-in .14s ease-out;
}
.pop-item {
  display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 10px; border: 0; border-radius: 8px;
  background: transparent; color: var(--ink); font-size: 13.5px; font-weight: 550; text-decoration: none; text-align: left;
}
.pop-item:hover:not([aria-disabled="true"]), .pop-item:focus-visible { background: var(--faint); }
/* A waiting item stays focusable (aria-disabled) so the arrows reach its reason; it only looks unavailable. */
.pop-item[aria-disabled="true"] { color: var(--dim); cursor: default; }
.pop-item svg { width: 15px; height: 15px; flex: none; color: var(--dim); }
/* Why an item waits (Record over an unsent report): a second line under the label, aligned past the icon. */
.pop-item:has(.pop-why:not([hidden])) { flex-wrap: wrap; row-gap: 2px; height: auto; min-height: 36px; padding: 8px 10px; }
.pop-why { flex-basis: 100%; padding-left: 25px; font-size: 12px; font-weight: 450; line-height: 1.35; }
.acc-who { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px 10px; }
.acc-who strong { font-size: 14px; }
.acc-mail, .acc-via { color: var(--dim); font-size: 12.5px; margin: 0; }
.acc-member { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 10px; }
.acc-member:has(.acc-linked:not([hidden])) { padding: 8px 10px; border-top: 1px solid rgba(255, 255, 255, .07); }
.acc-linked { margin: 0; font-size: 12.5px; color: var(--ink); }

/* -- the lists: My reports, recent recordings — in the card body ------------ */
.back { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 10px -4px; padding: 4px; border: 0; background: none; color: var(--ink); font-size: 14px; font-weight: 650; }
.back svg { width: 14px; height: 14px; color: var(--dim); }
.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.row {
  display: grid; grid-template-columns: 1fr auto; grid-template-areas: "t step" "age step"; column-gap: 10px;
  padding: 9px 10px; border-radius: 10px; background: rgba(242, 241, 239, .045); color: var(--ink); text-decoration: none;
}
a.row:hover { background: var(--faint); }
.row-t { grid-area: t; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; font-weight: 600; }
.age { grid-area: age; color: var(--dim); font-size: 12px; }
.step { grid-area: step; align-self: center; padding: 3px 9px; border-radius: 999px; background: var(--bg-deep); color: var(--dim); font-size: 12px; font-weight: 600; }
.step:empty { display: none; }
.list-status, .list-note { margin: 8px 0; color: var(--dim); font-size: 13px; }

/* -- the member link sheet (the pill's flow, vt-8020 D3) ------------------- */
.code { margin: 6px 0 14px; font: 650 26px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .08em; }
.link-go { display: flex; align-items: center; gap: 16px; }
.qr { width: 104px; height: 104px; border-radius: 8px; background: #fff; padding: 6px; }
.pane { padding: 14px 16px 16px; }
/* The reporter's word for it (vt-8020 D11): chips above the input, like the board composer's intents. */
.kinds { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.kinds button {
  height: 28px; padding: 0 11px; border: 1px solid rgba(255, 255, 255, .12); border-radius: 999px;
  background: transparent; color: rgba(242, 241, 239, .6); font-size: 13px; font-weight: 600;
  transition: background-color var(--dur-quick) ease-out, border-color var(--dur-quick) ease-out, color var(--dur-quick) ease-out;
}
.kinds button:hover:not(:disabled) { color: var(--ink); }
.kinds button[aria-checked="true"] { background: rgba(242, 241, 239, .12); border-color: rgba(242, 241, 239, .26); color: var(--ink); }
.kinds button:disabled { opacity: .5; cursor: default; }
.prompt { display: block; margin: 0 0 8px; font-weight: 600; font-size: 14px; }
.desc {
  display: block; width: 100%; min-height: 76px; resize: none;
  padding: 12px 14px; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, .2); background: var(--bg-deep); color: var(--ink);
  font-family: inherit; font-size: 15px; font-weight: 400; line-height: 1.45;
}
.desc::placeholder { color: rgba(242, 241, 239, .38); }
.desc:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.attached { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; color: var(--dim); font-size: 13px; }
.attached svg { width: 14px; height: 14px; flex: none; }
.link {
  display: inline-flex; align-items: center; gap: 3px; padding: 0; border: 0; background: none;
  color: rgba(242, 241, 239, .86); font-weight: 600; font-size: 13px;
}
.link:hover { color: #fff; text-decoration: underline; }
.link svg { width: 12px; height: 12px; transition: transform .14s ease; }
.link[aria-expanded="true"] svg { transform: rotate(180deg); }
.included { margin: 10px 0 0; padding: 10px 12px 10px 28px; border-radius: 10px; background: var(--bg-deep); color: var(--dim); font-size: 13px; }
.included li { margin: 2px 0; }
/* One numbered line per mark: its note, typed in the card, never floating on the page. */
.lines-wrap { margin-top: 10px; }
.lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ln {
  display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 4px 0 9px;
  border-radius: 10px; background: rgba(242, 241, 239, .045); border: 1px solid transparent;
}
.ln:focus-within { background: var(--bg-deep); border-color: rgba(242, 241, 239, .36); }
.ln-n {
  display: inline-grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 50%;
  background: var(--accent); color: #fff; font-size: 11px; font-weight: 750; box-shadow: 0 0 0 1.5px #fff;
}
.ln.hide .ln-n { background: #3a3940; }
.ln-t {
  flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: transparent; color: var(--ink);
  font-family: inherit; font-size: 13.5px;
}
.ln-t::placeholder { color: rgba(242, 241, 239, .4); }
.ln-t:focus, .ln-t:focus-visible { outline: none; }
.ln-x { display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 7px; background: transparent; color: rgba(242, 241, 239, .5); }
.ln-x:hover:not(:disabled) { background: var(--faint); color: var(--ink); }
.ln-x svg { width: 11px; height: 11px; }
.ln-empty { margin: 0; padding: 11px 13px; border: 1px dashed rgba(242, 241, 239, .14); border-radius: 10px; color: rgba(242, 241, 239, .46); font-size: 13px; }
.notify { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; color: var(--ink); cursor: pointer; }
.notify input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
.error { margin: 12px 0 0; color: #ff9aa9; font-size: 13px; }
/* The bottom actions: attachments and Show us where on the left, Send on the right. */
.foot { flex: none; display: flex; align-items: center; gap: 4px; padding: 10px 12px 12px; border-top: 1px solid rgba(255, 255, 255, .07); }
.foot .send { margin-left: auto; }
.icon:disabled { opacity: .45; cursor: default; background: transparent; color: var(--dim); }
/* Attached files (vt-8020 D9): chips in a tray above the foot — it scrolls, the card never grows. */
.tray { flex: none; max-height: 84px; overflow: auto; padding: 9px 12px 0; border-top: 1px solid rgba(255, 255, 255, .07); }
.tray:not([hidden]) + .foot { border-top: 0; }
.file-note { margin: 0 0 7px; color: #ffc1ca; font-size: 12.5px; }
.files { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.file { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; height: 28px; padding: 0 2px 0 10px; border-radius: 8px; background: rgba(242, 241, 239, .07); font-size: 12.5px; }
.file-name { min-width: 0; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.file-size { flex: none; color: var(--dim); }
.file .ln-x { width: 22px; height: 22px; }
/* A file dragged over the card: it will land here. */
.card.dropping { outline: 2px dashed rgba(242, 241, 239, .5); outline-offset: -7px; }
.where {
  display: inline-flex; align-items: center; gap: 7px; padding: 8px 13px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, .2); background: transparent; color: var(--ink);
  font-size: 13px; font-weight: 600;
}
.where:hover:not(:disabled) { background: var(--faint); }
.where[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.where svg { width: 14px; height: 14px; }
.where:disabled { opacity: .45; cursor: default; }
.send {
  padding: 10px 22px; border: 0; border-radius: 10px; background: var(--accent); color: #fff;
  font-size: 15px; font-weight: 650;
}
.send:hover:not(:disabled) { background: #e43a57; }
.send:disabled { opacity: .45; cursor: default; }

/* -- settings --------------------------------------------------------------- */
/* Scoped to the pane: a bare .row would restyle the lists' rows (their grid) above. */
.settings .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.settings .label { font-weight: 600; }
.size-row { margin-top: 18px; }
.size-row .seg button { padding: 0 12px; font-size: 13px; }
.tips-row { margin-top: 8px; }
.tech-wrap { margin-top: 18px; }
.tech { display: grid; grid-template-columns: auto 1fr; gap: 5px 14px; margin: 10px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--bg-deep); font-size: 12.5px; }
.tech dt { color: var(--dim); }
.tech dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.bind {
  min-width: 120px; padding: 8px 12px; border-radius: 9px; text-align: center;
  border: 1px solid rgba(255, 255, 255, .2); background: var(--bg-deep);
  font: 500 13px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.bind[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); color: var(--dim); }
.hint, .reason { margin: 10px 0 0; color: var(--dim); font-size: 13px; }
.reason { color: #ffc1ca; }
.settings-foot { display: flex; justify-content: space-between; margin-top: 16px; }

/* -- sent ------------------------------------------------------------------- */
.sent-head { display: flex; align-items: center; gap: 10px; }
.sent-head h3 { margin: 0; font-size: 17px; font-weight: 650; }
.sent-head svg { width: 22px; height: 22px; color: #4ade80; flex: none; }
.sent-body { margin: 8px 0 0 32px; color: var(--dim); }
.sent-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 18px 0 0 32px; }
.see {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: 9px;
  background: #fff; color: #131216; font-weight: 650; font-size: 13px; text-decoration: none;
}

/* -- marking: the frozen page ---------------------------------------------- */
.mark {
  position: fixed; inset: 0; pointer-events: auto;
  background: rgba(14, 13, 16, .16); cursor: crosshair;
  touch-action: none; user-select: none; -webkit-user-select: none;
}
.ink { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.ink .stroke { fill: none; stroke: var(--accent); stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 1px 1px rgba(0,0,0,.25)); }
.ink .veil { fill: #1b1b1f; }
.ink .veil-label { fill: rgba(255, 255, 255, .7); font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.ink .draft { opacity: .85; }
/* A pin is the mark's number on the page; its ✕ shows while the pin is hovered or focused. */
.pin { position: absolute; display: flex; align-items: center; gap: 4px; cursor: default; }
.pin .num {
  display: grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 12px;
  background: var(--accent); color: #fff; font-size: 12px; font-weight: 750;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .3), 0 0 0 2px #fff;
}
.pin .rm {
  display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 11px;
  background: #151417; color: rgba(255, 255, 255, .7); box-shadow: 0 2px 6px rgba(0, 0, 0, .3);
  opacity: 0; transition: opacity var(--dur-quick) ease-out;
}
.pin:hover .rm, .pin:focus-within .rm { opacity: 1; }
.pin .rm:hover { color: #fff; }
.pin .rm svg { width: 11px; height: 11px; }

/* The marking bar (vt-8020 D6): translucent glass at the top, the shape as a segmented control. */
.tb {
  /* translate (not transform): it applies after the scale, so the scaled bar stays centred. */
  position: fixed; left: 50%; top: 14px; translate: -50% 0;
  scale: var(--vr-scale); transform-origin: 50% 0;
  display: flex; align-items: center; gap: 4px; padding: 5px;
  border-radius: 14px; border: 1px solid rgba(255, 255, 255, .08);
  background: rgba(30, 29, 34, .68);
  -webkit-backdrop-filter: blur(18px) saturate(150%); backdrop-filter: blur(18px) saturate(150%);
  box-shadow: 0 14px 36px rgba(0, 0, 0, .36), 0 2px 6px rgba(0, 0, 0, .18), 0 1px 0 rgba(255, 255, 255, .05) inset;
  color: var(--ink); cursor: default; white-space: nowrap;
}
.tb-lead { padding: 0 12px 0 11px; color: rgba(242, 241, 239, .56); font-size: 13.5px; font-weight: 500; }
.seg { position: relative; display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 10px; background: rgba(255, 255, 255, .06); }
.seg button {
  position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 7px;
  height: 30px; padding: 0 13px 0 11px; border: 0; border-radius: 8px; background: transparent;
  color: rgba(242, 241, 239, .56); font-size: 13.5px; font-weight: 600;
  transition: color var(--dur-fast) var(--ease-smooth-out);
}
.seg button svg { width: 15px; height: 15px; flex: none; }
.seg button:hover { color: rgba(242, 241, 239, .86); }
.seg button[aria-checked="true"] { color: var(--ink); }
.seg-ind {
  position: absolute; top: 3px; left: 0; z-index: 0; width: 0; height: 30px; border-radius: 8px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .18), rgba(255, 255, 255, .115));
  box-shadow: 0 1px 0 rgba(255, 255, 255, .13) inset, 0 2px 7px rgba(0, 0, 0, .38), 0 0 0 1px rgba(0, 0, 0, .22);
  transition: transform var(--dur-fast) var(--ease-smooth-out), width var(--dur-fast) var(--ease-smooth-out);
  pointer-events: none; opacity: 0;
}
.seg.measured .seg-ind { opacity: 1; }
/* Before the indicator is measured, the picked segment carries the raised fill itself. */
.seg:not(.measured) button[aria-checked="true"] { background: rgba(255, 255, 255, .15); }
.tb-sep { width: 1px; height: 20px; margin: 0 5px; background: rgba(255, 255, 255, .1); }
.tb-quiet { height: 32px; padding: 0 13px; border: 0; border-radius: 9px; background: transparent; color: rgba(242, 241, 239, .72); font-size: 13.5px; font-weight: 600; }
.tb-quiet:hover { background: rgba(255, 255, 255, .07); color: var(--ink); }
.tb-confirm { display: inline-flex; align-items: center; gap: 4px; }
.tb-ask { padding: 0 6px 0 4px; font-size: 13.5px; font-weight: 600; }
.tb-discard { height: 32px; padding: 0 13px; border: 0; border-radius: 9px; background: var(--accent); color: #fff; font-size: 13.5px; font-weight: 650; }
.tb-discard:hover { background: #e43a57; }

/* -- the coach (D21, vt-8020): on the card's edge that faces the open page (place.ts coachSide), never over it -- */
.coach {
  position: absolute; z-index: 3; padding: 10px 12px 11px;
  /* Drawing goes on through it (to the marking layer under the card): only its button takes a press. */
  pointer-events: none;
  background: #151417; color: #f2f1ef; border-radius: 14px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, .38), 0 0 0 1px rgba(255, 255, 255, .1) inset;
  transition: opacity .12s ease;
}
.coach[data-side="above"] { left: 0; right: 0; bottom: calc(100% + 10px); }
.coach[data-side="below"] { left: 0; right: 0; top: calc(100% + 10px); }
.coach[data-side="left"] { right: calc(100% + 10px); top: 0; width: 300px; }
.coach[data-side="right"] { left: calc(100% + 10px); top: 0; width: 300px; }
/* No room around the card (a phone): over its top, the words without the art. */
.coach[data-side="over"] { left: 10px; right: 10px; top: 58px; }
.coach[data-side="over"] .coach-art { display: none; }
.coach.pressing { opacity: .55; }
.coach svg { display: block; width: 100%; height: 52px; border-radius: 9px; background: #222126; }
.coach p { margin: 8px 0 0; font-size: 14.5px; line-height: 1.38; }
.coach p + p { margin-top: 2px; color: rgba(242, 241, 239, .66); font-size: 13px; }
.coach-ok {
  pointer-events: auto; margin-top: 8px; height: 28px; padding: 0 12px; border: 0; border-radius: 8px;
  background: rgba(255, 255, 255, .09); color: #f2f1ef; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
}
.coach-ok:hover { background: rgba(255, 255, 255, .14); }
.mark:focus { outline: none; }
.mark:focus-visible { outline: 3px solid rgba(230, 69, 95, .65); outline-offset: -3px; }
/* The art runs on SMIL (widget.ts coachArt): one clock moves the pointer and grows the shape. */
.coach .bar { fill: #5b5a61; }
.coach .loop { fill: none; stroke: #e6455f; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.coach .veil { fill: #3a3940; stroke: rgba(255, 255, 255, .2); stroke-width: 1; }
.coach .hold { fill: none; stroke: #fff; stroke-width: 1.5; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.switch {
  position: relative; flex: none; width: 38px; height: 22px; padding: 0; border: 0; border-radius: 999px;
  background: rgba(255, 255, 255, .16); cursor: pointer; transition: background .15s ease;
}
.switch[aria-checked="true"] { background: var(--accent); }
.switch .knob { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: translate .15s ease; }
.switch[aria-checked="true"] .knob { translate: 16px 0; }

@media (max-width: 520px) {
  .vr { --edge: 16px; --lift: calc(var(--edge) + 68px * var(--vr-scale)); }
  .fab { padding: 13px 18px; font-size: 16px; }
  .tb { max-width: calc((100vw - 16px) / var(--vr-scale)); overflow-x: auto; }
  .tb-lead { display: none; }
  .seg button { padding: 0 9px; }
}
/* Every motion of the face stops here: the menu rises with the card's vr-in, the coach dims as you press, the chevron turns. */
@media (prefers-reduced-motion: reduce) {
  .card, .pop { animation: none; }
  .card.parked, .seg-ind, .seg button, .kinds button, .pin .rm, .link svg, .coach, .switch, .switch .knob { transition: none; }
  .card.busy .head::after { animation: none; }
  .fab, .fab.gliding { transition: none; }
}
`;
