import type { Config } from 'tailwindcss';

// MML dashboard theme. A clean, professional MSP look built around the Micro
// Maintenance brand blue (#0070c0): branded sidebar, light content area with
// subtle gradients and bevelled cards, and a traffic-light status palette.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Micro Maintenance brand blue and supporting shades.
        brand: {
          50: '#e8f3fb',
          100: '#cfe6f6',
          200: '#a3cfee',
          300: '#6fb2e2',
          400: '#3a93d6',
          500: '#0e7cc9',
          600: '#0070c0', // company blue
          700: '#005a9b',
          800: '#004578',
          900: '#002f52',
        },
        // Status colours (green / amber / red + neutral).
        status: {
          online: '#16a34a',
          stale: '#d97706',
          offline: '#dc2626',
          pending: '#64748b',
        },
        sidebar: {
          DEFAULT: '#0b1f33',
          hover: '#13314d',
          active: '#1b4066',
        },
      },
      boxShadow: {
        bevel: '0 1px 2px rgba(15,23,42,0.06), 0 1px 3px rgba(15,23,42,0.05), inset 0 1px 0 #ffffff',
        'bevel-hover': '0 10px 24px rgba(15,23,42,0.10), 0 3px 8px rgba(15,23,42,0.08), inset 0 1px 0 #ffffff',
        brand: '0 1px 2px rgba(0,112,192,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
