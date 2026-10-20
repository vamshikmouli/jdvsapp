import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Stop, Ellipse, Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle } from 'lucide-react-native';
import { useAuth } from '@/auth/AuthProvider';
import { fetchBranding } from '@/api/auth';
import { ErrorNote } from '@/components/ErrorNote';
import { Stars } from '@/components/Kit';
import { Field, Button } from '@/components/ui';
import { C, G, S, R, type } from '@/theme';

function Lamp() {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: C.goldGlow, opacity: 0.28 }} />
      <Svg width={104} height={104} viewBox="0 0 96 96">
        <Defs>
          <RadialGradient id="bfl" cx="0.5" cy="0.34" r="0.62">
            <Stop offset="0" stopColor="#FFF4CE" />
            <Stop offset="0.55" stopColor="#FFC961" />
            <Stop offset="1" stopColor="#F7A70A" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={48} cy={30} rx={17} ry={23} fill="url(#bfl)" />
        <Ellipse cx={48} cy={27} rx={7.5} ry={13} fill="#fff" opacity={0.85} />
        <Path d="M14 60c8 12 20 16 34 16s26-4 34-16c-6 4-14 6-34 6s-28-2-34-6Z" fill="#7C3AED" />
        <Path d="M10 58c10 10 24 12 38 12s28-2 38-12c-4-4-10-4-15-2-6 2-12 4-23 4s-17-2-23-4c-5-2-11-2-15 2Z" fill="#5B21B6" />
      </Svg>
    </View>
  );
}

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
      <LinearGradient colors={G.heroGlow} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 480 }} />
      <Stars />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }} keyboardShouldPersistTaps="handled" bounces={false} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', paddingTop: insets.top + 44, paddingHorizontal: S.xxl, paddingBottom: S.lg }}>
            <Lamp />
            <Text style={[type('h1', '#fff'), { marginTop: S.lg }]}>Light up their journey</Text>
            <Text style={[type('body', 'rgba(255,255,255,0.72)'), { textAlign: 'center', marginTop: 6, maxWidth: 260 }]}>
              Attendance, report cards, streaks & rewards — all in one place.
            </Text>
          </View>

          {/* Form sheet */}
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: R.xxl, borderTopRightRadius: R.xxl, paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: insets.bottom + S.xl }}>
            <Text style={type('h2', C.ink)}>Welcome back 👋</Text>
            <Text style={[type('body', C.inkMut), { marginTop: 2, marginBottom: S.lg }]}>Sign in to see your child's progress</Text>

            {error ? <ErrorNote message={error} /> : null}

            <Field
              label="PHONE OR ADMISSION NO."
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="e.g. 99999 00000"
              autoCapitalize="none"
              autoComplete="username"
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
              editable={!loading}
            />

            <Button label="Sign in ✨" onPress={onSubmit} disabled={!canSubmit} loading={loading} style={{ marginTop: S.lg }} />

            <Pressable onPress={() => router.push('/(auth)/otp')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: S.lg }}>
              <MessageCircle size={15} color={C.violet} />
              <Text style={[type('bodyStrong', C.violet), { marginLeft: 6 }]}>First time or forgot PIN? Verify by WhatsApp</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
