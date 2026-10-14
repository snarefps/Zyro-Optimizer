import { ComponentType, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatBytes, zy } from './api'
import { ActionCenterButton, ActionCenterPanel, TaskDock } from './components/ActionCenter'
import { CommandPalette } from './components/CommandPalette'
import { ErrorBoundary } from './components/ErrorBoundary'
import { GLYPH_FONT, Icon } from './components/Icon'
import { WindowControls } from './components/TitleBar'
import { Button, Kbd, ToastHost, useToast } from './components/ui'
import { logTask } from './lib/tasks'
import { checkOnStartup, dismissUpdate, openReleases, useUpdate } from './lib/update'
import { go, ROUTES } from './lib/routes'
import { resolve, setThemeMode, useThemeMode } from './lib/theme'
import { Apps } from './pages/Apps'
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
  tweaks: Tweaks, debloat: Debloat, updates: Updates, apps: Apps, dns: Dns, scheduler: Scheduler, history: History, settings: Settings
}

const currentRoute = () => window.location.hash.replace(/^#\//, '') || 'dashboard'
const COLLAPSE_KEY = 'zyro-sidebar-collapsed'
const EASE = 'ease-[cubic-bezier(0.55,0.55,0,1)]'

function NavItem({ id, label, icon, active, collapsed, pill }: { id: string; label: string; icon: string; active: boolean; collapsed: boolean; pill?: boolean }) {
  return (
    <button
      onClick={() => go(id)}
      data-active={active}
      title={collapsed ? label : undefined}
      className={`relative flex h-10 w-full items-center gap-3.5 rounded text-left text-[14px] transition-colors duration-[83ms] ${collapsed ? 'justify-center px-0' : 'px-3'} ${active ? 'bg-hover/[0.06]' : 'hover:bg-hover/[0.04] active:bg-hover/[0.03]'}`}
    >
      {pill && active && <span className="absolute left-0 top-3 h-4 w-[3px] rounded-full bg-accent" />}
      <Icon name={icon} size={20} color />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  )
}

function TitleButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} className="relative flex h-8 w-10 items-center justify-center text-fg transition-colors duration-[83ms] hover:bg-hover/[0.06] active:bg-hover/[0.04]">
      {children}
    </button>
  )
}

