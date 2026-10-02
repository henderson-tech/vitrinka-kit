/**
 * `@vitrinka/web/hud` — the recorder HUD on its own, for hosts that bring
 * their own recorder (the browser extension). Implement `HudController` and
 * mount it; `build/hud.iife.js` is the same mount as a self-contained script
 * defining `globalThis.VitrinkaHud.mount`.
 */
export { mountRecorderHud, type MountHudOptions } from './recorder/hud/mount';
export {
  DEFAULT_PREFS,
  type HudAccount,
  type HudAnnotation,
  type HudController,
  type HudLinkCode,
  type HudLinkFlow,
  type HudPrefs,
  type HudRecent,
  type HudRecentStatus,
  type HudRecording,
  type HudRect,
  type HudSize,
  type HudSnapshot,
  type HudSync,
  type HudSyncState,
} from './recorder/hud/controller';
export type { RecorderStorage } from './recorder/storage';
