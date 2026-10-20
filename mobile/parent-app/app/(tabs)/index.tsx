import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Settings, Flame, Wallet, Award } from 'lucide-react-native';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { NightHeader, LevelAvatar, XPBar, ProgressRing, Medal } from '@/components/Kit';
import { Txt, Label, Card, SectionHeader, StatTile, IconChip, Pill, BellButton, Loading, StateBlock } from '@/components/ui';
import { useTour, TourSpot } from '@/onboarding/tour';
import { deriveLevel, deriveBadges, deriveCoins, GameChild, Badge } from '@/lib/game';
import { greeting, money, initials, CELL_COLOR } from '@/lib/format';
import { C, G, S, R, E, T, type } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface HomeChild extends GameChild {
  id: string;
  roll: string | null;
  days: { date: string; status: string }[];
  fee: { totalCharged: number; totalPaid: number; totalBalance: number } | null;
  streak: { current: number; longest: number };
}
interface HomeResp {
  children: HomeChild[];
  branding: { schoolName: string; logoUrl: string | null };
  year?: string;
}

function greetEmoji() {
  const h = new Date().getHours();
  return h < 12 ? '☀️' : h < 17 ? '🌤️' : '🌙';
}
const GLYPH: Record<string, string> = { PRESENT: '✓', LATE: '◔', ABSENT: '✕', LEAVE: 'L', none: '·' };

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const first = user?.name?.split(' ')[0] || 'Parent';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState('');

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['home'],
    queryFn: () => api<HomeResp>('/api/parent/home'),
  });

  const kids = data?.children ?? [];
  const selected = kids.find((k) => k.id === selectedId) || kids[0];

  const badges: Badge[] = selected ? deriveBadges(selected) : [];
  const earned = badges.filter((b) => b.earned);
  const level = selected ? deriveLevel(selected) : null;
  const coins = selected ? deriveCoins(selected, earned.length) : 0;
  const featured: Badge | undefined = earned[0] ?? badges[0];
  const week = selected?.days.slice(-7) ?? [];
  const hasWeekData = week.some((d) => d.status !== 'none');

  const { maybeAutoStart, replay } = useTour();
  useEffect(() => {
    if (!isLoading && selected) maybeAutoStart();
  }, [isLoading, selected]);

  const onMenu = () =>
    Alert.alert('Menu', undefined, [
      { text: 'Take the app tour', onPress: () => replay() },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: C.night }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: C.appbg }}
        contentContainerStyle={{ paddingBottom: insets.bottom + S.xxxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.violet} colors={[C.violet]} />}
      >
        {/* ── Hero ─────────────────────────────────────────── */}
        <NightHeader colors={G.heroGlow} style={{ paddingHorizontal: S.gutter, paddingBottom: S.xxxl + S.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={type('caption', 'rgba(255,255,255,0.72)')}>{greeting()} {greetEmoji()}</Text>
              <Text style={[type('h1', '#fff'), { marginTop: 2 }]}>Namaste, {first}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
              <TourSpot id="coins">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: S.md, borderRadius: R.pill, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)' }}>
                  <View style={{ width: 15, height: 15, borderRadius: 8, backgroundColor: C.goldGlow }} />
                  <Text style={type('bodyStrong', '#fff')}>{coins}</Text>
                </View>
              </TourSpot>
              <TourSpot id="bell"><BellButton /></TourSpot>
              <Pressable onPress={onMenu} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)' }}>
                <Settings color="#fff" size={18} />
              </Pressable>
            </View>
          </View>

          {/* Child switcher */}
          {kids.length >= 2 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: S.lg, marginHorizontal: -S.gutter }} contentContainerStyle={{ paddingHorizontal: S.gutter, gap: S.sm }}>
              {kids.map((k) => {
                const on = k.id === (selected?.id ?? '');
                return (
                  <Pill key={k.id} active={on} onPress={() => setSelectedId(k.id)}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: on ? C.violet : 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={type('micro', '#fff')}>{initials(k.name)}</Text>
                    </View>
                    <View>
                      <Text style={type('bodyStrong', on ? C.ink : '#fff')}>{k.name.split(' ')[0]}</Text>
                      <Text style={type('micro', on ? C.violet : 'rgba(255,255,255,0.65)')}>{k.className}</Text>
                    </View>
                  </Pill>
                );
              })}
            </ScrollView>
          )}
        </NightHeader>

        {/* ── Body ─────────────────────────────────────────── */}
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <View style={{ paddingHorizontal: S.gutter, marginTop: S.xl }}>
            <StateBlock emoji="📡" title="Couldn't load" body="Pull down to try again." />
          </View>
        ) : !selected ? (
          <View style={{ paddingHorizontal: S.gutter, marginTop: S.xl }}>
            <StateBlock emoji="👨‍👩‍👧" title="No children linked" body="Please contact the school office to link your child." />
          </View>
        ) : (
          <View style={{ paddingHorizontal: S.gutter }}>
            {/* Level card — overlaps the hero */}
            <TourSpot id="level" style={{ marginTop: -S.xxl }}>
            <Card onPress={() => router.push('/how-rewards-work')} style={{ flexDirection: 'row', alignItems: 'center', gap: S.lg }} elevation="lg">
              <LevelAvatar initials={initials(selected.name)} pct={(level?.progress ?? 0) * 100} size={64} />
              <View style={{ flex: 1 }}>
                <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', paddingVertical: 3, paddingHorizontal: S.sm, borderRadius: R.pill, backgroundColor: C.violetSoft }}>
                  <Text style={type('micro', C.violetDeep)}>⭐ LEVEL {level?.level}</Text>
                </View>
                <Text style={[type('h2', C.ink), { marginTop: 5 }]} numberOfLines={1}>{selected.name}</Text>
                <Text style={type('caption', C.inkMut)}>{level?.title} · {selected.className}</Text>
                <View style={{ marginTop: S.sm }}>
                  <XPBar progress={level?.progress ?? 0} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
                    <Text style={type('micro', C.inkMut)}>{level?.xpInto} / {level?.xpForLevel} XP</Text>
                    <Text style={type('micro', C.inkMut)}>{level?.xpToNext} to Lv.{(level?.level ?? 0) + 1}</Text>
                  </View>
                </View>
              </View>
            </Card>
            </TourSpot>

            {/* Stat grid */}
            <TourSpot id="stats" style={{ marginTop: S.lg }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md }}>
              <StatTile
                label="Attendance"
                accent="#0e9b6c"
                icon={
                  <ProgressRing size={40} stroke={5} pct={selected.pct} colors={['#12b981', '#2ad294']} track="rgba(18,185,129,0.14)">
                    <Text style={type('micro', C.grass)}>{selected.marked ? selected.pct : ''}</Text>
                  </ProgressRing>
                }
                value={selected.marked ? `${selected.pct}%` : '—'}
                sub={`${selected.present} of ${selected.marked} days`}
              />
              <StatTile
                label="Streak"
                accent={C.goldDeep}
                icon={<IconChip bg={C.goldSoft}><Flame color={C.gold} size={22} /></IconChip>}
                value={`${selected.streak?.current ?? 0}`}
                sub={(selected.streak?.current ?? 0) > 0 ? 'days in a row' : 'start today'}
              />
              <StatTile
                label="Fee balance"
                accent={C.coral}
                icon={<IconChip bg={C.coralSoft}><Wallet color={C.coral} size={22} /></IconChip>}
                onPress={() => router.push({ pathname: '/fees', params: { studentId: selected.id, name: selected.name, className: selected.className } })}
                value={selected.fee ? money(selected.fee.totalBalance) : '—'}
                sub={selected.fee && selected.fee.totalBalance > 0 ? 'Tap to pay →' : 'All cleared'}
              />
              <StatTile
                label="Badges"
                accent={C.violetDeep}
                icon={<IconChip bg={C.violetSoft}><Award color={C.violet} size={22} /></IconChip>}
                onPress={() => router.push('/rewards')}
                value={`${earned.length}`}
                sub={featured ? `${featured.emoji} ${earned.length ? featured.name : 'next: ' + featured.name}` : undefined}
              />
            </View>
            </TourSpot>

            {/* This week */}
            <View style={{ marginTop: S.xxl }}>
              <SectionHeader title="This week" actionLabel="Full calendar" onAction={() => router.push({ pathname: '/attendance', params: { studentId: selected.id, name: selected.name, className: selected.className } })} />
              <Card padding={S.md} elevation="sm">
                {hasWeekData ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {week.map((d) => {
                      const dt = new Date(d.date);
                      const wd = dt.toLocaleDateString('en-US', { weekday: 'narrow' });
                      const none = d.status === 'none';
                      return (
                        <View key={d.date} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                          <Text style={type('micro', C.inkMut)}>{wd}</Text>
                          <View style={{ width: '100%', height: 40, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: none ? C.appbg : CELL_COLOR[d.status] || C.line }}>
                            <Text style={{ color: none ? C.inkMut : '#fff', fontSize: 14, fontFamily: T.bodyStrong.fontFamily }}>{GLYPH[d.status] ?? '·'}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', paddingVertical: S.lg }}>
                    <Text style={{ fontSize: 24, marginBottom: 4 }}>🗓️</Text>
                    <Txt variant="body" color={C.inkMut} center>No attendance marked this week yet.</Txt>
                  </View>
                )}
              </Card>
            </View>

            {/* Recent wins */}
            <View style={{ marginTop: S.xxl }}>
              <SectionHeader title="Recent wins" actionLabel="All badges" onAction={() => router.push('/rewards')} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -S.gutter }} contentContainerStyle={{ paddingHorizontal: S.gutter, gap: S.xs }}>
              {badges.slice(0, 6).map((b) => <Medal key={b.key} badge={b} />)}
            </ScrollView>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
