import React from 'react';
import {
  View, Text, Pressable, StyleSheet, ViewStyle, TextStyle,
  ActivityIndicator, ScrollView, RefreshControl, TextInput, TextInputProps,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bell } from 'lucide-react-native';
import { C, G, S, R, E, T, type } from '@/theme';
import { NightHeader } from './Kit';
import { initials } from '@/lib/format';

/**
 * Shared UI primitives for the parent app — the "bold & modern" design system.
 * Every screen composes these so spacing, radius, elevation and type stay
 * consistent. Prefer these over ad-hoc <View>/<Text> styling.
 */

// ── Text ────────────────────────────────────────────────────────────────
type Variant = keyof typeof T;
export function Txt({
  variant = 'body', color = C.ink, style, children, numberOfLines, center,
}: {
  variant?: Variant; color?: string; style?: TextStyle | TextStyle[];
  children: React.ReactNode; numberOfLines?: number; center?: boolean;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[type(variant, color), center && { textAlign: 'center' }, style as any]}>
      {children}
    </Text>
  );
}

/** Uppercase tracked eyebrow label. */
export function Label({ children, color = C.inkMut, style }: { children: React.ReactNode; color?: string; style?: TextStyle }) {
  return <Text style={[type('label', color), { textTransform: 'uppercase' }, style]}>{children}</Text>;
}

// ── Surfaces ───────────────────────────────────────────────────────────
export function Card({
  children, style, padding = S.lg, radius = R.xl, elevation = 'md', onPress,
}: {
  children: React.ReactNode; style?: ViewStyle; padding?: number; radius?: number;
  elevation?: keyof typeof E; onPress?: () => void;
}) {
  const base: ViewStyle = {
    backgroundColor: C.white, borderRadius: radius, padding,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, ...E[elevation],
  };
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

/** Color-blocked gradient surface (bold accents). */
export function GradientCard({
  children, colors, style, padding = S.lg, radius = R.xl, elevation = 'md', onPress, start, end,
}: {
  children: React.ReactNode; colors: readonly string[]; style?: ViewStyle; padding?: number;
  radius?: number; elevation?: keyof typeof E; onPress?: () => void;
  start?: { x: number; y: number }; end?: { x: number; y: number };
}) {
  const inner = (
    <LinearGradient
      colors={colors as any}
      start={start ?? { x: 0, y: 0 }}
      end={end ?? { x: 1, y: 1 }}
      style={[{ borderRadius: radius, padding, overflow: 'hidden' }, style]}
    >
      {children}
    </LinearGradient>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [{ borderRadius: radius, ...E[elevation] }, pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] }]}>
        {inner}
      </Pressable>
    );
  }
  return <View style={{ borderRadius: radius, ...E[elevation] }}>{inner}</View>;
}

// ── Section header ──────────────────────────────────────────────────────
export function SectionHeader({
  title, actionLabel, onAction, style,
}: { title: string; actionLabel?: string; onAction?: () => void; style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.md }, style]}>
      <Txt variant="h3">{title}</Txt>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Txt variant="bodyStrong" color={C.violet}>{actionLabel} ›</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Icon chip (soft-tinted square that holds an icon) ───────────────────
export function IconChip({
  bg, children, size = 40, radius = 12,
}: { bg: string; children: React.ReactNode; size?: number; radius?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </View>
  );
}

// ── Stat tile ───────────────────────────────────────────────────────────
/**
 * Premium metric tile: a white card with a colored icon in the top-left and a
 * bottom-anchored label + value + sub. Because every tile shares this structure
 * the values line up across the grid. Color lives in the icon + accent, not the
 * whole card.
 */
