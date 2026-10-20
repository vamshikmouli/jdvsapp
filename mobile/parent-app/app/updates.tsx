import React from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ScreenHero, Card, StateBlock } from '@/components/ui';
import { C, S, R, type } from '@/theme';

interface Circular {
  id: string;
  title: string;
  body: string;
  category?: string;
  pinned?: boolean;
  publishedAt: string;
}

interface Style { emoji: string; grad: readonly [string, string]; tagBg: string; tagFg: string }
const DEFAULT_STYLE: Style = { emoji: '📢', grad: ['#efe7fe', '#c9b3fb'], tagBg: '#efe7fe', tagFg: '#6d28d9' };
const STYLES: { keys: string[]; style: Style }[] = [
  { keys: ['event', 'annual', 'program', 'celebrat', 'day', 'function'], style: { emoji: '🎉', grad: ['#fff0cf', '#ffd06b'], tagBg: '#fff0cf', tagFg: '#8a5a00' } },
  { keys: ['fee', 'payment', 'due'], style: { emoji: '💰', grad: ['#efe7fe', '#c9b3fb'], tagBg: '#efe7fe', tagFg: '#6d28d9' } },
  { keys: ['photo', 'gallery', 'picture'], style: { emoji: '📸', grad: ['#d6f7ea', '#8fe6c4'], tagBg: '#d6f7ea', tagFg: '#0e9b6c' } },
  { keys: ['exam', 'test', 'result', 'mark'], style: { emoji: '📝', grad: ['#d9f1fd', '#93dbf8'], tagBg: '#d9f1fd', tagFg: '#0b7bb0' } },
  { keys: ['holiday', 'closed', 'notice', 'leave'], style: { emoji: '🏫', grad: ['#d9f1fd', '#93dbf8'], tagBg: '#d9f1fd', tagFg: '#0b7bb0' } },
];
function styleFor(c: Circular): Style {
  const hay = `${c.category || ''} ${c.title}`.toLowerCase();
  for (const s of STYLES) if (s.keys.some((k) => hay.includes(k))) return s.style;
  return DEFAULT_STYLE;
}

export default function UpdatesScreen() {
  const router = useRouter();
  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['circulars'],
    queryFn: () => api<{ circulars: Circular[] }>('/api/parent/circulars'),
  });
  const items = data?.circulars ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.appbg }}>
      <ScreenHero title="Updates" subtitle="News, events & notices from school 🔔" onBack={() => router.back()} />
      <FlashList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: S.gutter }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.violet} colors={[C.violet]} />}
        ListEmptyComponent={
          <View style={{ marginTop: S.sm }}>
            <StateBlock emoji="📭" title="No updates yet" body="News and notices from school will show up here." />
          </View>
        }
        renderItem={({ item }) => {
          const st = styleFor(item);
          return (
            <Card padding={S.md} radius={R.lg} elevation="sm" style={{ flexDirection: 'row', gap: S.md, marginBottom: S.md }}>
              <LinearGradient colors={st.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 46, height: 46, borderRadius: R.md, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 21 }}>{st.emoji}</Text>
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <Text style={[type('bodyStrong', C.ink), { flex: 1 }]} numberOfLines={2}>{item.title}</Text>
                  <Text style={[type('micro', C.inkMut), { marginLeft: S.sm, marginTop: 2 }]}>{new Date(item.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
                </View>
                <Text style={[type('body', C.inkSoft), { marginTop: 3 }]}>{item.body}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.sm }}>
                  {item.pinned ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: C.goldSoft }}>
                      <Text style={type('micro', C.goldDeep)}>📌 PINNED</Text>
                    </View>
                  ) : null}
                  {item.category ? (
                    <View style={{ alignSelf: 'flex-start', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: st.tagBg }}>
                      <Text style={[type('micro', st.tagFg), { textTransform: 'uppercase' }]}>{item.category}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}
