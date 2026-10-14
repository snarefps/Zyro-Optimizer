import { useEffect, useState } from 'react'
import { formatBytes, zy } from '../api'
import { Badge, Button, Card, PageHeader, ProgressBar, SectionTitle, Select, Setting, Toggle, useToast } from '../components/ui'
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
      <div className="pb-2">
        <div className="space-y-1">
          <Setting icon="alarm-clock" title="Automatic cleaning" description={s.lastRun ? `Last run ${new Date(s.lastRun).toLocaleString()}` : 'Has not run yet'}>
            <Toggle on={s.enabled} onChange={(v) => save({ enabled: v })} />
          </Setting>
          <Setting icon="calendar" title="Schedule" description="How often and when Zyro cleans in the tray.">
            <Select value={s.frequency as string} onChange={(v) => save({ frequency: v })} options={[{ value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' }, { value: 'monthly', label: 'Every month' }]} />
            <input type="time" value={s.time} onChange={(e) => save({ time: e.target.value })} />
          </Setting>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-7">
            <SectionTitle>What to clean</SectionTitle>
            <Card className="grid grid-cols-2 gap-x-2 p-2">
              {TARGETS.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-3 rounded px-2.5 py-2 transition-colors duration-[83ms] hover:bg-hover/[0.05]">
                  <input type="checkbox" checked={s.targets.includes(t.id)} onChange={() => toggleTarget(t.id)} />
                  <span className="flex-1 truncate">{t.label}</span>
                  {t.admin && <Badge>admin</Badge>}
                </label>
              ))}
            </Card>
            <p className="mt-3 text-[12px] leading-5 text-mute">Scheduled cleaning only runs while Zyro is running. Closing the window keeps it in the tray, using only a few megabytes. Change this on the Settings page.</p>
          </div>
          <div className="col-span-5">
            <SectionTitle>Total space freed</SectionTitle>
            <Card className="p-4">
              <div className="text-[28px] font-semibold leading-9">{formatBytes(cfg.totalFreedBytes) || '0 B'}</div>
              <div className="mt-3 space-y-2.5">
                {history.length === 0 ? <div className="text-[14px] text-mute">Cleaning history will appear here.</div> : history.map((h) => (
                  <div key={h.ts} className="flex items-center gap-3 text-[12px]">
                    <span className="w-24 shrink-0 text-mute">{new Date(h.ts).toLocaleDateString()}</span>
                    <div className="flex-1"><ProgressBar value={(h.freed / maxFreed) * 100} height={6} /></div>
                    <span className="w-16 text-right tabular-nums">{formatBytes(h.freed)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
