/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0d0d0d',
        surface: '#1a1a1a',
        border: '#2a2a2a',
        accent: '#e53e3e',
        'accent-hover': '#c53030',
        'text-primary': '#e8e8e8',
        'text-muted': '#888888',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'sans-serif'],
        mono: ['"Space Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
