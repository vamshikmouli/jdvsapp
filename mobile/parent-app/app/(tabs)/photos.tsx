import React from 'react';
import { View, Text, ScrollView, RefreshControl, Dimensions, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ScreenHero, BellButton, Txt, Label, StateBlock } from '@/components/ui';
import { C, S, R, E, type } from '@/theme';

interface Album {
  name: string;
  photos: { id: string; url: string; caption: string | null }[];
}

const GAP = 4;
const COLS = 3;
const CARD_PAD = S.sm;

export default function PhotosScreen() {
  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['photos'],
    queryFn: () => api<{ albums: Album[] }>('/api/parent/photos'),
  });
  const albums = data?.albums ?? [];
  const inner = Dimensions.get('window').width - S.gutter * 2 - CARD_PAD * 2;
  const size = (inner - GAP * (COLS - 1)) / COLS;

  return (
    <View style={{ flex: 1, backgroundColor: C.appbg }}>
      <ScreenHero title="Photos" subtitle="Moments from school 📸" right={<BellButton />} />
      <ScrollView
        contentContainerStyle={{ padding: S.gutter, paddingBottom: S.huge }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.violet} colors={[C.violet]} />}
      >
        {albums.length === 0 ? (
          <StateBlock emoji="📷" title="No photos yet" body="School photo albums will appear here." />
        ) : (
          albums.map((a) => (
            <View key={a.name} style={{ backgroundColor: C.white, borderRadius: R.xl, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, marginBottom: S.lg, ...E.sm }}>
              <View style={{ paddingHorizontal: S.lg, paddingVertical: S.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={type('h3', C.ink)}>{a.name}</Text>
                <Label>{a.photos.length} photos</Label>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP, padding: CARD_PAD }}>
                {a.photos.map((p) => (
                  <Image
                    key={p.id}
                    source={{ uri: p.url }}
                    style={{ width: size, height: size, borderRadius: 6, backgroundColor: C.appbg }}
                    contentFit="cover"
                    transition={150}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
