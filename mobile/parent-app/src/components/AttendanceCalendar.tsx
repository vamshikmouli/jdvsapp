import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { CELL_COLOR } from '@/lib/format';

interface AttendanceResp {
  statuses: Record<string, string>;
  summary: { present: number; absent: number; leave: number; pct: number; marked: number } | null;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

function monthKey(y: number, m: number) {
  return `${y}-${pad(m + 1)}`;
}

export function AttendanceCalendar({ studentId }: { studentId: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth());
  const qc = useQueryClient();

  const fetchMonth = (mk: string) => api<AttendanceResp>(`/api/parent/attendance?studentId=${studentId}&month=${mk}`);

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', studentId, monthKey(year, month)],
    queryFn: () => fetchMonth(monthKey(year, month)),
  });

  // Prefetch the previous month so scrolling back has no spinner (plan §11.3).
  useEffect(() => {
    const pm = month === 0 ? monthKey(year - 1, 11) : monthKey(year, month - 1);
    qc.prefetchQuery({ queryKey: ['attendance', studentId, pm], queryFn: () => fetchMonth(pm) });
  }, [studentId, year, month]);

  const statuses = data?.statuses || {};
  const summary = data?.summary || null;

  const prev = () => (month === 0 ? (setYear((y) => y - 1), setMonth(11)) : setMonth((m) => m - 1));
  const next = () => (month === 11 ? (setYear((y) => y + 1), setMonth(0)) : setMonth((m) => m + 1));
  const canNext = year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month < now.getUTCMonth());

  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const todayKey = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <View className="px-4 py-3 border-t border-slate-100">
      <View className="flex-row items-center justify-between mb-3">
        <Pressable onPress={prev} className="p-1.5" hitSlop={8}>
          <ChevronLeft size={18} color="#64748b" />
        </Pressable>
        <Text className="text-sm font-semibold text-slate-900">{MONTHS[month]} {year}</Text>
        <Pressable onPress={next} disabled={!canNext} className="p-1.5" hitSlop={8} style={{ opacity: canNext ? 1 : 0.3 }}>
          <ChevronRight size={18} color="#64748b" />
        </Pressable>
      </View>

      <View className="flex-row mb-1">
        {WEEKDAYS.map((w, i) => (
          <Text key={i} className="flex-1 text-center text-[10px] font-semibold text-slate-400">{w}</Text>
        ))}
      </View>

      <View className="flex-row flex-wrap" style={{ opacity: isLoading ? 0.5 : 1 }}>
        {cells.map((d, i) => {
          if (d === null) return <View key={`b${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
          const key = `${year}-${pad(month + 1)}-${pad(d)}`;
          const st = statuses[key];
          const bg = st ? CELL_COLOR[st] || CELL_COLOR.none : 'transparent';
          const isToday = key === todayKey;
          return (
            <View key={key} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
              <View
                className="flex-1 items-center justify-center rounded-md"
                style={{ backgroundColor: bg, borderWidth: isToday ? 2 : 0, borderColor: '#7c3aed' }}
              >
                <Text className="text-xs font-medium" style={{ color: st ? '#fff' : '#94a3b8' }}>{d}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {summary && (
        <View className="flex-row flex-wrap gap-x-3 mt-3">
          <Text className="text-[11px] text-slate-500"><Text className="text-success-700 font-bold">{summary.present}</Text> present</Text>
          <Text className="text-[11px] text-slate-500"><Text className="text-danger-700 font-bold">{summary.absent}</Text> absent</Text>
          <Text className="text-[11px] text-slate-500"><Text className="text-info-700 font-bold">{summary.leave}</Text> leave</Text>
          {summary.marked > 0 && <Text className="text-[11px] font-medium text-slate-700 ml-auto">{summary.pct}% present</Text>}
        </View>
      )}
    </View>
  );
}
