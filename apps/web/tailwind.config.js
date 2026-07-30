/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        zamam: {
          primary: '#1B5E5A',
          primaryHover: '#164D49',
          teal: '#3A9E8F',
          tealLight: '#5CBFAE',
          navy: '#1A2744',
          dark: '#0F2027',
          light: '#F0F5F4',
          white: '#FFFFFF',
          gray: '#E0E8E6',
          textDark: '#0A1628',
          textGray: '#5A6B7A'
        },
        meta: {
          blue: '#1B5E5A',
          blueHover: '#164D49',
          dark: '#1A2744',
          light: '#F0F5F4',
          white: '#FFFFFF',
          gray: '#E0E8E6',
          textDark: '#0A1628',
          textGray: '#5A6B7A'
        }
      },
      fontFamily: {
        sans: ['Cairo', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        meta: '0 2px 4px rgba(0, 0, 0, 0.1), 0 8px 16px rgba(0, 0, 0, 0.1)',
        card: '0 1px 2px rgba(0, 0, 0, 0.2)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.1)',
        'glass-hover': '0 8px 32px 0 rgba(27, 94, 90, 0.2)'
      }
    },
  },
  plugins: [],
}
