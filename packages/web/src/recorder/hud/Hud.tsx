/**
 * The HUD tree, rendered into the shadow host by its own React root. Owns
 * the sheet (open/title/ctx/pick + the surviving draft), annotate mode, the
 * keyboard shortcuts and the Esc-anywhere / click-outside close.
 */
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { readLink, recorderConfig, vitrinkaLinked } from '../config';
import { forgetLink, linkDevice, LinkExpired, type DeviceLink } from '../link';
import { getState } from '../queue';
import { addAnnotation, addNote, startSession, stopSession, togglePause } from '../session';
import { annotateState, setAnnotating, subscribe } from '../state';
import { AnnotateOverlay, type Pick } from './AnnotateOverlay';
import { createSheetHost, insideHud, sheetTarget } from './host';
import { type LinkPhase, LinkSheet } from './LinkSheet';
import { RecorderPill } from './RecorderPill';
import { Sheet } from './Sheet';
import { HUD_CSS } from './styles';

interface SheetState {
  title: string;
  ctx: string;
  pick: Pick | null;
}

let version = 0;
const bump = () => ++version;

function useRecorderState(): number {
  return useSyncExternalStore(
    (cb) => subscribe(() => { bump(); cb(); }),
    () => version,
    () => version,
  );
}

export interface HudProps {
  /** The HUD host's own mount (the sheet portals here when no dialog is open). */
  hostMount: HTMLElement;
  defaultTitle: () => string;
}

