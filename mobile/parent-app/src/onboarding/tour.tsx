import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Dimensions, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stars } from '@/components/Kit';
import { C, G, S, R, E, type } from '@/theme';

const SEEN_KEY = 'onboarding.v1.seen';

// ─── Content ────────────────────────────────────────────────────────────
interface Slide { emoji: string; title: string; body: string }
const SLIDES: Slide[] = [
  { emoji: '👋', title: 'Welcome!', body: "Your child's school life — attendance, marks, fees and rewards — all in one friendly place." },
  { emoji: '⭐', title: 'Levels & Coins', body: 'Every present day, streak and badge earns XP and Coins. Watch your child level up over the year.' },
  { emoji: '🔥', title: 'Streaks', body: 'Attending regularly builds a streak. Weekends and holidays are protected, so streaks keep going.' },
  { emoji: '🏅', title: 'Badges', body: 'Unlock badges for great attendance, top marks and on-time fees — all on the Rewards tab.' },
  { emoji: '🧭', title: 'Four tabs', body: 'Home, Report (marks), Rewards and Fees — switch anytime from the bar at the bottom.' },
  { emoji: '🔔', title: 'Stay updated', body: 'Tap the bell at the top-right for school news, events and notices whenever you like.' },
];

export interface CoachStep { id: string; title: string; body: string; pad?: number }
const COACH_STEPS: CoachStep[] = [
  { id: 'coins', title: 'Coins', body: "Your child's coins — earned from attendance, streaks and badges. They grow over time!" },
  { id: 'bell', title: 'Updates', body: 'School news, events and notices live here. Tap the bell anytime.' },
  { id: 'level', title: 'Level & XP', body: 'Progress as your child attends and achieves. Reach the next level to rank up.' },
  { id: 'stats', title: "Today's snapshot", body: 'Attendance, streak, fee balance and badges — the quick view for the selected child.' },
  { id: 'tabbar', title: 'Navigate', body: 'Switch between Home, Report, Rewards and Fees from here.' },
];

// ─── Context ────────────────────────────────────────────────────────────
interface Rect { x: number; y: number; width: number; height: number }
interface TourCtx {
  register: (id: string, ref: React.RefObject<View | null>) => void;
  unregister: (id: string) => void;
  maybeAutoStart: () => void; // start once, if never seen
  replay: () => void;
}
const Ctx = createContext<TourCtx | null>(null);
export const useTour = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTour must be used within TourProvider');
  return c;
};

/** Wrap any element to make it a spotlight target. */
export function TourSpot({ id, children, style }: { id: string; children: React.ReactNode; style?: any }) {
  const ref = useRef<View | null>(null);
  const { register, unregister } = useTour();
  useEffect(() => {
    register(id, ref);
    return () => unregister(id);
  }, [id]);
  return <View ref={ref} collapsable={false} style={style}>{children}</View>;
}

function measure(ref?: React.RefObject<View | null>): Promise<Rect | null> {
  return new Promise((res) => {
    const node = ref?.current as any;
    if (!node?.measureInWindow) return res(null);
    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      if (width === 0 && height === 0) return res(null);
      res({ x, y, width, height });
    });
  });
}

// ─── Provider ───────────────────────────────────────────────────────────
export function TourProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<'idle' | 'welcome' | 'coach'>('idle');
  const spots = useRef(new Map<string, React.RefObject<View | null>>()).current;
  const startedRef = useRef(false);

  const register = useCallback((id: string, ref: React.RefObject<View | null>) => { spots.set(id, ref); }, [spots]);
  const unregister = useCallback((id: string) => { spots.delete(id); }, [spots]);

  const finish = useCallback(() => {
    setMode('idle');
    AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {});
  }, []);

  const maybeAutoStart = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const seen = await AsyncStorage.getItem(SEEN_KEY);
      if (seen !== '1') setMode('welcome');
    } catch {
      /* ignore */
    }
  }, []);

  const replay = useCallback(() => { startedRef.current = true; setMode('welcome'); }, []);

  return (
    <Ctx.Provider value={{ register, unregister, maybeAutoStart, replay }}>
      {children}
      {mode === 'welcome' && <WelcomeSlides onDone={() => setMode('coach')} onSkip={finish} />}
      {mode === 'coach' && <Coachmarks spots={spots} onDone={finish} />}
    </Ctx.Provider>
  );
}

