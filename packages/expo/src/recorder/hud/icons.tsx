/**
 * Hand-rolled HUD icons — plain Views, no icon font, no react-native-svg.
 *
 * The recorder deliberately draws its ~10 tiny glyphs (9–17pt) itself so the
 * package needs NO drawing dependency: react-native-svg and an icon library
 * would each be one more (native) peer every consuming app must install for a
 * handful of shapes. Geometry is border/radius/rotation tricks; at HUD sizes
 * the geometric look reads as a style. Each component mirrors the icon-library
 * call shape it replaced: `size`, `color`, and (where used) `fill`.
 */
import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

interface IconProps {
  size: number;
  color: string;
  fill?: string;
}

/** Fixed-size centering box every glyph draws inside. */
function Box({ size, children }: { size: number; children: ReactNode }) {
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
}

/** Filled stop square. */
export function Square({ size, color, fill }: IconProps) {
  const d = size * 0.78;
  return (
    <Box size={size}>
      <View
        style={{
          width: d,
          height: d,
          borderRadius: size * 0.14,
          backgroundColor: fill ?? 'transparent',
          borderWidth: fill ? 0 : 1.5,
          borderColor: color,
        }}
      />
    </Box>
  );
}

export function Pause({ size, color }: IconProps) {
  const bar: ViewStyle = {
    width: Math.max(2, size * 0.2),
    height: size * 0.72,
    borderRadius: 1,
    backgroundColor: color,
  };
  return (
    <Box size={size}>
      <View style={{ flexDirection: 'row', gap: size * 0.22 }}>
        <View style={bar} />
        <View style={bar} />
      </View>
    </Box>
  );
}

/** Play triangle — the border trick; crisp enough at rail sizes. */
export function Play({ size, color }: IconProps) {
  return (
    <Box size={size}>
      <View
        style={{
          marginLeft: size * 0.12,
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.68,
          borderTopWidth: size * 0.42,
          borderBottomWidth: size * 0.42,
          borderLeftColor: color,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
        }}
      />
    </Box>
  );
}

export function X({ size, color }: IconProps) {
  const len = size * 0.9;
  const bar: ViewStyle = {
    position: 'absolute',
    width: len,
    height: 2,
    borderRadius: 1,
    backgroundColor: color,
  };
  return (
    <Box size={size}>
      <View style={[bar, { transform: [{ rotate: '45deg' }] }]} />
      <View style={[bar, { transform: [{ rotate: '-45deg' }] }]} />
    </Box>
  );
}

/** Check mark — an L of two borders, rotated. */
export function Check({ size, color }: IconProps) {
  const w = Math.max(1.5, size * 0.14);
  return (
    <Box size={size}>
      <View
        style={{
          width: size * 0.7,
          height: size * 0.38,
          borderLeftWidth: w,
          borderBottomWidth: w,
          borderColor: color,
          transform: [{ rotate: '-45deg' }, { translateX: size * 0.04 }],
        }}
      />
    </Box>
  );
}

/** Viewfinder brackets + center dot (icon-lib Scan). */
export function Scan({ size, color }: IconProps) {
  const arm = size * 0.3;
  const w = Math.max(1.5, size * 0.11);
  const r = size * 0.16;
  const corner = (pos: ViewStyle, borders: ViewStyle): ReactNode => (
    <View style={[{ position: 'absolute', width: arm, height: arm, borderColor: color }, pos, borders]} />
  );
  return (
    <Box size={size}>
      <View style={{ width: size * 0.94, height: size * 0.94 }}>
        {corner({ top: 0, left: 0 }, { borderTopWidth: w, borderLeftWidth: w, borderTopLeftRadius: r })}
        {corner({ top: 0, right: 0 }, { borderTopWidth: w, borderRightWidth: w, borderTopRightRadius: r })}
        {corner({ bottom: 0, left: 0 }, { borderBottomWidth: w, borderLeftWidth: w, borderBottomLeftRadius: r })}
        {corner({ bottom: 0, right: 0 }, { borderBottomWidth: w, borderRightWidth: w, borderBottomRightRadius: r })}
      </View>
    </Box>
  );
}

/** Camera — outline body + lens; legible down to the 9pt mini indicator. */
export function Camera({ size, color }: IconProps) {
  const w = Math.max(1, size * 0.12);
  const bodyH = size * 0.68;
  const lens = size * 0.34;
  return (
    <Box size={size}>
      {/* Viewfinder bump sits behind the body's top edge. */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.08,
          width: size * 0.34,
          height: size * 0.24,
          borderTopLeftRadius: 1,
          borderTopRightRadius: 1,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          marginTop: size * 0.18,
          width: size * 0.92,
          height: bodyH,
          borderRadius: size * 0.16,
          borderWidth: w,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: lens,
            height: lens,
            borderRadius: lens / 2,
            borderWidth: w,
            borderColor: color,
          }}
        />
      </View>
    </Box>
  );
}

/** Pencil — filled diagonal barrel + tip triangle. */
export function Pencil({ size, color }: IconProps) {
  const t = size * 0.26;
  return (
    <Box size={size}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          transform: [{ rotate: '-45deg' }],
        }}
      >
        {/* Tip */}
        <View
          style={{
            width: 0,
            height: 0,
            borderTopWidth: t / 2,
            borderBottomWidth: t / 2,
            borderRightWidth: t * 0.9,
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            borderRightColor: color,
          }}
        />
        {/* Barrel with the eraser notch as a lighter cap */}
        <View style={{ width: size * 0.62, height: t, backgroundColor: color }} />
        <View style={{ width: size * 0.1, height: t, backgroundColor: color, opacity: 0.5, borderTopRightRadius: 1.5, borderBottomRightRadius: 1.5 }} />
      </View>
    </Box>
  );
}
