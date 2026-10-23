/**
 * Inline style of the HUD host: a 0×0 fixed box at the viewport origin (the
 * dock and sheets are fixed children of its shadow root). Zero-size keeps
 * rrweb's placeholder for this blocked node empty in every replay — rrweb 2
 * has no "omit entirely" mode, a blocked node always leaves a sized
 * placeholder — and `pointer-events:none` lets the page under the HUD's gaps
 * take every click. Overrides the [popover] UA sheet.
 *
 * Its own leaf module so host.ts (which the React-free report face mounts
 * into) never pulls the HUD's React sheets in through styles.ts.
 */
export const HOST_STYLE =
  'all:initial;position:fixed;z-index:2147483647;inset:0 auto auto 0;margin:0;padding:0;border:0;' +
  'background:transparent;overflow:visible;width:0;height:0;pointer-events:none;color-scheme:normal;';

/** A dialog-associated top-layer popover uses the same viewport-origin box. */
export const SHEET_HOST_STYLE = HOST_STYLE;
