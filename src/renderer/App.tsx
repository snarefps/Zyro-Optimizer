import { ComponentType, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatBytes, zy } from './api'
import { ActionCenterButton, ActionCenterPanel, TaskDock } from './components/ActionCenter'
import { CommandPalette } from './components/CommandPalette'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Icon } from './components/Icon'
import { WindowControls } from './components/TitleBar'
import { Kbd, ToastHost, useToast } from './components/ui'
import { logTask } from './lib/tasks'
import { go, ROUTES } from './lib/routes'
import { resolve, setThemeMode, useThemeMode } from './lib/theme'
import { Cleaner } from './pages/Cleaner'
import { Dashboard } from './pages/Dashboard'
import { Debloat } from './pages/Debloat'
import { Disk } from './pages/Disk'
import { Dns } from './pages/Dns'
import { GameBooster } from './pages/GameBooster'
import { History } from './pages/History'
import { Processes } from './pages/Processes'
import { Scheduler } from './pages/Scheduler'
import { Settings } from './pages/Settings'
import { Startup } from './pages/Startup'
import { Tweaks } from './pages/Tweaks'
import { Uninstaller } from './pages/Uninstaller'
import { Updates } from './pages/Updates'

const PAGES: Record<string, ComponentType> = {
  dashboard: Dashboard, cleaner: Cleaner, disk: Disk, uninstaller: Uninstaller, startup: Startup, gamebooster: GameBooster, processes: Processes,
  tweaks: Tweaks, debloat: Debloat, updates: Updates, dns: Dns, scheduler: Scheduler, history: History, settings: Settings
}

