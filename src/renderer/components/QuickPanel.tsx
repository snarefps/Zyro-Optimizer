import { useEffect, useState } from 'react'
import { formatBytes, formatRate, zy } from '../api'
import { Button, ProgressBar } from './ui'

interface Stats {
  cpu: { total: number }
  mem: { total: number; used: number }
  disk: { total: number; used: number; free: number }
  net: { down: number; up: number }
}

function Meter({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-lg border border-hover/[0.07] bg-panel p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px]">{label}</span>
        <span className="text-[20px] font-semibold leading-7 tabular-nums">{Math.round(value)}%</span>
      </div>
      <div className="my-2"><ProgressBar value={value} height={4} /></div>
      <div className="truncate text-[12px] text-mute">{detail}</div>
    </div>
  )
}

export function QuickPanel() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [boost, setBoost] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    const tick = () => zy.monitor.stats().then((s: Stats) => alive && setStats(s)).catch(() => undefined)
    const status = () => zy.gamebooster.status().then((s: { active: boolean }) => alive && setBoost(!!s.active)).catch(() => undefined)
    tick(); status()
    const t = setInterval(tick, 2000)
    const off = window.zyro.on('gamebooster:auto', status)
    window.addEventListener('focus', status)
    return () => { alive = false; clearInterval(t); off(); window.removeEventListener('focus', status) }
  }, [])

  async function run(id: string, job: () => Promise<string>) {
    setBusy(id); setNote('')
    try { setNote(await job()) } catch (e: any) { setNote(String(e.message ?? e)) }
    setBusy(null)
  }

  const clean = () => run('clean', async () => `Freed ${formatBytes((await zy.cleaner.quick()).freed) || '0 B'} of junk files`)
  const trim = () => run('trim', async () => `Released ${formatBytes((await zy.processes.trimMemory()).freedBytes) || '0 B'} of RAM`)
  const toggleBoost = () => run('boost', async () => {
    if (boost) {
      await zy.gamebooster.restore()
      setBoost(false)
      return 'Boost stopped, everything was put back'
    }
    await zy.gamebooster.apply(['opt:power', 'opt:trim'])
    setBoost(true)
    return 'Boost is on'
  })

  const mem = stats ? (stats.mem.used / stats.mem.total) * 100 : 0
  const disk = stats && stats.disk.total ? (stats.disk.used / stats.disk.total) * 100 : 0

  return (
    <div className="flex h-full flex-col gap-2 bg-bg p-3">
      <div className="flex items-center gap-2 px-1">
        <img src="./icon.png" alt="" draggable={false} className="h-5 w-5" />
        <span className="flex-1 text-[14px] font-semibold">Zyro Optimizer</span>
        <Button variant="ghost" onClick={() => zy.system.showMain()}>Open</Button>
      </div>
      <Meter label="Processor" value={stats?.cpu.total ?? 0} detail={stats ? `Network ${formatRate(stats.net.down)} down, ${formatRate(stats.net.up)} up` : ' '} />
      <Meter label="Memory" value={mem} detail={stats ? `${formatBytes(stats.mem.used)} of ${formatBytes(stats.mem.total)}` : ' '} />
      <Meter label="System drive" value={disk} detail={stats ? `${formatBytes(stats.disk.free)} free of ${formatBytes(stats.disk.total)}` : ' '} />
      <div className="grid grid-cols-3 gap-2">
        <Button variant="soft" busy={busy === 'clean'} disabled={busy !== null} onClick={clean}>Clean</Button>
        <Button variant="soft" busy={busy === 'trim'} disabled={busy !== null} onClick={trim}>Free RAM</Button>
        <Button variant={boost ? 'primary' : 'soft'} busy={busy === 'boost'} disabled={busy !== null} onClick={toggleBoost}>{boost ? 'Stop boost' : 'Boost'}</Button>
      </div>
      <div className="min-h-[20px] px-1 text-[12px] text-mute">{note}</div>
    </div>
  )
}
