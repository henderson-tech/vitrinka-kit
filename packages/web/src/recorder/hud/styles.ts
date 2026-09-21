/**
 * The HUD's stylesheet — the extension's pill/sheet/pick CSS, verbatim where
 * it applies. Lives inside the shadow root (a `<style>` element), so it never
 * touches host CSS and host CSS never touches it.
 */
export const HUD_CSS_BASE = `
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
svg { width:1em; height:1em; vertical-align:-.125em; }
.stack { position:relative; z-index:4; display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
.pill { display:flex; align-items:center; gap:10px; padding:8px 10px 8px 14px;
  background:#1d1a1b; border:1px solid #292526; border-radius:999px;
  box-shadow:0 8px 30px rgba(0,0,0,.35); color:#f0eae4; }
.dot { width:10px; height:10px; border-radius:50%; background:#ff3b57; animation:p 1.4s ease infinite; }
.paused .dot { animation:none; background:#756e68; }
@keyframes p { 50% { opacity:.35; } }
.sync { font:600 11px/1 ui-monospace, Menlo, monospace; color:#5f7a5f; }
.sync.warn { color:#e8a33d; }
.sync.bad { color:#ff3b57; }
.sync.busy { color:#a8a099; }
.detail { max-width:320px; padding:6px 12px; border-radius:999px;
  background:#1d1a1b; border:1px solid #292526; color:#a8a099;
  font:500 10px/1.4 ui-monospace, Menlo, monospace;
  opacity:0; transform:translateY(-3px); transition:opacity .24s ease, transform .24s ease;
  pointer-events:none; }
.detail.show { opacity:1; transform:none; }
.detail.bad { border-color:#ff3b57; color:#f0eae4; }
.time { font:600 11px/1 ui-monospace, Menlo, monospace; }
.name { font:500 10px/1 ui-monospace, Menlo, monospace; color:#756e68;
  border-left:1px solid #292526; padding-left:10px; max-width:140px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
button { all:unset; cursor:pointer; position:relative; width:28px; height:28px; border-radius:50%;
  border:1px solid #363132; color:#a8a099; font-size:12px; text-align:center; line-height:28px; }
button:hover { color:#f0eae4; border-color:#756e68; }
button:focus-visible, .sendb:focus-visible, .closeb:focus-visible { outline:2px solid #ff3b57; outline-offset:2px; }
button.snap { background:#ff3b57; border-color:#ff3b57; color:#fff; }
button.snap.on { background:#f0eae4; border-color:#f0eae4; color:#1d1a1b; }
kbd { position:absolute; left:50%; bottom:calc(100% + 8px); transform:translateX(-50%);
  padding:4px 6px; border-radius:5px; background:#252122; border:1px solid #363132;
  color:#a8a099; font:600 9.5px/1 ui-monospace, Menlo, monospace; letter-spacing:.06em;
  white-space:nowrap; opacity:0; transition:opacity .16s ease; pointer-events:none; }
.b-snap kbd, .b-more kbd { left:auto; right:0; transform:none; }
button:hover kbd, button:focus-visible kbd { opacity:1; }
.pill.composing kbd { opacity:0; }
/* idle grip: a quiet dot until a recording starts */
.grip { display:flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:50%;
  background:#1d1a1b; border:1px solid #292526; box-shadow:0 8px 30px rgba(0,0,0,.35); }
.grip .dot { animation:none; opacity:.9; }
.grip:hover .dot { animation:p 1.4s ease infinite; }
.grip.busy .dot { background:#756e68; }
/* menu (Open board · Stop) */
.menu { position:absolute; right:0; bottom:44px; min-width:160px; padding:6px;
  background:#1d1a1b; border:1px solid #292526; border-radius:10px;
  box-shadow:0 8px 30px rgba(0,0,0,.35); display:flex; flex-direction:column; gap:2px; }
.menu button { all:unset; cursor:pointer; padding:7px 10px; border-radius:6px; color:#d8d2cc;
  font:500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display:flex; gap:8px; align-items:center; }
.menu button:hover { background:#252122; color:#f0eae4; }
.menu button.danger:hover { color:#ff3b57; }
.menuwrap { position:relative; }
/* pick chrome (annotate mode): dim, outline, hint — shadow-root children */
.dim { position:fixed; inset:0; z-index:1; pointer-events:none; background:rgba(0,0,0,.22); }
.outline { position:fixed; z-index:2; pointer-events:none; border:2px solid #ff3b57; border-radius:6px;
  box-shadow:0 0 0 4px rgba(255,59,87,.15); }
.hint { position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:3; padding:8px 16px;
  border-radius:999px; background:#1d1a1b; border:1px solid #ff3b57; box-shadow:0 8px 30px rgba(0,0,0,.4);
  font:600 12px/1 -apple-system,BlinkMacSystemFont,sans-serif; color:#f0eae4; white-space:nowrap; }
/* the composer sheet (360px) */
.pop { width:360px; padding:14px; background:#1d1a1b; border:1px solid #292526; border-radius:14px;
  box-shadow:0 8px 30px rgba(0,0,0,.35); color:#f0eae4; }
.pop-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
label { display:flex; align-items:center; gap:7px; font:700 9.5px/1 ui-monospace, Menlo, monospace;
  letter-spacing:.18em; text-transform:uppercase; color:#756e68; }
label i { width:3px; height:10px; background:#ff3b57; }
.closeb { all:unset; cursor:pointer; width:24px; height:24px; border-radius:6px; color:#756e68; font-size:13px; text-align:center; line-height:24px; }
.closeb:hover { color:#f0eae4; background:#252122; }
textarea { width:100%; margin-top:10px; padding:10px 12px; min-height:72px; resize:vertical;
  background:#141213; border:1px solid #363132; border-radius:8px; color:#f0eae4;
  font:400 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
textarea:focus { outline:none; border-color:#756e68; }
.row { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:12px; margin-top:10px; }
.row.nodest { grid-template-columns:minmax(0,1fr) auto; }
.ctx { font:500 10px/1.35 ui-monospace, Menlo, monospace; color:#756e68; text-align:center;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row.nodest .ctx { text-align:left; }
.dest { display:flex; align-items:center; gap:9px; }
.dest button { all:unset; cursor:pointer; padding:2px 0; color:#756e68; font:600 9px/1 ui-monospace, Menlo, monospace;
  letter-spacing:.12em; text-transform:uppercase; border-bottom:1px solid transparent; }
.dest button[aria-pressed="true"] { color:#f0eae4; border-bottom-color:#ff3b57; }
.sendb { all:unset; cursor:pointer; display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:8px;
  background:#ff3b57; color:#fff; font-size:13px; font-weight:600; line-height:1; }
.sendb:hover { background:#ff5670; }
.hints { margin-top:8px; font:500 9.5px/1 ui-monospace, Menlo, monospace; letter-spacing:.06em; color:#756e68; }
`;

