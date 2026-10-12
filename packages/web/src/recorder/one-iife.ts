/**
 * Entry of `build/one.iife.js`: the ONE recorder protocol (`one.ts`) as one
 * self-contained script — no React, no imports — for the browser extension's
 * content scripts, which have no bundler. It defines `globalThis.VitrinkaOne`:
 *
 *   const env = VitrinkaOne.documentEnv();
 *   const claim = VitrinkaOne.readClaim(env);
 *
 * The extension vendors it beside `build/hud.iife.js` under the same pin
 * (`tools/vendor-hud`), so both worlds speak one codec.
 */
import * as one from './one';

export type VitrinkaOneGlobal = typeof one;

(globalThis as typeof globalThis & { VitrinkaOne?: VitrinkaOneGlobal }).VitrinkaOne = Object.freeze({ ...one });
