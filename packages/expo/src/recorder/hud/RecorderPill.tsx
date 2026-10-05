/**
 * Floating recorder HUD — the web HUD's twin (recorder-hud-subtle):
 *
 *   puck     — idle: a 32pt glass circle; hollow ring = not linked (tap
 *              links), muted dot = ready (tap records); long-press opens
 *              the menu (unlink, move to)
 *   capsule  — recording: rec dot + clock; a tap unfolds the TRAY
 *              (frames · sync · pause · note · annotate · more), which folds
 *              back 4s after the last touch; annotate mode holds it open
 *   tab      — tucked: a 6pt sliver on a side edge; tap brings it back
 *
 * Drag the puck, capsule or tab: it settles on one of six spots through
 * @vitrinka/link/dock (a flick lands where it is aimed, a push past a side
 * edge tucks it), then springs there from where it was let go. The spot is
 * remembered. Link, note and menu open as bottom sheets riding the
 * keyboard. A machine-driven run (`driver: 'ai'`) stays a bare dot so review
 * frames never carry the HUD.
 *
 * Dev-only tooling — plain inline styles and untranslated strings (never
 * ships; the i18n law covers product UI). All glyphs are the hand-rolled
 * Views in ./icons — this HUD has no drawing dependency.
 */

import { colOf, type Insets, parsePlace, type Place, type Rect, rowOf, settle, SPOTS, type Size, type Spot, spotRect, untuck } from '@vitrinka/link/dock';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  LayoutAnimation,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hasEnvToken, vitrinkaLinked } from '../api';
import { type DeviceLink, forgetLink, linkDevice, LinkExpired } from '../link';
import { getState, health, type RecorderHealthState } from '../queue';
import { addNote, elapsedOf, startSession, stopSession, subscribe, togglePause } from '../session';
import { getRecorderStorage } from '../storage';
import { annotateState, currentRoute, setAnnotating } from '../state';
import { Camera, Check, Pause, Pencil, Play, Scan, Square, X } from './icons';

const INK = 'rgba(26,22,23,0.86)';
const EDGE = 'rgba(255,255,255,0.12)';
const FG = '#f4efea';
const FG2 = 'rgba(244,239,234,0.66)';
const REC = '#ff3b57';
const M = 12;
const H = 32;
const TAB = { w: 22, h: 56 };
const DOCK_KEY = 'vitrinka.recorder.dock';
/** The tray folds this long after the last touch inside it. */
const FOLD_MS = 4000;

/**
 * Honest dot per health state (extension D4): ok stays the recording red;
 * anything else recolors the dot the tester is already watching.
 */
const HEALTH_DOT: Record<RecorderHealthState, string> = {
  idle: REC,
  ok: REC,
  backlog: '#ff8800',
  offline: '#8a93a0',
  dead: '#7a1f1a',
};

const SPOT_NAMES: Record<Spot, string> = {
  tl: 'top left',
  tc: 'top centre',
  tr: 'top right',
  bl: 'bottom left',
  bc: 'bottom centre',
  br: 'bottom right',
};

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function ease(): void {
  LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
}

function readPlace(): Place {
  try {
    return parsePlace(getRecorderStorage().getString(DOCK_KEY));
  } catch {
    return parsePlace(null);
  }
}

/** Where a place puts a dock of `size` (screen coordinates). */
function rectOf(place: Place, size: Size, view: Size, inset: Insets): Rect {
  if ('spot' in place) return spotRect(place.spot, size, view, inset);
  const y = Math.min(Math.max(place.y * view.h - TAB.h / 2, inset.top - M + 8), view.h - inset.bottom + M - TAB.h - 8);
  return { x: place.tuck === 'left' ? 0 : view.w - TAB.w, y, w: TAB.w, h: TAB.h };
}