export function Hud({ hostMount, defaultTitle }: HudProps): ReactElement {
  useRecorderState();
  const rec = getState();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [draft, setDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const annotating = annotateState.active;
  const linked = vitrinkaLinked();
  const canUnlink = !recorderConfig().key && readLink() !== null;

  // Device link (Netflix-style code): the sheet paints the phase, this owns it.
  const [link, setLink] = useState<{ phase: LinkPhase; flow: DeviceLink | null; error?: string } | null>(null);
  const linkRef = useRef<DeviceLink | null>(null);
  const closeLink = useCallback(() => {
    linkRef.current?.cancel();
    linkRef.current = null;
    setLink(null);
  }, []);
  const beginLink = useCallback(() => {
    linkRef.current?.cancel();
    setSheet(null);
    setLink({ phase: 'starting', flow: null });
    linkDevice()
      .then((flow) => {
        linkRef.current = flow;
        setLink({ phase: 'waiting', flow });
        return flow.linked.then(
          () => {
            if (linkRef.current !== flow) return;
            linkRef.current = null;
            setLink(null);
            // Linked: start recording exactly as if a key had been passed.
            onStartRef.current();
          },
          (e: unknown) => {
            if (linkRef.current !== flow) return;
            linkRef.current = null;
            if (e instanceof LinkExpired) setLink({ phase: 'expired', flow });
            else if (!(e instanceof Error && e.name === 'AbortError'))
              setLink({ phase: 'error', flow, error: e instanceof Error ? e.message : String(e) });
          },
        );
      })
      .catch((e: unknown) => setLink({ phase: 'error', flow: null, error: e instanceof Error ? e.message : String(e) }));
  }, []);
  const onUnlink = useCallback(() => {
    closeLink();
    setSheet(null);
    setAnnotating(false);
    forgetLink();
  }, [closeLink]);

  const closeSheet = useCallback(() => setSheet(null), []);
  const openNote = useCallback(() => {
    if (!getState()) return;
    setAnnotating(false);
    setSheet({ title: 'Note', ctx: `step · ${location.pathname}`, pick: null });
  }, []);
  const toggleAnnotate = useCallback(() => {
    if (!getState()) return;
    setSheet(null);
    setAnnotating(!annotateState.active);
  }, []);
  const onPick = useCallback((pick: Pick) => {
    setAnnotating(false);
    const ctx = pick.selector
      ? `${pick.selector} · ${location.pathname}`
      : `${Math.round(pick.rect.w)}×${Math.round(pick.rect.h)} · ${location.pathname}`;
    setSheet({ title: pick.selector ? 'Annotate element' : 'Annotate region', ctx, pick });
  }, []);
  const cancelAnnotate = useCallback(() => setAnnotating(false), []);
  const onSend = useCallback(
    (text: string, task: boolean) => {
      const s = sheet;
      setSheet(null);
      if (!s) return;
      if (s.pick) {
        addAnnotation(text, s.pick.rect, s.pick.selector, { task });
        setDraft('');
      } else if (text) {
        addNote(text);
        setDraft('');
      }
    },
    [sheet],
  );
  const onStart = useCallback(() => {
    if (!vitrinkaLinked()) {
      beginLink();
      return;
    }
    setStarting(true);
    startSession({ title: defaultTitle() })
      .catch((e) => console.warn('vitrinka: start failed', e))
      .finally(() => setStarting(false));
  }, [defaultTitle, beginLink]);
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const onStop = useCallback(() => {
    setSheet(null);
    setAnnotating(false);
    setStopping(true);
    stopSession()
      .catch((e) => console.warn('vitrinka: stop —', e instanceof Error ? e.message : e))
      .finally(() => setStopping(false));
  }, []);
  const onPause = useCallback(() => {
    void togglePause();
  }, []);

  // Shortcuts (window keydown): ⌥⇧A annotate · ⌥⇧N note · ⌥⇧P pause.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey) return;
      if (e.code === 'KeyA') toggleAnnotate();
      else if (e.code === 'KeyN') openNote();
      else if (e.code === 'KeyP') onPause();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [toggleAnnotate, openNote, onPause]);

  // Esc anywhere and click-outside close the sheet (capture-phase, so the
  // page's own dialog never sees the Esc that closed ours).
  useEffect(() => {
    if (!sheet) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || insideHud(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
    };
    const down = (e: PointerEvent) => {
      if (insideHud(e.target)) return;
      closeSheet();
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', down, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', down, true);
    };
  }, [sheet, link, closeSheet, closeLink]);

  // The sheet's portal target (D4): a host inside the topmost open dialog
  // when one exists, else the HUD host. Resolved per open.
  const portal = useMemo(() => {
    if (!sheet) return null;
    const target = sheetTarget();
    if (!target) return { mount: hostMount, destroy: () => undefined, own: false };
    const h = createSheetHost(target);
    return { ...h, own: true };
  }, [sheet, hostMount]);
  useEffect(() => () => portal?.destroy(), [portal]);

  const sheetEl = sheet && portal ? (
    <>
      {portal.own ? <style>{HUD_CSS}</style> : null}
      <div className="sheetwrap" style={portal.own ? undefined : { position: 'absolute', right: 0, bottom: 52 }}>
        <Sheet
          title={sheet.title}
          ctx={sheet.ctx}
          pick={sheet.pick !== null}
          draft={draft}
          onDraft={setDraft}
          onSend={onSend}
          onClose={closeSheet}
        />
      </div>
    </>
  ) : null;

  return (
    <>
      <style>{HUD_CSS}</style>
      {annotating && rec ? <AnnotateOverlay onPick={onPick} onCancel={cancelAnnotate} /> : null}
      <div style={{ position: 'relative' }}>
        <RecorderPill
          rec={rec}
          composing={sheet !== null}
          annotating={annotating}
          stopping={stopping}
          starting={starting}
          linked={linked}
          canUnlink={canUnlink}
          onLink={beginLink}
          onUnlink={onUnlink}
          onStart={onStart}
          onPause={onPause}
          onNote={openNote}
          onAnnotate={toggleAnnotate}
          onStop={onStop}
        />
        {sheetEl && portal ? createPortal(sheetEl, portal.mount) : null}
        {link ? (
          <div className="sheetwrap" style={{ position: 'absolute', right: 0, bottom: 52 }}>
            <LinkSheet phase={link.phase} start={link.flow?.start ?? null} error={link.error} onRetry={beginLink} onClose={closeLink} />
          </div>
        ) : null}
      </div>
    </>
  );
}
