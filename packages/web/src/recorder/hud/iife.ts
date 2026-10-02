/**
 * Entry of `build/hud.iife.js`: the HUD as one self-contained script (React
 * bundled in, no imports) for hosts without a bundler — the browser
 * extension's content script. It defines `globalThis.VitrinkaHud`:
 *
 *   const unmount = VitrinkaHud.mount(controller, { title: () => document.title });
 *
 * `controller` implements `HudController` (`@vitrinka/web/hud` types).
 */
import { mountRecorderHud } from './mount';

export interface VitrinkaHudGlobal {
  mount: typeof mountRecorderHud;
}

(globalThis as typeof globalThis & { VitrinkaHud?: VitrinkaHudGlobal }).VitrinkaHud = { mount: mountRecorderHud };
