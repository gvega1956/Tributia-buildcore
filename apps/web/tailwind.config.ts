import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary: indigo con carácter — más profundo que el azul original
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
      },
      boxShadow: {
        // Sistema de elevación en 4 niveles
        card:       '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.04)',
        'card-md':  '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
        'card-lg':  '0 8px 24px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.05)',
        brand:      '0 4px 14px rgba(99,102,241,0.28)',
        'brand-md': '0 6px 20px rgba(99,102,241,0.38)',
      },
      animation: {
        'fade-in':        'fadeIn 0.15s ease-out',
        'slide-in-right': 'slideInRight 0.22s cubic-bezier(0.16,1,0.3,1)',
      },
      keyframes: {
        fadeIn:        { from: { opacity: '0' },                                         to: { opacity: '1' } },
        slideInRight:  { from: { transform: 'translateX(20px)', opacity: '0' },          to: { transform: 'translateX(0)', opacity: '1' } },
      },
    },
  },
  plugins: [],
};

export default config;
