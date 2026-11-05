import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Settings, Flame, Wallet, Award, ChevronRight, Compass, LogOut, X } from 'lucide-react-native';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { NightHeader, ProgressRing, Medal } from '@/components/Kit';
import { Txt, Label, Card, GradientCard, SectionHeader, StatTile, IconChip, Pill, BellButton, StarRating, Loading, StateBlock } from '@/components/ui';
import { useTour, TourSpot } from '@/onboarding/tour';
import { deriveStars, deriveSimpleBadges, GameChild, Badge } from '@/lib/game';
import { greeting, money, initials, givenName, CELL_COLOR } from '@/lib/format';
import { C, G, S, R, E, T, type } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BirthdayModal } from '@/components/BirthdayModal';

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
  const first = givenName(user?.name) || 'Parent';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['home'],
    queryFn: () => api<HomeResp>('/api/parent/home'),
  });

  const kids = data?.children ?? [];
  const selected = kids.find((k) => k.id === selectedId) || kids[0];

  const badges: Badge[] = selected ? deriveSimpleBadges(selected) : [];
  const earned = badges.filter((b) => b.earned);
  const stars = selected ? deriveStars(selected) : { stars: 0, label: '' };
  const featured: Badge | undefined = earned[0] ?? badges[0];
  const week = selected?.days.slice(-7) ?? [];
  const hasWeekData = week.some((d) => d.status !== 'none');
  const schoolName = data?.branding?.schoolName;
  const todayStr = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

  const { maybeAutoStart, replay } = useTour();
  useEffect(() => {
    if (!isLoading && selected) maybeAutoStart();
  }, [isLoading, selected]);

  const onMenu = () => setMenuOpen(true);

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
              {schoolName ? <Text style={[type('micro', C.goldGlow), { textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }]} numberOfLines={1}>{schoolName}</Text> : null}
              <Text style={type('caption', 'rgba(255,255,255,0.72)')}>{greeting()} {greetEmoji()}</Text>
              <Text style={[type('h1', '#fff'), { marginTop: 2 }]}>Namaste, {first}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
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
                      <Text style={type('bodyStrong', on ? C.ink : '#fff')}>{givenName(k.name)}</Text>
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
            {/* Profile + stars card — overlaps the hero */}
            <TourSpot id="starcard" style={{ marginTop: -S.xxl }}>
            <GradientCard onPress={() => router.push('/how-rewards-work')} colors={[C.violet, C.violetDeep]} elevation="lg" padding={S.lg}>
              {(selected.streak?.current ?? 0) > 0 && (
                <View style={{ position: 'absolute', top: S.md, right: S.md, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Flame color={C.goldGlow} size={13} />
                  <Text style={type('micro', '#fff')}>{selected.streak.current}-day streak</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.lg }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.96)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.goldGlow, ...E.sm }}>
                  <Text style={type('h2', C.violetDeep)}>{initials(selected.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type('h3', '#fff')} numberOfLines={1}>{selected.name}</Text>
                  <Text style={[type('caption', 'rgba(255,255,255,0.78)'), { marginBottom: 8 }]}>{selected.className}</Text>
                  <StarRating value={stars.stars} size={20} />
                  <Text style={[type('caption', 'rgba(255,255,255,0.92)'), { marginTop: 6 }]} numberOfLines={1}>{stars.label}</Text>
                </View>
                <ChevronRight color="rgba(255,255,255,0.55)" size={22} />
              </View>
            </GradientCard>
            </TourSpot>

            {/* Stat grid */}
            <TourSpot id="tiles" style={{ marginTop: S.lg }}>
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
                label="Days in a row"
                accent={C.goldDeep}
                icon={<IconChip bg={C.goldSoft}><Flame color={C.gold} size={22} /></IconChip>}
                value={`${selected.streak?.current ?? 0}`}
                sub={(selected.streak?.current ?? 0) > 0 ? 'keep it going!' : 'come today'}
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
                label="Rewards"
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
                      const isToday = d.date === todayStr;
                      return (
                        <View key={d.date} style={{ flex: 1, alignItems: 'center', gap: 5 }}>
                          <Text style={type('micro', isToday ? C.violet : C.inkMut)}>{wd}</Text>
                          <View style={{ width: '100%', height: 44, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: none ? C.appbg : CELL_COLOR[d.status] || C.line, borderWidth: isToday ? 2 : 0, borderColor: C.violet }}>
                            <Text style={{ color: none ? C.inkMut : '#fff', fontSize: 14, fontFamily: T.bodyStrong.fontFamily }}>{GLYPH[d.status] ?? '·'}</Text>
                          </View>
                          <Text style={type('micro', isToday ? C.violet : none ? C.inkMut : C.inkSoft)}>{dt.getDate()}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
                {hasWeekData ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: S.lg, marginTop: S.md }}>
                    <LegendDot color={CELL_COLOR.PRESENT} label="Present" />
                    <LegendDot color={CELL_COLOR.ABSENT} label="Absent" />
                    <LegendDot color={CELL_COLOR.LEAVE} label="Leave" />
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
              <SectionHeader title="Rewards earned" actionLabel="See all" onAction={() => router.push('/rewards')} style={{ marginBottom: S.xs }} />
              <Text style={[type('caption', C.inkMut), { marginBottom: S.md }]}>
                {earned.length > 0 ? `${earned.length} earned so far — keep it up! 🎉` : 'Come regularly to earn your first reward ⭐'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -S.gutter }} contentContainerStyle={{ paddingHorizontal: S.gutter, gap: S.sm }}>
                {badges.slice(0, 6).map((b) => <Medal key={b.key} badge={b} />)}
              </ScrollView>
            </View>
          </View>
        )}
      </ScrollView>

      <BirthdayModal />

      {/* Account menu — bottom sheet (replaces the OS alert) */}
      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)} statusBarTranslucent>
        <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16,10,40,0.5)' }} onPress={() => setMenuOpen(false)}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{ backgroundColor: '#fff', borderTopLeftRadius: R.xxl, borderTopRightRadius: R.xxl, paddingBottom: insets.bottom + S.lg, paddingTop: S.md, paddingHorizontal: S.gutter }}
          >
            {/* grab handle */}
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: S.lg }} />

            {/* parent header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.lg }}>
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.violetSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={type('h3', C.violetDeep)}>{initials(user?.name || 'P')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type('bodyStrong', C.ink)} numberOfLines={1}>{user?.name || 'Parent'}</Text>
                <Text style={type('caption', C.inkMut)}>Parent account</Text>
              </View>
              <Pressable onPress={() => setMenuOpen(false)} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.appbg, alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} color={C.inkMut} />
              </Pressable>
            </View>

            <MenuRow
              icon={<Compass size={20} color={C.violet} />}
              bg={C.violetSoft}
              title="Take the app tour"
              sub="See how the app works"
              onPress={() => { setMenuOpen(false); setTimeout(replay, 250); }}
            />
            <MenuRow
              icon={<LogOut size={20} color={C.coral} />}
              bg={C.coralSoft}
              title="Sign out"
              sub="You'll need your PIN to sign in again"
              tone={C.coral}
              onPress={() => { setMenuOpen(false); signOut(); }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: color }} />
      <Text style={type('micro', C.inkMut)}>{label}</Text>
    </View>
  );
}

function MenuRow({ icon, bg, title, sub, tone, onPress }: {
  icon: React.ReactNode; bg: string; title: string; sub?: string; tone?: string; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(124,58,237,0.08)' }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={type('bodyStrong', tone ?? C.ink)}>{title}</Text>
        {sub ? <Text style={[type('caption', C.inkMut), { marginTop: 1 }]}>{sub}</Text> : null}
      </View>
      <ChevronRight size={18} color={C.inkMut} />
    </Pressable>
  );
}
