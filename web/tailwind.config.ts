import type { Config } from 'tailwindcss';

// MML dashboard theme. A clean, professional MSP look: dark slate sidebar,
// light content area, and a traffic-light status palette.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Status colours (green / amber / red + neutral).
        status: {
          online: '#16a34a',
          stale: '#d97706',
          offline: '#dc2626',
          pending: '#64748b',
        },
        sidebar: {
          DEFAULT: '#0f172a',
          hover: '#1e293b',
          active: '#334155',
        },
      },
    },
  },
  plugins: [],
};

export default config;