export function RecorderPill({ hideIdleGripOn }: { hideIdleGripOn?: readonly string[] } = {}) {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<'note' | 'menu' | null>(null);
  const [note, setNote] = useState('');
  const [busyAction, setBusyAction] = useState<'start' | 'stop' | null>(null);
  const [place, setPlace] = useState<Place>(readPlace);
  const [size, setSize] = useState<Size>({ w: H, h: H });
  const [flight, setFlight] = useState<Animated.ValueXY | null>(null);
  const pan = useRef(new Animated.ValueXY()).current;
  const fold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const win = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const inset: Insets = { top: safe.top + M, right: safe.right + M, bottom: safe.bottom + M, left: safe.left + M };

  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  const rec = getState();
  // Dead is not "recording": the clock is frozen and capture refuses, so the
  // 1s tick below must not keep re-rendering a corpse.
  const recording = rec !== null && !rec.paused && !rec.dead;
  const busy = busyAction !== null;
  const h = health();
  const hasBacklog = rec !== null && h.queued > 0;
  useEffect(() => {
    if (!recording && !hasBacklog) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [recording, hasBacklog]);

  // Folding: 4s after the last touch; never while annotating or a sheet is up.
  const hold = annotateState.active || sheet !== null;
  const touch = () => {
    clearTimeout(fold.current);
    fold.current = setTimeout(() => {
      ease();
      setOpen(false);
    }, FOLD_MS);
  };
  useEffect(() => {
    if (open && !hold) touch();
    return () => clearTimeout(fold.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hold]);

  // What a screen reader hears when the state changes (the capsule is mute).
  const status = !rec
    ? vitrinkaLinked()
      ? 'Recorder ready'
      : 'Recorder not linked'
    : rec.dead
      ? 'Recording ended on the server'
      : h.state === 'offline'
        ? 'Recorder offline, retrying'
        : rec.paused
          ? 'Recording paused'
          : 'Recording';
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current === status) return;
    lastStatus.current = status;
    AccessibilityInfo.announceForAccessibility(status);
  }, [status]);

  const moveTo = (next: Place, from?: Rect) => {
    const view = { w: win.width, h: win.height };
    if (from) {
      // FLIP: the new place's layout and a transform back to the release
      // point commit together (a fresh value per flight), then spring home.
      const to = rectOf(next, 'spot' in next ? size : TAB, view, inset);
      setFlight(new Animated.ValueXY({ x: from.x - to.x, y: from.y + from.h / 2 - (to.y + to.h / 2) }));
    }
    setPlace(next);
    try {
      getRecorderStorage().set(DOCK_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('vitrinka: could not remember the HUD position', e);
    }
  };
  useEffect(() => {
    if (!flight) return;
    const anim = Animated.spring(flight, { toValue: { x: 0, y: 0 }, useNativeDriver: true, damping: 20, stiffness: 220, mass: 1 });
    anim.start(() => {
      pan.setValue({ x: 0, y: 0 });
      setFlight(null);
    });
    return () => anim.stop();
  }, [flight, pan]);

  // Drag: claimed only past a small slop, so taps still reach the buttons.
  const layout = useRef<Rect>({ x: 0, y: 0, w: H, h: H });
  const placeRef = useRef(place);
  placeRef.current = place;
  const moveRef = useRef(moveTo);
  moveRef.current = moveTo;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => Math.hypot(g.dx, g.dy) > 6,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          clearTimeout(fold.current);
          setOpen(false);
          setSheet(null);
        },
        onPanResponderMove: (_, g) => pan.setValue({ x: g.dx, y: g.dy }),
        onPanResponderRelease: (_, g) => {
          const l = layout.current;
          const from = { x: l.x + g.dx, y: l.y + g.dy, w: l.w, h: l.h };
          const view = { w: win.width, h: win.height };
          moveRef.current(settle(from, { x: g.vx * 1000, y: g.vy * 1000 }, view, inset), from);
        },
        // Taken away mid-drag (a system gesture): spring back to where it rested.
        onPanResponderTerminate: (_, g) => {
          const l = layout.current;
          moveRef.current(placeRef.current, { x: l.x + g.dx, y: l.y + g.dy, w: l.w, h: l.h });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pan, win.width, win.height, safe.top, safe.right, safe.bottom, safe.left],
  );

  // Device link (@vitrinka/link): the code sheet. No QR on native — a phone
  // cannot scan itself; the code + "Open vitrinka" cover the same-device path.
  const [link, setLink] = useState<{
    phase: 'starting' | 'waiting' | 'expired' | 'error';
    flow: DeviceLink | null;
    error?: string;
  } | null>(null);
  const [linkFlow, setLinkFlow] = useState<DeviceLink | null>(null);
  const closeLink = () => {
    linkFlow?.cancel();
    setLinkFlow(null);
    setLink(null);
  };
  const beginLink = () => {
    linkFlow?.cancel();
    setSheet(null);
    setLink({ phase: 'starting', flow: null });
    linkDevice()
      .then((flow) => {
        setLinkFlow(flow);
        setLink({ phase: 'waiting', flow });
        return flow.linked.then(
          () => {
            setLinkFlow(null);
            setLink(null);
            onStart(); // linked: record exactly as if a token had been baked
          },
          (e: unknown) => {
            setLinkFlow(null);
            if (e instanceof LinkExpired) setLink({ phase: 'expired', flow });
            else if (!(e instanceof Error && e.name === 'AbortError'))
              setLink({ phase: 'error', flow, error: e instanceof Error ? e.message : String(e) });
          },
        );
      })
      .catch((e: unknown) => setLink({ phase: 'error', flow: null, error: e instanceof Error ? e.message : String(e) }));
  };
  const onUnlink = () => {
    closeLink();
    setSheet(null);
    forgetLink();
  };

  const onStart = () => {
    if (busy) return;
    if (!vitrinkaLinked()) {
      beginLink();
      return;
    }
    setBusyAction('start');
    startSession()
      .catch((e) => Alert.alert('Vitrinka recorder', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusyAction(null));
  };

  const onStop = () => {
    if (busy) return;
    setSheet(null);
    setBusyAction('stop');
    stopSession()
      .then((done) => {
        ease();
        setOpen(false);
        if (done?.board?.url) Alert.alert('Vitrinka recorder', `Session saved\n${done.board.url}`);
      })
      .catch((e) => Alert.alert('Vitrinka recorder', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusyAction(null));
  };

  const sendNote = () => {
    const text = note.trim();
    if (text) addNote(text);
    setNote('');
    setSheet(null);
  };

  // Routes where the host app owns competing UI can opt the idle puck out;
  // a live recording stays visible there.
  if (rec === null && (hideIdleGripOn?.includes(currentRoute.tabHost) ?? false)) return null;

  const view = { w: win.width, h: win.height };
  const spot = untuck(place);
  const dockStyle: ViewStyle =
    'tuck' in place
      ? { [place.tuck]: 0, top: rectOf(place, TAB, view, inset).y }
      : {
          [rowOf(spot) === 't' ? 'top' : 'bottom']: rowOf(spot) === 't' ? inset.top : inset.bottom,
          ...(colOf(spot) === 'c'
            ? { left: (win.width - size.w) / 2 }
            : { [colOf(spot) === 'l' ? 'left' : 'right']: colOf(spot) === 'l' ? inset.left : inset.right }),
          flexDirection: colOf(spot) === 'r' ? 'row-reverse' : 'row',
        };
  const translate = flight ?? pan;
  const aiDriven = rec?.driver === 'ai';

  let face: ReactNode;
  if ('tuck' in place) {
    face = (
      <Pressable
        onPress={() => moveTo({ spot: untuck(place) })}
        accessibilityRole="button"
        accessibilityLabel="Show recorder"
        style={[styles.tab, place.tuck === 'left' ? styles.tabLeft : styles.tabRight]}
        testID="vitrinka-recorder-tab"
      >
        <View style={[styles.tabLine, { backgroundColor: rec ? HEALTH_DOT[h.state] : FG2 }]} />
      </Pressable>
    );
  } else if (rec === null) {
    const unlinked = !vitrinkaLinked();
    face = (
      <Pressable
        onPress={unlinked ? beginLink : onStart}
        onLongPress={() => setSheet('menu')}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={unlinked ? 'Link recorder' : 'Start recording'}
        accessibilityHint="Long-press for more"
        accessibilityState={{ disabled: busy, busy: busyAction === 'start' }}
        accessibilityActions={[{ name: 'longpress', label: 'More' }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setSheet('menu')}
        hitSlop={6}
        style={[styles.glass, styles.puck]}
        testID="vitrinka-recorder-dot"
      >
        {busyAction === 'start' ? (
          <ActivityIndicator size="small" color={FG} />
        ) : (
          <View style={unlinked ? styles.ring : styles.ready} />
        )}
      </Pressable>
    );
  } else {
    const held = open || hold;
    const toggle = () => {
      ease();
      setOpen((o) => !o);
    };
    face = (
      <View style={[styles.glass, styles.bar, { flexDirection: colOf(spot) === 'r' ? 'row-reverse' : 'row' }]} testID="vitrinka-recorder-pill">
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={`Recorder controls, ${status.toLowerCase()}, ${fmt(elapsedOf(rec))}`}
          accessibilityState={{ expanded: held }}
          hitSlop={6}
          style={styles.handle}
          testID="vitrinka-recorder-mini"
        >
          <View
            style={[styles.dot, { backgroundColor: rec.paused && h.state === 'ok' ? FG2 : HEALTH_DOT[h.state] }]}
            testID={`vitrinka-recorder-health-${h.state}`}
          />
          {aiDriven && !held ? null : <Text style={styles.clock}>{fmt(elapsedOf(rec))}</Text>}
        </Pressable>
        {held ? (
          <View style={[styles.tray, { flexDirection: colOf(spot) === 'r' ? 'row-reverse' : 'row' }]} onTouchStart={() => !hold && touch()}>
            <View style={styles.sep} />
            <View style={styles.meta}>
              <Camera size={9} color={FG2} />
              <Text style={styles.metaText}>{rec.shots}</Text>
            </View>
            <View style={styles.meta} testID={`vitrinka-recorder-rail-health-${h.state}`}>
              {rec.dead ? (
                <Text style={[styles.metaText, { color: HEALTH_DOT.dead }]}>!</Text>
              ) : h.synced ? (
                <Check size={10} color="#4caf50" />
              ) : h.queued > 0 ? (
                <Text style={[styles.metaText, { color: HEALTH_DOT[h.state] }]} testID="vitrinka-recorder-queued">
                  ↑{h.queued > 999 ? '1k+' : h.queued}
                </Text>
              ) : null}
            </View>
            <TrayButton
              testID="vitrinka-recorder-pause"
              label={rec.paused ? 'Resume recording' : 'Pause recording'}
              onPress={() => void togglePause()}
              disabled={busy || rec.dead}
            >
              {rec.paused ? <Play size={15} color={FG} /> : <Pause size={15} color={FG} />}
            </TrayButton>
            <TrayButton testID="vitrinka-recorder-note" label="Add note" onPress={() => setSheet('note')} disabled={busy || rec.dead}>
              <Pencil size={15} color={FG} />
            </TrayButton>
            <TrayButton
              testID="vitrinka-recorder-annotate"
              label={annotateState.active ? 'Cancel annotation' : 'Annotate a region'}
              // Read LIVE state, never the render-captured value (a stale
              // closure turned ✕ into a no-op on the simulator).
              onPress={() => setAnnotating(!annotateState.active)}
              disabled={rec.paused || rec.dead || busy}
              active={annotateState.active}
            >
              {annotateState.active ? <X size={15} color="#fff" /> : <Scan size={15} color={REC} />}
            </TrayButton>
            <TrayButton testID="vitrinka-recorder-more" label="More" onPress={() => setSheet('menu')}>
              <More />
            </TrayButton>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        {...responder.panHandlers}
        onLayout={(e) => {
          const { x, y, width, height } = e.nativeEvent.layout;
          layout.current = { x, y, w: width, h: height };
          if ('spot' in place && (width !== size.w || height !== size.h)) setSize({ w: width, h: height });
        }}
        style={[styles.dock, dockStyle, { transform: translate.getTranslateTransform() }]}
      >
        {face}
      </Animated.View>
      {link || sheet ? (
        <KeyboardStickyView offset={{ closed: 0, opened: safe.bottom }} style={[styles.sheetDock, { paddingBottom: safe.bottom + 8 }]}>
          {link ? (
            <View style={styles.sheet} testID="vitrinka-recorder-link">
              <SheetHead title="Link recorder" onClose={closeLink} />
              {link.flow ? (
                <>
                  <Text style={styles.linkCode} testID="vitrinka-recorder-link-code">
                    {link.flow.start.user_code}
                  </Text>
                  <Pressable
                    onPress={() => void Linking.openURL(link.flow?.start.verifyUrl ?? '')}
                    accessibilityRole="link"
                    accessibilityLabel="Open vitrinka"
                    style={styles.primary}
                    testID="vitrinka-recorder-link-open"
                  >
                    <Text style={styles.primaryText}>Open vitrinka</Text>
                  </Pressable>
                </>
              ) : null}
              <View style={styles.linkRow}>
                <Text style={[styles.linkLine, link.phase === 'expired' || link.phase === 'error' ? styles.linkBad : null]}>
                  {link.phase === 'starting'
                    ? 'asking vitrinka for a code…'
                    : link.phase === 'waiting'
                      ? 'waiting for approval…'
                      : link.phase === 'expired'
                        ? 'code expired — try again'
                        : (link.error ?? 'could not start the link')}
                </Text>
                {link.phase === 'expired' || link.phase === 'error' ? (
                  <Pressable onPress={beginLink} accessibilityRole="button" accessibilityLabel="Try again" style={styles.secondary}>
                    <Text style={styles.secondaryText}>Try again</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : sheet === 'note' ? (
            <View style={styles.sheet}>
              <SheetHead title="Note" onClose={() => setSheet(null)} />
              <View style={styles.noteRow}>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="what's wrong / what to refine…"
                  placeholderTextColor={FG2}
                  style={styles.noteInput}
                  autoFocus
                  onSubmitEditing={sendNote}
                  returnKeyType="send"
                  testID="vitrinka-recorder-note-input"
                />
                <Pressable
                  onPress={sendNote}
                  accessibilityRole="button"
                  accessibilityLabel="Send note"
                  hitSlop={6}
                  style={styles.send}
                  testID="vitrinka-recorder-note-send"
                >
                  <Check size={15} color="#fff" />
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.sheet} testID="vitrinka-recorder-menu">
              <SheetHead title="Recorder" onClose={() => setSheet(null)} />
              {rec ? (
                <MenuRow testID="vitrinka-recorder-stop" label="Stop recording" onPress={onStop} spinning={busyAction === 'stop'} danger>
                  <Square size={13} color={REC} fill={REC} />
                </MenuRow>
              ) : null}
              {!hasEnvToken() && vitrinkaLinked() ? (
                <MenuRow testID="vitrinka-recorder-unlink" label="Unlink" onPress={onUnlink}>
                  <X size={13} color={FG2} />
                </MenuRow>
              ) : null}
              <View style={styles.moveRow} accessibilityRole="radiogroup" accessibilityLabel="Move to">
                <Text style={styles.moveLabel}>Move to</Text>
                <View style={styles.spots}>
                  {SPOTS.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => {
                        setSheet(null);
                        moveTo({ spot: s });
                      }}
                      accessibilityRole="radio"
                      accessibilityLabel={`Move to ${SPOT_NAMES[s]}`}
                      accessibilityState={{ checked: 'spot' in place && place.spot === s }}
                      style={styles.spotCell}
                      testID={`vitrinka-recorder-move-${s}`}
                    >
                      <View style={[styles.spotMark, 'spot' in place && place.spot === s ? styles.spotOn : null]} />
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          )}
        </KeyboardStickyView>
      ) : null}
    </View>
  );
}

function TrayButton({
  testID,
  label,
  onPress,
  disabled,
  active,
  children,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(active) }}
      hitSlop={6}
      style={[styles.trayBtn, active ? styles.trayBtnOn : null, disabled ? styles.dimmed : null]}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={styles.sheetHead}>
      <View style={styles.titleRow}>
        <View style={styles.titleBar} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
        <X size={14} color={FG2} />
      </Pressable>
    </View>
  );
}

function MenuRow({
  testID,
  label,
  onPress,
  spinning,
  danger,
  children,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  spinning?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={spinning}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: Boolean(spinning) }}
      style={styles.menuRow}
      testID={testID}
    >
      {spinning ? <ActivityIndicator size="small" color={FG} /> : children}
      <Text style={[styles.menuText, danger ? { color: REC } : null]}>{label}</Text>
    </Pressable>
  );
}

/** ⋯ drawn with Views, like the rest of ./icons. */
function More() {
  return (
    <View style={styles.more}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.moreDot} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', zIndex: 9999, alignItems: 'center' },
  glass: {
    backgroundColor: INK,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: EDGE,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  puck: { width: H, height: H, borderRadius: H / 2, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 11, height: 11, borderRadius: 6, borderWidth: 1.5, borderColor: FG2 },
  ready: { width: 11, height: 11, borderRadius: 6, backgroundColor: FG2 },
  bar: { height: H, borderRadius: H / 2, alignItems: 'center', paddingHorizontal: 2 },
  handle: { height: H, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  clock: { color: FG, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 36 },
  tray: { alignItems: 'center', gap: 2, paddingHorizontal: 2 },
  sep: { width: StyleSheet.hairlineWidth, height: 14, backgroundColor: EDGE, marginHorizontal: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 18, justifyContent: 'center' },
  metaText: { color: FG2, fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  trayBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  trayBtnOn: { backgroundColor: REC },
  dimmed: { opacity: 0.35 },
  more: { flexDirection: 'row', gap: 2.5 },
  moreDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: FG },
  tab: { width: TAB.w, height: TAB.h },
  tabLeft: { alignItems: 'flex-start' },
  tabRight: { alignItems: 'flex-end' },
  tabLine: { width: 6, height: TAB.h, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: EDGE },
  sheetDock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 8, zIndex: 10000 },
  sheet: { backgroundColor: INK, borderRadius: 18, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: EDGE, gap: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  titleBar: { width: 3, height: 11, borderRadius: 1, backgroundColor: REC },
  title: { color: FG, fontSize: 13, fontWeight: '600' },
  linkCode: { color: FG, fontSize: 24, fontWeight: '700', letterSpacing: 2, fontVariant: ['tabular-nums'] },
  primary: { alignSelf: 'flex-start', backgroundColor: REC, borderRadius: 9, paddingHorizontal: 14, height: 36, justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkLine: { color: FG2, fontSize: 12, flexShrink: 1 },
  linkBad: { color: '#f0a63a' },
  secondary: { borderWidth: StyleSheet.hairlineWidth, borderColor: EDGE, borderRadius: 8, paddingHorizontal: 10, height: 30, justifyContent: 'center' },
  secondaryText: { color: FG, fontWeight: '600', fontSize: 12 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteInput: { flex: 1, color: FG, fontSize: 16, backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  send: { width: 40, height: 40, borderRadius: 10, backgroundColor: REC, alignItems: 'center', justifyContent: 'center' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44 },
  menuText: { color: FG, fontSize: 15 },
  moveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: EDGE, paddingTop: 10 },
  moveLabel: { color: FG2, fontSize: 14 },
  spots: { width: 3 * 44, flexDirection: 'row', flexWrap: 'wrap' },
  spotCell: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' },
  spotMark: { width: 26, height: 16, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: EDGE },
  spotOn: { backgroundColor: REC, borderColor: REC },
});
