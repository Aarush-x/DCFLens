/** @type {import('tailwindcss').Config} */
// Colours map to the CSS variables in src/styles/tokens.css, never to hexes.
// tokens.css is the single source of truth; changing a hex here would fork it.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--ink)',
        surface: 'var(--surface)',
        cream: 'var(--cream)',
        dim: 'var(--dim)',
        faint: 'var(--faint)',
        hair: 'var(--hair)',
        hair2: 'var(--hair2)',
        accent: 'var(--accent)',
        hero: 'var(--hero)',
        under: 'var(--under)',
        fair: 'var(--fair)',
        over: 'var(--over)',
      },
      fontFamily: {
        display: ['var(--fd)'],
        sans: ['var(--f)'],
        mono: ['var(--m)'],
      },
    },
  },
  plugins: [],
}
