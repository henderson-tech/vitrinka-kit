/**
 * The HUD tree, rendered into the shadow host by its own React root and
 * driven ONLY through a `HudController` (controller.ts) — the in-page
 * recorder's, or another host's. Owns the dock (where the HUD rests), the
 * pill's inline flows (flow.ts), the sheet (open/title/ctx/pick + the
 * surviving draft and its images) and where it opens, the ⋯ menu, the tooltip and details
 * floats, annotate mode, the bug report (its sheet, "Mark on screen" through
 * annotate mode, its send flow), the keyboard shortcuts, the Esc-anywhere /
 * click-outside close and the status line a screen reader hears while the
 * pill is folded.
 */
import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

import type { RecorderStorage } from '../storage';
import type { HudAttachment, HudController, HudLinkFlow, HudReport } from './controller';
import { AnnotateOverlay, type Pick } from './AnnotateOverlay';
import { flowReducer, NO_FLOW } from './flow';
import { createSheetHost, insideHud, sheetTarget } from './host';
import {
  anchoredLayer,
  hostOrigin,
  PHONE_QUERY,
  phoneLayer,
  restingBox,
  useFloat,
  useMedia,
  usePresence,
  useViewportTick,
} from './layer';
import { type LinkPhase, LinkSheet } from './LinkSheet';
import { listen } from './listen';
import { Menu } from './Menu';
import { alignFor, towardCentre } from './place';
import { RecorderPill } from './RecorderPill';
import { Sheet } from './Sheet';
import { colOf, rowOf } from './spots';
import { fmtAgo, healthLine } from './status';
import { HUD_CSS } from './styles';
import { Tooltip } from './Tooltip';
import { useDock } from './useDock';

interface SheetState {
  title: string;
  ctx: string;
  pick: Pick | null;
  /** The bug report sheet; `pick` is then the mark on screen. */
  report?: true;
}

/** What a pick names in the sheet's context line. */
function pickCtx(pick: Pick): string {
  return pick.selector
    ? `${pick.selector} · ${location.pathname}`
    : `${Math.round(pick.rect.w)}×${Math.round(pick.rect.h)} · ${location.pathname}`;
}

/** The bug report sheet: the mark (null = the whole viewport) and what the report carries. */
function reportSheet(mark: Pick | null, recording: boolean): SheetState {
  return {
    title: 'Report a bug',
    ctx: mark ? pickCtx(mark) : `${recording ? 'this recording' : 'last minute'} · ${location.pathname}`,
    pick: mark,
    report: true,
  };
}

/** "Saving…" stays at least this long, so a fast save still reads as one. */
const MIN_SAVING_MS = 700;
/** How long the clock says "Saved" after a note or annotation. */
const FLASH_MS = 1600;

/** A clock that ticks every second while `active` (the timer, ages, the sync chip). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return active ? now : Date.now();
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface HudProps {
  controller: HudController;
  /** The HUD host's own mount (the sheet portals here when no dialog is open). */
  hostMount: HTMLElement;
  defaultTitle: () => string;
  /** Where the HUD remembers its own UI state (the dock spot). */
  storage: RecorderStorage;
}

