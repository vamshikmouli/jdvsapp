import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { NightHeader, XPBar } from '@/components/Kit';
import { useRouter } from 'expo-router';
import { HelpCircle } from 'lucide-react-native';
import { ChildSwitcher, BellButton, HeaderIconButton, Card, Label, Loading, StateBlock } from '@/components/ui';
import { deriveLevel, deriveBadges, deriveCoins, TONE_GRAD, GameChild, Badge, MarksLike } from '@/lib/game';
import { C, G, S, R, E, T, type } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface HomeChild extends GameChild {
  id: string;
  days: { date: string; status: string }[];
  fee: { totalCharged: number; totalPaid: number; totalBalance: number } | null;
  streak: { current: number; longest: number };
}
interface HomeResp { children: HomeChild[] }

export default function RewardsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data } = useQuery({ queryKey: ['home'], queryFn: () => api<HomeResp>('/api/parent/home') });
  const kids = data?.children ?? [];
  const [selectedId, setSelectedId] = useState('');
  const selected = kids.find((k) => k.id === selectedId) || kids[0];

  const { data: report } = useQuery({
    queryKey: ['marks', selected?.id],
    queryFn: () => api<MarksLike>(`/api/parent/marks?studentId=${selected!.id}`),
    enabled: !!selected,
  });

  if (!selected) {
    return (
      <View style={{ flex: 1, backgroundColor: C.appbg }}>
        <NightHeader colors={G.heroGlow} style={{ paddingHorizontal: S.gutter, paddingBottom: S.xxl }} glow>
          <Text style={type('h1', '#fff')}>Rewards</Text>
        </NightHeader>
        {kids.length === 0 ? <Loading /> : (
          <View style={{ paddingHorizontal: S.gutter, marginTop: S.xl }}>
            <StateBlock emoji="🏆" title="No child linked" />
          </View>
        )}
      </View>
    );
  }

  const level = deriveLevel(selected);
  const badges = deriveBadges(selected, report);
  const earned = badges.filter((b) => b.earned);
  const coins = deriveCoins(selected, earned.length);

  return (
    <View style={{ flex: 1, backgroundColor: C.night }}>
      <ScrollView style={{ flex: 1, backgroundColor: C.appbg }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + S.xxxl }}>
        <NightHeader colors={G.heroGlow} style={{ paddingHorizontal: S.gutter, paddingBottom: S.xl }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: S.sm }}>
            <HeaderIconButton onPress={() => router.push('/how-rewards-work')}><HelpCircle color="#fff" size={18} /></HeaderIconButton>
            <BellButton />
          </View>
          <ChildSwitcher kids={kids} selectedId={selected.id} onSelect={setSelectedId} />
          <View style={{ alignItems: 'center', paddingTop: kids.length >= 2 ? S.lg : S.xs }}>
            <Text style={[type('label', C.goldGlow), { textTransform: 'uppercase' }]}>{selected.name.split(' ')[0].toUpperCase()}'S JOURNEY</Text>
            <Text style={[type('display', '#fff'), { fontSize: 44, lineHeight: 48, marginTop: 4 }]}>Lv.{level.level}</Text>
            <Text style={type('bodyL', 'rgba(255,255,255,0.75)')}>{level.title}</Text>
            <View style={{ width: 240, maxWidth: '100%', marginTop: S.lg }}>
              <XPBar progress={level.progress} colors={['#ffc961', '#f7a70a']} track="rgba(255,255,255,0.18)" height={10} />
              <Text style={[type('caption', 'rgba(255,255,255,0.8)'), { textAlign: 'center', marginTop: 6 }]}>{level.xpInto} / {level.xpForLevel} XP · {level.xpToNext} to Level {level.level + 1}</Text>
            </View>
          </View>
        </NightHeader>

        {/* Summary stats */}
        <View style={{ flexDirection: 'row', gap: S.md, paddingHorizontal: S.gutter, marginTop: S.lg }}>
          <MiniStat n={earned.length} label="Badges" color={C.violet} />
          <MiniStat n={coins} label="Coins" color={C.goldDeep} />
          <MiniStat n={selected.streak?.current ?? 0} label="Streak" color={C.grass} />
        </View>

        {/* Badge grid */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md, paddingHorizontal: S.gutter, marginTop: S.lg }}>
          {badges.map((b) => <BadgeCard key={b.key} badge={b} />)}
        </View>
      </ScrollView>
    </View>
  );
}

function MiniStat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <Card padding={S.md} radius={R.lg} elevation="sm" style={{ flex: 1, alignItems: 'center' }}>
      <Text style={type('statL', color)}>{n}</Text>
      <Label style={{ marginTop: 2 }}>{label}</Label>
    </Card>
  );
}

function BadgeCard({ badge }: { badge: Badge }) {
  const grad = TONE_GRAD[badge.tone];
  return (
    <View style={{ backgroundColor: C.white, borderRadius: R.lg, alignItems: 'center', paddingHorizontal: S.sm, paddingVertical: S.lg, borderWidth: 1, borderColor: C.line, flexGrow: 1, flexBasis: '29%', opacity: badge.earned ? 1 : 0.7, ...E.sm }}>
      {badge.earned && (
        <View style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: C.grass, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 9 }}>✓</Text>
        </View>
      )}
      {badge.earned ? (
        <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: S.sm }}>
          <Text style={{ fontSize: 25 }}>{badge.emoji}</Text>
        </LinearGradient>
      ) : (
        <View style={{ width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: S.sm, backgroundColor: C.appbg }}>
          <Text style={{ fontSize: 22 }}>🔒</Text>
        </View>
      )}
      <Text numberOfLines={1} style={[type('bodyStrong', C.ink), { textAlign: 'center' }]}>{badge.name}</Text>
      <Text numberOfLines={1} style={[type('micro', C.inkMut), { textAlign: 'center', marginTop: 2 }]}>{badge.progress}</Text>
    </View>
  );
}
