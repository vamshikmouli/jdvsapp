import { Redirect } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';

// Route the user based on whether a valid token was restored on cold start.
export default function Index() {
  const { token } = useAuth();
  return <Redirect href={token ? '/(tabs)' : '/(auth)/login'} />;
}
