/**
 * Region-annotate overlay — the mobile port of the extension's ⌖ snap flow
 * (vitrinka apps/extension/content.js V1/V2, minus element-pick):
 *
 *   chip tap → dim + hint, drag surface claims every touch
 *   drag ≥ 6pt → marquee; release → keyframe frozen IMMEDIATELY (captureHeldShot)
 *   sticky-bottom composer above the keyboard → send → annotate-note + held shot
 *   tap-no-drag → nothing (the ✕ chip is the only exit)
 *
 * Mounted as a sibling BEFORE RecorderPill (see index.tsx): inside the capture
 * root — so the marquee/dim are IN the frozen frame (decision #5, "as-is") —
 * and under KeyboardProvider, which KeyboardStickyView needs. The pill renders
 * after it, so the annotate chip (flipped to ✕) stays tappable above the dim.
 *
 * Dev-only tooling — plain inline styles and untranslated strings (never
 * ships; the i18n law covers product UI).
 */
import { useEffect, useRef, useState } from 'react';
import { type GestureResponderEvent, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { eventRoute } from '../capture/redact';
import { captureHeldShot, type HeldShot } from '../capture/shot';
import { getState } from '../queue';
import { addAnnotation, cornersToRect, type ViewRect } from '../session';
import { annotateState, setAnnotating, subscribe } from '../state';

const ACCENT = '#ff3b57';
const DRAG_THRESHOLD = 6;
const MIN_REGION = 4;

export function AnnotateOverlay() {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);

  const [rect, setRect] = useState<ViewRect | null>(null);
  const [held, setHeld] = useState<HeldShot | null>(null);
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState(false);
  // Surface stays inert while a captureHeldShot is in flight — a second
  // drag-release during the ~100ms capture would start a second capture whose
  // handle overwrites (and leaks) the first.
  const [capturing, setCapturing] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const heldRef = useRef<HeldShot | null>(null);
  heldRef.current = held;
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Identifies THIS annotate-mode instance: bumped on every deactivation, so
  // a capture that settles after ✕ + fast re-enter can't install its stale
  // HeldShot into the NEW mode (annotateState.active alone can't tell them
  // apart).
  const modeTokenRef = useRef(0);

  const rec = getState();
  const active = annotateState.active && rec !== null && !rec.paused;

  // Deactivation (✕ chip, session stop, pause) discards an uncommitted frame
  // and resets — the overlay must come back clean next time. A pause/stop that
  // ended the overlay also clears the mode flag, or the chip stays stuck on ✕.
  useEffect(() => {
    if (active) return;
    modeTokenRef.current++;
    if (annotateState.active) setAnnotating(false);
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    heldRef.current?.discard();
    setHeld(null);
    setRect(null);
    setNote('');
    setFlash(false);
    setCapturing(false);
    startRef.current = null;
  }, [active]);

  if (!active) return null;

  const composing = held !== null;

  const onGrant = (e: GestureResponderEvent) => {
    startRef.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  };
  const onMove = (e: GestureResponderEvent) => {
    const start = startRef.current;
    if (!start) return;
    const r = cornersToRect(start.x, start.y, e.nativeEvent.pageX, e.nativeEvent.pageY);
    if (rect || Math.hypot(r.w, r.h) > DRAG_THRESHOLD) setRect(r);
  };
  const onRelease = (e: GestureResponderEvent) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || capturing) return;
    // Derive the FINAL rect from the release event, never from marquee state:
    // the last onResponderMove's setRect may not have rendered yet, so `rect`
    // can lag a sample (or still be null on a fast drag) — the selection must
    // be pixel-exact to what the finger released at.
    const r = cornersToRect(start.x, start.y, e.nativeEvent.pageX, e.nativeEvent.pageY);
    // Tap / sub-threshold drag: nothing happens — mode exits only via the ✕ chip.
    if (r.w < MIN_REGION || r.h < MIN_REGION) {
      setRect(null);
      return;
    }
    // Paint the true final marquee, then freeze the frame (by design) —
    // captureHeldShot waits a frame, so the frozen pixels show THIS rect.
    setRect(r);
    setCapturing(true);
    const token = modeTokenRef.current;
    void captureHeldShot().then(
      (h) => {
        // Mode instance ended while the capture settled (✕ mid-capture, even
        // with an instant re-enter) — this result belongs to a dead mode.
        if (token !== modeTokenRef.current) {
          h?.discard();
          return;
        }
        setCapturing(false);
        if (!h) {
          setRect(null);
          return;
        }
        setHeld(h);
      },
      () => {
        // captureHeldShot catches internally today, but a rejection must
        // never leave the surface stuck inert.
        if (token === modeTokenRef.current) setCapturing(false);
      },
    );
  };

  const onSend = () => {
    if (!held || !rect) return;
    addAnnotation(note.trim(), rect, held);
    setHeld(null);
    setNote('');
    setFlash(true);
    // Brief flash, then out. Kept cancellable: the deactivation cleanup clears
    // it so a stop/✕ inside the window doesn't leave a timer on module state.
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      setAnnotating(false);
    }, 300);
  };

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="auto"
      // Keep VoiceOver focus inside the overlay while the app underneath is
      // dimmed and touch-blocked (iOS; Android would need markers on the app
      // root itself, which a self-contained dev overlay can't reach).
      accessibilityViewIsModal
      testID="vitrinka-annotate-overlay"
    >
      {/* Drag surface: claims every touch so the app underneath receives nothing. */}
      <View
        style={[StyleSheet.absoluteFill, styles.dim]}
        pointerEvents={composing || flash || capturing ? 'none' : 'auto'}
        onStartShouldSetResponder={() => true}
        onResponderGrant={onGrant}
        onResponderMove={onMove}
        onResponderRelease={onRelease}
        onResponderTerminate={() => {
          startRef.current = null;
          setRect(null);
        }}
        testID="vitrinka-annotate-surface"
      />
      {rect ? (
        <View
          pointerEvents="none"
          style={[
            styles.marquee,
            flash ? styles.marqueeFlash : null,
            { left: rect.x, top: rect.y, width: rect.w, height: rect.h },
          ]}
          testID="vitrinka-annotate-marquee"
        />
      ) : null}
      {!composing && !flash ? <HintPill /> : null}
      {composing ? (
        <Composer
          context={`⌖ ${Math.round(rect?.w ?? 0)}×${Math.round(rect?.h ?? 0)} · ${eventRoute().tabHost}`}
          note={note}
          onChangeNote={setNote}
          onSend={onSend}
        />
      ) : null}
    </View>
  );
}