/** Inline style of the HUD host — fixed bottom-right, above everything; overrides the [popover] UA sheet. */
export const HOST_STYLE =
  'all:initial;position:fixed;z-index:2147483647;inset:auto 20px 20px auto;margin:0;padding:0;border:0;' +
  'background:transparent;overflow:visible;width:auto;height:auto;color-scheme:normal;';

/** Inline style of a sheet host portaled into a dialog: the same corner, above the dialog's own chrome. */
export const SHEET_HOST_STYLE =
  'all:initial;position:fixed;z-index:2147483647;right:20px;bottom:76px;margin:0;padding:0;border:0;' +
  'background:transparent;overflow:visible;width:auto;height:auto;color-scheme:normal;';

/** Link-sheet additions (appended to HUD_CSS). */
export const LINK_CSS = `
.pop.link .code { margin-top:12px; font:700 28px/1.2 ui-monospace, Menlo, monospace; letter-spacing:.14em; text-align:center; color:#f0eae4; }
.linkrow { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-top:12px; }
.linkrow .sendb { text-decoration:none; }
.qr { width:96px; height:96px; border-radius:8px; background:#fff; padding:4px; }
.linkline { margin-top:10px; font:500 10px/1.4 ui-monospace, Menlo, monospace; color:#756e68; display:flex; gap:10px; align-items:center; }
.linkline.bad { color:#ff3b57; }
.retry { all:unset; cursor:pointer; padding:3px 8px; border-radius:6px; border:1px solid #363132; color:#a8a099; font:600 10px/1 ui-monospace, Menlo, monospace; }
.retry:hover { color:#f0eae4; border-color:#756e68; }
.grip.link { width:auto; border-radius:999px; padding:0 14px; gap:8px; color:#f0eae4; font:600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
`;

export const HUD_CSS = HUD_CSS_BASE + LINK_CSS;
