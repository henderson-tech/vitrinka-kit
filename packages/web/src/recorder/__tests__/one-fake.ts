/**
 * Test doubles for the ONE recorder channel without a DOM: an `<html>`
 * stand-in (attributes in a map; its watch fires a microtask after a claim
 * write, as a MutationObserver does) and `window` as a plain EventTarget,
 * whose `dispatchEvent` runs every listener synchronously like the browser's.
 * Plus the extension's two endpoints as `one.ts` parties: `content.js` in a
 * captured tab (holds the claim) and `one.js` in any other tab (answers only
 * where `data-vitrinka-page` stands, takes no command).
 */
import {
  announce,
  type ClaimState,
  type Command,
  type CommandReply,
  LEAD_ATTR,
  type Live,
  type OneEnv,
  PAGE_ATTR,
  releaseClaim,
  serveCommands,
  serveHello,
  takeClaim,
  updateClaim,
} from '../one';

export function fakeDocument(): { env: OneEnv; attrs: Map<string, string> } {
  const attrs = new Map<string, string>();
  const watchers = new Set<() => void>();
  let queued = false;
  const changed = (name: string) => {
    if (name !== LEAD_ATTR || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const w of watchers) w();
    });
  };
  const env: OneEnv = {
    root: {
      getAttribute: (n) => attrs.get(n) ?? null,
      setAttribute: (n, v) => {
        attrs.set(n, v);
        changed(n);
      },
      removeAttribute: (n) => {
        attrs.delete(n);
        changed(n);
      },
    },
    bus: new EventTarget(),
    watch: (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
  };
  return { env, attrs };
}

/** Let the claim watch (a microtask) and its follow-ups run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

/** The extension's content script in a captured tab: holds the claim under its recording's generation. */
export function extensionHere(env: OneEnv, sessionId = '42') {
  const self = { from: 'extension' as const, inst: 'x.content' };
  const id = 'gen-7';
  let state: ClaimState | null = null;
  const commands: Command[] = [];
  let reply: CommandReply = { ok: true };
  const live = (): Live | null => (state ? { by: 'extension', state, here: true, id } : null);
  const offHello = serveHello(env, self, live);
  const offCommands = serveCommands(env, self, (c) => {
    if (!state) return null;
    commands.push(c);
    return reply;
  });
  return {
    id,
    commands,
    start() {
      const r = takeClaim(env, self, { id, state: 'recording', sessionId });
      if (r.ok) {
        state = 'recording';
        announce(env, self, live());
      }
      return r;
    },
    set(next: ClaimState) {
      state = next;
      updateClaim(env, id, { state: next });
    },
    /** Answer every command with this reply from now on. */
    reply(r: CommandReply) {
      reply = r;
    },
    stop() {
      state = null;
      releaseClaim(env, id);
      announce(env, self, null);
    },
    /** Reloaded or uninstalled: the orphan answers nothing and its claim stays. */
    orphan() {
      offHello();
      offCommands();
    },
  };
}

/** The extension's `one.js` in a tab it does not capture: silent unless a page recorder is mounted. */
export function extensionElsewhere(env: OneEnv, state: ClaimState = 'recording') {
  const self = { from: 'extension' as const, inst: 'x.one' };
  let live: Live | null = { by: 'extension', state, here: false };
  const off = serveHello(env, self, () => live, undefined, { answerIf: () => env.root.getAttribute(PAGE_ATTR) !== null });
  return {
    stop() {
      live = null;
      announce(env, self, null);
    },
    /** Say so unasked, as one.js does when it lands in a tab already open. */
    announce() {
      announce(env, self, live);
    },
    off,
  };
}
