import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogOut } from 'lucide-react-native';
import { useAuth } from '@/auth/AuthProvider';

// Purple gradient-style header used across the tabs (matches the web app).
export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { signOut } = useAuth();
  return (
    <View className="bg-purple-700">
      <SafeAreaView edges={['top']}>
        <View className="px-4 pt-2 pb-5 flex-row items-start justify-between">
          <View className="flex-1">
            <Text className="text-xs text-purple-100">Jnana Deepika · Parent</Text>
            <Text className="text-xl font-bold text-white mt-0.5">{title}</Text>
            {subtitle ? <Text className="text-xs text-purple-100 mt-0.5">{subtitle}</Text> : null}
          </View>
          <Pressable onPress={signOut} hitSlop={10} className="p-2">
            <LogOut size={20} color="#fff" />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
