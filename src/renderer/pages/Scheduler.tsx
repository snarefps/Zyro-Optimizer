import { useEffect, useState } from 'react'
import { formatBytes, zy } from '../api'
import { Icon } from '../components/Icon'
import { Badge, Button, Card, PageHeader, ProgressBar, Toggle, useToast } from '../components/ui'
import { runTask } from '../lib/tasks'

const TARGETS: { id: string; label: string; admin?: boolean }[] = [
  { id: 'user-temp', label: 'User temporary files' },
  { id: 'thumbnails', label: 'Thumbnail and icon cache' },
  { id: 'inet-cache', label: 'Internet cache (Windows)' },
  { id: 'crash-dumps', label: 'Crash dumps' },
  { id: 'shader-cache', label: 'DirectX shader cache' },
  { id: 'chrome', label: 'Chrome cache' },
  { id: 'edge', label: 'Edge cache' },
  { id: 'brave', label: 'Brave cache' },
  { id: 'firefox', label: 'Firefox cache' },
  { id: 'recycle-bin', label: 'Recycle Bin' },
  { id: 'win-temp', label: 'Windows temporary files', admin: true },
  { id: 'prefetch', label: 'Prefetch cache', admin: true },
  { id: 'wu-cache', label: 'Windows Update cache', admin: true }
]

export function Scheduler() {
  const toast = useToast()
  const [cfg, setCfg] = useState<any>(null)
  const [running, setRunning] = useState(false)

  const load = () => zy.scheduler.getConfig().then(setCfg)
  useEffect(() => {
    load()
    return window.zyro.on('scheduler:ran', () => load())
  }, [])

  if (!cfg) return null
  const s = cfg.schedule
  const save = async (patch: Partial<typeof s>) => { setCfg(await zy.scheduler.setSchedule({ ...s, ...patch })) }
  const toggleTarget = (id: string) => save({ targets: s.targets.includes(id) ? s.targets.filter((t: string) => t !== id) : [...s.targets, id] })

  async function runNow() {
    setRunning(true)
    try {
      await runTask(
        { title: 'Scheduled clean (manual run)', icon: 'alarm-clock', page: 'scheduler', message: 'Cleaning the selected items...' },
        async () => (await zy.scheduler.runNow(true)) as { freed: number },
        (r) => (r.freed > 0 ? `Freed ${formatBytes(r.freed)}` : 'Ran, nothing to remove')
      )
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setRunning(false); load()
  }

  const history: { ts: number; freed: number; source: string }[] = [...cfg.history].reverse().slice(0, 8)
  const maxFreed = Math.max(1, ...history.map((h) => h.freed))

  return (
    <>
      <PageHeader title="Scheduler" subtitle="Clean automatically while Zyro runs in the system tray. Only the items you tick are cleaned, using the same safe rules as the Junk Cleaner." actions={<Button icon="timer" onClick={runNow} busy={running} disabled={s.targets.length === 0}>Run now</Button>} />
      <div className="grid grid-cols-12 gap-4 pb-2">
        <Card className="col-span-7 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="font-bold">Automatic cleaning</div>
              <div className="text-[12px] text-mute">{s.lastRun ? `Last run ${new Date(s.lastRun).toLocaleString()}` : 'Has not run yet'}</div>
            </div>
            <Toggle on={s.enabled} onChange={(v) => save({ enabled: v })} />
          </div>
          <div className="mb-5 flex items-center gap-3">
            <Icon name="calendar" size={22} />
            <select value={s.frequency} onChange={(e) => save({ frequency: e.target.value as any })}>
              <option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option>
            </select>
            <span className="text-mute">at</span>
            <input type="time" value={s.time} onChange={(e) => save({ time: e.target.value })} />
          </div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mute">What to clean</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {TARGETS.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover/5">
                <input type="checkbox" checked={s.targets.includes(t.id)} onChange={() => toggleTarget(t.id)} />
                <span className="flex-1 truncate">{t.label}</span>
                {t.admin && <Badge tone="info">admin</Badge>}
              </label>
            ))}
          </div>
        </Card>
        <div className="col-span-5 space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-mute"><Icon name="recycle-bin" size={22} />Total space freed</div>
            <div className="my-1 text-4xl font-extrabold tracking-tight text-accent">{formatBytes(cfg.totalFreedBytes)}</div>
            <div className="mt-3 space-y-2">
              {history.length === 0 ? <div className="text-[13px] text-mute">Cleaning history will appear here.</div> : history.map((h) => (
                <div key={h.ts} className="flex items-center gap-2 text-[12px]">
                  <span className="w-28 shrink-0 text-mute">{new Date(h.ts).toLocaleDateString()}</span>
                  <div className="flex-1"><ProgressBar value={(h.freed / maxFreed) * 100} height={8} /></div>
                  <span className="w-16 text-right tabular-nums">{formatBytes(h.freed)}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="flex items-start gap-3 p-5">
            <Icon name="info" size={24} />
            <p className="text-[12px] leading-5 text-mute">Scheduled cleaning only runs while Zyro is running. Closing the window keeps it in the tray, using only a few megabytes. Change this on the Settings page.</p>
          </Card>
        </div>
      </div>
    </>
  )
}
