import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight } from 'lucide-react-native';
import { useAuth } from '@/auth/AuthProvider';
import { requestOtp, verifyOtp, setPin as setPinApi, mobileLogin, type OtpAccount } from '@/api/auth';
import { ErrorNote } from '@/components/ErrorNote';
import { Stars } from '@/components/Kit';
import { Field, Button, Txt } from '@/components/ui';
import { C, G, S, R, E, type } from '@/theme';

type Step = 'phone' | 'code' | 'setpin' | 'role';

// First-login / forgot-PIN: WhatsApp OTP → set PIN → sign in. Parent-only:
// accounts are filtered to the PARENT surface before the role picker.
export default function OtpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn, signInWithToken } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [grantToken, setGrantToken] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [accounts, setAccounts] = useState<OtpAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const guard = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const submitPhone = () => guard(async () => { await requestOtp(phone.trim()); setStep('code'); });
  const submitCode = () => guard(async () => {
    const { grantToken: gt } = await verifyOtp(phone.trim(), code);
    setGrantToken(gt); setStep('setpin');
  });
  const submitPin = () => guard(async () => {
    if (pin !== pin2) throw new Error("PINs don't match.");
    const { accounts: all } = await setPinApi(phone.trim(), grantToken, pin);
    const parents = (all || []).filter((a) => (a.surface || 'PARENT') === 'PARENT');
    if (parents.length <= 1) {
      const acc = parents[0];
      await signIn(acc?.email ?? phone.trim(), pin);
    } else { setAccounts(parents); setStep('role'); }
  });
  const pickAccount = (acc: OtpAccount) => guard(async () => {
    const { token, user } = await mobileLogin(acc.email, pin);
    await signInWithToken(token, user);
  });

  const back = () => (step === 'phone' ? router.back() : setStep('phone'));

  return (
    <View style={{ flex: 1, backgroundColor: C.night }}>
      <LinearGradient colors={G.heroGlow} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 420 }} />
      <Stars />
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: S.xl, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ backgroundColor: C.white, borderRadius: R.xxl, padding: S.xl, ...E.lg }}>
          <Pressable onPress={back} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: S.md }} hitSlop={8}>
            <ArrowLeft size={16} color={C.inkMut} />
            <Txt variant="body" color={C.inkMut} style={{ marginLeft: 6 }}>Back</Txt>
          </Pressable>

          {error ? <ErrorNote message={error} /> : null}

          {step === 'phone' && (
            <>
              <Txt variant="h2">Verify your number</Txt>
              <Txt variant="body" color={C.inkMut} style={{ marginTop: 2, marginBottom: S.lg }}>We'll send a 6-digit code to your WhatsApp.</Txt>
              <Field value={phone} onChangeText={setPhone} placeholder="Registered phone number" keyboardType="phone-pad" editable={!loading} />
              <Button label="Send code" loading={loading} disabled={!phone} onPress={submitPhone} style={{ marginTop: S.lg }} />
            </>
          )}

          {step === 'code' && (
            <>
              <Txt variant="h2">Enter the code</Txt>
              <Txt variant="body" color={C.inkMut} style={{ marginTop: 2, marginBottom: S.lg }}>Sent to {phone} on WhatsApp.</Txt>
              <Field
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
                placeholder="––––––"
                keyboardType="number-pad"
                maxLength={6}
                editable={!loading}
                inputStyle={{ height: 58, textAlign: 'center', fontSize: 26, letterSpacing: 10 }}
              />
              <Button label="Verify" loading={loading} disabled={code.length !== 6} onPress={submitCode} style={{ marginTop: S.lg }} />
              <Pressable onPress={submitPhone} style={{ marginTop: S.md }}>
                <Txt variant="bodyStrong" color={C.violet} center>Resend code</Txt>
              </Pressable>
            </>
          )}

          {step === 'setpin' && (
            <>
              <Txt variant="h2">Set your PIN</Txt>
              <Txt variant="body" color={C.inkMut} style={{ marginTop: 2, marginBottom: S.lg }}>Choose a 4–6 digit PIN you'll use to sign in.</Txt>
              <Field value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, ''))} placeholder="New PIN (4–6 digits)" keyboardType="number-pad" secureTextEntry maxLength={6} editable={!loading} />
              <Field style={{ marginTop: S.md }} value={pin2} onChangeText={(t) => setPin2(t.replace(/\D/g, ''))} placeholder="Confirm PIN" keyboardType="number-pad" secureTextEntry maxLength={6} editable={!loading} />
              <Button label="Save PIN & sign in" loading={loading} disabled={pin.length < 4} onPress={submitPin} style={{ marginTop: S.lg }} />
            </>
          )}

          {step === 'role' && (
            <>
              <Txt variant="h2">Choose your account</Txt>
              <Txt variant="body" color={C.inkMut} style={{ marginTop: 2, marginBottom: S.lg }}>Your number is linked to more than one account.</Txt>
              {accounts.map((acc) => (
                <Pressable
                  key={acc.email}
                  onPress={() => pickAccount(acc)}
                  disabled={loading}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.appbg, padding: S.lg, marginBottom: S.md }}
                >
                  <View>
                    <Txt variant="bodyStrong">{acc.displayName}</Txt>
                    <Txt variant="caption" color={C.inkMut}>{acc.roleName}</Txt>
                  </View>
                  <ChevronRight size={18} color={C.inkMut} />
                </Pressable>
              ))}
            </>
          )}
        </View>
      </View>
    </View>
  );
}
