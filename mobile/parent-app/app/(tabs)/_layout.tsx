import { Redirect, Tabs } from 'expo-router';
import { House, FileText, Trophy, Wallet } from 'lucide-react-native';
import { useAuth } from '@/auth/AuthProvider';
import { C, F } from '@/theme';

export default function TabsLayout() {
  const { token } = useAuth();
  if (!token) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.violet,
        tabBarInactiveTintColor: C.inkMut,
        tabBarStyle: { borderTopColor: C.line, backgroundColor: '#fff', height: 60, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontFamily: F.jakB, fontSize: 10.5, letterSpacing: 0.2 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <House color={color} size={size - 1} /> }} />
      <Tabs.Screen name="marks" options={{ title: 'Report', tabBarIcon: ({ color, size }) => <FileText color={color} size={size - 1} /> }} />
      <Tabs.Screen name="rewards" options={{ title: 'Rewards', tabBarIcon: ({ color, size }) => <Trophy color={color} size={size - 1} /> }} />
      <Tabs.Screen name="fees" options={{ title: 'Fees', tabBarIcon: ({ color, size }) => <Wallet color={color} size={size - 1} /> }} />
      <Tabs.Screen name="photos" options={{ href: null }} />
    </Tabs>
  );
}
