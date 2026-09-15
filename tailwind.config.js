/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        mac: {
          bg: '#141416',
          sidebar: '#1a1b1e',
          card: '#1e1f23',
          cardHover: '#25272c',
          border: 'rgba(255, 255, 255, 0.08)',
          accent: '#0A84FF',
          accentHover: '#0077ED',
          success: '#30D158',
          warning: '#FFD60A',
          danger: '#FF453A',
          purple: '#BF5AF2',
        }
      },
      fontFamily: {
        sans: ['Doto', 'sans-serif'],
        mono: ['Doto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
