'use client';

import { useEffect, useState } from 'react';

interface Badge { key: string; label: string; emoji: string; need: number; earned: boolean; desc: string; }
interface Stats { currentStreak: number; longestStreak: number; totalAttended: number; totalMarked: number; pct: number; lateCount: number; }

export function StreakCard({ studentId }: { studentId: string }) {
  const [data, setData] = useState<{ stats: Stats; badges: Badge[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/parent/streaks?studentId=${studentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [studentId]);

  if (loading) return <div className="rounded-2xl h-32 bg-slate-100 animate-pulse" />;
  if (!data) return null;

  const { stats, badges } = data;
  const earned = badges.filter((b) => b.earned).length;
  const streak = stats.currentStreak;

  return (
    <div className="rounded-2xl overflow-hidden border border-amber-200 bg-white">
      {/* Streak header */}
      <div className="bg-gradient-to-br from-orange-500 to-amber-500 text-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-amber-50/90 uppercase tracking-wide">Attendance streak</div>
            {streak > 0 ? (
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-4xl font-extrabold leading-none">{streak}</span>
                <span className="text-lg font-semibold">day{streak === 1 ? '' : 's'} 🔥</span>
              </div>
            ) : (
              <div className="text-lg font-bold mt-0.5">Start your streak! 🔥</div>
            )}
            <div className="text-xs text-amber-50/90 mt-1">
              {streak > 0 ? 'Keep it going — be present tomorrow!' : 'Be present tomorrow to begin.'}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold leading-none">{stats.pct}%</div>
            <div className="text-[11px] text-amber-50/90">attendance</div>
            <div className="text-[11px] text-amber-50/90 mt-2">Best: {stats.longestStreak} 🏅</div>
          </div>
        </div>
      </div>

      {/* Badges */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2.5">
          <div className="text-sm font-semibold text-slate-800">Badges</div>
          <div className="text-xs text-slate-400">{earned}/{badges.length} earned</div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {badges.map((b) => (
            <div key={b.key} title={b.desc}
              className={`flex flex-col items-center text-center rounded-xl py-2 px-1 ${b.earned ? 'bg-amber-50' : 'bg-slate-50'}`}>
              <span className={`text-2xl leading-none ${b.earned ? '' : 'grayscale opacity-30'}`}>{b.emoji}</span>
              <span className={`text-[10px] mt-1 leading-tight ${b.earned ? 'text-amber-800 font-medium' : 'text-slate-400'}`}>{b.label}</span>
              {!b.earned && b.need > 0 && <span className="text-[9px] text-slate-300">{b.need}-day</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
