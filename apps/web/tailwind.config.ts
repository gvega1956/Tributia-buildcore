import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Brand: indigo profundo ──────────────────────────────────────────
        brand: {
          50:  '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
          900: '#312E81',
          950: '#1E1B4B',
        },
        // ── Superficie jerárquica ──────────────────────────────────────────
        surface: {
          0:   '#FFFFFF',
          1:   '#F8FAFC',   // slate-50
          2:   '#EEF0F6',   // fondo dashboard — tono más fresco que slate-100
          3:   '#E2E6EF',
          dark:'#020617',   // slate-950
        },
      },
      // ── Sistema de elevación (4 niveles) ────────────────────────────────
      boxShadow: {
        card:           '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.04)',
        'card-md':      '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
        'card-lg':      '0 8px 24px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.05)',
        'card-xl':      '0 16px 48px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.06)',
        // Glow semántico — para métricas y alertas
        brand:          '0 4px 14px rgba(99,102,241,0.28)',
        'brand-md':     '0 6px 20px rgba(99,102,241,0.38)',
        'glow-brand':   '0 0 24px rgba(99,102,241,0.25),  0 4px 12px rgba(0,0,0,0.06)',
        'glow-emerald': '0 0 20px rgba(16,185,129,0.22),  0 4px 12px rgba(0,0,0,0.06)',
        'glow-amber':   '0 0 20px rgba(245,158,11,0.22),  0 4px 12px rgba(0,0,0,0.06)',
        'glow-rose':    '0 0 20px rgba(244,63,94,0.22),   0 4px 12px rgba(0,0,0,0.06)',
        'glow-sky':     '0 0 20px rgba(14,165,233,0.22),  0 4px 12px rgba(0,0,0,0.06)',
      },
      // ── Drop-shadow para SVG / elementos con filter ──────────────────────
      dropShadow: {
        'glow-brand':   ['0 0 8px rgba(99,102,241,0.55)',  '0 0 24px rgba(99,102,241,0.22)'],
        'glow-emerald': ['0 0 8px rgba(16,185,129,0.55)',  '0 0 24px rgba(16,185,129,0.22)'],
        'glow-amber':   ['0 0 8px rgba(245,158,11,0.55)',  '0 0 24px rgba(245,158,11,0.22)'],
        'glow-rose':    ['0 0 8px rgba(244,63,94,0.55)',   '0 0 24px rgba(244,63,94,0.22)'],
      },
      // ── Gradientes reutilizables ─────────────────────────────────────────
      backgroundImage: {
        'dots':             'radial-gradient(circle, #c4cde0 1px, transparent 1px)',
        'gradient-mesh':    'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.07), transparent)',
        'gradient-brand':   'linear-gradient(135deg, #818CF8 0%, #6366F1 50%, #4F46E5 100%)',
        'gradient-dark':    'linear-gradient(160deg, #0f172a 0%, #0d0d1f 50%, #0f172a 100%)',
        'gradient-emerald': 'linear-gradient(135deg, #34d399, #10b981)',
        'gradient-amber':   'linear-gradient(135deg, #fbbf24, #f59e0b)',
        'gradient-rose':    'linear-gradient(135deg, #fb7185, #f43f5e)',
      },
      backgroundSize: {
        'dots': '22px 22px',
      },
      // ── Animaciones ─────────────────────────────────────────────────────
      animation: {
        'fade-in':        'fadeIn 0.15s ease-out',
        'slide-in-right': 'slideInRight 0.22s cubic-bezier(0.16,1,0.3,1)',
        'shimmer':        'shimmer 2.4s linear infinite',
        'pulse-slow':     'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'count-up':       'fadeIn 0.4s ease-out',
      },
      keyframes: {
        fadeIn:       { from: { opacity: '0' },                                to: { opacity: '1' } },
        slideInRight: { from: { transform: 'translateX(20px)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
