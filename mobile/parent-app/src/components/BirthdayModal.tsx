import React, { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import { C, S, R, type } from '@/theme';

interface Wish { kind: 'STUDENT' | 'STAFF'; id: string; name: string; firstName: string; age: number | null; title: string; body: string }
interface BirthdayResp { todayKey: string; schoolName: string; wishes: Wish[] }

/**
 * Birthday greeting on the child's birthday — a bottom sheet shown once per day per
 * device (the push notification is sent separately by the server's daily job).
 */
export function BirthdayModal() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['birthdays'],
    queryFn: () => api<BirthdayResp>('/api/birthdays/me'),
    staleTime: 60 * 60 * 1000,
  });

  useEffect(() => {
    if (!data?.wishes?.length) return;
    AsyncStorage.getItem(`bday-seen-${data.todayKey}`)
      .then((v) => { if (v !== '1') setOpen(true); })
      .catch(() => setOpen(true));
  }, [data]);

  const close = () => {
    setOpen(false);
    if (data) AsyncStorage.setItem(`bday-seen-${data.todayKey}`, '1').catch(() => {});
  };

  if (!data?.wishes?.length) return null;
  const single = data.wishes.length === 1 ? data.wishes[0] : null;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16,10,40,0.5)' }} onPress={close}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: '#fff', borderTopLeftRadius: R.xxl, borderTopRightRadius: R.xxl, paddingBottom: insets.bottom + S.lg, paddingTop: S.md, paddingHorizontal: S.gutter }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: S.lg }} />

          <View style={{ alignItems: 'center', backgroundColor: C.goldSoft, borderRadius: R.xl, paddingVertical: S.xl, marginBottom: S.lg }}>
            <Text style={{ fontSize: 22, marginBottom: 4 }}>🎈 🎉 ✨</Text>
            <Text style={{ fontSize: 64 }}>🎂</Text>
            <Text style={[type('h1', C.violetDeep), { marginTop: S.md, textAlign: 'center' }]}>
              Happy Birthday{single ? `, ${single.firstName}` : ''}!
            </Text>
            {single?.age ? <Text style={[type('bodyStrong', C.goldDeep), { marginTop: 4 }]}>Turns {single.age} today</Text> : null}
          </View>

          {data.wishes.map((w) => (
            <View key={w.id} style={{ marginBottom: S.md }}>
              {!single && (
                <Text style={type('bodyStrong', C.ink)}>
                  {w.name}{w.age ? ` · turns ${w.age}` : ''}
                </Text>
              )}
              <Text style={[type('body', C.inkMut), { marginTop: 2 }]}>{w.body}</Text>
            </View>
          ))}

          <Pressable onPress={close} style={{ marginTop: S.md, backgroundColor: C.violet, borderRadius: R.xl, paddingVertical: S.md, alignItems: 'center' }}>
            <Text style={type('bodyStrong', '#fff')}>Thank you! 🎉</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
