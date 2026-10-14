/**
 * The in-page recorder as a `HudController` — the HUD's view of this
 * document's session, link, account, prefs and recents, and its doors into
 * them. Another host (the browser extension) supplies its own controller.
 *
 * The snapshot is rebuilt on every read and handed back as the SAME object
 * while nothing in it changed (a structural key), so `useSyncExternalStore`
 * stays quiet between changes even for values no `notify()` announces (the
 * event count, the offline threshold) — the HUD's clock tick picks those up.
 */
import type { HudController, HudLinkFlow, HudSnapshot } from './hud/controller';
import { readLink, recorderConfig, vitrinkaLinked } from './config';
import { holdFace, leadStatus, sendToLeader, setRemoteStop } from './lead';
import { forgetLink, linkDevice } from './link';
import { cachedAccount, cachedPrefs, fetchMe, savePrefs } from './me';
import { ackedCounts, getState, health, pendingNoteCids } from './queue';
import { boardUrlOf, readRecents, refreshRecents, retryBuild } from './recents';
import { canAttach, canReport, holdReport, sendReport } from './report';
import { addAnnotation, addNote, listNotes, RECORDER_ID, startSession, stopSession, togglePause } from './session';
import { annotateState, leadState, setAnnotating, subscribe } from './state';

function build(): HudSnapshot {
  const rec = getState();
  const cfg = recorderConfig();
  let recording: HudSnapshot['recording'] = null;
  if (rec) {
    const h = health();
    recording = {
      sessionId: rec.sessionId,
      title: rec.title,
      ...(rec.boardUrl ? { boardUrl: rec.boardUrl } : {}),
      paused: rec.paused,
      dead: Boolean(rec.dead),
      activeMs: rec.activeMs || 0,
      resumedAt: !rec.paused && rec.resumeAt ? Date.parse(rec.resumeAt) : null,
      sync: {
        state: h.state === 'idle' ? 'ok' : h.state,
        synced: h.synced,
        queued: h.queued,
        chunks: h.chunks,
        failures: h.failures,
        error: h.error,
        lastSyncAt: h.lastSyncAt,
        events: h.localSeq,
        serverMaxSeq: h.serverMaxSeq,
        deadReason: h.deadReason,
        acked: ackedCounts(),
        pendingNotes: pendingNoteCids(),
      },
    };
  }
  return {
    linked: vitrinkaLinked(),
    canUnlink: !cfg.key && readLink() !== null,
    annotating: annotateState.active,
    recording,
    account: vitrinkaLinked() ? cachedAccount() : null,
    prefs: cachedPrefs(),
    // A "recording" that is not this document's live session was never
    // stopped (its tab closed, or another tab holds it).
    recents: readRecents().map((r) =>
      r.status === 'recording' && r.sessionId !== rec?.sessionId ? { ...r, status: 'unsaved' as const } : r,
    ),
    workspaceUrl: cfg.url,
    version: RECORDER_ID,
    canReport: canReport(),
    canAttach: canAttach(),
    ...(leadState.following ? { following: leadState.following } : {}),
  };
}

export function createPageController(): HudController {
  let last: HudSnapshot | null = null;
  let lastKey = '';
  return {
    getSnapshot() {
      const next = build();
      const key = JSON.stringify(next);
      if (last && key === lastKey) return last;
      last = next;
      lastKey = key;
      return next;
    },
    subscribe,
    async start({ title }) {
      await startSession({ title });
    },
    // While another recorder leads, pause, stop and a note act on it (ONE recorder D11).
    async togglePause() {
      if (leadState.following) return sendToLeader('pause');
      await togglePause();
    },
    async stop() {
      if (leadState.following) {
        sendToLeader('stop');
        const sessionId = leadStatus().claim?.sessionId;
        return sessionId ? { sessionId } : {};
      }
      // The stop's face holds the claim as `saved` from its first moment (D7).
      holdFace('saving');
      const boardUrl = getState()?.boardUrl;
      const sessionId = getState()?.sessionId;
      const done = await stopSession();
      // null for a live session = the server refused to close it (ended locally, not saved).
      if (sessionId && done === null) throw new Error('the server refused to close this session — it ended locally, not saved');
      const url = boardUrlOf(done) ?? boardUrl;
      return { ...(url ? { boardUrl: url } : {}), ...(sessionId ? { sessionId } : {}) };
    },
    note(text, attachments, link) {
      if (!leadState.following) return addNote(text, attachments, link);
      // Images never cross to the other recorder; its note carries the text.
      if (attachments?.length) console.warn('vitrinka: the note goes to the recorder that leads — without its images');
      sendToLeader('note', text);
    },
    annotate: ({ text, rect, selector, attachments, link }) =>
      addAnnotation(text, rect, selector, { ...(attachments ? { attachments } : {}), ...(link ? { link } : {}) }),
    listNotes,
    retryBuild,
    setAnnotating,
    async link(): Promise<HudLinkFlow> {
      const flow = await linkDevice();
      return {
        start: flow.start,
        linked: flow.linked.then(() => {
          void fetchMe();
        }),
        cancel: flow.cancel,
      };
    },
    unlink: forgetLink,
    getMe: fetchMe,
    async setPrefs(patch) {
      await savePrefs(patch);
    },
    refreshRecents: () => refreshRecents(getState()?.sessionId ?? null),
    holdReport,
    report: (r) => sendReport(r),
    onRemoteStop: setRemoteStop,
    faceChanged: holdFace,
  };
}