function HintPill() {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[styles.hint, { top: insets.top + 10 }]}>
      <Text style={styles.hintText}>⌖ drag an area to annotate</Text>
    </View>
  );
}

function Composer({
  context,
  note,
  onChangeNote,
  onSend,
}: {
  context: string;
  note: string;
  onChangeNote: (v: string) => void;
  onSend: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }} style={styles.composerDock}>
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Text style={styles.ctx} numberOfLines={1}>
          {context}
        </Text>
        <View style={styles.inputRow}>
          <TextInput
            value={note}
            onChangeText={onChangeNote}
            placeholder="what's wrong / what to refine…"
            placeholderTextColor="#756e68"
            style={styles.input}
            autoFocus
            multiline
            testID="vitrinka-annotate-input"
          />
          <Pressable
            onPress={onSend}
            accessibilityRole="button"
            accessibilityLabel="Send annotation"
            hitSlop={8}
            style={styles.sendBtn}
            testID="vitrinka-annotate-send"
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(0,0,0,0.22)' },
  marquee: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: ACCENT,
    borderRadius: 6,
    backgroundColor: 'rgba(255,59,87,0.08)',
  },
  marqueeFlash: {
    borderColor: '#fff',
    backgroundColor: 'rgba(255,59,87,0.25)',
  },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#1d1a1b',
    borderWidth: 1,
    borderColor: ACCENT,
  },
  hintText: { color: '#f0eae4', fontSize: 12, fontWeight: '600' },
  composerDock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  composer: {
    backgroundColor: '#1d1a1b',
    borderTopWidth: 1,
    borderColor: '#292526',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  ctx: {
    color: '#756e68',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    marginBottom: 6,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: {
    flex: 1,
    color: '#f0eae4',
    fontSize: 14,
    maxHeight: 96,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#141213',
    borderWidth: 1,
    borderColor: '#363132',
    borderRadius: 10,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
