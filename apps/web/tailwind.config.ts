import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#dde8ff',
          500: '#4263eb',
          600: '#3451c7',
          700: '#2c44aa',
          900: '#1e2f6e',
        },
      },
    },
  },
  plugins: [],
};

export default config;
