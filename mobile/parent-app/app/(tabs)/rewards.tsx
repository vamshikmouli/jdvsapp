import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { HelpCircle } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { NightHeader } from '@/components/Kit';
import { ChildSwitcher, BellButton, HeaderIconButton, Card, Txt, Label, StarRating, Loading, StateBlock } from '@/components/ui';
import { deriveStars, deriveSimpleBadges, TONE_GRAD, GameChild, Badge, MarksLike } from '@/lib/game';
import { givenName } from '@/lib/format';
import { C, G, S, R, E, type } from '@/theme';
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
            <StateBlock emoji="⭐" title="No child linked" />
          </View>
        )}
      </View>
    );
  }

  const stars = deriveStars(selected);
  const badges = deriveSimpleBadges(selected, report);
  const earned = badges.filter((b) => b.earned);

  return (
    <View style={{ flex: 1, backgroundColor: C.night }}>
      <ScrollView style={{ flex: 1, backgroundColor: C.appbg }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + S.xxxl }}>
        <NightHeader colors={G.heroGlow} style={{ paddingHorizontal: S.gutter, paddingBottom: S.xl }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: S.sm }}>
            <HeaderIconButton onPress={() => router.push('/how-rewards-work')}><HelpCircle color="#fff" size={18} /></HeaderIconButton>
            <BellButton />
          </View>
          <ChildSwitcher kids={kids} selectedId={selected.id} onSelect={setSelectedId} />

          {/* Big, simple stars */}
          <View style={{ alignItems: 'center', paddingTop: kids.length >= 2 ? S.lg : S.xs }}>
            <Text style={type('bodyL', 'rgba(255,255,255,0.8)')}>{givenName(selected.name)}'s stars</Text>
            <View style={{ marginTop: S.md, marginBottom: S.sm }}>
              <StarRating value={stars.stars} size={40} />
            </View>
            <Text style={type('h3', '#fff')}>{stars.label}</Text>
            <Text style={[type('caption', 'rgba(255,255,255,0.7)'), { marginTop: 4 }]}>Stars come from coming to school regularly.</Text>
          </View>
        </NightHeader>

        {/* Reward count */}
        <View style={{ paddingHorizontal: S.gutter, marginTop: S.lg }}>
          <Card padding={S.lg} elevation="sm" style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
            <Text style={{ fontSize: 30 }}>🏅</Text>
            <View style={{ flex: 1 }}>
              <Txt variant="h3">{earned.length} of {badges.length} rewards earned</Txt>
              <Txt variant="caption" color={C.inkMut}>Keep coming, do well, and pay fees on time to earn more.</Txt>
            </View>
          </Card>
        </View>

        {/* Badge list — big, clear, with how-to */}
        <View style={{ paddingHorizontal: S.gutter, marginTop: S.lg, gap: S.md }}>
          {badges.map((b) => <BadgeRow key={b.key} badge={b} />)}
        </View>
      </ScrollView>
    </View>
  );
}

function BadgeRow({ badge }: { badge: Badge }) {
  const grad = TONE_GRAD[badge.tone];
  return (
    <Card padding={S.md} radius={R.lg} elevation="sm" style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, opacity: badge.earned ? 1 : 0.85 }}>
      {badge.earned ? (
        <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 26 }}>{badge.emoji}</Text>
        </LinearGradient>
      ) : (
        <View style={{ width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.appbg }}>
          <Text style={{ fontSize: 24, opacity: 0.6 }}>🔒</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={type('bodyStrong', C.ink)}>{badge.name}</Text>
        <Text style={[type('caption', C.inkMut), { marginTop: 1 }]}>{badge.progress}</Text>
      </View>
      {badge.earned ? (
        <View style={{ paddingHorizontal: S.md, paddingVertical: 5, borderRadius: R.pill, backgroundColor: C.grassSoft }}>
          <Text style={type('micro', '#0e9b6c')}>EARNED ✓</Text>
        </View>
      ) : null}
    </Card>
  );
}