function Shell() {
  const [route, setRoute] = useState(currentRoute())
  const [admin, setAdmin] = useState<boolean | null>(null)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } })
  const [palette, setPalette] = useState(false)
  const [pill, setPill] = useState<number | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const mode = useThemeMode()
  const toast = useToast()
  const update = useUpdate()
  const newVersion = update.info?.available && update.dismissed !== update.info.latest ? update.info : null

  useEffect(() => {
    const h = () => setRoute(currentRoute())
    window.addEventListener('hashchange', h)
    zy.system.isAdmin().then(setAdmin).catch(() => setAdmin(false))
    checkOnStartup()
    const off = window.zyro.on('scheduler:ran', (p: { freed?: number }) =>
      logTask({ title: 'Background clean', icon: 'broom', page: 'scheduler', message: p?.freed ? `Freed ${formatBytes(p.freed)}` : 'Ran, nothing to remove' })
    )
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p) }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('hashchange', h); window.removeEventListener('keydown', key); off() }
  }, [])

  const toggleCollapsed = () => setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch {} return !c })
  const active = ROUTES.find((r) => r.id === route) ?? ROUTES[0]
  const Page = PAGES[active.id] ?? Dashboard
  const groups = [...new Set(ROUTES.filter((r) => r.group !== 'App').map((r) => r.group))]
  const dark = resolve(mode) === 'dark'

  useLayoutEffect(() => {
    const el = navRef.current?.querySelector('[data-active="true"]') as HTMLElement | null
    setPill(el ? el.offsetTop + (el.offsetHeight - 16) / 2 : null)
  }, [active.id, collapsed])

  async function elevate() {
    const r = await zy.system.relaunchAsAdmin()
    if (!r.ok) toast('err', r.reason ?? 'Could not restart as administrator')
  }

  return (
    <div className="flex h-full flex-col">
      <header data-tauri-drag-region className="flex h-8 shrink-0 items-center">
        <div className="pointer-events-none flex items-center gap-3 pl-4">
          <img src="./icon.png" alt="" draggable={false} className="h-4 w-4" />
          <span className="text-[12px]">Zyro Optimizer</span>
        </div>
        <div data-tauri-drag-region className="h-full flex-1" />
        <ActionCenterButton />
        <TitleButton onClick={() => setThemeMode(dark ? 'light' : 'dark')} title={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
          <span style={{ fontFamily: GLYPH_FONT, fontSize: 14, lineHeight: 1 }}>{dark ? '\uE706' : '\uE708'}</span>
        </TitleButton>
        <TitleButton onClick={() => zy.system.openGithub()} title="Zyro Optimizer on GitHub">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" /></svg>
        </TitleButton>
        <WindowControls />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={`flex shrink-0 flex-col transition-[width] duration-[250ms] ${EASE} ${collapsed ? 'w-[56px]' : 'w-[280px]'}`}>
          <div className={`flex flex-col gap-1 px-1.5 pb-2 pt-1 ${collapsed ? 'items-center' : ''}`}>
            <button onClick={toggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="flex h-10 w-11 items-center justify-center rounded transition-colors duration-[83ms] hover:bg-hover/[0.06] active:bg-hover/[0.03]">
              <span style={{ fontFamily: GLYPH_FONT, fontSize: 16, lineHeight: 1 }}>{'\uE700'}</span>
            </button>
            {collapsed ? (
              <button onClick={() => setPalette(true)} title="Search (Ctrl+K)" aria-label="Search" className="flex h-10 w-11 items-center justify-center rounded transition-colors duration-[83ms] hover:bg-hover/[0.06]"><Icon name="search" size={20} /></button>
            ) : (
              <button onClick={() => setPalette(true)} className="mx-1.5 mt-1 flex h-8 items-center gap-2 rounded border border-line border-b-hover/50 bg-hover/[0.06] pl-3 pr-2.5 text-[14px] text-mute transition-colors duration-[83ms] hover:bg-hover/[0.09]">
                <span className="flex-1 truncate text-left">Search pages and actions</span><Kbd>Ctrl K</Kbd><Icon name="search" size={16} className="text-fg" />
              </button>
            )}
          </div>
          <nav ref={navRef} className="relative min-h-0 flex-1 overflow-auto px-1.5 pb-2">
            {pill !== null && (
              <span
                className={`pointer-events-none absolute left-1.5 z-10 w-[3px] rounded-full bg-accent transition-transform duration-[250ms] ${EASE}`}
                style={{ height: 16, transform: `translateY(${pill}px)` }}
              />
            )}
            {groups.map((g) => (
              <div key={g} className="mb-1">
                {collapsed ? <div className="mx-3 my-2 h-px bg-hover/10" /> : <div className="px-3 pb-1 pt-3 text-[12px] leading-4 text-mute">{g}</div>}
                <div className="space-y-0.5">{ROUTES.filter((r) => r.group === g).map((r) => <NavItem key={r.id} id={r.id} label={r.label} icon={r.icon} active={r.id === active.id} collapsed={collapsed} />)}</div>
              </div>
            ))}
          </nav>
          <div className="space-y-0.5 px-1.5 pb-2 pt-1">
            {admin === false && !collapsed && (
              <div className="fade-in mx-1.5 mb-1 flex items-center gap-3 rounded-lg bg-hover/[0.04] py-2 pl-3 pr-2" title="Some cleaners and tweaks need administrator rights.">
                <Icon name="warning-shield" size={20} />
                <div className="min-w-0 flex-1 truncate text-[12px] leading-4 text-mute">Limited mode</div>
                <button onClick={elevate} className="btn-std h-7 shrink-0 rounded px-2.5 text-[12px]">Restart as admin</button>
              </div>
            )}
            {admin === false && collapsed && (
              <button onClick={elevate} title="Limited mode. Restart as administrator." className="flex h-10 w-full items-center justify-center rounded hover:bg-hover/[0.06]"><Icon name="warning-shield" size={20} /></button>
            )}
            {admin && !collapsed && <div className="fade-in flex items-center gap-3 px-3 py-1.5 text-[12px] leading-4 text-mute"><Icon name="security-checked" size={16} />Administrator mode</div>}
            <NavItem id="settings" label="Settings" icon="settings" active={active.id === 'settings'} collapsed={collapsed} pill />
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {newVersion && (
            <div className="fade-up mb-1 ml-10 mr-8 mt-2 flex shrink-0 items-center gap-3 rounded-lg bg-panel py-2 pl-4 pr-2 text-[14px] shadow-card">
              <Icon name="available-updates" size={20} />
              <div className="min-w-0 flex-1 truncate"><span className="font-semibold">Version {newVersion.latest} is available.</span> <span className="text-mute">You have {newVersion.current}.</span></div>
              <Button onClick={() => openReleases()}>Download</Button>
              <button onClick={() => dismissUpdate(newVersion.latest)} title="Dismiss" aria-label="Dismiss" className="flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-hover/[0.08]"><Icon name="cancel" size={16} /></button>
            </div>
          )}
          <div key={active.id} className="page-enter flex min-h-0 flex-1 flex-col overflow-auto pb-6 pl-10 pr-8 pt-3">
            <div className="flex min-h-0 w-full max-w-[1100px] flex-1 flex-col">
              <ErrorBoundary resetKey={active.id}><Page /></ErrorBoundary>
            </div>
          </div>
        </main>
      </div>

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
