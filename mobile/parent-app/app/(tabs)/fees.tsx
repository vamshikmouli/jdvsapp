import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ScreenHero, ChildSwitcher, BellButton, Loading, StateBlock } from '@/components/ui';
import { FeesView } from '@/components/FeesView';
import { C, S } from '@/theme';

interface HomeChild { id: string; name: string; className: string }
interface HomeResp { children: HomeChild[] }

export default function FeesTab() {
  const params = useLocalSearchParams<{ studentId?: string }>();
  const { data, isLoading } = useQuery({ queryKey: ['home'], queryFn: () => api<HomeResp>('/api/parent/home') });
  const kids = data?.children ?? [];
  const [selectedId, setSelectedId] = useState('');
  // Preselect the child passed from the Home fee tile (and when it changes).
  useEffect(() => { if (params.studentId) setSelectedId(String(params.studentId)); }, [params.studentId]);
  const selected = kids.find((k) => k.id === selectedId) || kids[0];

  return (
    <View style={{ flex: 1, backgroundColor: C.appbg }}>
      <ScreenHero title="Fees" subtitle="Balance, breakdown & payments 💳" right={<BellButton />}>
        <ChildSwitcher kids={kids} selectedId={selected?.id ?? ''} onSelect={setSelectedId} />
      </ScreenHero>

      {isLoading ? (
        <Loading />
      ) : !selected ? (
        <View style={{ paddingHorizontal: S.gutter, marginTop: S.xl }}>
          <StateBlock emoji="🧾" title="No children linked" body="No children are linked to your account yet." />
        </View>
      ) : (
        <FeesView key={selected.id} studentId={selected.id} name={selected.name} />
      )}
    </View>
  );
}
