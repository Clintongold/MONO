/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#0A1B30',
          900: '#0E2A47',
          800: '#17395C',
          700: '#204A73',
          100: '#E4EAF1',
        },
        gold: {
          600: '#A9781F',
          500: '#C08A28',
          400: '#D6A94F',
          100: '#F3E6C9',
        },
        surface: '#F2F3F5',
        good: '#2E7D53',
        warn: '#B4750F',
        bad: '#B3261E',
      },
      fontFamily: {
        display: ['Manrope', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
