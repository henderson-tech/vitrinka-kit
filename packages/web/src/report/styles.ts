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
  font: 400 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  letter-spacing: normal;
  text-align: left;
}
.vr *, .vr *::before, .vr *::after { box-sizing: border-box; }
.vr [hidden] { display: none !important; }
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible {
  outline: 2px solid #fff; outline-offset: 2px;
}

/* -- the floating button -------------------------------------------------- */
.fab {
  position: fixed; right: 24px; bottom: 24px;
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

/* -- the card --------------------------------------------------------------- */
.card {
  position: fixed; right: 24px; bottom: 96px;
  width: min(420px, calc(100vw - 32px));
  max-height: calc(100vh - 120px); overflow: auto;
  background: var(--bg); color: var(--ink);
  border: 1px solid rgba(255, 255, 255, .08); border-radius: 16px;
  box-shadow: 0 28px 70px rgba(0, 0, 0, .38), 0 2px 8px rgba(0, 0, 0, .2);
  pointer-events: auto;
  animation: vr-in .16s ease-out;
}
.vr.nobutton .card { bottom: 24px; }
@keyframes vr-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.head {
  display: flex; align-items: center; gap: 4px;
  padding: 16px 14px 16px 20px; border-bottom: 1px solid rgba(255, 255, 255, .07);
}
.head h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
.icon {
  display: inline-grid; place-items: center; width: 32px; height: 32px;
  border: 0; border-radius: 8px; background: transparent; color: var(--dim);
}
.icon:hover { background: var(--faint); color: var(--ink); }
.icon svg { width: 16px; height: 16px; }
.pane { padding: 18px 20px 20px; }
.prompt { display: block; margin: 0 0 8px; font-weight: 600; font-size: 14px; }
.desc {
  display: block; width: 100%; min-height: 88px; resize: vertical;
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
.marked { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; color: var(--dim); }
.chip {
  display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px;
  border-radius: 11px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 700;
}
.chip.hide { background: #3a3940; }
.notify { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; color: var(--ink); cursor: pointer; }
.notify input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
.error { margin: 12px 0 0; color: #ff9aa9; font-size: 13px; }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; }
.where {
  display: inline-flex; align-items: center; gap: 7px; padding: 8px 13px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, .2); background: transparent; color: var(--ink);
  font-size: 13px; font-weight: 600;
}
.where:hover:not(:disabled) { background: var(--faint); }
.where svg { width: 14px; height: 14px; }
.where:disabled { opacity: .45; cursor: default; }
.send {
  padding: 10px 22px; border: 0; border-radius: 10px; background: var(--accent); color: #fff;
  font-size: 15px; font-weight: 650;
}
.send:hover:not(:disabled) { background: #e43a57; }
.send:disabled { opacity: .45; cursor: default; }

/* -- settings --------------------------------------------------------------- */
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.row .label { font-weight: 600; }
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
.pin { position: absolute; display: flex; align-items: center; gap: 6px; cursor: default; }
.pin .num {
  display: grid; place-items: center; width: 24px; height: 24px; border-radius: 12px;
  background: var(--accent); color: #fff; font-size: 12px; font-weight: 750;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .3), 0 0 0 2px #fff;
}
.pin .note {
  width: 220px; padding: 6px 10px; border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, .16); background: #151417; color: #fff;
  font-family: inherit; font-size: 13px; font-weight: 400; line-height: 1.3;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .3);
}
.pin .note::placeholder { color: rgba(255, 255, 255, .45); }
.pin .note:focus { outline: none; border-color: var(--accent); }
.pin .rm {
  display: grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 12px;
  background: #151417; color: rgba(255, 255, 255, .7); box-shadow: 0 2px 6px rgba(0, 0, 0, .3);
}
.pin .rm:hover { color: #fff; }
.pin .rm svg { width: 12px; height: 12px; }
.toolbar {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 4px; padding: 6px; border-radius: 15px;
  background: #151417; box-shadow: 0 16px 40px rgba(0, 0, 0, .35), 0 0 0 1px rgba(255, 255, 255, .08) inset;
  cursor: default;
}
.toolbar button {
  padding: 9px 15px; border: 0; border-radius: 10px; background: transparent; color: #f2f1ef;
  font-size: 15px; font-weight: 600;
}
.toolbar button:hover { background: rgba(255, 255, 255, .08); }
.toolbar button[aria-pressed="true"] { background: #e6455f; color: #fff; }
.toolbar .sep { width: 1px; height: 22px; margin: 0 4px; background: rgba(255, 255, 255, .14); }
.toolbar .done { background: var(--accent); color: #fff; }
.toolbar .done:hover { background: #e43a57; }
.toolbar button:disabled { opacity: .4; cursor: default; background: transparent; }

/* -- the coach card (D21): stays beside the pointer until mark 1 exists --- */
.coach {
  position: fixed; width: 300px; padding: 14px 16px 15px;
  background: #151417; color: #f2f1ef; border-radius: 14px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, .38), 0 0 0 1px rgba(255, 255, 255, .1) inset;
  pointer-events: none;
  transition: opacity .12s ease;
}
.coach.pressing { opacity: .55; }
.coach svg { display: block; width: 100%; height: 64px; border-radius: 9px; background: #222126; }
.coach p { margin: 11px 0 0; font-size: 15px; line-height: 1.4; }
.coach p + p { margin-top: 2px; color: rgba(242, 241, 239, .66); font-size: 13px; }
.coach .bar { fill: #5b5a61; }
.coach .loop { fill: none; stroke: #e6455f; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 200; stroke-dashoffset: 200; animation: vr-draw 2.8s ease-in-out infinite; }
.coach .hold { fill: none; stroke: #fff; stroke-width: 1.5; opacity: 0; animation: vr-hold 2.8s ease-in-out infinite; }
@keyframes vr-draw { 0%, 18% { stroke-dashoffset: 200; } 72%, 100% { stroke-dashoffset: 0; } 90% { opacity: 1; } 100% { opacity: 0; } }
@keyframes vr-hold { 0%, 8% { opacity: 0; } 14%, 72% { opacity: .9; } 80%, 100% { opacity: 0; } }

@media (max-width: 520px) {
  .fab { right: 16px; bottom: 16px; padding: 13px 18px; font-size: 16px; }
  .card { right: 16px; bottom: 84px; }
  .vr.nobutton .card { bottom: 16px; }
  .toolbar { bottom: 16px; max-width: calc(100vw - 24px); overflow-x: auto; }
  .toolbar button { padding: 8px 11px; font-size: 14px; }
  .coach { width: 260px; }
}
@media (prefers-reduced-motion: reduce) {
  .card { animation: none; }
  .fab { transition: none; }
  .coach .loop { animation: none; stroke-dashoffset: 0; }
  .coach .hold { animation: none; opacity: .9; }
}
`;
