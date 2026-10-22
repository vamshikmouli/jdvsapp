import React from 'react';
import { View, Text, ScrollView, Pressable, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { XPBar } from '@/components/Kit';
import { Card, GradientCard, Label, Loading, StateBlock } from '@/components/ui';
import { PayFeesSheet, type OutstandingItem } from '@/components/PayFeesSheet';
import { money } from '@/lib/format';
import { C, S, R, type } from '@/theme';

interface FeeData {
  year: string;
  summary: {
    totalCharged: number; totalPaid: number; totalBalance: number; concession: number;
    heads: { key: string; name: string; charged: number; paid: number; balance: number }[];
  };
  onlinePayEnabled: boolean;
  outstanding: OutstandingItem[];
  payments: { id: string; receiptNo: string; total: number; paidAt: string }[];
}

function MiniFig({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card padding={S.md} radius={R.lg} elevation="sm" style={{ flex: 1, alignItems: 'center' }}>
      <Text style={type('h3', color)} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
      <Label style={{ marginTop: 2 }}>{label}</Label>
    </Card>
  );
}

const HEAD_ICON: Record<string, string> = { tuition: '🎓', transport: '🚌', bus: '🚌', books: '📚', book: '📚', uniform: '👕', admission: '🏫', exam: '📝', activity: '🎨', other: '📦' };
function iconFor(name: string) {
  const k = name.toLowerCase();
  for (const key in HEAD_ICON) if (k.includes(key)) return HEAD_ICON[key];
  return '💠';
}

// A private (unaided) school shouldn't be seen itemising / selling uniforms, so
// the parent app never spells out uniform items — uniform, tie, belt, socks (and
// the like) are folded into a single short "Others" line. The parent still sees
// the amount they owe; just not an itemised uniform bill. (Matched on whole words
// so a fee like "Activities" is never caught by "tie".)
const UNIFORM_WORDS = new Set([
  'uniform', 'uniforms', 'tie', 'ties', 'belt', 'belts', 'sock', 'socks',
  'shoe', 'shoes', 'sweater', 'sweaters', 'blazer', 'blazers', 'pinafore', 'pinafores',
]);
function isUniformName(name: string): boolean {
  return name.toLowerCase().split(/[^a-z]+/).some((w) => UNIFORM_WORDS.has(w));
}

type Head = { key: string; name: string; charged: number; paid: number; balance: number };
/** Fold all uniform-type heads into one "Others" line, kept at the end. */
function groupHeads(heads: Head[]): Head[] {
  const kept: Head[] = [];
  const others = { key: '__others__', name: 'Others', charged: 0, paid: 0, balance: 0 };
  let hasOthers = false;
  for (const h of heads) {
    if (isUniformName(h.name)) { others.charged += h.charged; others.paid += h.paid; others.balance += h.balance; hasOthers = true; }
    else kept.push(h);
  }
  if (hasOthers) kept.push(others);
  return kept;
}

/** The full Fees scroll body for one child — used by the Fees tab and the
 *  deep-linked fees screen so both stay identical. Pass the child's id + name. */
export function FeesView({ studentId, name, bottomInset = S.huge }: { studentId: string; name: string; bottomInset?: number }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['fees-full', studentId],
    queryFn: () => api<FeeData>(`/api/parent/fees?studentId=${studentId}`),
    retry: false,
    enabled: !!studentId,
  });

  function refreshFees() {
    qc.invalidateQueries({ queryKey: ['fees-full', studentId] });
    qc.invalidateQueries({ queryKey: ['fees', studentId] });
  }

  const s = data?.summary;
  const paidPct = s && s.totalCharged > 0 ? s.totalPaid / s.totalCharged : 0;
  const cleared = s ? s.totalBalance <= 0 : false;

  return (
    <ScrollView contentContainerStyle={{ padding: S.gutter, paddingBottom: bottomInset }} showsVerticalScrollIndicator={false}>
      {isLoading ? (
        <Loading />
      ) : isError || !s ? (
        <StateBlock emoji="🧾" title="No fees on record" body="There are no fees recorded for this child yet." />
      ) : (
        <>
          {/* Balance summary */}
          <GradientCard colors={[C.violet, C.violetDeep]} radius={R.xl} elevation="md">
            <Label color="rgba(255,255,255,0.7)">{cleared ? 'FULLY PAID' : 'BALANCE DUE'}</Label>
            <Text style={[type('display', '#fff'), { fontSize: 36, lineHeight: 40, marginTop: 4 }]}>{money(s.totalBalance)}</Text>
            <View style={{ marginTop: S.md }}>
              <XPBar progress={paidPct} colors={['#2ad294', '#12b981']} track="rgba(255,255,255,0.22)" height={9} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={type('micro', 'rgba(255,255,255,0.85)')}>Paid {money(s.totalPaid)}</Text>
                <Text style={type('micro', 'rgba(255,255,255,0.85)')}>of {money(s.totalCharged)}{data.year ? ` · ${data.year}` : ''}</Text>
              </View>
            </View>
          </GradientCard>

          {/* Charged · Paid · Balance */}
          <View style={{ flexDirection: 'row', gap: S.md, marginTop: S.lg }}>
            <MiniFig label="Charged" value={money(s.totalCharged)} color={C.ink} />
            <MiniFig label="Paid" value={money(s.totalPaid)} color={C.grass} />
            <MiniFig label="Balance" value={money(s.totalBalance)} color={cleared ? C.grass : C.coral} />
          </View>

          {!cleared && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, borderRadius: R.lg, padding: S.md, marginTop: S.lg, backgroundColor: C.goldSoft }}>
              <Text style={{ fontSize: 26 }}>💫</Text>
              <View style={{ flex: 1 }}>
                <Text style={type('bodyStrong', '#7a4d00')}>Pay on time → earn Star Payer</Text>
                <Text style={[type('caption', '#946000'), { marginTop: 1 }]}>Unlock the badge + 100 coins for on-time payment.</Text>
              </View>
            </View>
          )}

          <Card style={{ marginTop: S.lg }}>
            <Text style={[type('h3', C.ink), { marginBottom: S.xs }]}>Fee breakdown</Text>
            {groupHeads(s.heads).map((h, i) => (
              <View key={h.key} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: C.line }}>
                <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.violetSoft }}>
                  <Text style={{ fontSize: 17 }}>{iconFor(h.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type('bodyStrong', C.ink)}>{h.name}</Text>
                  {h.balance > 0 && h.paid > 0 ? (
                    <Text style={[type('caption', C.inkMut), { marginTop: 1 }]}>Paid {money(h.paid)} of {money(h.charged)}</Text>
                  ) : null}
                </View>
                {h.balance > 0 ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={type('h3', C.ink)}>{money(h.balance)}</Text>
                    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, marginTop: 2, backgroundColor: C.coralSoft }}><Text style={type('micro', '#e0435f')}>DUE</Text></View>
                  </View>
                ) : (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={type('bodyStrong', C.grass)}>{money(h.paid)}</Text>
                    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, marginTop: 2, backgroundColor: C.grassSoft }}><Text style={type('micro', '#0e9b6c')}>PAID</Text></View>
                  </View>
                )}
              </View>
            ))}
          </Card>

          {data.payments.length > 0 && (
            <Card style={{ marginTop: S.lg }}>
              <Text style={[type('h3', C.ink), { marginBottom: S.sm }]}>Recent payments</Text>
              {data.payments.map((p) => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 }}>
                  <Text style={[type('body', C.inkMut), { flex: 1 }]} numberOfLines={1}>🧾 {p.receiptNo}</Text>
                  <Text style={[type('caption', C.inkMut), { marginHorizontal: S.sm }]}>{new Date(p.paidAt).toLocaleDateString('en-IN')}</Text>
                  <Text style={type('bodyStrong', C.ink)}>{money(p.total)}</Text>
                </View>
              ))}
            </Card>
          )}

          {!cleared && (
            data.onlinePayEnabled ? (
              <PayFeesSheet
                studentId={String(studentId)}
                studentName={String(name ?? '')}
                balance={s.totalBalance}
                outstanding={(data.outstanding ?? []).map((o) => isUniformName(o.label) ? { ...o, label: 'Others' } : o)}
                onPaid={refreshFees}
              />
            ) : (
              <Pressable
                onPress={() => Alert.alert('Fee payment', 'Please pay the balance at the school office. Online payment is coming soon!')}
                style={{ marginTop: S.xl, borderRadius: R.lg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
              >
                <LinearGradient colors={['#12b981', '#f7a70a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                <Text style={[type('h3', '#fff'), { paddingVertical: S.lg }]}>💳 Pay {money(s.totalBalance)} & earn ⭐</Text>
              </Pressable>
            )
          )}
          <Text style={[type('caption', C.inkMut), { textAlign: 'center', marginTop: S.md }]}>
            {cleared
              ? 'All fees cleared — thank you! 🎉'
              : data.onlinePayEnabled
                ? 'Pay securely via UPI — the balance updates automatically.'
                : 'Balance can be paid at the school office.'}
          </Text>
        </>
      )}
    </ScrollView>
  );
}
