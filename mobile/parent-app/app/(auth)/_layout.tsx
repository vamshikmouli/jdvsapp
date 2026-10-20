import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';

export default function AuthLayout() {
  const { token } = useAuth();
  // Already signed in → never show the auth screens.
  if (token) return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />;
}
