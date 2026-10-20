import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useQuery } from '@tanstack/react-query';
import { Share2 } from 'lucide-react-native';
import { api } from '@/api/client';
import { ProgressRing } from '@/components/Kit';
import { ScreenHero, ChildSwitcher, BellButton, Card, Txt, Label, Loading, StateBlock } from '@/components/ui';
import { C, G, S, R, E, T, type } from '@/theme';
import { ShareableResult, ShareAssessment, ShareStudent } from '@/components/ShareableResult';

interface ReportSubject { name: string; marks: number | null; isAbsent: boolean; max: number; grade: string | null; gradeOnly: boolean }
interface ReportAssessment extends ShareAssessment {}
interface Report { year: string; student: ShareStudent & { id: string }; assessments: ReportAssessment[]; hasGrades: boolean }

interface HomeChild { id: string; name: string; className: string }
interface HomeResp { children: HomeChild[]; branding: { schoolName: string; logoUrl: string | null }; year?: string }

function cheer(pct: number | null) {
  if (pct == null) return 'Results in';
  if (pct >= 90) return 'Outstanding! 🌟';
  if (pct >= 75) return 'Brilliant! 🎉';
  if (pct >= 50) return 'Well done 👏';
  return 'Keep going 💪';
}

export default function MarksScreen() {
  const { data: home, isLoading: homeLoading } = useQuery({
    queryKey: ['home'],
    queryFn: () => api<HomeResp>('/api/parent/home'),
  });
  const kids = home?.children ?? [];
  const brand = home?.branding ?? { schoolName: 'School', logoUrl: null };
  const [selectedId, setSelectedId] = useState('');
  const selected = kids.find((k) => k.id === selectedId) || kids[0];

  // --- Share-as-image plumbing ---
  const shotRef = useRef<View>(null);
  const [pending, setPending] = useState<{ report: Report; a: ReportAssessment } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    (async () => {
      try {
        await new Promise((r) => setTimeout(r, 90));
        const uri = await captureRef(shotRef, { format: 'png', quality: 1, result: 'tmpfile' });
        if (cancelled) return;
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `${pending.report.student.name} — ${pending.a.name}` });
        }
      } catch {
        /* dismissed / failed — ignore */
      } finally {
        if (!cancelled) { setPending(null); setBusyId(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [pending]);

  const share = (report: Report, a: ReportAssessment) => { setBusyId(a.id); setPending({ report, a }); };

  return (
    <View style={{ flex: 1, backgroundColor: C.appbg }}>
      <ScreenHero title="Report card" subtitle="Approved results, celebrated 🎓" right={<BellButton />}>
        <ChildSwitcher kids={kids} selectedId={selected?.id ?? ''} onSelect={setSelectedId} />
      </ScreenHero>

      {homeLoading ? (
        <Loading />
      ) : kids.length === 0 ? (
        <View style={{ paddingHorizontal: S.gutter, marginTop: S.xl }}>
          <StateBlock emoji="🎓" title="No children linked" body="No children are linked to your account yet." />
        </View>
      ) : selected ? (
        <ChildReport key={selected.id} childId={selected.id} onShare={share} busyId={busyId} />
      ) : null}

      {pending && (
        <View style={{ position: 'absolute', top: -10000, left: 0 }} pointerEvents="none">
          <View ref={shotRef} collapsable={false} style={{ backgroundColor: '#fff' }}>
            <ShareableResult student={pending.report.student} year={pending.report.year} assessment={pending.a} brand={brand} />
          </View>
        </View>
      )}
    </View>
  );
}

function ChildReport({ childId, onShare, busyId }: { childId: string; onShare: (r: Report, a: ReportAssessment) => void; busyId: string | null }) {
  const { data: report, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['marks', childId],
    queryFn: () => api<Report>(`/api/parent/marks?studentId=${childId}`),
  });
  const assessments = report?.assessments ?? [];
  const [pickId, setPickId] = useState<string | null>(null);
  // Default to the most recent published exam.
  const selectedA = assessments.find((a) => a.id === pickId) ?? assessments[assessments.length - 1];

  return (
    <ScrollView
      contentContainerStyle={{ padding: S.gutter, gap: S.lg, paddingBottom: S.huge }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.violet} colors={[C.violet]} />}
    >
      {isLoading ? (
        <Loading />
      ) : isError || !report ? (
        <StateBlock emoji="📡" title="Couldn't load" body="Pull down to retry." />
      ) : assessments.length === 0 ? (
        <StateBlock emoji="🗂️" title="No results published yet" body={`You'll see ${report.student.name.split(' ')[0]}'s report card here once the school publishes it.`} />
      ) : (
        <>
          {/* Exam selector — pick one to view its detail */}
          {assessments.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -S.gutter }} contentContainerStyle={{ paddingHorizontal: S.gutter, gap: S.sm }}>
              {assessments.map((a) => {
                const on = a.id === selectedA?.id;
                const isSA = a.type === 'SUMMATIVE';
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => setPickId(a.id)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: S.sm, paddingHorizontal: S.md, borderRadius: R.pill, backgroundColor: on ? C.violet : C.white, borderWidth: 1, borderColor: on ? C.violet : C.line, ...E.sm }}
                  >
                    <Text style={type('bodyStrong', on ? '#fff' : C.ink)}>{a.name}</Text>
                    <Text style={type('micro', on ? 'rgba(255,255,255,0.85)' : (isSA ? C.violet : C.goldDeep))}>{a.percent != null ? `${a.percent}%` : '—'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          {selectedA && <ResultBlock report={report} a={selectedA} onShare={onShare} busy={busyId === selectedA.id} />}
          <Txt variant="caption" color={C.inkMut} center>Only results approved &amp; published by the school are shown.</Txt>
        </>
      )}
    </ScrollView>
  );
}

