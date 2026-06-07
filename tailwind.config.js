/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0B0B0C',
        surface: '#111113',
        border: 'rgba(255,255,255,0.08)',
        secondary: '#A1A1AA',
        'accent-purple': '#8B5CF6',
        'accent-blue': '#3B82F6',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['Charter', 'Iowan Old Style', 'Georgia', 'Cambria', 'serif'],
      },
      animation: {
        aurora: 'aurora 60s linear infinite',
        spotlight: 'spotlight 2s ease .75s 1 forwards',
        'border-beam': 'border-beam calc(var(--duration)*1s) infinite linear',
      },
      keyframes: {
        aurora: {
          from: { backgroundPosition: '50% 50%, 50% 50%' },
          to: { backgroundPosition: '350% 50%, 350% 50%' },
        },
        spotlight: {
          '0%': { opacity: '0', transform: 'translate(-72%, -62%) scale(0.5)' },
          '100%': { opacity: '1', transform: 'translate(-50%,-40%) scale(1)' },
        },
        'border-beam': {
          '100%': { 'offset-distance': '100%' },
        },
      },
    },
  },
  plugins: [],
}
