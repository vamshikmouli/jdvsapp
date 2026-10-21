import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle } from 'lucide-react-native';
import { useAuth } from '@/auth/AuthProvider';
import { fetchBranding } from '@/api/auth';
import { ErrorNote } from '@/components/ErrorNote';
import { Stars } from '@/components/Kit';
import { Field, Button } from '@/components/ui';
import { C, G, S, R, E, type } from '@/theme';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [, setBrand] = useState<{ schoolName: string; logoUrl?: string }>({ schoolName: 'Jnana Deepika' });

  useEffect(() => {
    fetchBranding().then((b) => setBrand({ schoolName: b.schoolName || 'Jnana Deepika', logoUrl: b.logoUrl }));
  }, []);

  const onSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      await signIn(identifier.trim(), pin);
    } catch (e: any) {
      setError(e?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = !loading && identifier.trim().length > 0 && pin.length >= 4;

  return (
    <View style={{ flex: 1, backgroundColor: C.night }}>
      <LinearGradient colors={G.heroGlow} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      <Stars />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: S.xl, paddingTop: insets.top + S.lg, paddingBottom: insets.bottom + S.lg }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand */}
          <View style={{ alignItems: 'center', marginBottom: S.xl }}>
            <Image source={require('../../assets/logo.png')} style={{ width: 128, height: 128 }} contentFit="contain" />
            <Text style={[type('h1', '#fff'), { marginTop: S.md, textAlign: 'center' }]}>Light up their journey</Text>
            <Text style={[type('body', 'rgba(255,255,255,0.72)'), { textAlign: 'center', marginTop: 4, maxWidth: 280 }]}>
              Attendance, report cards, streaks & rewards — all in one place.
            </Text>
          </View>

          {/* Form card */}
          <View style={{ backgroundColor: '#fff', borderRadius: R.xxl, padding: S.xl, ...E.lg }}>
            <Text style={type('h2', C.ink)}>Welcome back 👋</Text>
            <Text style={[type('body', C.inkMut), { marginTop: 2, marginBottom: S.lg }]}>Sign in to see your child's progress</Text>

            {error ? <ErrorNote message={error} /> : null}

            <Field
              label="PHONE OR ADMISSION NO."
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="e.g. 99999 00000"
              keyboardType="default"
              autoCapitalize="none"
              autoComplete="username"
              returnKeyType="next"
              editable={!loading}
            />
            <Field
              label="YOUR PIN"
              style={{ marginTop: S.md }}
              value={pin}
              onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
              placeholder="••••"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={() => { if (canSubmit) onSubmit(); }}
              editable={!loading}
            />

            <Button label="Sign in ✨" onPress={onSubmit} disabled={!canSubmit} loading={loading} style={{ marginTop: S.lg }} />

            <Pressable onPress={() => router.push('/(auth)/otp')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: S.lg }} hitSlop={8}>
              <MessageCircle size={15} color={C.violet} />
              <Text style={[type('bodyStrong', C.violet), { marginLeft: 6, textAlign: 'center' }]}>First time or forgot PIN? Verify by WhatsApp</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
