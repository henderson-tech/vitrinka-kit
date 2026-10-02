/**
 * Mount the HUD for any `HudController` — the in-page recorder's
 * (`VitrinkaRecorderPill` does this) or another host's, such as the browser
 * extension's content script. The HUD renders into its own shadow host on
 * `<html>` (top layer, rrweb-blocked) and never touches the page's DOM.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { localRecorderStorage, memoryRecorderStorage, type RecorderStorage } from '../storage';
import type { HudController } from './controller';
import { createHudHost } from './host';
import { Hud } from './Hud';

export interface MountHudOptions {
  /** Session title when the tester starts from the pill; defaults to `document.title`. */
  title?: () => string;
  /**
   * Where the HUD keeps its own UI state (the dock spot); synchronous.
   * Defaults to `localStorage` (`vitrinka.recorder.*`), memory where that is unavailable.
   */
  storage?: RecorderStorage;
}

/** Mount the HUD; returns the unmount (removes the host). */
export function mountRecorderHud(controller: HudController, opts: MountHudOptions = {}): () => void {
  const host = createHudHost();
  const root = createRoot(host.mount);
  const storage = opts.storage ?? localRecorderStorage() ?? memoryRecorderStorage();
  root.render(
    createElement(Hud, {
      controller,
      hostMount: host.mount,
      defaultTitle: opts.title ?? (() => document.title),
      storage,
    }),
  );
  return () => {
    root.unmount();
    host.destroy();
  };
}
