import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHero, Card, Label, StarRating } from '@/components/ui';
import { C, S, R, type } from '@/theme';

const STAR_ROWS = [
  { n: 5, text: 'Comes every day', pct: '95% and above' },
  { n: 4, text: 'Very regular', pct: '85% to 94%' },
  { n: 3, text: 'Coming well', pct: '70% to 84%' },
  { n: 2, text: 'Coming sometimes', pct: '50% to 69%' },
  { n: 1, text: 'Needs to come more', pct: 'below 50%' },
];
const BADGES: { emoji: string; name: string; how: string }[] = [
  { emoji: '🐦', name: 'Early Bird', how: 'No absent days this month.' },
  { emoji: '🎯', name: 'Perfect Week', how: 'Your child comes 5 school days in a row.' },
  { emoji: '🔥', name: 'On a Roll', how: 'Your child comes 7 days in a row.' },
  { emoji: '🌟', name: 'Perfect Month', how: '100% attendance this month.' },
  { emoji: '🦸', name: 'Streak Rewards', how: 'A new reward every 15 days with no leave — 30, 45, 60, 75… The longer the streak, the bigger the reward: Hero → Superstar → Champion → Legend 👑.' },
  { emoji: '🏅', name: 'Top Marks', how: 'Your child scores grade A in an exam.' },
  { emoji: '💰', name: 'Fees Paid', how: 'All school fees are paid.' },
];

export default function HowRewardsWork() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: C.appbg }}>
      <ScreenHero title="How it works" subtitle="Stars & rewards, made simple" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: S.huge, gap: S.lg }} showsVerticalScrollIndicator={false}>
        <Card elevation="sm">
          <Text style={type('body', C.inkSoft)}>
            This app shows how your child is doing at school, and gives them <Text style={type('bodyStrong', C.ink)}>stars and rewards</Text> for coming regularly, doing well, and paying fees on time. It's only to encourage your child — it does not change marks or fees. 🌟
          </Text>
        </Card>

        {/* Stars */}
        <Card elevation="sm">
          <Text style={type('h3', C.ink)}>⭐ Stars</Text>
          <Text style={[type('body', C.inkMut), { marginTop: 4, marginBottom: S.md }]}>
            Stars show how regularly your child comes to school this month. The more they come, the more stars.
          </Text>
          {STAR_ROWS.map((r, i) => (
            <View key={r.n} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: C.line }}>
              <StarRating value={r.n} size={16} />
              <View style={{ flex: 1 }}>
                <Text style={type('body', C.inkSoft)}>{r.text}</Text>
                <Text style={[type('micro', C.inkMut), { marginTop: 1 }]}>{r.pct} attendance</Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Rewards */}
        <View>
          <Label style={{ marginBottom: S.sm, marginLeft: 2 }}>Rewards & how to earn them</Label>
          <Card elevation="sm" padding={S.xs}>
            {BADGES.map((b, i) => (
              <View key={b.name} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md, paddingHorizontal: S.md, borderBottomWidth: i === BADGES.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: C.line }}>
                <View style={{ width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.violetSoft }}>
                  <Text style={{ fontSize: 24 }}>{b.emoji}</Text>
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
          Top Marks shows up after the school publishes exam results.
        </Text>
      </ScrollView>
    </View>
  );
}
