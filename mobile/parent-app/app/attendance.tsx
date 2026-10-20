import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react-native';
import { api } from '@/api/client';
import { NightHeader, ProgressRing } from '@/components/Kit';
import { Card, Loading } from '@/components/ui';
import { C, G, S, R, type } from '@/theme';

interface AttResp {
  month: string;
  statuses: Record<string, string>;
  summary: { present: number; absent: number; leave: number; late: number; marked: number; pct: number };
}

const STATUS_FILL: Record<string, string> = { PRESENT: '#12b981', LATE: '#f7a70a', ABSENT: '#ff5a74', LEAVE: '#34b7f1' };
const STATUS_MARK: Record<string, string> = { PRESENT: '✓', LATE: '◔', ABSENT: '✕', LEAVE: 'L' };
const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = new Date().toISOString().slice(0, 10);

export default function AttendanceScreen() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ studentId: string; name: string; className: string }>();
  const { studentId } = useLocalSearchParams<{ studentId: string }>();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const monthStr = `${ym.y}-${pad(ym.m)}`;

  const { data, isLoading } = useQuery({
    queryKey: ['attendance-full', studentId, monthStr],
    queryFn: () => api<AttResp>(`/api/parent/attendance?studentId=${studentId}&month=${monthStr}`),
  });

  const shift = (d: number) => {
    let m = ym.m + d, y = ym.y;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYm({ y, m });
  };

  const statuses = data?.statuses ?? {};
  const s = data?.summary;
  const first = new Date(ym.y, ym.m - 1, 1).getDay();
  const daysInMonth = new Date(ym.y, ym.m, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const monthLabel = new Date(ym.y, ym.m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <View style={{ flex: 1, backgroundColor: C.appbg }}>
      <NightHeader colors={G.heroGlow} style={{ paddingHorizontal: S.gutter, paddingBottom: S.xxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
            <ArrowLeft size={18} color="#fff" />
          </Pressable>
          <View>
            <Text style={type('h2', '#fff')}>Attendance</Text>
            <Text style={type('caption', 'rgba(255,255,255,0.68)')}>{name} · {monthLabel}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.lg }}>
          <ProgressRing size={78} stroke={8} pct={s?.pct ?? 0} colors={['#2ad294', '#ffc961']} track="rgba(255,255,255,0.16)">
            <Text style={type('h2', '#fff')}>{s ? `${s.pct}%` : '—'}</Text>
          </ProgressRing>
          <View style={{ flex: 1 }}>
            <Text style={type('h3', '#fff')}>{(s?.pct ?? 0) >= 90 ? 'Great month! 🌟' : (s?.pct ?? 0) >= 75 ? 'Good going 👍' : 'Keep it up 💪'}</Text>
            <Text style={[type('caption', 'rgba(255,255,255,0.72)'), { marginTop: 2 }]}>{s ? `${s.present} present · ${s.late} late · ${s.absent} absent` : ' '}</Text>
            <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.sm }}>
              <Chip>{s?.marked ?? 0} days marked</Chip>
              <Chip>{s?.leave ?? 0} leave</Chip>
            </View>
          </View>
        </View>
      </NightHeader>

      <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: S.huge }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.md }}>
          <NavBtn onPress={() => shift(-1)}><ChevronLeft size={16} color={C.inkSoft} /></NavBtn>
          <Text style={type('h3', C.ink)}>{monthLabel}</Text>
          <NavBtn onPress={() => shift(1)}><ChevronRight size={16} color={C.inkSoft} /></NavBtn>
        </View>

        {isLoading ? (
          <Loading />
        ) : (
          <>
            <Card padding={S.md} elevation="sm">
              <View style={{ flexDirection: 'row' }}>
                {WD.map((w, i) => <Text key={i} style={[type('micro', C.inkMut), { flex: 1, textAlign: 'center', paddingBottom: 6 }]}>{w}</Text>)}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {cells.map((d, i) => {
                  if (d == null) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 3 }} />;
                  const key = `${ym.y}-${pad(ym.m)}-${pad(d)}`;
                  const st = statuses[key];
                  const wd = new Date(ym.y, ym.m - 1, d).getDay();
                  const weekend = wd === 0 || wd === 6;
                  const fill = st ? STATUS_FILL[st] : undefined;
                  const isToday = key === todayKey;
                  return (
                    <View key={key} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 3 }}>
                      <View style={{ flex: 1, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: fill ?? (weekend ? '#efeafe' : C.appbg), borderWidth: isToday ? 2 : 0, borderColor: C.violet }}>
                        <Text style={type('bodyStrong', fill ? '#fff' : C.inkMut)}>{d}</Text>
                        {st ? <Text style={{ color: '#fff', fontSize: 8, marginTop: 1, fontWeight: '700' }}>{STATUS_MARK[st]}</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            </Card>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: S.lg, rowGap: S.sm, marginTop: S.lg, paddingHorizontal: S.xs }}>
              <Legend c="#12b981" t="Present" />
              <Legend c="#f7a70a" t="Late" />
              <Legend c="#ff5a74" t="Absent" />
              <Legend c="#34b7f1" t="Leave" />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, marginTop: S.lg, borderRadius: R.lg, padding: S.md, backgroundColor: C.goldSoft }}>
              <Text style={{ fontSize: 24 }}>🔥</Text>
              <View style={{ flex: 1 }}>
                <Text style={type('bodyStrong', '#8a5a00')}>Every present day lights the lamp brighter</Text>
                <Text style={[type('caption', '#a56a10'), { marginTop: 1 }]}>Streaks are protected on weekends & holidays.</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function NavBtn({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={{ width: 34, height: 34, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: C.white, borderWidth: 1, borderColor: C.line }}>
      {children}
    </Pressable>
  );
}
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: S.md, paddingVertical: 5, borderRadius: R.pill, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}>
      <Text style={type('micro', '#fff')}>{children}</Text>
    </View>
  );
}
function Legend({ c, t }: { c: string; t: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: c }} />
      <Text style={type('caption', C.inkMut)}>{t}</Text>
    </View>
  );
}
