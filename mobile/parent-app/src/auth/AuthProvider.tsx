import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { TOKEN_KEY, BIOMETRIC_KEY } from '@/config';
import { setAuthToken, setUnauthorizedHandler } from '@/api/client';
import { mobileLogin, mobileLogout, type ParentUser } from '@/api/auth';
import { registerForPush, unregisterPush, configurePushHandler } from '@/push';

// Global foreground notification behaviour (safe to call once at import).
configurePushHandler();

interface AuthState {
  ready: boolean; // finished reading persisted token
  token: string | null;
  user: ParentUser | null;
  biometricEnabled: boolean;
  signIn: (identifier: string, pin: string) => Promise<void>;
  signInWithToken: (token: string, user: ParentUser) => Promise<void>;
  signOut: () => Promise<void>;
  setBiometricEnabled: (on: boolean) => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<ParentUser | null>(null);
  const [biometricEnabled, setBio] = useState(false);

  const persist = useCallback(async (t: string | null, u: ParentUser | null) => {
    setToken(t);
    setUser(u);
    setAuthToken(t);
    if (t) await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify({ t, u }));
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  }, []);

  const signOut = useCallback(async () => {
    await unregisterPush().catch(() => {});
    await mobileLogout();
    await persist(null, null);
  }, [persist]);

  // Register this device for push whenever we have a valid session (sign-in or
  // a restored token). No-ops where push isn't available (Expo Go, emulator).
  useEffect(() => {
    if (token) registerForPush();
  }, [token]);

  // Wire the API client's 401 handler to sign out.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      persist(null, null);
    });
    return () => setUnauthorizedHandler(null);
  }, [persist]);

  // Restore persisted session on cold start, gated by biometrics when enabled.
  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(TOKEN_KEY);
        const bioOn = (await SecureStore.getItemAsync(BIOMETRIC_KEY)) === '1';
        setBio(bioOn);
        if (raw) {
          const { t, u } = JSON.parse(raw) as { t: string; u: ParentUser };
          if (bioOn) {
            const hw = await LocalAuthentication.hasHardwareAsync();
            const enrolled = await LocalAuthentication.isEnrolledAsync();
            if (hw && enrolled) {
              const res = await LocalAuthentication.authenticateAsync({
                promptMessage: 'Unlock Jnana Parent',
                fallbackLabel: 'Enter PIN',
              });
              if (!res.success) {
                // Failed biometrics does NOT sign out — leave to login gate.
                setReady(true);
                return;
              }
            }
          }
          setAuthToken(t);
          setToken(t);
          setUser(u);
        }
      } catch {
        // Corrupt/unreadable store → treat as signed out.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const signIn = useCallback(
    async (identifier: string, pin: string) => {
      const { token: t, user: u } = await mobileLogin(identifier, pin);
      await persist(t, u);
    },
    [persist],
  );

  const signInWithToken = useCallback(
    async (t: string, u: ParentUser) => {
      await persist(t, u);
    },
    [persist],
  );

  const setBiometricEnabled = useCallback(async (on: boolean) => {
    setBio(on);
    await SecureStore.setItemAsync(BIOMETRIC_KEY, on ? '1' : '0');
  }, []);

  return (
    <Ctx.Provider
      value={{ ready, token, user, biometricEnabled, signIn, signInWithToken, signOut, setBiometricEnabled }}
    >
      {children}
    </Ctx.Provider>
  );
}
