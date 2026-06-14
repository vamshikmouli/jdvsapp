import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary: Purple
        purple: {
          50: '#F5F1FE',
          100: '#EBE3FD',
          200: '#D8C8FB',
          300: '#BFA3F7',
          400: '#A07AF1',
          500: '#7C3AED',
          600: '#6428CC',
          700: '#501FA3',
          800: '#3F1A82',
          900: '#311666',
        },
        // Accent: Marigold
        marigold: {
          50: '#FEF6E7',
          100: '#FDE8B9',
          300: '#F9C966',
          500: '#F2A516',
          600: '#C9860B',
          700: '#9C6608',
        },
        // Neutrals: Cool slate
        slate: {
          0: '#FFFFFF',
          25: '#FBFCFD',
          50: '#F5F7FA',
          100: '#EDF1F6',
          200: '#DDE3EB',
          300: '#C2CBD6',
          400: '#94A0B2',
          500: '#6B7785',
          600: '#4B5563',
          700: '#2F3742',
          800: '#1C222B',
          900: '#0F141B',
        },
        // Semantic: Status colors
        success: {
          50: '#E8F7EE',
          100: '#C8ECD4',
          500: '#1F8A4C',
          600: '#156D3B',
          700: '#0F5530',
        },
        warn: {
          50: '#FFF4E0',
          100: '#FDE3B4',
          500: '#C97A0A',
          600: '#A6620A',
        },
        danger: {
          50: '#FCEBEC',
          100: '#F8CDD0',
          500: '#C7322E',
          600: '#A4231F',
          700: '#7F1A17',
        },
        info: {
          50: '#E6F2FB',
          100: '#BFDEF4',
          500: '#1C77C3',
          600: '#155E9C',
        },
      },
      fontFamily: {
        display: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        body: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        'display-lg': ['44px', { lineHeight: '1.1', fontWeight: '700', letterSpacing: '-0.02em' }],
        'display': ['36px', { lineHeight: '1.15', fontWeight: '700', letterSpacing: '-0.02em' }],
        'h1': ['28px', { lineHeight: '1.2', fontWeight: '700', letterSpacing: '-0.02em' }],
        'h2': ['22px', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '-0.02em' }],
        'h3': ['18px', { lineHeight: '1.35', fontWeight: '600' }],
        'h4': ['16px', { lineHeight: '1.4', fontWeight: '600' }],
        'body-lg': ['17px', { lineHeight: '1.55', fontWeight: '400' }],
        'body': ['15px', { lineHeight: '1.55', fontWeight: '400' }],
        'body-sm': ['13px', { lineHeight: '1.5', fontWeight: '400' }],
        'meta': ['12px', { lineHeight: '1.4', fontWeight: '500' }],
        'overline': ['11px', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '0.08em' }],
        'button': ['14px', { lineHeight: '1', fontWeight: '600' }],
        'code': ['13px', { lineHeight: '1.5', fontWeight: '400' }],
      },
      spacing: {
        'px': '1px',
        '0': '0',
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
        '16': '64px',
        '20': '80px',
      },
      borderRadius: {
        'xs': '4px',
        'sm': '6px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
        'pill': '999px',
      },
      boxShadow: {
        'xs': '0 1px 2px 0 rgba(15, 20, 27, 0.08)',
        'sm': '0 1px 3px 0 rgba(15, 20, 27, 0.1), 0 1px 2px 0 rgba(15, 20, 27, 0.06)',
        'md': '0 4px 6px -1px rgba(15, 20, 27, 0.12), 0 2px 4px -1px rgba(15, 20, 27, 0.08)',
        'lg': '0 10px 15px -3px rgba(15, 20, 27, 0.15), 0 4px 6px -2px rgba(15, 20, 27, 0.08)',
        'xl': '0 20px 25px -5px rgba(15, 20, 27, 0.2), 0 10px 10px -5px rgba(15, 20, 27, 0.08)',
      },
      transitionDuration: {
        '200': '200ms',
      },
      transitionTimingFunction: {
        'out': 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      },
    },
  },
  plugins: [],
}

export default config
