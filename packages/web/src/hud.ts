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
  type HudAttachment,
  type HudController,
  type HudFace,
  type HudLinkCode,
  type HudLinkFlow,
  type HudPrefs,
  type HudRecent,
  type HudRecentStatus,
  type HudRecording,
  type HudRect,
  type HudReport,
  type HudSaved,
  type HudSize,
  type HudSnapshot,
  type HudSync,
  type HudSyncState,
} from './recorder/hud/controller';
export type { RecorderStorage } from './recorder/storage';
/** ONE recorder: the protocol the page recorder and the extension speak (`build/one.iife.js` = `globalThis.VitrinkaOne`). */
export type {
  Ack,
  AckCode,
  Claim,
  ClaimRoot,
  ClaimState,
  Command,
  CommandOp,
  CommandReply,
  Hello,
  Live,
  OneEnv,
  OneParty,
  OneSelf,
} from './recorder/one';
export type { VitrinkaOneGlobal } from './recorder/one-iife';
