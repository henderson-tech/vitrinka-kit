/**
 * Floating recorder HUD — a slim VERTICAL icon rail docked to the right
 * screen edge. Three states:
 *
 *   grip      — idle, 6pt sliver on the edge; tap opens the rail
 *   rail      — full icon column (rec OR clock/pause/note/stop, ×)
 *   mini tab  — DEFAULT while recording (2026-07-25 feedback: controls are
 *               intrusive during a test run): only the timer and the number
 *               of frames captured, fixed-size slots so nothing jumps or
 *               flickers. Tap to reopen the full rail; × returns here.
 *
 * The docked shapes blend into the screen edge with concave fillets
 * ("inverse rounded border", plain-View border trick) above and below the
 * body. All glyphs are the hand-rolled Views in ./icons — this HUD has no
 * drawing dependency.
 *
 * Transition rules: pause/resume is optimistic (icon swaps in place, no
 * loading state); start/stop spin inside the pressed button while the rest
 * stays mounted; layout changes ease via LayoutAnimation.
 *
 * Dev-only tooling — plain inline styles and untranslated strings (never
 * ships; the i18n law covers product UI).
 */

import { type ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { hasEnvToken, vitrinkaLinked } from '../api';
import { type DeviceLink, forgetLink, linkDevice, LinkExpired } from '../link';
import { getState, health, type RecorderHealthState } from '../queue';
import { addNote, elapsedOf, startSession, stopSession, subscribe, togglePause } from '../session';
import { annotateState, currentRoute, setAnnotating } from '../state';
import { Camera, Check, Circle, ConcaveFillet, Pause, Pencil, Play, Scan, Square, X } from './icons';

const BG = 'rgba(20,20,20,0.88)';
const FILLET = 10;

/**
 * Honest dot per health state (extension D4): ok stays the recording red;
 * anything else recolors the dot the tester is already watching. Paused wins
 * only over ok — an offline/dead recording must not hide behind the amber.
 */
const HEALTH_DOT: Record<RecorderHealthState, string> = {
  idle: '#ff3b57',
  ok: '#ff3b57',
  backlog: '#ff8800',
  offline: '#8a93a0',
  dead: '#7a1f1a',
};

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function ease(): void {
  LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
}

/**
 * Concave quarter fillet blending the dock body into the screen edge (drawn
 * with plain Views — see ./icons). `box-none` on the wrapper does not cover
 * children, so the fillet is pointer-transparent itself.
 */
function Fillet({ flip }: { flip?: boolean }) {
  return <ConcaveFillet size={FILLET} color={BG} flip={flip} style={styles.filletSvg} />;
}

/** Edge-docked container: fillet above, body, fillet below. */
function EdgeDock({
  children,
  testID,
  onPress,
  label,
  wide,
  disabled,
}: {
  children: ReactNode;
  testID: string;
  onPress?: () => void;
  label?: string;
  /** 40pt body (open-rail metric, decision #8); default stays the 34pt mini width. */
  wide?: boolean;
  /** Real disabled semantics — blocks the press AND tells assistive tech. */
  disabled?: boolean;
}) {
  const body = (
    <View style={[styles.dockBody, wide ? styles.dockBodyWide : null]} testID={testID}>
      {children}
    </View>
  );
  return (
    <View style={styles.dockCol} pointerEvents="box-none">
      <Fillet />
      {onPress ? (
        <Pressable
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: Boolean(disabled) }}
          hitSlop={{ top: 8, bottom: 8, left: 10, right: 0 }}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
      <Fillet flip />
    </View>
  );
}

/**
 * Permanent annotate chip above the dock (by design): visible in BOTH live
 * states so annotating never costs an open-rail tap first. Flips ⌖ → ✕ while
 * annotate mode is on — the ✕ is the mode's only exit (by design). Disabled
 * while paused (pushEvent drops events when paused; the chip must not lie).
 */
function AnnotateChip({ wide, disabled }: { wide?: boolean; disabled?: boolean }) {
  const active = annotateState.active;
  return (
    <EdgeDock
      testID="vitrinka-recorder-annotate"
      wide={wide}
      disabled={disabled}
      label={active ? 'Cancel annotation' : 'Annotate a region'}
      onPress={() => {
        // Read LIVE state, never the render-captured value: a press must
        // toggle relative to what annotate mode IS, not what this closure
        // saw — a stale closure otherwise turns ✕ into a no-op (verified on
        // sim: the tap fired setAnnotating(true) while the mode was on).
        setAnnotating(!annotateState.active);
      }}
    >
      <View style={[styles.chipSlot, disabled ? styles.dimmed : null]}>
        {active ? <X size={17} color="#fff" /> : <Scan size={17} color="#ff3b57" />}
      </View>
    </EdgeDock>
  );
}

export function RecorderPill({ hideIdleGripOn }: { hideIdleGripOn?: readonly string[] } = {}) {
  const [, setTick] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busyAction, setBusyAction] = useState<'start' | 'stop' | null>(null);

  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  const rec = getState();
  // Dead is not "recording": the clock is frozen and capture refuses, so the
  // 1s tick below must not keep re-rendering a corpse.
  const recording = rec !== null && !rec.paused && !rec.dead;
  const busy = busyAction !== null;

  // Routes where the host app owns competing right-edge UI can opt the idle
  // grip out entirely (its invisible hit target is deliberately wide, so a
  // host control at the same edge would become untappable). A live recording
  // still stays visible if navigation lands on one of these routes. The
  // current pathname comes from module route state (fed by the provider's
  // `route` prop), which notifies the subscribe() channel this component
  // already re-renders off.
  const hideIdleGrip = rec === null && (hideIdleGripOn?.includes(currentRoute.tabHost) ?? false);
  // Recomputed every render: the 1s timer tick below doubles as the health
  // refresh, so offline/backlog/synced stay current without extra wiring.
  const h = health();

  // Tick the timer while it is visible (mini tab or open rail). Kept alive
  // while paused-with-a-backlog too, so the health dot/queue count stay honest
  // when the clock itself is frozen.
  const hasBacklog = rec !== null && h.queued > 0;
  useEffect(() => {
    if (!recording && !hasBacklog) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [recording, hasBacklog]);

  // Device link (@vitrinka/link): the code sheet above the rail. No QR on
  // native — RN Image renders SVG only with react-native-svg, which is not a
  // peer; the code + "Open vitrinka" cover the same-device path, and the
  // tester types the code in vitrinka on another device.
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
      .catch((e: unknown) =>
        setLink({ phase: 'error', flow: null, error: e instanceof Error ? e.message : String(e) }),
      );
  };
  const onUnlink = () => {
    closeLink();
    setNoteOpen(false);
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
      .then(() => {
        ease();
        setRailOpen(false); // auto-hide: recording shows only the mini tab
      })
      .catch((e) => Alert.alert('Vitrinka recorder', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusyAction(null));
  };

  const onStop = () => {
    if (busy) return;
    setBusyAction('stop');
    stopSession()
      .then((done) => {
        ease();
        setNoteOpen(false);
        setRailOpen(false);
        if (done?.board?.url) Alert.alert('Vitrinka recorder', `Session saved\n${done.board.url}`);
      })
      .catch((e) => Alert.alert('Vitrinka recorder', String(e instanceof Error ? e.message : e)))
      .finally(() => setBusyAction(null));
  };

  const onPause = () => {
    if (busy) return;
    void togglePause();
  };

  const sendNote = () => {
    const text = note.trim();
    if (text) addNote(text);
    setNote('');
    ease();
    setNoteOpen(false);
  };

  // --- collapsed states -----------------------------------------------------

  if (hideIdleGrip) return null;

  if (!railOpen && rec === null) {
    return (
      <Pressable
        onPress={() => {
          ease();
          setRailOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Open journey recorder"
        // 6pt sliver at the screen edge: slop widens it to ~44pt tappable
        // (right slop is wasted at the edge, so it all goes left).
        hitSlop={{ top: 8, bottom: 8, left: 38, right: 0 }}
        style={styles.grip}
        testID="vitrinka-recorder-dot"
      />
    );
  }

  if (!railOpen && rec !== null && rec.driver === 'ai') {
    // Machine-driven run (machine-run design): a quiet dot, not the mini tab.
    // Every keyframe of an agent's session is a candidate design-review image
    // and gets compared against `vitrinka snap` stills of the same screen, so
    // the HUD must not sit on the UI — but it must not vanish either, or there
    // is no visible proof a recording is live. The dot keeps the honest health
    // color and stays tappable, so a human can always take over and stop it.
    // The annotate chip is deliberately absent: its region marquee is a
    // human gesture, and an agent adds notes over the control channel.
    return (
      <Pressable
        onPress={() => {
          ease();
          setRailOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Recorder running under AI control — ${fmt(elapsedOf(rec))}, ${rec.shots} frames. Open controls`}
        hitSlop={{ top: 10, bottom: 10, left: 38, right: 0 }}
        style={styles.aiDock}
        testID="vitrinka-recorder-ai-dot"
      >
        <View
          style={[styles.aiDot, { backgroundColor: HEALTH_DOT[h.state] }]}
          testID={`vitrinka-recorder-health-${h.state}`}
        />
      </Pressable>
    );
  }

  if (!railOpen && rec !== null) {
    // Mini tab: timer + frames, nothing else. Fixed-width slots — the text
    // can never reflow the tab, so there is no flicker while recording.
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.dockStack} pointerEvents="box-none">
          <AnnotateChip disabled={rec.paused || rec.dead} />
          <EdgeDock
            testID="vitrinka-recorder-mini"
            label={`Recorder ${rec.dead ? 'stopped by the server' : rec.paused ? 'paused' : 'recording'}${h.state === 'offline' ? ', offline — uploads retrying' : h.state === 'backlog' ? ', upload backlog' : ''} — ${fmt(elapsedOf(rec))}, ${rec.shots} frames${h.queued ? `, ${h.queued} queued` : ''}. Open controls`}
            onPress={() => {
              ease();
              setRailOpen(true);
            }}
          >
            <View style={styles.miniDotSlot}>
              <View
                style={[
                  styles.miniDot,
                  { backgroundColor: HEALTH_DOT[h.state] },
                  rec.paused && h.state === 'ok' ? styles.miniDotPaused : null,
                ]}
                testID={`vitrinka-recorder-health-${h.state}`}
              />
            </View>
            <Text style={styles.miniClock}>{fmt(elapsedOf(rec))}</Text>
            <View style={styles.miniFrames}>
              <Camera size={9} color="#9a9a9a" />
              <Text style={styles.miniFramesText}>{rec.shots}</Text>
            </View>
            {/* Fixed-height slot (no reflow): queue depth appears only while
                the server is behind — the mini tab's honest-backlog line. */}
            <View style={styles.miniFrames}>
              {h.queued > 0 ? (
                <Text
                  style={[styles.miniFramesText, { color: HEALTH_DOT[h.state] }]}
                  testID="vitrinka-recorder-queued"
                >
                  ↑{h.queued > 999 ? '1k+' : h.queued}
                </Text>
              ) : null}
            </View>
          </EdgeDock>
        </View>
      </View>
    );
  }

  // --- full rail ------------------------------------------------------------

  // Icon-only controls get an explicit role + label, and hitSlop widening the
  // ~29x34pt visual slot to the 44pt minimum without changing the layout
  //.
  const railBtn = (opts: {
    testID: string;
    label: string;
    onPress: () => void;
    icon: ReactNode;
    spinning?: boolean;
    disabled?: boolean;
  }) => (
    <Pressable
      onPress={opts.onPress}
      disabled={opts.spinning || opts.disabled}
      accessibilityRole="button"
      accessibilityLabel={opts.label}
      accessibilityState={{
        disabled: Boolean(opts.spinning || opts.disabled),
        busy: Boolean(opts.spinning),
      }}
      hitSlop={{ top: 8, bottom: 8, left: 10, right: 0 }}
      style={[styles.railBtn, opts.disabled && !opts.spinning ? styles.dimmed : null]}
      testID={opts.testID}
    >
      {opts.spinning ? <ActivityIndicator size="small" color="#fff" /> : opts.icon}
    </Pressable>
  );

  return (
    <View style={styles.wrap} pointerEvents="box-none" testID="vitrinka-recorder-pill">
      {link ? (
        <View style={styles.linkSheet} testID="vitrinka-recorder-link">
          <View style={styles.linkHead}>
            <Text style={styles.linkTitle}>LINK RECORDER</Text>
            <Pressable
              onPress={closeLink}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={14} color="#999" />
            </Pressable>
          </View>
          {link.flow ? (
            <>
              <Text style={styles.linkCode} testID="vitrinka-recorder-link-code">
                {link.flow.start.user_code}
              </Text>
              <Pressable
                onPress={() => void Linking.openURL(link.flow?.start.verifyUrl ?? '')}
                accessibilityRole="link"
                accessibilityLabel="Open vitrinka"
                style={styles.linkBtn}
                testID="vitrinka-recorder-link-open"
              >
                <Text style={styles.linkBtnText}>Open vitrinka</Text>
              </Pressable>
            </>
          ) : null}
          <View style={styles.linkRow}>
            <Text
              style={[
                styles.linkLine,
                link.phase === 'expired' || link.phase === 'error' ? styles.linkBad : null,
              ]}
            >
              {link.phase === 'starting'
                ? 'asking vitrinka for a code…'
                : link.phase === 'waiting'
                  ? 'waiting for approval…'
                  : link.phase === 'expired'
                    ? 'code expired — try again'
                    : (link.error ?? 'could not start the link')}
            </Text>
            {link.phase === 'expired' || link.phase === 'error' ? (
              <Pressable
                onPress={beginLink}
                accessibilityRole="button"
                accessibilityLabel="Try again"
                style={styles.linkRetry}
              >
                <Text style={styles.linkRetryText}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      {noteOpen ? (
        <View style={styles.noteRow}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Note…"
            placeholderTextColor="#999"
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
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            style={styles.railBtn}
            testID="vitrinka-recorder-note-send"
          >
            <Check size={15} color="#fff" />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.dockStack} pointerEvents="box-none">
        {rec !== null ? <AnnotateChip wide disabled={rec.paused || rec.dead || busy} /> : null}
        <EdgeDock testID="vitrinka-recorder-rail" wide>
          {rec === null && !vitrinkaLinked() ? (
            railBtn({
              testID: 'vitrinka-recorder-link-start',
              label: 'Link recorder',
              onPress: beginLink,
              icon: <Circle size={17} color="#ff3b57" />,
            })
          ) : rec === null ? (
            <>
              {railBtn({
                testID: 'vitrinka-recorder-rec',
                label: 'Start recording',
                onPress: onStart,
                icon: <Circle size={17} color="#ff3b57" fill="#ff3b57" />,
                spinning: busyAction === 'start',
              })}
              {!hasEnvToken()
                ? railBtn({
                    testID: 'vitrinka-recorder-unlink',
                    label: 'Unlink recorder',
                    onPress: onUnlink,
                    icon: <X size={15} color="#999" />,
                  })
                : null}
            </>
          ) : (
            <>
              <Text style={styles.clock}>{fmt(elapsedOf(rec))}</Text>
              <View style={styles.miniFrames}>
                <Camera size={9} color="#9a9a9a" />
                <Text style={styles.miniFramesText}>{rec.shots}</Text>
              </View>
              {/* Server-truth line (extension D4): ✓ = the server confirmed it
                  holds every allocated seq; ↑N = it is still owed N items;
                  ! = it refused the session. Nothing while the verdict is
                  simply unknown (first 10s, reconcile unreachable). */}
              <View style={styles.miniFrames} testID={`vitrinka-recorder-rail-health-${h.state}`}>
                {rec.dead ? (
                  <Text style={[styles.miniFramesText, { color: HEALTH_DOT.dead }]}>!</Text>
                ) : h.synced ? (
                  <Check size={10} color="#4caf50" />
                ) : h.queued > 0 ? (
                  <Text style={[styles.miniFramesText, { color: HEALTH_DOT[h.state] }]}>
                    ↑{h.queued > 999 ? '1k+' : h.queued}
                  </Text>
                ) : null}
              </View>
              {railBtn({
                testID: 'vitrinka-recorder-pause',
                label: rec.paused ? 'Resume recording' : 'Pause recording',
                onPress: onPause,
                icon: rec.paused ? (
                  <Play size={17} color="#fff" />
                ) : (
                  <Pause size={17} color="#fff" />
                ),
                disabled: busy || rec.dead,
              })}
              {railBtn({
                testID: 'vitrinka-recorder-note',
                label: 'Add note',
                onPress: () => {
                  ease();
                  setNoteOpen((v) => !v);
                },
                icon: <Pencil size={17} color="#fff" />,
                disabled: busy || rec.dead,
              })}
              {railBtn({
                testID: 'vitrinka-recorder-stop',
                label: 'Stop recording',
                onPress: onStop,
                icon: <Square size={15} color="#ff3b57" fill="#ff3b57" />,
                spinning: busyAction === 'stop',
              })}
            </>
          )}
          {railBtn({
            testID: 'vitrinka-recorder-collapse',
            label: 'Minimize recorder',
            onPress: () => {
              ease();
              setRailOpen(false); // rec != null → mini tab; else grip
              setNoteOpen(false);
            },
            icon: <X size={16} color="#888" />,
            disabled: busy,
          })}
        </EdgeDock>
      </View>
    </View>
  );
}

const RAIL_TOP = '38%';

const styles = StyleSheet.create({
  grip: {
    position: 'absolute',
    right: 0,
    top: RAIL_TOP,
    width: 6,
    height: 46,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
    backgroundColor: 'rgba(30,30,30,0.35)',
    zIndex: 9999,
  },
  wrap: {
    position: 'absolute',
    right: 0,
    top: RAIL_TOP,
    flexDirection: 'row',
    alignItems: 'flex-start',
    zIndex: 9999,
  },
  // AI-driven session: smallest honest presence. Same edge dock as the grip so
  // it reads as recorder chrome, sized to stay out of a review screenshot.
  aiDock: {
    position: 'absolute',
    right: 0,
    top: RAIL_TOP,
    width: 12,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 5,
    borderBottomLeftRadius: 5,
    backgroundColor: 'rgba(20,20,20,0.55)',
    zIndex: 9999,
  },
  aiDot: { width: 5, height: 5, borderRadius: 2.5 },
  dockCol: { alignItems: 'flex-end' },
  dockStack: { alignItems: 'flex-end', gap: 8 },
  filletSvg: { marginVertical: -0.5 },
  dockBody: {
    alignItems: 'center',
    backgroundColor: BG,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    paddingVertical: 6,
    width: 34,
  },
  // Open-rail metric (by design): real 40pt-wide targets, mini tab stays 34.
  dockBodyWide: { width: 40 },
  chipSlot: {
    width: 34,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railBtn: {
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    minHeight: 34,
  },
  dimmed: { opacity: 0.4 },
  linkSheet: {
    width: 260,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#1d1a1b',
    borderWidth: 1,
    borderColor: '#292526',
    marginBottom: 8,
    alignSelf: 'flex-end',
  },
  linkHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  linkTitle: { color: '#756e68', fontSize: 9.5, fontWeight: '700', letterSpacing: 1.6 },
  linkCode: {
    color: '#f0eae4',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    marginTop: 12,
    fontVariant: ['tabular-nums'],
  },
  linkBtn: {
    marginTop: 12,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#ff3b57',
  },
  linkBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  linkLine: { color: '#756e68', fontSize: 10, flex: 1 },
  linkBad: { color: '#ff3b57' },
  linkRetry: {
    borderWidth: 1,
    borderColor: '#363132',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  linkRetryText: { color: '#a8a099', fontSize: 10, fontWeight: '600' },
  clock: {
    color: '#fff',
    fontSize: 9,
    fontVariant: ['tabular-nums'],
    width: 40,
    textAlign: 'center',
    marginBottom: 1,
  },
  miniDotSlot: { height: 10, justifyContent: 'center' },
  miniDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ff3b57' },
  miniDotPaused: { backgroundColor: '#ffaa00' },
  miniClock: {
    color: '#fff',
    fontSize: 9,
    fontVariant: ['tabular-nums'],
    width: 34,
    textAlign: 'center',
    marginTop: 2,
  },
  miniFrames: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 14,
    gap: 2,
  },
  miniFramesText: {
    color: '#9a9a9a',
    fontSize: 9,
    fontVariant: ['tabular-nums'],
    minWidth: 12,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderRadius: 12,
    marginRight: 4,
    paddingHorizontal: 10,
    maxWidth: 240,
  },
  noteInput: {
    width: 170,
    color: '#fff',
    fontSize: 13,
    paddingVertical: 8,
  },
});
