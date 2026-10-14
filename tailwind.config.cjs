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
        accenttext: v('accent-text'),
        onaccent: v('onaccent'),
        ok: v('ok'),
        warn: v('warn'),
        bad: v('bad'),
        info: v('info'),
        hover: v('hover')
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        dialog: 'var(--shadow-dialog)'
      },
      fontFamily: { sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
}
