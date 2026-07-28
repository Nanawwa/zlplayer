export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#E8F4FF',
          100: '#C5E4FF',
          200: '#9ED1FF',
          300: '#77BEFF',
          400: '#5AACFF',
          500: '#0A84FF',
          600: '#0070E0',
          700: '#005CB8',
          800: '#004990',
          900: '#003668',
        },
      },
      padding: {
        safe: 'env(safe-area-inset-bottom)',
      },
    },
  },
  plugins: [],
};