export function StatTile({
  label, value, sub, accent = C.inkMut, icon, onPress, flex = true,
}: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string;
  icon?: React.ReactNode; onPress?: () => void; flex?: boolean;
}) {
  // Grid sizing AND card surface live on ONE element so a tappable tile is sized
  // and styled identically to a static one (a Pressable wrapper was shrinking it).
  const tile: ViewStyle = {
    ...(flex ? { flexGrow: 1, flexShrink: 1, flexBasis: '46%' } : null),
    height: 124, borderRadius: R.lg, padding: S.lg, backgroundColor: C.white,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, justifyContent: 'space-between', ...E.sm,
  };
  const content = (
    <>
      <View style={{ height: 40, justifyContent: 'center' }}>{icon}</View>
      <View>
        <Label>{label}</Label>
        <Text style={[type('statL', C.ink), { marginTop: 3 }]} numberOfLines={1}>{value}</Text>
        {sub != null ? <Text style={[type('caption', accent), { marginTop: 2 }]} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} android_ripple={{ color: 'rgba(124,58,237,0.08)' }} style={tile}>
        {content}
      </Pressable>
    );
  }
  return <View style={tile}>{content}</View>;
}

// ── Selectable pill (child switcher, filters) ───────────────────────────
export function Pill({
  active, onPress, children, style,
}: { active?: boolean; onPress?: () => void; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <Pressable
      onPress={onPress}
      style={[{
        flexDirection: 'row', alignItems: 'center', gap: S.sm,
        paddingVertical: S.sm, paddingHorizontal: S.md, borderRadius: R.pill,
        backgroundColor: active ? '#fff' : 'rgba(255,255,255,0.12)',
        borderWidth: 1, borderColor: active ? '#fff' : 'rgba(255,255,255,0.20)',
      }, style]}
    >
      {children}
    </Pressable>
  );
}

// ── Text field ──────────────────────────────────────────────────────────
export function Field({
  label, style, inputStyle, ...props
}: { label?: string; inputStyle?: TextStyle } & TextInputProps & { style?: ViewStyle }) {
  return (
    <View style={style}>
      {label ? <Label style={{ marginBottom: 7 }}>{label}</Label> : null}
      <TextInput
        placeholderTextColor={C.inkMut}
        style={[{
          height: 52, paddingHorizontal: S.lg, borderRadius: R.md, backgroundColor: C.appbg,
          borderWidth: 1, borderColor: C.line, ...type('bodyL', C.ink),
        }, inputStyle]}
        {...props}
      />
    </View>
  );
}

// ── Button ──────────────────────────────────────────────────────────────
export function Button({
  label, onPress, variant = 'primary', size = 'md', disabled, loading, style, icon,
}: {
  label: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md'; disabled?: boolean; loading?: boolean; style?: ViewStyle; icon?: React.ReactNode;
}) {
  const h = size === 'sm' ? 40 : 52;
  const padX = size === 'sm' ? S.lg : S.xl;
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm }}>
      {loading ? <ActivityIndicator color={variant === 'primary' ? '#fff' : C.violet} /> : icon}
      {!loading && <Text style={type(size === 'sm' ? 'bodyStrong' : 'h3', variant === 'primary' ? '#fff' : C.violet)}>{label}</Text>}
    </View>
  );
  const common: ViewStyle = {
    height: h, borderRadius: R.pill, paddingHorizontal: padX,
    alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1,
  };
  if (variant === 'primary') {
    return (
      <Pressable onPress={disabled || loading ? undefined : onPress} style={({ pressed }) => [{ borderRadius: R.pill, ...E.sm }, pressed && { opacity: 0.9 }, style]}>
        <LinearGradient colors={[C.violet, C.violetDeep] as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={common}>
          {content}
        </LinearGradient>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      style={({ pressed }) => [common, {
        backgroundColor: variant === 'secondary' ? C.violetSoft : 'transparent',
        borderWidth: variant === 'ghost' ? 1.5 : 0, borderColor: C.line,
      }, pressed && { opacity: 0.85 }, style]}
    >
      {content}
    </Pressable>
  );
}

// ── Empty / error / loading states ──────────────────────────────────────
export function StateBlock({
  emoji, title, body, action,
}: { emoji?: string; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: S.xxxl }} elevation="sm">
      {emoji ? <Text style={{ fontSize: 40, marginBottom: S.sm }}>{emoji}</Text> : null}
      <Txt variant="h3" center>{title}</Txt>
      {body ? <Txt variant="body" color={C.inkMut} center style={{ marginTop: S.xs }}>{body}</Txt> : null}
      {action ? <View style={{ marginTop: S.lg }}>{action}</View> : null}
    </Card>
  );
}