export function Hud({ controller, hostMount, defaultTitle, storage }: HudProps): ReactElement {
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const rec = snap.recording;
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [draft, setDraft] = useState('');
  const [reportDraft, setReportDraft] = useState('');
  // The drafts' images survive a cancel like their text (canAttach only).
  const [images, setImages] = useState<readonly HudAttachment[]>([]);
  const [reportImages, setReportImages] = useState<readonly HudAttachment[]>([]);
  // Annotate mode is picking the report's mark (it returns to the report sheet).
  const [marking, setMarking] = useState(false);
  const markRef = useRef<Pick | null>(null);
  const reportRef = useRef<HudReport | null>(null);
  const [starting, setStarting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [flow, dispatch] = useReducer(flowReducer, NO_FLOW);
  const [flash, setFlash] = useState(false);
  const annotating = snap.annotating;
  const now = useNow(rec !== null || menu || flow.face !== 'none');
  const rootRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  // Device link (Netflix-style code): the sheet paints the phase, this owns it.
  const [link, setLink] = useState<{ phase: LinkPhase; flow: HudLinkFlow | null; error?: string } | null>(null);
  const linkRef = useRef<HudLinkFlow | null>(null);
  const closeLink = useCallback(() => {
    linkRef.current?.cancel();
    linkRef.current = null;
    setLink(null);
  }, []);
  const onStartRef = useRef<() => void>(() => undefined);
  const beginLink = useCallback(() => {
    linkRef.current?.cancel();
    setSheet(null);
    setMenu(false);
    setLink({ phase: 'starting', flow: null });
    controller
      .link()
      .then((lf) => {
        linkRef.current = lf;
        setLink({ phase: 'waiting', flow: lf });
        return lf.linked.then(
          () => {
            if (linkRef.current !== lf) return;
            linkRef.current = null;
            setLink(null);
            // Linked: start recording exactly as if a key had been passed.
            onStartRef.current();
          },
          (e: unknown) => {
            if (linkRef.current !== lf) return;
            linkRef.current = null;
            const name = e instanceof Error ? e.name : '';
            if (name === 'LinkExpired') setLink({ phase: 'expired', flow: lf });
            else if (name !== 'AbortError') setLink({ phase: 'error', flow: lf, error: errorText(e) });
          },
        );
      })
      .catch((e: unknown) => setLink({ phase: 'error', flow: null, error: errorText(e) }));
  }, [controller]);

  const closeSheet = useCallback(() => setSheet(null), []);
  // A drag closes the composer (its draft survives) and the menu; the link sheet follows the dock.
  const onMoveStart = useCallback(() => {
    setSheet(null);
    setMenu(false);
  }, []);
  const dock = useDock(onMoveStart, storage);
  const phone = useMedia(PHONE_QUERY);
  const openNote = useCallback(() => {
    if (!controller.getSnapshot().recording) return;
    controller.setAnnotating(false);
    setMenu(false);
    setSheet({ title: 'Note', ctx: `step · ${location.pathname}`, pick: null });
  }, [controller]);
  const toggleAnnotate = useCallback(() => {
    const s = controller.getSnapshot();
    if (!s.recording) return;
    setSheet(null);
    setMenu(false);
    setMarking(false);
    controller.setAnnotating(!s.annotating);
  }, [controller]);
  const onPick = useCallback(
    (pick: Pick) => {
      controller.setAnnotating(false);
      if (marking) {
        setMarking(false);
        setSheet(reportSheet(pick, controller.getSnapshot().recording !== null));
        return;
      }
      setSheet({ title: pick.selector ? 'Annotate element' : 'Annotate region', ctx: pickCtx(pick), pick });
    },
    [controller, marking],
  );
  const cancelAnnotate = useCallback(() => {
    controller.setAnnotating(false);
    if (!marking) return;
    // Back to the report as it was (its earlier mark, if any).
    setMarking(false);
    setSheet(reportSheet(markRef.current, controller.getSnapshot().recording !== null));
  }, [controller, marking]);
  // "Report a bug" (⋯ menu): idle, the last minute is frozen as the sheet opens.
  const openReport = useCallback(() => {
    const s = controller.getSnapshot();
    if (!s.canReport || !controller.report) return;
    setMenu(false);
    setMarking(false);
    controller.setAnnotating(false);
    controller.holdReport?.(true);
    setSheet(reportSheet(null, s.recording !== null));
  }, [controller]);
  // "Mark on screen": the sheet steps aside (draft and frozen clip kept) for annotate mode.
  const markOnScreen = useCallback(() => {
    markRef.current = sheet?.pick ?? null;
    setSheet(null);
    setMarking(true);
    controller.setAnnotating(true);
  }, [sheet, controller]);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saidSaved = useCallback(() => {
    clearTimeout(flashTimer.current);
    setFlash(true);
    flashTimer.current = setTimeout(() => setFlash(false), FLASH_MS);
  }, []);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  // The frozen last minute lives while the report is composed (sheet open or
  // marking); any other close drops it. A send already took it.
  const composingReport = sheet?.report === true || marking;
  useEffect(() => {
    if (!composingReport) controller.holdReport?.(false);
  }, [composingReport, controller]);

  // Idle, a report is its own short session: the pill says Sending…, then Sent · Open board.
  const runReport = useCallback(
    (r: HudReport) => {
      const t0 = Date.now();
      const settle = (ev: Parameters<typeof dispatch>[0]) =>
        setTimeout(() => dispatch(ev), Math.max(0, MIN_SAVING_MS - (Date.now() - t0)));
      const sent = controller.report?.(r);
      if (!sent) return;
      sent.then(
        (res) => {
          setReportDraft('');
          setReportImages([]);
          settle({ type: 'saved', ...res });
        },
        (e: unknown) => {
          console.warn('vitrinka: report —', errorText(e));
          settle({ type: 'failed', message: errorText(e) });
        },
      );
    },
    [controller],
  );
  const fileReport = useCallback(
    (r: HudReport) => {
      // Recording: a task annotation in the session — the clock says Saved.
      if (controller.getSnapshot().recording) {
        controller.report?.(r).then(
          () => {
            setReportDraft('');
            setReportImages([]);
            saidSaved();
          },
          (e: unknown) => console.warn('vitrinka: report —', errorText(e)),
        );
        return;
      }
      reportRef.current = r;
      dispatch({ type: 'send' });
      runReport(r);
    },
    [controller, runReport, saidSaved],
  );
  const onSend = useCallback(
    (text: string, task: boolean) => {
      const s = sheet;
      setSheet(null);
      if (!s) return;
      // Images ride only while the host takes them (a policy switched off mid-draft drops them).
      const held = controller.getSnapshot().canAttach === true ? (s.report ? reportImages : images) : [];
      const attachments = held.length ? { attachments: held } : {};
      if (s.report) {
        fileReport({ text, rect: s.pick?.rect ?? null, selector: s.pick?.selector ?? '', ...attachments });
        return;
      }
      if (s.pick) {
        controller.annotate({ text, rect: s.pick.rect, selector: s.pick.selector, task, ...attachments });
        setDraft('');
        setImages([]);
        saidSaved();
      } else if (text || held.length) {
        // An image can BE the note: text may be empty when it carries one.
        if (held.length) controller.note(text, held);
        else controller.note(text);
        setDraft('');
        setImages([]);
        saidSaved();
      }
    },
    [sheet, controller, saidSaved, fileReport, images, reportImages],
  );
  const onStart = useCallback(() => {
    if (!controller.getSnapshot().linked) {
      beginLink();
      return;
    }
    setStarting(true);
    controller
      .start({ title: defaultTitle() })
      .catch((e) => console.warn('vitrinka: start failed', e))
      .finally(() => setStarting(false));
  }, [controller, defaultTitle, beginLink]);
  onStartRef.current = onStart;
  const onPause = useCallback(() => {
    void controller.togglePause();
  }, [controller]);

  // The inline flows. Stop drains first; a refusal (offline) keeps the session.
  const runStop = useCallback(() => {
    const t0 = Date.now();
    const settle = (ev: Parameters<typeof dispatch>[0]) =>
      setTimeout(() => dispatch(ev), Math.max(0, MIN_SAVING_MS - (Date.now() - t0)));
    controller.stop().then(
      (r) => settle({ type: 'saved', ...r }),
      (e: unknown) => {
        console.warn('vitrinka: stop —', errorText(e));
        settle({ type: 'failed', message: errorText(e) });
      },
    );
  }, [controller]);
  const askStop = useCallback(() => {
    if (!controller.getSnapshot().recording) return;
    setSheet(null);
    setMenu(false);
    controller.setAnnotating(false);
    dispatch({ type: 'ask', action: 'stop' });
  }, [controller]);
  const askUnlink = useCallback(() => {
    setSheet(null);
    setMenu(false);
    dispatch({ type: 'ask', action: 'unlink' });
  }, []);
  const onConfirm = useCallback(() => {
    if (flow.face !== 'confirm') return;
    dispatch({ type: 'confirm', queued: controller.getSnapshot().recording?.sync.queued ?? 0 });
    if (flow.action === 'stop') {
      runStop();
      return;
    }
    closeLink();
    setSheet(null);
    controller.setAnnotating(false);
    controller.unlink();
  }, [flow, controller, runStop, closeLink]);
  const onCancel = useCallback(() => dispatch({ type: 'cancel' }), []);
  const failedReport = flow.face === 'failed' && flow.report === true;
  const onDismiss = useCallback(() => {
    // A report not sent is dropped with its failure.
    if (failedReport) controller.holdReport?.(false);
    dispatch({ type: 'dismiss' });
  }, [failedReport, controller]);
  const onRetry = useCallback(() => {
    if (failedReport) {
      dispatch({ type: 'retry', queued: 0 });
      if (reportRef.current) runReport(reportRef.current);
      return;
    }
    dispatch({ type: 'retry', queued: controller.getSnapshot().recording?.sync.queued ?? 0 });
    runStop();
  }, [failedReport, controller, runStop, runReport]);
  // A stop confirm outlives nothing: the session ended under it (401, the server).
  useEffect(() => {
    if (!rec && flow.face === 'confirm' && flow.action === 'stop') dispatch({ type: 'cancel' });
  }, [rec, flow]);

  // Who the token is (and the user's server-side prefs): on mount and once linked.
  useEffect(() => {
    if (snap.linked) void controller.getMe();
  }, [snap.linked, controller]);
  // A keyboard open (Enter, Space, ↓ on ⋯) moves focus to the first item, as a menu button does.
  const focusMenu = useRef(false);
  const toggleMenu = useCallback((byKeyboard: boolean) => {
    focusMenu.current = byKeyboard;
    setMenu((m) => !m);
  }, []);
  useEffect(() => {
    if (!menu || !focusMenu.current) return;
    focusMenu.current = false;
    const raf = requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(raf);
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    void controller.getMe();
    void controller.refreshRecents();
  }, [menu, controller]);

  // Shortcuts (window keydown, CAPTURE — the host's shield stops a keydown
  // from a focused HUD control before it could bubble to window, and a drag
  // leaves the handle focused): ⌥⇧A annotate · ⌥⇧N note · ⌥⇧P pause · ⌥⇧S stop.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey) return;
      if (e.code === 'KeyA') toggleAnnotate();
      else if (e.code === 'KeyN') openNote();
      else if (e.code === 'KeyP') onPause();
      else if (e.code === 'KeyS') askStop();
      else return;
      e.preventDefault();
    };
    return listen(window, 'keydown', key, { capture: true });
  }, [toggleAnnotate, openNote, onPause, askStop]);

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
    const offKey = listen(document, 'keydown', key, { capture: true });
    document.addEventListener('pointerdown', down, true);
    return () => {
      offKey();
      document.removeEventListener('pointerdown', down, true);
    };
  }, [sheet, closeSheet]);

  // The menu closes on Esc (focus back on its ⋯) and on a press outside it and the pill.
  useEffect(() => {
    if (!menu) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setMenu(false);
      pillRef.current?.querySelector<HTMLElement>('.seg.on .b-more')?.focus();
    };
    const down = (e: Event) => {
      const path = e.composedPath();
      if (!path.includes(menuRef.current as EventTarget) && !path.includes(pillRef.current as EventTarget)) setMenu(false);
    };
    const offKey = listen(document, 'keydown', key, { capture: true });
    document.addEventListener('pointerdown', down, true);
    return () => {
      offKey();
      document.removeEventListener('pointerdown', down, true);
    };
  }, [menu]);
  useEffect(() => {
    if (dock.dragging) setMenu(false);
  }, [dock.dragging]);

  // Sheets and the menu enter and leave (presence) with their last content
  // kept for the closing frames.
  const sheetP = usePresence(sheet !== null, 150);
  const linkP = usePresence(link !== null, 150);
  const menuP = usePresence(menu, 150);
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

  // Where the open layer sits (D5): beside the dock's resting box, toward the
  // centre and inside the viewport, or a phone bottom sheet over the visual viewport.
  const layerOpen = sheet !== null || link !== null;
  const vvTick = useViewportTick(layerOpen && phone);
  // On desktop the placement is measured, so a viewport resize or a grown
  // sheet (the textarea resizes) must place it again.
  const [sizeTick, setSizeTick] = useState(0);
  useEffect(() => {
    if (!layerOpen || phone) return;
    const bump = () => setSizeTick((n) => n + 1);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(bump) : null;
    const pop = layerRef.current?.firstElementChild;
    if (ro && pop) ro.observe(pop);
    addEventListener('resize', bump);
    return () => {
      ro?.disconnect();
      removeEventListener('resize', bump);
    };
  }, [layerOpen, phone, sheetP.mounted, linkP.mounted]);
  const [layer, setLayer] = useState<{ style: CSSProperties; origin: string }>({ style: {}, origin: 'bottom right' });
  useLayoutEffect(() => {
    const el = dock.ref.current;
    if (!layerOpen || !el) return;
    const o = hostOrigin(sheet && portal ? portal.mount : hostMount);
    if (phone) {
      setLayer({ style: phoneLayer(o), origin: 'bottom center' });
      return;
    }
    const pop = layerRef.current?.firstElementChild as HTMLElement | null;
    const size = pop ? { w: pop.offsetWidth, h: pop.offsetHeight } : { w: 288, h: 200 };
    setLayer(anchoredLayer(restingBox(el), size, dock.place, o));
  }, [layerOpen, sheet, link?.phase, portal, hostMount, dock.place, dock.ref, phone, vvTick, sizeTick, snap.prefs.size]);
  const layerCls = phone ? 'phone' : 'anchor';
  const motionCls = phone ? 'rise' : 'grow';

  // The floats: menu and details card beside the dock, toward the centre.
  const side = towardCentre(dock.place);
  const align = alignFor(dock.place);
  const anchor = useCallback(() => {
    const el = dock.ref.current;
    return el ? { el, box: restingBox(el) } : null;
  }, [dock.ref]);
  useFloat(menuRef, anchor, side, align, menuP.mounted);
  const tucked = 'tuck' in dock.place;
  const line = rec ? healthLine(rec.sync, now) : '';
  const detailOn =
    rec !== null && (snap.prefs.verbose || line !== '') && !menu && !layerOpen && flow.face === 'none' && !dock.dragging && !tucked;
  const detailP = usePresence(detailOn, 150);
  useFloat(detailRef, anchor, side, align, detailP.mounted);
  const lastRec = useRef(rec);
  if (rec) lastRec.current = rec;
  const detailRec = rec ?? lastRec.current;

  const sheetEl =
    shownSheet && portal ? (
      <div className="hud" data-size={snap.prefs.size}>
        {portal.own ? <style>{HUD_CSS}</style> : null}
        <div ref={layerRef} className={layerCls} style={layer.style}>
          <Sheet
            key={shownSheet.report ? 'report' : 'note'}
            className={`${motionCls} ${sheetP.cls}`}
            origin={layer.origin}
            title={shownSheet.title}
            ctx={shownSheet.ctx}
            pick={shownSheet.pick !== null && !shownSheet.report}
            draft={shownSheet.report ? reportDraft : draft}
            onDraft={shownSheet.report ? setReportDraft : setDraft}
            onSend={onSend}
            onClose={closeSheet}
            {...(shownSheet.report
              ? { placeholder: 'What went wrong?', required: true, onMark: markOnScreen, marked: shownSheet.pick !== null }
              : {})}
            {...(snap.canAttach === true
              ? shownSheet.report
                ? { images: reportImages, onImages: setReportImages }
                : { images, onImages: setImages }
              : {})}
          />
        </div>
      </div>
    ) : null;

  // Stable phrases only: a live region re-announces on every text change.
  const hs = rec?.sync.state ?? null;
  const status = !rec
    ? snap.linked
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
    <div ref={rootRef} className="hud" data-size={snap.prefs.size} data-spot={'spot' in place ? place.spot : undefined}>
      <style>{HUD_CSS}</style>
      {annotating && (rec || marking) ? <AnnotateOverlay onPick={onPick} onCancel={cancelAnnotate} /> : null}
      <div ref={dock.ref} className={dock.dragging ? 'dock dragging' : 'dock'} {...dockAttrs} onClickCapture={dock.onClickCapture}>
        <RecorderPill
          snap={snap}
          now={now}
          flow={flow}
          flash={flash}
          composing={sheet !== null}
          starting={starting}
          menuOpen={menu}
          place={place}
          dragging={dock.dragging}
          handle={dock.handle}
          pillRef={pillRef}
          onMove={dock.moveTo}
          onLink={beginLink}
          onStart={onStart}
          onPause={onPause}
          onNote={openNote}
          onAnnotate={toggleAnnotate}
          onMenu={toggleMenu}
          onAskStop={askStop}
          onConfirm={onConfirm}
          onCancel={onCancel}
          onRetry={onRetry}
          onDismiss={onDismiss}
        />
      </div>
      {menuP.mounted ? (
        <Menu
          snap={snap}
          now={now}
          place={place}
          className={`grow ${menuP.cls}`}
          menuRef={menuRef}
          onClose={() => setMenu(false)}
          onMove={dock.moveTo}
          onSize={(size) => void controller.setPrefs({ size })}
          onVerbose={(verbose) => void controller.setPrefs({ verbose })}
          onAskUnlink={askUnlink}
          onLink={beginLink}
          {...(snap.canReport && controller.report ? { onReport: openReport } : {})}
        />
      ) : null}
      {/* before the details card: a showing tooltip fades it (styles.ts), they share a side */}
      <Tooltip root={rootRef} side={side} suppressed={dock.dragging || menu || layerOpen} />
      {detailP.mounted && detailRec ? (
        <div
          ref={detailRef}
          className={['float detail grow', detailP.cls, snap.prefs.verbose ? '' : 'line', line ? 'bad' : ''].filter(Boolean).join(' ')}
          data-e2e="recorder-detail"
          aria-hidden="true"
        >
          {snap.prefs.verbose ? (
            <>
              <dl>
                <dt>events</dt>
                <dd>{detailRec.sync.events}</dd>
                <dt>queue</dt>
                <dd>
                  {detailRec.sync.queued}
                  {detailRec.sync.chunks ? ` (${detailRec.sync.chunks} chunk${detailRec.sync.chunks === 1 ? '' : 's'})` : ''}
                </dd>
                <dt>last sync</dt>
                <dd>
                  {detailRec.sync.lastSyncAt === null ? '—' : `${fmtAgo(now - detailRec.sync.lastSyncAt)} · ${detailRec.sync.state}`}
                </dd>
                <dt>server seq</dt>
                <dd>{Math.max(0, detailRec.sync.serverMaxSeq)}</dd>
                <dt>session</dt>
                <dd>{detailRec.sessionId}</dd>
                <dt>recorder</dt>
                <dd>{snap.version}</dd>
              </dl>
              {line ? <div className="warnline">{line}</div> : null}
            </>
          ) : (
            line
          )}
        </div>
      ) : null}
      {sheetEl && portal ? createPortal(sheetEl, portal.mount) : null}
      {linkP.mounted && shownLink ? (
        <div ref={layerRef} className={layerCls} style={layer.style}>
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
