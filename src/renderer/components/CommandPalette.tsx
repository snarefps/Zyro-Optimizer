import { useEffect, useMemo, useRef, useState } from 'react'
import { zy } from '../api'
import { usePresence } from '../hooks/usePresence'
import { go, ROUTES } from '../lib/routes'
import { setActionCenterOpen } from '../lib/tasks'
import { resolve, setThemeMode, useThemeMode } from '../lib/theme'
import { Icon } from './Icon'
import { Kbd } from './ui'

interface Cmd {
  id: string
  label: string
  hint: string
  icon: string
  keywords: string
  run: () => void
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [admin, setAdmin] = useState(true)
  const input = useRef<HTMLInputElement>(null)
  const mode = useThemeMode()

  useEffect(() => {
    if (!open) return
    setQ(''); setIdx(0)
    zy.system.isAdmin().then(setAdmin).catch(() => undefined)
    setTimeout(() => input.current?.focus(), 30)
  }, [open])

  const commands = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [
      { id: 'center', label: 'Open Action Center', hint: 'See running and finished jobs', icon: 'bell', keywords: 'activity progress tasks notifications', run: () => setActionCenterOpen(true) },
      { id: 'theme', label: resolve(mode) === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', hint: 'Appearance', icon: resolve(mode) === 'dark' ? 'sun--v1' : 'moon-symbol', keywords: 'theme dark light appearance', run: () => setThemeMode(resolve(mode) === 'dark' ? 'light' : 'dark') }
    ]
    if (!admin) list.push({ id: 'admin', label: 'Restart as administrator', hint: 'Unlock the items marked "Needs admin"', icon: 'shield', keywords: 'admin elevate uac', run: () => { zy.system.relaunchAsAdmin().catch(() => undefined) } })
    // pages first so an empty search never lands on an action
    return [...ROUTES.map((r) => ({ id: r.id, label: r.label, hint: `Go to ${r.group}`, icon: r.icon, keywords: `${r.keywords} ${r.group}`, run: () => go(r.id) })), ...list]
  }, [mode, admin])

  // shared by the list and Enter so Enter never uses a stale list
  const filter = (query: string) => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return commands
    return commands.filter((c) => terms.every((t) => `${c.label} ${c.keywords}`.toLowerCase().includes(t)))
  }
  const results = useMemo(() => filter(q), [q, commands]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setIdx(0) }, [q])

  const { mounted, closing } = usePresence(open, 167)
  if (!mounted) return null
  const choose = (c?: Cmd) => { if (!c) return; onClose(); c.run() }

  return (
    <div className={`${closing ? 'fade-out' : 'fade-in'} fixed inset-0 z-[90] flex items-start justify-center bg-black/45 pt-[14vh]`} onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className={`${closing ? 'drop-out' : 'drop-in'} w-[560px] overflow-hidden rounded-lg border border-line bg-panel shadow-pop`}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Icon name="search" size={22} />
          <input
            ref={input}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages and actions..."
            className="!border-0 !bg-transparent !p-0 text-[15px] !shadow-none"
            style={{ width: '100%' }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
              else if (e.key === 'Enter') {
                const live = filter(e.currentTarget.value)
                choose(live[Math.min(idx, live.length - 1)])
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="max-h-[360px] overflow-auto p-2">
          {results.length === 0 && <div className="py-10 text-center text-[13px] text-mute">Nothing matches "{q}"</div>}
          {results.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setIdx(i)}
              onClick={() => choose(c)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${i === idx ? 'bg-accent/[0.13]' : ''}`}
            >
              <Icon name={c.icon} size={26} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{c.label}</div>
                <div className="truncate text-[12px] text-mute">{c.hint}</div>
              </div>
              {i === idx && <Kbd>Enter</Kbd>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-mute">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate</span>
          <span><Kbd>Enter</Kbd> select</span>
          <span className="ml-auto">Press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> anywhere</span>
        </div>
      </div>
    </div>
  )
}
