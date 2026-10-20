import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

// Small attendance ring, mirrors the web MiniDonut.
export function MiniDonut({ pct, marked }: { pct: number; marked: number }) {
  const size = 58, stroke = 7, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const off = c * (1 - clamped / 100);
  const color = !marked ? '#cbd5e1' : pct >= 90 ? '#1F8A4C' : pct >= 75 ? '#C97A0A' : '#C7322E';
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f141b' }}>{marked ? `${pct}%` : '—'}</Text>
      </View>
    </View>
  );
}
