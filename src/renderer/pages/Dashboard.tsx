import { useEffect, useRef, useState } from 'react'
import { formatBytes, formatDuration, formatRate, zy } from '../api'
import { Ring, Sparkline } from '../components/charts'
import { Icon } from '../components/Icon'
import { Button, Card, PageHeader, ProgressBar, useToast } from '../components/ui'
import { useCountUp } from '../hooks/useCountUp'
import { smartOptimize } from '../lib/actions'
import { go } from '../lib/routes'

interface Stats {
  cpu: { total: number }
  mem: { total: number; used: number; free: number }
  disk: { total: number; used: number; free: number }
  net: { down: number; up: number }
}

const HISTORY = 60
const push = (arr: number[], v: number) => [...arr.slice(-(HISTORY - 1)), v]

export function Dashboard() {
  const toast = useToast()
  const [stats, setStats] = useState<Stats | null>(null)
  const [cpuH, setCpuH] = useState<number[]>([])
  const [memH, setMemH] = useState<number[]>([])
  const [netH, setNetH] = useState<number[]>([])
  const [info, setInfo] = useState<any>(null)
  const [junk, setJunk] = useState<number | null>(null)
  const [highStartup, setHighStartup] = useState<number | null>(null)
  const [totalFreed, setTotalFreed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<{ freed: number; ram: number } | null>(null)
  const alive = useRef(true)

  const refreshScans = () => {
    zy.cleaner.scan().then((items: any[]) => alive.current && setJunk(items.reduce((n, i) => n + (i.sizeBytes ?? 0), 0))).catch(() => alive.current && setJunk(0))
    zy.startup.scan().then((items: any[]) => alive.current && setHighStartup(items.filter((i) => i.meta?.enabled && i.meta?.impact === 'high' && i.meta?.kind !== 'Service').length)).catch(() => alive.current && setHighStartup(0))
    zy.scheduler.getConfig().then((c: any) => alive.current && setTotalFreed(c.totalFreedBytes)).catch(() => undefined)
  }

  useEffect(() => {
    alive.current = true
    zy.monitor.info().then(setInfo).catch(() => undefined)
    refreshScans()
    const tick = async () => {
      try {
        const s: Stats = await zy.monitor.stats()
        if (!alive.current) return
        setStats(s)
        setCpuH((h) => push(h, s.cpu.total))
        setMemH((h) => push(h, (s.mem.used / s.mem.total) * 100))
        setNetH((h) => push(h, s.net.down))
      } catch { /* window closing */ }
    }
    tick()
    const t = setInterval(tick, 1500)
    const changed = () => refreshScans()
    window.addEventListener('zyro:changed', changed)
    return () => { alive.current = false; clearInterval(t); window.removeEventListener('zyro:changed', changed) }
  }, [])

  const memPct = stats ? (stats.mem.used / stats.mem.total) * 100 : 0
  const diskPct = stats && stats.disk.total ? (stats.disk.used / stats.disk.total) * 100 : 0

  const issues: { text: string; penalty: number; to: string; icon: string; action: string }[] = []
  if (junk && junk > 200 * 1048576) issues.push({ text: `${formatBytes(junk)} of junk files can be removed`, penalty: Math.min(25, (junk / 1073741824) * 5), to: 'cleaner', icon: 'broom', action: 'Clean' })
  if (highStartup && highStartup > 0) issues.push({ text: `${highStartup} high-impact startup app${highStartup > 1 ? 's' : ''} slow down boot`, penalty: Math.min(20, highStartup * 4), to: 'startup', icon: 'rocket', action: 'Review' })
  if (memPct > 70) issues.push({ text: `Memory is ${Math.round(memPct)}% used`, penalty: memPct > 85 ? 15 : 7, to: 'processes', icon: 'memory-slot', action: 'Free up' })
  if (diskPct > 80) issues.push({ text: `System drive is ${Math.round(diskPct)}% full`, penalty: diskPct > 90 ? 15 : 7, to: 'disk', icon: 'hdd', action: 'Analyze' })
  const ready = !!stats && junk !== null && highStartup !== null
  const score = Math.max(0, Math.round(100 - issues.reduce((n, i) => n + i.penalty, 0)))
  const shownScore = Math.round(useCountUp(ready ? score : 0, 900))
  const tone = score >= 80 ? 'ok' : score >= 60 ? 'warn' : 'bad'
  const scoreLabel = !ready ? 'Checking...' : score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 55 ? 'Needs attention' : 'Poor'
  const freedShown = useCountUp(totalFreed, 900)

  async function optimize() {
    setBusy(true); setReport(null)
    try { setReport(await smartOptimize()); refreshScans() } catch (e: any) { toast('err', String(e.message ?? e)) } finally { setBusy(false) }
  }

  const quick = [
    { to: 'cleaner', icon: 'broom', title: 'Clean junk', sub: junk === null ? 'Scanning...' : junk > 0 ? `${formatBytes(junk)} found` : 'Nothing to clean' },
    { to: 'startup', icon: 'rocket', title: 'Faster startup', sub: highStartup === null ? 'Scanning...' : highStartup > 0 ? `${highStartup} high-impact app${highStartup > 1 ? 's' : ''}` : 'Startup looks light' },
    { to: 'gamebooster', icon: 'controller', title: 'Boost for games', sub: 'Free CPU and RAM' },
    { to: 'updates', icon: 'available-updates', title: 'Update apps', sub: 'Check with winget' }
  ]

  return (
    <>
      <PageHeader title="Dashboard" subtitle={info ? `${info.host} · ${info.os}${info.machine ? ` · ${info.machine}` : ''}` : 'Reading system information...'} />
      <div className="grid grid-cols-12 gap-4 pb-2">
        <Card className="col-span-5 flex flex-col items-center p-6">
          <Ring value={ready ? score : 0} tone={tone}>
            <div className="text-[52px] font-extrabold leading-none tabular-nums">{ready ? shownScore : '-'}</div>
            <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-mute">{scoreLabel}</div>
          </Ring>
          <Button icon="sparkling" className="mt-5 w-full py-3 text-[14px]" onClick={optimize} busy={busy}>{busy ? 'Optimizing...' : 'Smart Optimize'}</Button>
          <p className="mt-2.5 text-center text-[12px] leading-4 text-mute">Safely removes junk files and frees idle RAM. Nothing personal is touched.</p>
          {report && (
            <div className="slide-up mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-ok/25 bg-ok/10 p-3 text-[13px] text-ok">
              <Icon name="checkmark" size={20} className="check-pop" />Freed <b>{formatBytes(report.freed)}</b> disk · <b>{formatBytes(report.ram)}</b> RAM
            </div>
          )}
        </Card>

        <div className="col-span-7 grid grid-cols-2 gap-4">
          <Tile icon="processor" title="CPU" value={stats ? `${stats.cpu.total}%` : '-'} sub={info?.cpuName ?? ''} data={cpuH} color="var(--accent)" />
          <Tile icon="memory-slot" title="Memory" value={stats ? `${Math.round(memPct)}%` : '-'} sub={stats ? `${formatBytes(stats.mem.used)} of ${formatBytes(stats.mem.total)}` : ''} data={memH} color="var(--accent2)" />
          <Tile icon="wifi" title="Network" value={stats ? formatRate(stats.net.down) : '-'} sub={stats ? `↑ ${formatRate(stats.net.up)}` : ''} data={netH} color="var(--info)" max={Math.max(1024 * 100, ...netH)} />
          <Card className="p-4" lift>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-mute"><Icon name="ssd" size={22} />System drive</span>
              <span className="text-xl font-bold tabular-nums">{stats ? `${Math.round(diskPct)}%` : '-'}</span>
            </div>
            <div className="my-4"><ProgressBar value={diskPct} tone={diskPct > 90 ? 'bad' : diskPct > 80 ? 'warn' : 'accent'} height={8} /></div>
            <div className="text-[12px] text-mute">{stats ? `${formatBytes(stats.disk.free)} free of ${formatBytes(stats.disk.total)}` : ''}</div>
            <div className="mt-3 text-[12px] text-mute">Uptime {info ? formatDuration(info.uptimeSec) : '-'}</div>
          </Card>
        </div>

        <div className="col-span-12 grid grid-cols-4 gap-4">
          {quick.map((q, i) => (
            <button key={q.to} onClick={() => go(q.to)} style={{ animationDelay: `${i * 60}ms` }} className="group fade-up text-left">
              <Card lift className="flex items-center gap-3 p-4">
                <Icon name={q.icon} size={38} />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold">{q.title}</div>
                  <div className="truncate text-[12px] text-mute">{q.sub}</div>
                </div>
              </Card>
            </button>
          ))}
        </div>

        <Card className="col-span-7 p-5">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-bold"><Icon name="info" size={20} />Recommendations</div>
          {!ready ? <div className="text-[13px] text-mute">Scanning your PC...</div> : issues.length === 0 ? (
            <div className="flex items-center gap-3 rounded-md border border-ok/25 bg-ok/10 px-4 py-3 text-[13px] text-ok"><Icon name="thumb-up" size={26} />Your PC is in great shape. Nothing needs attention.</div>
          ) : issues.map((i, n) => (
            <div key={i.text} style={{ animationDelay: `${n * 70}ms` }} className="fade-up flex items-center gap-3 border-b border-line/60 py-2.5 last:border-0">
              <Icon name={i.icon} size={26} />
              <span className="flex-1 text-[13px]">{i.text}</span>
              <Button variant="soft" className="!py-1.5" onClick={() => go(i.to)}>{i.action}</Button>
            </div>
          ))}
        </Card>

        <Card className="col-span-5 p-5">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-bold"><Icon name="computer" size={20} />Your PC</div>
          <Row k="Processor" v={info ? `${info.cpuName} (${info.cores}C/${info.threads}T)` : '...'} />
          <Row k="Graphics" v={info ? ((info.gpu ?? []).join(', ') || 'Unknown') : '...'} />
          <Row k="Memory" v={info ? formatBytes(info.totalMem) : '...'} />
          <Row k="Junk found" v={junk === null ? 'Scanning...' : formatBytes(junk)} />
          <Row k="Freed by Zyro so far" v={formatBytes(Math.round(freedShown))} />
        </Card>
      </div>
    </>
  )
}

function Tile({ icon, title, value, sub, data, color, max = 100 }: { icon: string; title: string; value: string; sub: string; data: number[]; color: string; max?: number }) {
  return (
    <Card className="p-4" lift>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-mute"><Icon name={icon} size={22} />{title}</span>
        <span className="text-xl font-bold tabular-nums">{value}</span>
      </div>
      <div className="my-2"><Sparkline data={data} color={color} max={max} /></div>
      <div className="truncate text-[12px] text-mute">{sub}</div>
    </Card>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/50 py-2 text-[13px] last:border-0">
      <span className="text-mute">{k}</span>
      <span className="truncate text-right font-medium">{v}</span>
    </div>
  )
}
