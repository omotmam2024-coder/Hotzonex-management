import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Atkinson Hyperlegible: made to be read on any screen; 0/O, 1/l/I and 5/S never look alike (voucher codes).
        sans: ['"Atkinson Hyperlegible Next Variable"', ...defaultTheme.fontFamily.sans],
        // Bricolage Grotesque: headings and big numbers (money, codes); narrow and heavy like printed card stock.
        display: ['"Bricolage Grotesque Variable"', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        brand: {
          // Cobalt from the "H" of the Hotzonex logo; 950 is the night blue of the menu.
          50: '#eef3ff',
          100: '#dce5ff',
          200: '#bccdfe',
          300: '#8ea9fb',
          400: '#5c7ff2',
          500: '#3560e3',
          600: '#1d47c9',
          700: '#1838a3',
          800: '#152f82',
          900: '#0f2466',
          950: '#0a1b4d',
        },
        // Orange from the Hotzonex logo (the "X"). Buttons use 700/800 so white text stays readable (AA contrast).
        accent: {
          50: '#fff4ec',
          100: '#ffe6d4',
          200: '#ffc9a6',
          300: '#ffa46d',
          400: '#fb7f3a',
          500: '#f26b1d',
          600: '#ee5a12',
          700: '#c8460a',
          800: '#9e370a',
          900: '#7d2e0c',
        },
      },
      boxShadow: {
        // Tinted with the night blue, not grey, so cards sit on the page instead of floating.
        card: '0 1px 0 rgb(10 27 77 / 0.04)',
        lift: '0 10px 30px -12px rgb(10 27 77 / 0.25), 0 2px 4px rgb(10 27 77 / 0.06)',
      },
    },
  },
  plugins: [],
};
