import { useCallback, useEffect, useState } from 'react'
import { zy } from '../api'
import { Icon } from '../components/Icon'
import { Badge, Button, Card, PageHeader, ScanBar, Segmented, Toggle, useToast } from '../components/ui'
import { runTask } from '../lib/tasks'
import { clearFinished } from '../lib/tasks'
import { setThemeMode, ThemeMode, useThemeMode } from '../lib/theme'

interface RestorePoint { seq: number; description: string; created: string; byZyro: boolean }
type PointsState = { ok: true; points: RestorePoint[] } | { ok: false; reason: string } | null

type SysSettings = { launchAtLogin: boolean; minimizeToTray: boolean; autoRestorePoint: boolean }

export function Settings() {
  const mode = useThemeMode()
  const toast = useToast()
  const [sys, setSys] = useState<SysSettings | null>(null)
  const [version, setVersion] = useState('')
  const [points, setPoints] = useState<PointsState>(null)
  const [loadingPoints, setLoadingPoints] = useState(false)
  const [creating, setCreating] = useState(false)

  const loadPoints = useCallback(async () => {
    setLoadingPoints(true)
    try { setPoints(await zy.system.listRestorePoints()) } catch (e: any) { setPoints({ ok: false, reason: String(e?.message ?? e) }) }
    setLoadingPoints(false)
  }, [])

  useEffect(() => {
    zy.system.getSettings().then(setSys)
    zy.system.version().then(setVersion)
    loadPoints()
  }, [loadPoints])

  const set = async (key: keyof SysSettings, v: boolean) => {
    try { setSys(await zy.system.setSetting(key, v)) } catch (e: any) { toast('err', String(e.message ?? e)) }
  }

  async function createNow() {
    setCreating(true)
    try {
      await runTask({ title: 'Creating a restore point', icon: 'restore-page', page: 'settings', message: 'Asking Windows to create a restore point...' }, async (h) => {
        const r = await zy.system.createRestorePoint()
        if (!r.created) throw new Error(r.reason ?? 'Failed')
        h.done('Windows restore point created')
      })
      await loadPoints()
    } catch (e: any) { toast('err', `Could not create a restore point: ${String(e.message ?? e)}`) }
    setCreating(false)
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Appearance, startup behaviour, restore points and information about Zyro Optimizer." />
      <div className="max-w-3xl space-y-4 pb-2">
        <Card className="p-5">
          <div className="mb-1 flex items-center gap-2 font-bold"><Icon name="sun--v1" size={22} />Appearance</div>
          <p className="mb-4 text-[12px] text-mute">Choose a theme, or follow your Windows setting.</p>
          <Segmented<ThemeMode>
            value={mode}
            onChange={setThemeMode}
            options={[
              { value: 'dark', label: 'Dark', icon: 'moon-symbol' },
              { value: 'light', label: 'Light', icon: 'sun--v1' },
              { value: 'system', label: 'Match Windows', icon: 'computer' }
            ]}
          />
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2 font-bold"><Icon name="rocket" size={22} />Behaviour</div>
          {sys && (
            <>
              <Row label="Start with Windows" hint="Starts minimized in the tray so scheduled cleaning keeps working." on={sys.launchAtLogin} onChange={(v) => set('launchAtLogin', v)} />
              <Row label="Keep running in the tray when the window is closed" hint="Closing the window frees almost all memory. The tray agent uses only a few MB." on={sys.minimizeToTray} onChange={(v) => set('minimizeToTray', v)} />
            </>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2 font-bold"><Icon name="restore-page" size={22} />Restore points</div>
          {sys && (
            <Row
              label="Create a restore point automatically before Tune changes"
              hint="Applies to Tweaks, the Debloater and app updates. Needs administrator rights and System Protection turned on. A point made in the last 10 minutes is reused."
              on={sys.autoRestorePoint}
              onChange={(v) => set('autoRestorePoint', v)}
            />
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button icon="restore-page" onClick={createNow} busy={creating}>Create restore point now</Button>
            <Button variant="ghost" icon="refresh" onClick={loadPoints} busy={loadingPoints}>Refresh</Button>
            <Button variant="ghost" icon="time-machine" onClick={() => zy.system.openSystemRestore()}>Open System Restore</Button>
          </div>
          <div className="relative mt-4 overflow-hidden rounded-lg border border-line">
            <ScanBar active={loadingPoints} />
            {points === null ? (
              <div className="p-4 text-[13px] text-mute">Reading restore points...</div>
            ) : !points.ok ? (
              <div className="flex items-start gap-3 p-4 text-[13px] text-mute"><Icon name="info" size={22} />{points.reason}. Restart Zyro as administrator to see and create restore points.</div>
            ) : points.points.length === 0 ? (
              <div className="p-4 text-[13px] text-mute">No restore points yet. If this stays empty, System Protection may be turned off for your system drive.</div>
            ) : (
              <div className="max-h-[300px] overflow-auto">
                {points.points.map((p, n) => (
                  <div key={p.seq} style={{ animationDelay: `${Math.min(n, 10) * 22}ms` }} className="fade-up flex items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-0">
                    <Icon name="restore-page" size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{p.description || 'Restore point'}</div>
                      <div className="text-[12px] text-mute">{p.created ? new Date(p.created).toLocaleString() : ''}</div>
                    </div>
                    {p.byZyro && <Badge tone="info">Zyro</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="mt-3 text-[12px] text-mute">To go back to a restore point, open System Restore and choose it there.</p>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2 font-bold"><Icon name="bell" size={22} />Action Center</div>
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-mute">Finished jobs stay in the Action Center so you can review them. Clear the list any time.</p>
            <Button variant="ghost" onClick={() => { clearFinished(); toast('ok', 'Action Center history cleared') }}>Clear history</Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-4">
            <img src="./icon.png" alt="" className="h-14 w-14 rounded-lg shadow-card" />
            <div className="flex-1">
              <div className="text-[16px] font-bold">Zyro Optimizer</div>
              <div className="text-[12px] text-mute">Version {version || '...'}</div>
            </div>
          </div>
          <p className="mt-4 text-[12px] leading-5 text-mute">Zyro does not collect or send any data. Every change it makes is logged on the Restore page so it can be undone.</p>
          <button
            onClick={() => zy.system.openTelegram()}
            className="mt-4 flex w-full items-center gap-3 rounded-lg border border-line/60 px-3 py-2.5 text-left transition-colors hover:bg-hover"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#2AABEE" aria-hidden="true"><path d="M21.9 4.1a1.2 1.2 0 0 0-1.2-.2L2.6 10.9c-.9.4-.9 1.2-.2 1.4l4.6 1.4 1.8 5.5c.2.6.4.8.8.8.3 0 .5-.1.8-.4l2.3-2.2 4.6 3.4c.8.5 1.5.2 1.7-.8l3-14.7c.2-.9-.3-1.4-.1-1.2zM9.2 13.6l9.4-5.9c.4-.3.8-.1.5.2l-7.8 7-.3 3.2-1.8-4.5z"/></svg>
            <div className="flex-1">
              <div className="text-[13px] font-semibold">Telegram channel</div>
              <div className="text-[12px] text-mute">t.me/ZeroNullex</div>
            </div>
          </button>
          <div className="mt-4 border-t border-line/60 pt-4 text-center text-[13px] text-soft">Made with <span className="text-[#e8445a]">❤️</span> by <b className="font-semibold text-fg">ZeroNullex Team</b></div>
        </Card>
      </div>
    </>
  )
}

function Row({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line/50 py-3 last:border-0">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[12px] leading-4 text-mute">{hint}</div>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  )
}
