// Shared hex values for things NativeWind classes can't express (gradients,
// SVG strokes, canvas). Keep in sync with tailwind.config.js.
export const C = {
  ink: '#241b45',
  inkSoft: '#4a3f70',
  inkMut: '#8d86a8',
  night: '#141029',
  hero: '#2a1f52',
  line: '#ece5fb',
  appbg: '#f4f0fe',
  violet: '#7c3aed',
  violetDeep: '#5b21b6',
  violetSoft: '#efe7fe',
  gold: '#f7a70a',
  goldGlow: '#ffc961',
  goldDeep: '#c97a05',
  goldSoft: '#fff0cf',
  grass: '#12b981',
  grassSoft: '#daf6ec',
  coral: '#ff5a74',
  coralSoft: '#ffe1e7',
  aqua: '#34b7f1',
  aquaSoft: '#d9f1fd',
  white: '#ffffff',
} as const;

// Reusable gradient tuples (expo-linear-gradient `colors`).
export const G = {
  hero: ['#2a1f52', '#141029'] as const,          // night-sky header
  heroGlow: ['#4526a3', '#2a1f52', '#141029'] as const,
  violetGold: ['#7c3aed', '#f7a70a'] as const,     // XP / brand sweep
  lamp: ['#ffc961', '#f7a70a'] as const,           // gold lamplight
  present: ['#2ad294', '#12b981'] as const,
  late: ['#ffc75a', '#f7a70a'] as const,
  absent: ['#ff7d92', '#ff5a74'] as const,
  saHero: ['#3a2170', '#171029'] as const,         // summative report header
  faHero: ['#f59e0b', '#b45309'] as const,         // formative accent
  goldChip: ['#ffc961', '#f7a70a'] as const,
};

// Fredoka / Jakarta family names (from @expo-google-fonts) for inline styles.
export const F = {
  fred: 'Fredoka_600SemiBold',
  fredM: 'Fredoka_500Medium',
  fredB: 'Fredoka_700Bold',
  jak: 'PlusJakartaSans_400Regular',
  jakM: 'PlusJakartaSans_500Medium',
  jakS: 'PlusJakartaSans_600SemiBold',
  jakB: 'PlusJakartaSans_700Bold',
  jakX: 'PlusJakartaSans_800ExtraBold',
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Design system v2 — "bold & modern". One 4px grid, one radius scale, one
// elevation scale, one type ramp. Everything in the app composes from these
// so spacing, corners, shadows and text stay consistent across every screen.
// ─────────────────────────────────────────────────────────────────────────

/** 4px spacing grid. Use for padding, margin and gaps — never hard-code a gap. */
export const S = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  gutter: 18, // standard screen side padding
} as const;

/** Corner-radius scale. Cards use `xl`; pills use `pill`. */
export const R = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 28,
  pill: 999,
} as const;

/** Elevation presets — consistent iOS shadow + Android elevation, brand-tinted. */
export const E = {
  none: {},
  sm: {
    shadowColor: '#2a1a5e',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  md: {
    shadowColor: '#2a1a5e',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  lg: {
    shadowColor: '#241247',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
  },
} as const;

type TextToken = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  color?: string;
};

/** Type ramp. Fredoka = display/numbers; Jakarta = UI/body. Pair with a color. */
export const T = {
  display: { fontFamily: F.fredB, fontSize: 30, lineHeight: 34, letterSpacing: -0.4 },
  h1: { fontFamily: F.fredB, fontSize: 24, lineHeight: 28, letterSpacing: -0.3 },
  h2: { fontFamily: F.fred, fontSize: 19, lineHeight: 24, letterSpacing: -0.2 },
  h3: { fontFamily: F.fred, fontSize: 16, lineHeight: 21 },
  // Big metric numbers
  statXL: { fontFamily: F.fredB, fontSize: 30, lineHeight: 32, letterSpacing: -0.5 },
  statL: { fontFamily: F.fredB, fontSize: 24, lineHeight: 26, letterSpacing: -0.4 },
  // Body & UI
  bodyL: { fontFamily: F.jakM, fontSize: 15, lineHeight: 22 },
  body: { fontFamily: F.jakM, fontSize: 14, lineHeight: 20 },
  bodyStrong: { fontFamily: F.jakB, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: F.jakM, fontSize: 12, lineHeight: 16 },
  // Uppercase eyebrow / stat label
  label: { fontFamily: F.jakX, fontSize: 11, lineHeight: 14, letterSpacing: 0.8 },
  micro: { fontFamily: F.jakB, fontSize: 10, lineHeight: 13, letterSpacing: 0.4 },
} as const satisfies Record<string, TextToken>;

/** Compose a type token with a color (and optional overrides) for `style=`. */
export function type(token: keyof typeof T, color?: string, extra?: Partial<TextToken>) {
  return { ...T[token], ...(color ? { color } : null), ...extra };
}