const currentRoute = () => window.location.hash.replace(/^#\//, '') || 'dashboard'
const COLLAPSE_KEY = 'zyro-sidebar-collapsed'

function NavItem({ id, label, icon, active, collapsed, pill }: { id: string; label: string; icon: string; active: boolean; collapsed: boolean; pill?: boolean }) {
  return (
    <button
      onClick={() => go(id)}
      data-active={active}
      title={collapsed ? label : undefined}
      className={`relative flex w-full items-center gap-3 rounded-lg py-[6px] text-left text-[13px] font-medium transition-colors duration-[167ms] ${collapsed ? 'justify-center px-0' : 'px-3'} ${active ? 'bg-hover/[0.07] text-fg' : 'text-soft hover:bg-hover/[0.05] hover:text-fg active:bg-hover/[0.03]'}`}
    >
      {pill && active && <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-accent" />}
      <Icon name={icon} size={22} />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  )
}

function Shell() {
  const [route, setRoute] = useState(currentRoute())
  const [admin, setAdmin] = useState<boolean | null>(null)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } })
  const [palette, setPalette] = useState(false)
  const [pill, setPill] = useState<{ top: number; h: number } | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const mode = useThemeMode()
  const toast = useToast()

  useEffect(() => {
    const h = () => setRoute(currentRoute())
    window.addEventListener('hashchange', h)
    zy.system.isAdmin().then(setAdmin).catch(() => setAdmin(false))
    // background cleans (schedule or tray) show up in the Action Center
    const off = window.zyro.on('scheduler:ran', (p: { freed?: number }) =>
      logTask({ title: 'Background clean', icon: 'broom', page: 'scheduler', message: p?.freed ? `Freed ${formatBytes(p.freed)}` : 'Ran, nothing to remove' })
    )
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p) }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('hashchange', h); window.removeEventListener('keydown', key); off() }
  }, [])

  const toggleCollapsed = () => setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch { /* ignore */ } return !c })
  const active = ROUTES.find((r) => r.id === route) ?? ROUTES[0]
  const Page = PAGES[active.id] ?? Dashboard
  const groups = [...new Set(ROUTES.filter((r) => r.group !== 'App').map((r) => r.group))]
  const dark = resolve(mode) === 'dark'

  // one pill element slides to the active item
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector('[data-active="true"]') as HTMLElement | null
    setPill(el ? { top: el.offsetTop, h: el.offsetHeight } : null)
  }, [active.id, collapsed])

  async function elevate() {
    const r = await zy.system.relaunchAsAdmin()
    if (!r.ok) toast('err', r.reason ?? 'Could not restart as administrator')
  }

  return (
    <div className="relative flex h-full">
      <WindowControls />

      <aside className={`flex shrink-0 flex-col border-r border-line bg-panel/60 transition-[width] duration-[250ms] ease-[cubic-bezier(0.55,0.55,0,1)] ${collapsed ? 'w-[76px]' : 'w-[248px]'}`}>
        <div data-tauri-drag-region className={`flex h-[52px] items-center gap-3 ${collapsed ? 'justify-center' : 'px-5'}`}>
          <img src="./icon.png" alt="" draggable={false} className="pointer-events-none h-8 w-8 rounded-lg" />
          {!collapsed && (
            <div className="pointer-events-none fade-in">
              <div className="text-[15px] font-bold leading-4 tracking-tight">Zyro Optimizer</div>
              <div className="mt-0.5 text-[11px] font-medium tracking-wide text-mute">by ZeroNullex</div>
            </div>
          )}
        </div>
        <nav ref={navRef} className="relative flex-1 overflow-auto px-3 pb-2">
          {pill && (
            <span
              className="pointer-events-none absolute left-3 z-10 w-[3px] rounded-full bg-accent transition-transform duration-[250ms] ease-[cubic-bezier(0.55,0.55,0,1)]"
              style={{ height: 16, transform: `translateY(${pill.top + (pill.h - 16) / 2}px)` }}
            />
          )}
          {groups.map((g) => (
            <div key={g} className="mb-1">
              {collapsed ? <div className="mx-3 my-2 h-px bg-line" /> : <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-mute">{g}</div>}
              <div className="space-y-0.5">{ROUTES.filter((r) => r.group === g).map((r) => <NavItem key={r.id} {...r} active={r.id === active.id} collapsed={collapsed} />)}</div>
            </div>
          ))}
        </nav>
        <div className="space-y-1.5 border-t border-line p-3">
          <NavItem id="settings" label="Settings" icon="settings" active={active.id === 'settings'} collapsed={collapsed} pill />
          {collapsed ? (
            <div className="flex justify-center py-1" title={admin ? 'Administrator mode' : 'Limited mode. Some items need administrator rights.'}>
              <Icon name={admin ? 'security-checked' : 'warning-shield'} size={26} />
            </div>
          ) : admin === false ? (
            <div className="fade-in rounded-lg border border-warn/25 bg-warn/10 p-2.5" title="Some cleaners and tweaks need administrator rights.">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-warn"><Icon name="warning-shield" size={18} />Limited mode</div>
              <button onClick={elevate} className="mt-2 w-full rounded-md bg-hover/10 px-2 py-1.5 text-[12px] font-semibold transition-colors duration-[83ms] hover:bg-hover/[0.16] active:bg-hover/[0.07]">Restart as admin</button>
            </div>
          ) : admin ? (
            <div className="fade-in flex items-center gap-2 rounded-lg border border-ok/25 bg-ok/10 px-3 py-2 text-[12px] font-medium text-ok"><Icon name="security-checked" size={18} />Administrator mode</div>
          ) : null}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {/* the header doubles as the title bar */}
        <header data-tauri-drag-region className="flex h-[56px] shrink-0 items-center gap-3 pl-8 pr-[154px]">
          <button onClick={toggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel text-soft transition-colors duration-[83ms] hover:bg-hover/[0.06] hover:text-fg active:bg-hover/[0.03]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
          </button>
          <div data-tauri-drag-region className="h-full flex-1" />
          <button onClick={() => setPalette(true)} className="flex h-9 w-[280px] items-center gap-2.5 whitespace-nowrap rounded-lg border border-line bg-panel px-3 text-[13px] text-mute transition-colors duration-[83ms] hover:bg-hover/[0.06]">
            <Icon name="search" size={18} /><span className="flex-1 truncate text-left">Search pages and actions</span><Kbd>Ctrl K</Kbd>
          </button>
          <button onClick={() => setThemeMode(dark ? 'light' : 'dark')} title={dark ? 'Switch to light theme' : 'Switch to dark theme'} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel transition-colors duration-[83ms] hover:bg-hover/[0.06] active:bg-hover/[0.03]">
            <Icon name={dark ? 'sun--v1' : 'moon-symbol'} size={20} />
          </button>
          <button onClick={() => zy.system.openGithub()} title="Zyro Optimizer on GitHub" className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel text-fg transition-colors duration-[83ms] hover:bg-hover/[0.06] active:bg-hover/[0.03]">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" /></svg>
          </button>
          <ActionCenterButton />
        </header>
        <div key={active.id} className="page-enter flex min-h-0 flex-1 flex-col overflow-auto px-8 pb-6 pt-1">
          <ErrorBoundary resetKey={active.id}><Page /></ErrorBoundary>
        </div>
      </main>

      <ActionCenterPanel />
      <TaskDock />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  )
}

export function App() {
  return (
    <ToastHost>
      <Shell />
    </ToastHost>
  )
}
