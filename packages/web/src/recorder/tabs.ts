/** Each mounted tab saves its own tail before any tab closes the shared session. */
import { capturesSettled, drainBuffer, getState, STOPPING_RENEW_MS, STOPPING_TTL_MS } from './queue';
import { getRecorderStorage } from './storage';
import { subscribe } from './state';

const PREFIX = 'tab.';
// Document identity, independent of sessionStorage (duplicating a tab copies it).
const ownKey = `${PREFIX}${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;

interface Participant {
  sessionId: string;
  at: number;
  failed?: boolean;
}

function readParticipant(raw: string | null | undefined): Participant | null {
  return raw ? JSON.parse(raw) as Participant : null;
}

export function recorderPeers(sessionId: string): string[] {
  const storage = getRecorderStorage();
  if (!storage.watch || !storage.keys) return [];
  return storage.keys().filter((key) => {
    if (!key.startsWith(PREFIX) || key === ownKey) return false;
    const peer = readParticipant(storage.getString(key));
    return peer?.sessionId === sessionId && Date.now() - peer.at < STOPPING_TTL_MS;
  });
}

export function registerRecorderTab() {
  const storage = getRecorderStorage();
  if (!storage.watch || !storage.keys) return null;
  let settling = false;
  const sync = () => {
    const rec = getState();
    if (!rec) storage.remove(ownKey);
    else if (!rec.stopping) storage.set(ownKey, JSON.stringify({ sessionId: rec.sessionId, at: Date.now() }));
  };
  const heartbeat = setInterval(sync, STOPPING_RENEW_MS);
  const offState = subscribe(sync);
  sync();
  const dispose = () => {
    clearInterval(heartbeat);
    offState();
    storage.remove(ownKey);
    globalThis.removeEventListener?.('pagehide', dispose);
  };
  globalThis.addEventListener?.('pagehide', dispose);
  return {
    sync,
    dispose,
    async settle() {
      if (settling) return;
      const sessionId = getState()?.sessionId;
      if (!sessionId) return;
      settling = true;
      try {
        const saved = await capturesSettled() && await drainBuffer();
        if (getState()?.sessionId !== sessionId) return;
        if (saved) storage.remove(ownKey);
        else storage.set(ownKey, JSON.stringify({ sessionId, at: Date.now(), failed: true }));
      } catch (error) {
        console.warn('vitrinka: another tab could not save its tail', error);
        storage.set(ownKey, JSON.stringify({ sessionId, at: Date.now(), failed: true }));
        throw error;
      } finally {
        settling = false;
      }
    },
  };
}

/** Watch before reading, so an acknowledgement arriving during setup is never missed. */
export async function waitForRecorderPeers(keys: readonly string[], sessionId: string, timeoutMs = 60_000): Promise<boolean> {
  const storage = getRecorderStorage();
  if (!storage.watch || !keys.length) return true;
  const results = await Promise.all(keys.map((key) => new Promise<boolean>((resolve) => {
    let off = () => {};
    const finish = (saved: boolean) => { clearTimeout(timer); off(); resolve(saved); };
    const check = (raw: string | null | undefined) => {
      const peer = readParticipant(raw);
      if (!peer || peer.sessionId !== sessionId) finish(true);
      else if (peer.failed) finish(false);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    off = storage.watch!(key, check);
    check(storage.getString(key));
  })));
  return results.every(Boolean);
}
