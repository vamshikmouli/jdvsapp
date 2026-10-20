/** @type {import('tailwindcss').Config} */
// Gamified "lamp of knowledge" design system — deep indigo night + gold lamplight,
// with brand violet. Mirrors the approved HTML mockup. Fredoka (display/numbers)
// + Plus Jakarta Sans (body/UI) are loaded in app/_layout.tsx.
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // legacy tokens (kept so not-yet-restyled screens keep working)
        purple: {
          50: '#faf5ff', 100: '#f3e8ff', 400: '#c084fc', 500: '#a855f7',
          600: '#9333ea', 700: '#7c3aed', 800: '#6b21a8',
        },
        success: { 50: '#ecfdf5', 100: '#d1fae5', 500: '#1F8A4C', 600: '#16803f', 700: '#166534' },
        danger: { 50: '#fef2f2', 100: '#fee2e2', 500: '#C7322E', 600: '#dc2626', 700: '#b91c1c' },
        info: { 50: '#eff6ff', 100: '#dbeafe', 500: '#3b82f6', 700: '#1d4ed8' },
        marigold: { 50: '#fffbeb', 100: '#fef3c7', 500: '#f59e0b', 600: '#C97A0A', 700: '#b45309' },

        // gamified design system
        ink: { DEFAULT: '#241b45', soft: '#4a3f70', mut: '#8d86a8' },
        night: '#141029',
        hero: '#2a1f52',
        line: '#ece5fb',
        appbg: '#f4f0fe',
        grape: { DEFAULT: '#7c3aed', deep: '#5b21b6', soft: '#efe7fe' },
        gold: { DEFAULT: '#f7a70a', glow: '#ffc961', deep: '#c97a05', soft: '#fff0cf' },
        grass: { DEFAULT: '#12b981', soft: '#daf6ec' },
        coral: { DEFAULT: '#ff5a74', soft: '#ffe1e7' },
        aqua: { DEFAULT: '#34b7f1', soft: '#d9f1fd' },
      },
      fontFamily: {
        // Fredoka — display, headings, big numbers, badges
        fred: ['Fredoka_600SemiBold'],
        'fred-m': ['Fredoka_500Medium'],
        'fred-b': ['Fredoka_700Bold'],
        // Plus Jakarta Sans — body & UI
        jak: ['PlusJakartaSans_400Regular'],
        'jak-m': ['PlusJakartaSans_500Medium'],
        'jak-s': ['PlusJakartaSans_600SemiBold'],
        'jak-b': ['PlusJakartaSans_700Bold'],
        'jak-x': ['PlusJakartaSans_800ExtraBold'],
      },
    },
  },
  plugins: [],
};