export function Loading({ pad = S.huge }: { pad?: number }) {
  return (
    <View style={{ paddingVertical: pad, alignItems: 'center' }}>
      <ActivityIndicator color={C.violet} />
    </View>
  );
}

// ── Screen scaffold ─────────────────────────────────────────────────────
/** Scrollable screen body with the standard gutter, bottom inset and pull-to-refresh. */
export function ScreenScroll({
  children, onRefresh, refreshing, contentStyle,
}: { children: React.ReactNode; onRefresh?: () => void; refreshing?: boolean; contentStyle?: ViewStyle }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.appbg }}
      contentContainerStyle={[{ paddingBottom: insets.bottom + S.xxxl }, contentStyle]}
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.violet} colors={[C.violet]} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

// ── Screen hero (shared night-sky header) ───────────────────────────────
/** Consistent header used across every screen: title, optional subtitle, an
 *  optional right slot, and optional content below (e.g. a child switcher). */
export function ScreenHero({
  title, subtitle, right, onBack, children, paddingBottom,
}: {
  title: string; subtitle?: string; right?: React.ReactNode; onBack?: () => void;
  children?: React.ReactNode; paddingBottom?: number;
}) {
  return (
    <NightHeader colors={G.heroGlow} style={{ paddingHorizontal: S.gutter, paddingBottom: paddingBottom ?? (children ? S.lg : S.xl) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
        {onBack ? <HeaderIconButton onPress={onBack}><ArrowLeft size={18} color="#fff" /></HeaderIconButton> : null}
        <View style={{ flex: 1 }}>
          <Text style={type('h1', '#fff')}>{title}</Text>
          {subtitle ? <Text style={[type('caption', 'rgba(255,255,255,0.68)'), { marginTop: 2 }]}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </NightHeader>
  );
}

// ── Header buttons (translucent circular, for dark heroes) ──────────────
export function HeaderIconButton({ onPress, children }: { onPress?: () => void; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)' }}>
      {children}
    </Pressable>
  );
}

/** Notification bell for screen headers — opens the Updates screen. */
export function BellButton() {
  const router = useRouter();
  return (
    <HeaderIconButton onPress={() => router.push('/updates')}>
      <Bell color="#fff" size={18} />
    </HeaderIconButton>
  );
}

// ── Child switcher (horizontal pills, shared) ───────────────────────────
export function ChildSwitcher({
  kids, selectedId, onSelect,
}: {
  kids: { id: string; name: string; className?: string }[];
  selectedId: string; onSelect: (id: string) => void;
}) {
  if (kids.length < 2) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginTop: S.lg, marginHorizontal: -S.gutter }}
      contentContainerStyle={{ paddingHorizontal: S.gutter, gap: S.sm }}
    >
      {kids.map((k) => {
        const on = k.id === selectedId;
        return (
          <Pill key={k.id} active={on} onPress={() => onSelect(k.id)}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: on ? C.violet : 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={type('micro', '#fff')}>{initials(k.name)}</Text>
            </View>
            <View>
              <Text style={type('bodyStrong', on ? C.ink : '#fff')}>{k.name.split(' ')[0]}</Text>
              {k.className ? <Text style={type('micro', on ? C.violet : 'rgba(255,255,255,0.65)')}>{k.className}</Text> : null}
            </View>
          </Pill>
        );
      })}
    </ScrollView>
  );
}
