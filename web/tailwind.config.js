/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9eaff',
          500: '#1f6feb',
          600: '#1958c4',
          700: '#15479c',
          900: '#0b2550',
        },
      },
    },
  },
  plugins: [],
};