// ─── Welcome slides ─────────────────────────────────────────────────────
function WelcomeSlides({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const insets = useSafeAreaInsets();
  const W = Dimensions.get('window').width;
  const [i, setI] = useState(0);
  const scRef = useRef<ScrollView>(null);
  const last = i >= SLIDES.length - 1;

  const go = (n: number) => { scRef.current?.scrollTo({ x: n * W, animated: true }); setI(n); };

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: C.night, zIndex: 1000 }]}>
      <LinearGradient colors={G.heroGlow} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 520 }} />
      <Stars />
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ alignItems: 'flex-end', paddingHorizontal: S.gutter, height: 44, justifyContent: 'center' }}>
          {!last && <Pressable onPress={onSkip} hitSlop={8}><Text style={type('bodyStrong', 'rgba(255,255,255,0.8)')}>Skip</Text></Pressable>}
        </View>

        <ScrollView
          ref={scRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / W))}
          style={{ flex: 1 }}
        >
          {SLIDES.map((s) => (
            <View key={s.title} style={{ width: W, alignItems: 'center', justifyContent: 'center', paddingHorizontal: S.xxl }}>
              <View style={{ width: 128, height: 128, borderRadius: 64, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', marginBottom: S.xl }}>
                <Text style={{ fontSize: 60 }}>{s.emoji}</Text>
              </View>
              <Text style={[type('display', '#fff'), { textAlign: 'center' }]}>{s.title}</Text>
              <Text style={[type('bodyL', 'rgba(255,255,255,0.78)'), { textAlign: 'center', marginTop: S.md, maxWidth: 300 }]}>{s.body}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Dots */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 7, paddingVertical: S.lg }}>
          {SLIDES.map((_, idx) => (
            <View key={idx} style={{ width: idx === i ? 22 : 7, height: 7, borderRadius: 4, backgroundColor: idx === i ? C.goldGlow : 'rgba(255,255,255,0.3)' }} />
          ))}
        </View>

        <View style={{ paddingHorizontal: S.xl, paddingBottom: S.lg }}>
          <Pressable onPress={() => (last ? onDone() : go(i + 1))} style={({ pressed }) => [{ borderRadius: R.pill, ...E.sm }, pressed && { opacity: 0.9 }]}>
            <LinearGradient colors={G.violetGold} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 54, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={type('h3', '#fff')}>{last ? "Show me around ✨" : 'Next'}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Coachmarks ─────────────────────────────────────────────────────────
function Coachmarks({ spots, onDone }: { spots: Map<string, React.RefObject<View | null>>; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = Dimensions.get('window');
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = COACH_STEPS[idx];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let r: Rect | null = null;
      if (step.id === 'tabbar') {
        const tabH = 60 + insets.bottom;
        r = { x: 6, y: H - tabH, width: W - 12, height: tabH };
      } else {
        // a target may need a tick to be laid out
        for (let attempt = 0; attempt < 4 && !r; attempt++) {
          r = await measure(spots.get(step.id));
          if (!r) await new Promise((res) => setTimeout(res, 60));
        }
      }
      if (!cancelled) setRect(r);
    })();
    return () => { cancelled = true; };
  }, [idx]);

  const pad = step.pad ?? 8;
  const hole = rect
    ? { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  const next = () => (idx >= COACH_STEPS.length - 1 ? onDone() : setIdx(idx + 1));

  // Tooltip above or below the hole depending on room.
  const below = hole ? hole.y + hole.height + 220 < H : true;
  const tipTop = hole ? (below ? hole.y + hole.height + 12 : Math.max(insets.top + 8, hole.y - 190)) : H / 2 - 90;

  const DIM = 'rgba(12,8,28,0.86)';
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
      {hole ? (
        <>
          {/* 4 dim panels around the spotlight hole */}
          <View style={{ position: 'absolute', left: 0, top: 0, right: 0, height: hole.y, backgroundColor: DIM }} />
          <View style={{ position: 'absolute', left: 0, top: hole.y + hole.height, right: 0, bottom: 0, backgroundColor: DIM }} />
          <View style={{ position: 'absolute', left: 0, top: hole.y, width: hole.x, height: hole.height, backgroundColor: DIM }} />
          <View style={{ position: 'absolute', left: hole.x + hole.width, top: hole.y, right: 0, height: hole.height, backgroundColor: DIM }} />
          {/* highlight ring */}
          <View pointerEvents="none" style={{ position: 'absolute', left: hole.x, top: hole.y, width: hole.width, height: hole.height, borderRadius: 16, borderWidth: 2, borderColor: C.goldGlow }} />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} />
      )}

      {/* tap anywhere to advance */}
      <Pressable style={StyleSheet.absoluteFill} onPress={next} />

      {/* tooltip card */}
      <View style={{ position: 'absolute', left: S.gutter, right: S.gutter, top: tipTop }}>
        <View style={{ backgroundColor: C.white, borderRadius: R.xl, padding: S.lg, ...E.lg }}>
          <Text style={type('h3', C.ink)}>{step.title}</Text>
          <Text style={[type('body', C.inkSoft), { marginTop: 4 }]}>{step.body}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.lg }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {COACH_STEPS.map((_, k) => (
                <View key={k} style={{ width: k === idx ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: k === idx ? C.violet : C.line }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
              <Pressable onPress={onDone} hitSlop={8}><Text style={type('bodyStrong', C.inkMut)}>Skip</Text></Pressable>
              <Pressable onPress={next} style={({ pressed }) => [{ borderRadius: R.pill, ...E.sm }, pressed && { opacity: 0.9 }]}>
                <LinearGradient colors={[C.violet, C.violetDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingHorizontal: S.xl, height: 42, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={type('bodyStrong', '#fff')}>{idx >= COACH_STEPS.length - 1 ? 'Done' : 'Next'}</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
