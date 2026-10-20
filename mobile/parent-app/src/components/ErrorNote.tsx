import { View, Text } from 'react-native';
import { AlertCircle } from 'lucide-react-native';

export function ErrorNote({ message }: { message: string }) {
  return (
    <View className="flex-row items-start gap-2 bg-danger-50 border border-danger-100 rounded-xl p-3 mb-4">
      <AlertCircle size={16} color="#dc2626" />
      <Text className="flex-1 text-sm text-danger-700">{message}</Text>
    </View>
  );
}
