import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHero, Card, Label } from '@/components/ui';
import { C, S, R, type } from '@/theme';

// Mirrors the rules in src/lib/game.ts. Keep in sync if the formula changes.
const XP_ROWS = [
  { emoji: '✅', label: 'Each present day', value: '+15 XP' },
  { emoji: '🔥', label: 'Each streak day', value: '+10 XP' },
  { emoji: '💫', label: 'All fees cleared', value: '+100 XP' },
  { emoji: '🎯', label: '90%+ attendance', value: '+60 XP' },
];
const COIN_ROWS = [
  { emoji: '✅', label: 'Each present day', value: '+10' },
  { emoji: '🏅', label: 'Each badge earned', value: '+20' },
  { emoji: '🔥', label: 'Each streak day', value: '+5' },
];
const LEVELS = ['New Star', 'Bright Spark', 'Curious Mind', 'Rising Scholar', 'Star Scholar', 'Champion Scholar'];
const BADGES: { emoji: string; name: string; how: string }[] = [
  { emoji: '🐦', name: 'Early Bird', how: 'No absences this month.' },
  { emoji: '🎯', name: 'Perfect Week', how: 'Present 5 school days in a row.' },
  { emoji: '🔥', name: 'On a Roll', how: 'Keep a 7-day attendance streak.' },
  { emoji: '🏅', name: 'Top Marks', how: 'Score an A grade in any exam.' },
  { emoji: '💫', name: 'Star Payer', how: 'Clear all fees on time.' },
  { emoji: '🌟', name: 'Perfect Month', how: '100% attendance for the month.' },
  { emoji: '🦸', name: '30-Day Hero', how: 'Reach a 30-day attendance streak.' },
  { emoji: '💯', name: 'Century Club', how: 'Score 100% in any exam.' },
  { emoji: '🎓', name: 'All-Rounder', how: 'Get an A in every subject.' },
];

function MetricRow({ emoji, label, value, accent = C.violet, last }: { emoji: string; label: string; value: string; accent?: string; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: C.line }}>
      <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.appbg }}>
        <Text style={{ fontSize: 18 }}>{emoji}</Text>
      </View>
      <Text style={[type('body', C.inkSoft), { flex: 1 }]}>{label}</Text>
      <Text style={type('h3', accent)}>{value}</Text>
    </View>
  );
}

export default function HowRewardsWork() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: C.appbg }}>
      <ScreenHero title="How rewards work" subtitle="Levels, XP, coins & badges ✨" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: S.huge, gap: S.lg }} showsVerticalScrollIndicator={false}>
        {/* Intro */}
        <Card elevation="sm">
          <Text style={type('body', C.inkSoft)}>
            Rewards turn everyday good habits — showing up, keeping streaks, doing well and paying on time — into points your child can see and celebrate. Nothing here affects fees or marks; it's just encouragement. 🌟
          </Text>
        </Card>

        {/* XP & Levels */}
        <Card elevation="sm">
          <Text style={type('h3', C.ink)}>⭐ XP & Levels</Text>
          <Text style={[type('body', C.inkMut), { marginTop: 4, marginBottom: S.sm }]}>
            XP (experience points) measure progress this term. Your child earns XP from:
          </Text>
          {XP_ROWS.map((r, i) => <MetricRow key={r.label} {...r} last={i === XP_ROWS.length - 1} />)}
          <View style={{ marginTop: S.md, borderRadius: R.md, padding: S.md, backgroundColor: C.violetSoft }}>
            <Text style={type('bodyStrong', C.violetDeep)}>Every 250 XP = the next level.</Text>
            <Text style={[type('caption', C.violetDeep), { marginTop: 2, opacity: 0.85 }]}>The bar on the Home & Rewards screens shows how far to the next level.</Text>
          </View>
        </Card>

        {/* Level ladder */}
        <Card elevation="sm">
          <Text style={type('h3', C.ink)}>🏆 Level ladder</Text>
          <Text style={[type('body', C.inkMut), { marginTop: 4, marginBottom: S.sm }]}>Everyone starts at Level 1 and ranks up as XP grows:</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
            {LEVELS.map((t, i) => (
              <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: R.pill, paddingVertical: 6, paddingHorizontal: S.md, backgroundColor: C.appbg, borderWidth: 1, borderColor: C.line }}>
                <Text style={type('micro', C.violet)}>Lv.{i + 1}</Text>
                <Text style={type('bodyStrong', C.ink)}>{t}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Coins */}
        <Card elevation="sm">
          <Text style={type('h3', C.ink)}>🪙 Coins</Text>
          <Text style={[type('body', C.inkMut), { marginTop: 4, marginBottom: S.sm }]}>
            Coins are a fun running total shown in the top bar. They add up from:
          </Text>
          {COIN_ROWS.map((r, i) => <MetricRow key={r.label} {...r} accent={C.goldDeep} last={i === COIN_ROWS.length - 1} />)}
        </Card>

        {/* Badges */}
        <View>
          <Label style={{ marginBottom: S.sm, marginLeft: 2 }}>Badges & how to earn them</Label>
          <Card elevation="sm" padding={S.xs}>
            {BADGES.map((b, i) => (
              <View key={b.name} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md, paddingHorizontal: S.md, borderBottomWidth: i === BADGES.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: C.line }}>
                <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.violetSoft }}>
                  <Text style={{ fontSize: 22 }}>{b.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type('bodyStrong', C.ink)}>{b.name}</Text>
                  <Text style={[type('caption', C.inkMut), { marginTop: 1 }]}>{b.how}</Text>
                </View>
              </View>
            ))}
          </Card>
        </View>

        <Text style={[type('caption', C.inkMut), { textAlign: 'center' }]}>
          Marks-based badges (Top Marks, Century Club, All-Rounder) light up once the school publishes results.
        </Text>
      </ScrollView>
    </View>
  );
}
