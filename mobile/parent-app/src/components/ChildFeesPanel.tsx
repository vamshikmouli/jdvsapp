import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { money } from '@/lib/format';

interface FeeData {
  year: string;
  summary: {
    totalCharged: number;
    totalPaid: number;
    totalBalance: number;
    concession: number;
    heads: { key: string; name: string; balance: number }[];
  };
  payments: { id: string; receiptNo: string; total: number; paidAt: string }[];
  concessions: { feeTypeName: string; amount: number; status: string }[];
}

export function ChildFeesPanel({ studentId }: { studentId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['fees', studentId],
    queryFn: () => api<FeeData>(`/api/parent/fees?studentId=${studentId}`),
    retry: false,
  });

  if (isLoading) {
    return (
      <View className="px-4 py-6 border-t border-slate-100 items-center">
        <ActivityIndicator color="#7c3aed" />
      </View>
    );
  }
  if (isError || !data) {
    return <View className="px-4 py-6 border-t border-slate-100"><Text className="text-sm text-slate-400 text-center">No fees on record.</Text></View>;
  }

  const s = data.summary;
  return (
    <View className="px-4 py-3 border-t border-slate-100">
      <View className="flex-row gap-2 mb-3">
        {[
          { l: 'Total fee', v: s.totalCharged, c: 'text-slate-900' },
          { l: 'Paid', v: s.totalPaid, c: 'text-success-700' },
          { l: 'Balance', v: s.totalBalance, c: 'text-danger-700' },
        ].map((b) => (
          <View key={b.l} className="flex-1 rounded-lg bg-slate-50 px-2 py-2 items-center">
            <Text className={`text-sm font-bold ${b.c}`}>{money(b.v)}</Text>
            <Text className="text-[10px] text-slate-500 mt-0.5">{b.l}</Text>
          </View>
        ))}
      </View>

      <View className="gap-1.5">
        {s.heads.map((h) => (
          <View key={h.key} className="flex-row items-center justify-between">
            <Text className="text-sm text-slate-700">{h.name}</Text>
            {h.balance > 0 ? (
              <Text className="text-danger-700 text-sm font-medium">{money(h.balance)} due</Text>
            ) : (
              <Text className="text-success-600 text-xs font-medium">Paid</Text>
            )}
          </View>
        ))}
      </View>

      {data.payments.length > 0 && (
        <View className="mt-3 pt-3 border-t border-slate-100">
          <Text className="text-[11px] font-semibold text-slate-500 mb-1.5">Recent payments</Text>
          {data.payments.map((p) => (
            <View key={p.id} className="flex-row items-center justify-between mb-1.5">
              <Text className="text-xs text-slate-500 flex-1" numberOfLines={1}>{p.receiptNo}</Text>
              <Text className="text-xs text-slate-400 mx-2">{new Date(p.paidAt).toLocaleDateString('en-IN')}</Text>
              <Text className="text-xs font-semibold text-slate-900">{money(p.total)}</Text>
            </View>
          ))}
        </View>
      )}

      <Text className="mt-3 text-[11px] text-slate-400 text-center">
        {s.totalBalance > 0 ? 'Please pay the balance at the school office.' : 'All fees cleared. Thank you!'}
      </Text>
    </View>
  );
}
