import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import { GLYPH_FONT } from './Icon'

const base = 'flex h-8 w-[46px] items-center justify-center text-fg transition-colors duration-[83ms]'

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = getCurrentWindow()
    const sync = () => win.isMaximized().then(setMaximized).catch(() => undefined)
    sync()
    let off: (() => void) | undefined
    let dead = false
    win.onResized(sync).then((u) => (dead ? u() : (off = u))).catch(() => undefined)
    return () => { dead = true; off?.() }
  }, [])

  const win = () => getCurrentWindow()
  const glyph = (code: string) => <span style={{ fontFamily: GLYPH_FONT, fontSize: 10, lineHeight: 1 }}>{code}</span>

  return (
    <div className="flex shrink-0">
      <button className={`${base} hover:bg-hover/[0.06] active:bg-hover/[0.04]`} onClick={() => win().minimize()} title="Minimize" aria-label="Minimize">{glyph('\uE921')}</button>
      <button className={`${base} hover:bg-hover/[0.06] active:bg-hover/[0.04]`} onClick={() => win().toggleMaximize()} title={maximized ? 'Restore' : 'Maximize'} aria-label={maximized ? 'Restore' : 'Maximize'}>{glyph(maximized ? '\uE923' : '\uE922')}</button>
      <button className={`${base} hover:bg-[#c42b1c] hover:text-white active:bg-[#b22a1b] active:text-white`} onClick={() => win().close()} title="Close" aria-label="Close">{glyph('\uE8BB')}</button>
    </div>
  )
}
