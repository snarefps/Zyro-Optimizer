export const GLYPH_FONT = "'Segoe Fluent Icons', 'Segoe MDL2 Assets'"

const GLYPHS: Record<string, string> = {
  'alarm-clock': '\uE916',
  'available-updates': '\uE895',
  bell: '\uEA8F',
  'box-important': '\uE7BA',
  broom: '\uEA99',
  calendar: '\uE787',
  cancel: '\uE711',
  checkmark: '\uE73E',
  computer: '\uE7F8',
  'control-panel': '\uE9E9',
  controller: '\uE7FC',
  cut: '\uE74D',
  'dashboard-layout': '\uE80F',
  database: '\uE8B7',
  error: '\uE783',
  'flash-on': '\uE945',
  'folder-tree': '\uE838',
  hdd: '\uEDA2',
  info: '\uE946',
  maintenance: '\uE90F',
  'memory-slot': '\uEEA1',
  'moon-symbol': '\uE708',
  package: '\uE7B8',
  privacy: '\uE72E',
  processor: '\uE950',
  'recycle-bin': '\uE74D',
  refresh: '\uE72C',
  restart: '\uE777',
  'restore-page': '\uE777',
  rocket: '\uE7E8',
  search: '\uE721',
  'security-checked': '\uEA18',
  settings: '\uE713',
  shield: '\uEA18',
  'software-installer': '\uE896',
  sparkling: '\uE9F5',
  speed: '\uEC4A',
  ssd: '\uEDA2',
  'sun--v1': '\uE706',
  'thumb-up': '\uE8E1',
  'time-machine': '\uE81C',
  time: '\uE916',
  timer: '\uE916',
  undo: '\uE7A7',
  'warning-shield': '\uEA18',
  wifi: '\uE701',
  'windows-11': '\uE7F4'
}

export function glyphSize(size: number) {
  return size <= 22 ? 16 : size <= 32 ? 20 : size <= 40 ? 24 : Math.round(size * 0.6)
}

export function Icon({ name, size = 20, className = '', color = false }: { name: string; size?: number; className?: string; color?: boolean }) {
  const glyph = GLYPHS[name]
  if (glyph && !color) {
    return (
      <span aria-hidden className={`inline-flex shrink-0 select-none items-center justify-center ${className}`} style={{ width: size, height: size, fontFamily: GLYPH_FONT, fontSize: glyphSize(size), lineHeight: 1 }}>
        {glyph}
      </span>
    )
  }
  return <img src={`./icons/${name}.png`} width={size} height={size} alt="" draggable={false} className={`inline-block shrink-0 select-none ${className}`} style={{ width: size, height: size }} />
}
