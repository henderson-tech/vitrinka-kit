/**
 * The HUD tree, rendered into the shadow host by its own React root. Owns
 * the dock (where the HUD rests), the sheet (open/title/ctx/pick + the
 * surviving draft) and where it opens, annotate mode, the keyboard
 * shortcuts, the Esc-anywhere / click-outside close and the status line a
 * screen reader hears while the capsule is folded.
 */
import { colOf, rowOf } from '@vitrinka/link/dock';
import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

import { readLink, recorderConfig, vitrinkaLinked } from '../config';
import { forgetLink, linkDevice, LinkExpired, type DeviceLink } from '../link';
import { getState, health } from '../queue';
import { addAnnotation, addNote, startSession, stopSession, togglePause } from '../session';
import { annotateState, setAnnotating, subscribe } from '../state';
import { AnnotateOverlay, type Pick } from './AnnotateOverlay';
import { createSheetHost, insideHud, sheetTarget } from './host';
import { anchoredLayer, hostOrigin, PHONE_QUERY, phoneLayer, restingBox, useMedia, usePresence, useViewportTick } from './layer';
import { type LinkPhase, LinkSheet } from './LinkSheet';
import { RecorderPill } from './RecorderPill';
import { Sheet } from './Sheet';
import { HUD_CSS } from './styles';
import { useDock } from './useDock';

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
  // A drag closes the composer (its draft survives); the link sheet follows the dock.
  const dock = useDock(closeSheet);
  const phone = useMedia(PHONE_QUERY);
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

  // Shortcuts (window keydown, CAPTURE — the host's shield stops a keydown
  // from a focused HUD control before it could bubble to window, and a drag
  // leaves the handle focused): ⌥⇧A annotate · ⌥⇧N note · ⌥⇧P pause.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey) return;
      if (e.code === 'KeyA') toggleAnnotate();
      else if (e.code === 'KeyN') openNote();
      else if (e.code === 'KeyP') onPause();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
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

  // Sheets enter and leave (presence) with their last content kept for the
  // closing frames.
  const sheetP = usePresence(sheet !== null, 150);
  const linkP = usePresence(link !== null, 150);
  const lastSheet = useRef<SheetState | null>(null);
  const lastLink = useRef<typeof link>(null);
  if (sheet) lastSheet.current = sheet;
  if (link) lastLink.current = link;
  const shownSheet = sheet ?? lastSheet.current;
  const shownLink = link ?? lastLink.current;

  // The sheet's portal target (D4): a host inside the topmost open dialog
  // when one exists, else the HUD host. Resolved per open, kept while it closes.
  const portal = useMemo(() => {
    if (!sheetP.mounted) return null;
    const target = sheetTarget();
    if (!target) return { mount: hostMount, destroy: () => undefined, own: false };
    const h = createSheetHost(target);
    return { ...h, own: true };
  }, [sheetP.mounted, hostMount]);
  useEffect(() => () => portal?.destroy(), [portal]);

  // Where the open layer sits (D5): anchored to the dock's resting box and
  // opening toward the centre, or a phone bottom sheet over the visual viewport.
  const layerOpen = sheet !== null || link !== null;
  const vvTick = useViewportTick(layerOpen && phone);
  const [layer, setLayer] = useState<{ style: CSSProperties; origin: string }>({ style: {}, origin: 'bottom-right' });
  useLayoutEffect(() => {
    const el = dock.ref.current;
    if (!layerOpen || !el) return;
    const o = hostOrigin(sheet && portal ? portal.mount : hostMount);
    setLayer(phone ? { style: phoneLayer(o), origin: 'bottom-center' } : anchoredLayer(restingBox(el), dock.place, o));
  }, [layerOpen, sheet, portal, hostMount, dock.place, dock.ref, phone, vvTick]);
  const layerCls = phone ? 'phone' : 'anchor';
  const motionCls = phone ? 'rise' : 'grow';

  const sheetEl =
    shownSheet && portal ? (
      <div className="hud">
        {portal.own ? <style>{HUD_CSS}</style> : null}
        <div className={layerCls} style={layer.style}>
          <Sheet
            className={`${motionCls} ${sheetP.cls}`}
            origin={layer.origin}
            title={shownSheet.title}
            ctx={shownSheet.ctx}
            pick={shownSheet.pick !== null}
            draft={draft}
            onDraft={setDraft}
            onSend={onSend}
            onClose={closeSheet}
          />
        </div>
      </div>
    ) : null;

  // Stable phrases only: a live region re-announces on every text change.
  const hs = rec ? health().state : null;
  const status = !rec
    ? linked
      ? 'Recorder ready'
      : 'Recorder not linked'
    : hs === 'dead'
      ? 'Recording ended on the server'
      : hs === 'offline'
        ? 'Recorder offline, retrying'
        : rec.paused
          ? 'Recording paused'
          : 'Recording';

  const place = dock.place;
  const dockAttrs =
    'tuck' in place
      ? { 'data-tuck': place.tuck, style: { '--ty': String(place.y) } as CSSProperties }
      : { 'data-row': rowOf(place.spot), 'data-col': colOf(place.spot) };

  return (
    <div className="hud" data-spot={'spot' in place ? place.spot : undefined}>
      <style>{HUD_CSS}</style>
      {annotating && rec ? <AnnotateOverlay onPick={onPick} onCancel={cancelAnnotate} /> : null}
      <div ref={dock.ref} className={dock.dragging ? 'dock dragging' : 'dock'} {...dockAttrs} onClickCapture={dock.onClickCapture}>
        <RecorderPill
          rec={rec}
          composing={sheet !== null}
          annotating={annotating}
          stopping={stopping}
          starting={starting}
          linked={linked}
          canUnlink={canUnlink}
          place={place}
          dragging={dock.dragging}
          handle={dock.handle}
          onMove={dock.moveTo}
          onLink={beginLink}
          onUnlink={onUnlink}
          onStart={onStart}
          onPause={onPause}
          onNote={openNote}
          onAnnotate={toggleAnnotate}
          onStop={onStop}
        />
      </div>
      {sheetEl && portal ? createPortal(sheetEl, portal.mount) : null}
      {linkP.mounted && shownLink ? (
        <div className={layerCls} style={layer.style}>
          <LinkSheet
            className={`${motionCls} ${linkP.cls}`}
            origin={layer.origin}
            phase={shownLink.phase}
            start={shownLink.flow?.start ?? null}
            error={shownLink.error}
            onRetry={beginLink}
            onClose={closeLink}
          />
        </div>
      ) : null}
      <div className="sr" role="status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}