function ResultBlock({ report, a, onShare, busy }: { report: Report; a: ReportAssessment; onShare: (r: Report, a: ReportAssessment) => void; busy: boolean }) {
  const isSA = a.type === 'SUMMATIVE';
  const colors = isSA ? (['#6d5bf5', '#7c3aed'] as const) : (['#f59e0b', '#d97706'] as const);

  return (
    <View style={{ backgroundColor: C.white, borderRadius: R.xl, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, ...E.md }}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: S.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flex: 1 }}>
            <View style={{ borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: 'rgba(255,255,255,0.25)' }}>
              <Text style={type('micro', '#fff')}>{isSA ? 'SA' : 'FA'}</Text>
            </View>
            <Text style={[type('h3', '#fff'), { flexShrink: 1 }]} numberOfLines={1}>{a.name}</Text>
            {a.term ? <Text style={type('caption', 'rgba(255,255,255,0.75)')} numberOfLines={1}>{a.term}</Text> : null}
          </View>
          <Pressable onPress={() => onShare(report, a)} disabled={busy} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: R.pill, paddingHorizontal: S.md, paddingVertical: 7, backgroundColor: 'rgba(255,255,255,0.2)' }}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Share2 size={13} color="#fff" />}
            <Text style={type('micro', '#fff')}>{busy ? 'Sharing…' : 'Share'}</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.lg }}>
          <ProgressRing size={78} stroke={8} pct={a.percent ?? 0} colors={['#ffe9a8', '#ffffff']} track="rgba(255,255,255,0.22)">
            <Text style={type('h3', '#fff')}>{a.percent != null ? `${a.percent}%` : '—'}</Text>
          </ProgressRing>
          <View style={{ flex: 1 }}>
            <Text style={type('h3', '#fff')}>{cheer(a.percent)}</Text>
            <Text style={[type('caption', 'rgba(255,255,255,0.75)'), { marginTop: 2 }]}>{a.subjects.length} subjects · {a.totalObtained}/{a.totalMax} marks</Text>
            {a.grade ? (
              <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', marginTop: S.sm, borderRadius: R.pill, paddingHorizontal: S.md, paddingVertical: 5, overflow: 'hidden' }}>
                <LinearGradient colors={G.lamp} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                <Text style={[type('bodyStrong', '#4a2c00')]}>Grade </Text>
                <Text style={[type('h3', '#4a2c00')]}>{a.grade}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </LinearGradient>

      <View style={{ paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: S.xs }}>
        {a.subjects.map((s) => (
          <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 9 }}>
            <View style={{ flex: 1 }}>
              <Text style={type('bodyStrong', C.ink)} numberOfLines={1}>
                {s.name}{s.gradeOnly ? <Text style={type('caption', C.inkMut)}>  grade only</Text> : null}
              </Text>
              {!s.gradeOnly && (
                <View style={{ height: 6, borderRadius: 99, backgroundColor: C.line, marginTop: 6, overflow: 'hidden' }}>
                  <LinearGradient colors={G.violetGold} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: '100%', borderRadius: 99, width: `${s.isAbsent || s.marks == null ? 0 : Math.min(100, (s.marks / s.max) * 100)}%` }} />
                </View>
              )}
            </View>
            {s.gradeOnly ? (
              <View style={{ borderRadius: R.pill, paddingHorizontal: S.md, paddingVertical: 5, backgroundColor: C.violetSoft }}>
                <Text style={type('bodyStrong', C.violetDeep)}>{s.isAbsent ? 'AB' : s.grade || '—'}</Text>
              </View>
            ) : (
              <Text style={type('h3', s.isAbsent ? C.coral : C.ink)}>{s.isAbsent ? 'AB' : `${s.marks}`}<Text style={type('caption', C.inkMut)}>/{s.max}</Text></Text>
            )}
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: S.lg, marginBottom: S.lg, marginTop: S.xs, borderRadius: R.lg, paddingHorizontal: S.lg, paddingVertical: S.md, backgroundColor: C.ink }}>
        <Text style={type('bodyStrong', '#fff')}>Total score</Text>
        <Text style={type('h3', '#fff')}>{a.totalObtained}<Text style={type('caption', 'rgba(255,255,255,0.55)')}>/{a.totalMax}</Text></Text>
      </View>
    </View>
  );
}
