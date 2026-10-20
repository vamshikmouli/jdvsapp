import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { LinearGradient as ExpoGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, G, F } from '@/theme';
import { Badge, TONE_GRAD } from '@/lib/game';

let _uid = 0;
const nextId = () => `g${++_uid}`;

/** Circular progress ring with a gradient stroke and optional center content. */
export function ProgressRing({
  size = 64,
  stroke = 7,
  pct,
  colors = G.violetGold,
  track = 'rgba(124,58,237,0.14)',
  children,
}: {
  size?: number;
  stroke?: number;
  pct: number;
  colors?: readonly [string, string];
  track?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const off = circ * (1 - clamped / 100);
  const id = React.useRef(nextId()).current;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors[0]} />
            <Stop offset="1" stopColor={colors[1]} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children != null && (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>{children}</View>
      )}
    </View>
  );
}

/** Avatar disc (initials) wrapped in a level progress ring. */
export function LevelAvatar({ initials, pct, colors, size = 64 }: { initials: string; pct: number; colors?: readonly [string, string]; size?: number }) {
  const inset = Math.round(size * 0.12);
  return (
    <View style={{ width: size, height: size }}>
      <ProgressRing size={size} stroke={6} pct={pct} colors={colors ?? G.violetGold} track="rgba(124,58,237,0.15)" />
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <ExpoGradient
          colors={G.heroGlow}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: size - inset * 2, height: size - inset * 2, borderRadius: size, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: F.fred, color: '#fff', fontSize: size * 0.3 }}>{initials}</Text>
        </ExpoGradient>
      </View>
    </View>
  );
}

/** Gradient XP / progress bar. */
export function XPBar({ progress, height = 8, colors = G.violetGold, track = 'rgba(124,58,237,0.14)' }: { progress: number; height?: number; colors?: readonly [string, string]; track?: string }) {
  return (
    <View style={{ height, borderRadius: 99, backgroundColor: track, overflow: 'hidden' }}>
      <ExpoGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: '100%', width: `${Math.max(3, Math.min(100, progress * 100))}%`, borderRadius: 99 }} />
    </View>
  );
}

/** Night-sky gradient header with stars + a soft gold glow. Adds safe-area top pad. */
export function NightHeader({ children, style, colors = G.hero, glow = true, safeTop = true }: { children: React.ReactNode; style?: ViewStyle; colors?: readonly string[]; glow?: boolean; safeTop?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <ExpoGradient colors={colors as any} start={{ x: 0.85, y: 0 }} end={{ x: 0.1, y: 1 }} style={[{ paddingTop: safeTop ? insets.top + 8 : 14, overflow: 'hidden' }, style]}>
      {glow && <View pointerEvents="none" style={{ position: 'absolute', width: 230, height: 230, right: -50, top: -100, borderRadius: 200, backgroundColor: C.goldGlow, opacity: 0.22 }} />}
      <Stars />
      {children}
    </ExpoGradient>
  );
}

const STAR_POS = [
  { top: 14, left: '18%', o: 0.7 }, { top: 30, left: '62%', o: 0.5 }, { top: 22, left: '86%', o: 0.6 },
  { top: 54, left: '40%', o: 0.4 }, { top: 66, left: '74%', o: 0.5 }, { top: 44, left: '9%', o: 0.5 },
] as const;
export function Stars() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {STAR_POS.map((s, i) => (
        <View key={i} style={{ position: 'absolute', top: s.top, left: s.left as any, width: 3, height: 3, borderRadius: 3, backgroundColor: '#fff', opacity: s.o }} />
      ))}
    </View>
  );
}

/** Badge medallion — earned (gradient disc) or locked (greyed). */
export function Medal({ badge, size = 64 }: { badge: Badge; size?: number }) {
  const grad = TONE_GRAD[badge.tone];
  return (
    <View style={{ alignItems: 'center', width: size + 20 }}>
      {badge.earned ? (
        <ExpoGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.disc, { width: size, height: size, borderRadius: size * 0.34 }]}>
          <Text style={{ fontSize: size * 0.45 }}>{badge.emoji}</Text>
        </ExpoGradient>
      ) : (
        <View style={[styles.disc, { width: size, height: size, borderRadius: size * 0.34, backgroundColor: C.line }]}>
          <Text style={{ fontSize: size * 0.4, opacity: 0.55 }}>🔒</Text>
        </View>
      )}
      <Text numberOfLines={1} style={{ fontFamily: F.jakB, fontSize: 11, color: C.inkSoft, marginTop: 7, textAlign: 'center' }}>{badge.name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#341e6e',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
});
