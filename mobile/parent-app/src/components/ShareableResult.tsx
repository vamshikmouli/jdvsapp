import React from 'react';
import { View, Text, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// A fixed-width card that renders ONE assessment result for capture as a PNG
// (react-native-view-shot) and sharing to WhatsApp etc. Mirrors the web
// canvas design in app/parent/page.tsx (renderResultImage). Presentational
// only — rendered off-screen by the Marks screen while sharing.

export interface ShareSubject {
  name: string;
  marks: number | null;
  isAbsent: boolean;
  max: number;
  grade: string | null;
  gradeOnly: boolean;
}
export interface ShareAssessment {
  id: string;
  name: string;
  type: 'FORMATIVE' | 'SUMMATIVE';
  term: string | null;
  subjects: ShareSubject[];
  totalObtained: number;
  totalMax: number;
  percent: number | null;
  grade: string | null;
}
export interface ShareStudent {
  name: string;
  className: string | null;
  section: string | null;
}

const W = 380;

function subjectValue(s: ShareSubject): string {
  if (s.isAbsent) return 'AB';
  if (s.gradeOnly) return s.grade || '—';
  return `${s.marks}/${s.max}`;
}

export function ShareableResult({
  student,
  year,
  assessment: a,
  brand,
}: {
  student: ShareStudent;
  year: string;
  assessment: ShareAssessment;
  brand: { schoolName: string; logoUrl: string | null };
}) {
  const isSA = a.type === 'SUMMATIVE';
  const colors = isSA ? (['#6366f1', '#7c3aed'] as const) : (['#f59e0b', '#b45309'] as const);
  const gradeText = isSA ? '#4338ca' : '#92400e';
  const cls = (student.className || '').replace(/\s?STD$/i, '');
  const pct = a.percent == null ? null : Math.max(0, Math.min(100, a.percent));

  return (
    <View style={{ width: W, backgroundColor: '#ffffff' }}>
      {/* Header band */}
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          {brand.logoUrl ? (
            <View style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.95)', marginRight: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <Image source={{ uri: brand.logoUrl }} style={{ width: 18, height: 18 }} resizeMode="contain" />
            </View>
          ) : null}
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', flex: 1 }} numberOfLines={1}>
            {brand.schoolName}  ·  {cls}{student.section ? ' ' + student.section : ''}  ·  {year}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: '800' }} numberOfLines={1}>{student.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 }}>
                <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>{isSA ? 'SA' : 'FA'}</Text>
              </View>
              <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600', marginLeft: 8, flexShrink: 1 }} numberOfLines={1}>
                {a.name}{a.term ? '  ·  ' + a.term : ''}
              </Text>
            </View>
          </View>
          {pct != null && (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: '#ffffff', fontSize: 34, fontWeight: '800' }}>{a.percent}%</Text>
              {a.grade ? (
                <View style={{ backgroundColor: '#ffffff', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 }}>
                  <Text style={{ color: gradeText, fontSize: 13, fontWeight: '800' }}>{a.grade}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>

        {pct != null && (
          <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)', marginTop: 14, overflow: 'hidden' }}>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: '#ffffff', width: `${pct}%` }} />
          </View>
        )}
      </LinearGradient>

      {/* Subject rows */}
      {a.subjects.map((s, i) => (
        <View
          key={s.name}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 11, backgroundColor: i % 2 === 1 ? '#f8fafc' : '#ffffff' }}
        >
          <Text style={{ color: '#334155', fontSize: 15, fontWeight: '500', flex: 1, paddingRight: 10 }} numberOfLines={1}>
            {s.name}{s.gradeOnly ? '  (grade)' : ''}
          </Text>
          <Text style={{ color: s.isAbsent ? '#dc2626' : '#0f172a', fontSize: 15, fontWeight: '600' }}>{subjectValue(s)}</Text>
        </View>
      ))}

      {/* Total */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, backgroundColor: '#f1f5f9' }}>
        <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '800' }}>Total</Text>
        <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '800' }}>{a.totalObtained}/{a.totalMax}</Text>
      </View>

      {/* Footer */}
      <View style={{ paddingVertical: 12, alignItems: 'center', backgroundColor: '#ffffff' }}>
        <Text style={{ color: '#94a3b8', fontSize: 12 }}>Shared from {brand.schoolName} · Parent app</Text>
      </View>
    </View>
  );
}
