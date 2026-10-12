const v = (n) => `rgb(var(--${n}) / <alpha-value>)`

module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        panel: v('panel'),
        panel2: v('panel2'),
        line: v('line'),
        fg: v('fg'),
        soft: v('soft'),
        mute: v('mute'),
        accent: v('accent'),
        accent2: v('accent2'),
        ok: v('ok'),
        warn: v('warn'),
        bad: v('bad'),
        info: v('info'),
        hover: v('hover')
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)'
      },
      fontFamily: { sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
}
