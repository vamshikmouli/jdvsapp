import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle, Eye, EyeOff } from 'lucide-react-native';
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
  const [showPin, setShowPin] = useState(true);
  const scRef = useRef<ScrollView>(null);
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scRef}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: S.xl, paddingTop: insets.top + S.md, paddingBottom: insets.bottom + S.xl }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand */}
          <View style={{ alignItems: 'center', marginBottom: S.lg }}>
            <Image source={require('../../assets/logo.png')} style={{ width: 92, height: 92 }} contentFit="contain" />
            <Text style={[type('h2', '#fff'), { marginTop: S.sm, textAlign: 'center' }]}>Light up their journey</Text>
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
              inputStyle={{ fontSize: 22, letterSpacing: showPin ? 6 : 3 }}
              value={pin}
              onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
              placeholder="Enter your PIN"
              keyboardType="number-pad"
              secureTextEntry={!showPin}
              maxLength={6}
              returnKeyType="done"
              onFocus={() => setTimeout(() => scRef.current?.scrollToEnd({ animated: true }), 280)}
              onSubmitEditing={() => { if (canSubmit) onSubmit(); }}
              editable={!loading}
              rightSlot={
                <Pressable onPress={() => setShowPin((s) => !s)} hitSlop={12} style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
                  {showPin ? <Eye size={22} color={C.violet} /> : <EyeOff size={22} color={C.inkMut} />}
                </Pressable>
              }
            />
            <Text style={[type('micro', C.inkMut), { marginTop: 6 }]}>
              {showPin ? 'PIN visible — tap the eye to hide' : 'PIN hidden — tap the eye to show'}
            </Text>

            <Button label="Sign in ✨" onPress={onSubmit} disabled={!canSubmit} loading={loading} style={{ marginTop: S.xl }} />

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
