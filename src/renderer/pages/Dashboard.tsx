import { useEffect, useRef, useState } from 'react'
import { formatBytes, formatDuration, formatRate, zy } from '../api'
import { Sparkline } from '../components/charts'
import { Icon } from '../components/Icon'
import { Button, Card, ProgressBar, Row, SectionTitle, Setting, useToast } from '../components/ui'
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
const SCAN_TTL = 60_000
const scanCache: { at: number; junk: number; startup: number } = { at: 0, junk: 0, startup: 0 }
const push = (arr: number[], v: number) => (arr.length ? [...arr.slice(-(HISTORY - 1)), v] : [v, v])

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

  const refreshScans = (force = false) => {
    if (!force && scanCache.at && Date.now() - scanCache.at < SCAN_TTL) {
      setJunk(scanCache.junk); setHighStartup(scanCache.startup)
    } else {
      zy.cleaner.scan().then((items: any[]) => { const n = items.reduce((t, i) => t + (i.sizeBytes ?? 0), 0); scanCache.junk = n; if (alive.current) setJunk(n) }).catch(() => alive.current && setJunk(0))
      zy.startup.scan().then((items: any[]) => { const n = items.filter((i) => i.meta?.enabled && i.meta?.impact === 'high' && i.meta?.kind !== 'Service').length; scanCache.startup = n; scanCache.at = Date.now(); if (alive.current) setHighStartup(n) }).catch(() => alive.current && setHighStartup(0))
    }
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
      } catch {}
    }
    tick()
    const t = setInterval(tick, 1500)
    const changed = () => refreshScans(true)
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
  const scoreLabel = !ready ? 'Checking...' : score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 55 ? 'Needs attention' : 'Poor'
  const freedShown = useCountUp(totalFreed, 900)

  async function optimize() {
    setBusy(true); setReport(null)
    try { setReport(await smartOptimize()); refreshScans(true) } catch (e: any) { toast('err', String(e.message ?? e)) } finally { setBusy(false) }
  }

  const quick = [
    { to: 'cleaner', icon: 'broom', title: 'Clean junk', sub: junk === null ? 'Scanning...' : junk > 0 ? `${formatBytes(junk)} found` : 'Nothing to clean' },
    { to: 'startup', icon: 'rocket', title: 'Faster startup', sub: highStartup === null ? 'Scanning...' : highStartup > 0 ? `${highStartup} high-impact app${highStartup > 1 ? 's' : ''}` : 'Startup looks light' },
    { to: 'gamebooster', icon: 'controller', title: 'Boost for games', sub: 'Free CPU and RAM' },
    { to: 'updates', icon: 'available-updates', title: 'Update apps', sub: 'Check with winget' }
  ]

  return (
    <div className="pb-2">

      <div className="mb-6 flex items-center gap-5">
        <div className="flex h-[84px] w-[110px] shrink-0 items-center justify-center rounded-lg border border-line bg-panel"><Icon name="computer" size={64} /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[20px] font-semibold leading-7">{info?.host ?? 'This PC'}</div>
          <div className="truncate text-[14px] text-mute">{info?.machine || info?.cpuName || ' '}</div>
          <div className="truncate text-[14px] text-mute">{info ? info.os : 'Reading system information...'}</div>
        </div>
        <div className="flex shrink-0 gap-10 pr-2">
          <div className="flex items-center gap-3">
            <Icon name="security-checked" size={32} />
            <div>
              <div className="text-[14px] font-semibold leading-5">Health score</div>
              <div className="text-[12px] leading-4 text-mute">{ready ? `${shownScore} · ${scoreLabel}` : scoreLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Icon name="recycle-bin" size={32} />
            <div>
              <div className="text-[14px] font-semibold leading-5">Freed so far</div>
              <div className="text-[12px] leading-4 text-mute">{formatBytes(Math.round(freedShown)) || '0 B'}</div>
            </div>
          </div>
        </div>
      </div>

      <Setting
        icon="sparkling"
        title="Smart Optimize"
        description={report ? `Freed ${formatBytes(report.freed)} of disk space and ${formatBytes(report.ram)} of RAM` : 'Safely removes junk files and frees idle RAM. Nothing personal is touched.'}
      >
        <Button onClick={optimize} busy={busy}>{busy ? 'Optimizing...' : 'Optimize now'}</Button>
      </Setting>

      <SectionTitle>Performance</SectionTitle>
      <div className="grid grid-cols-2 gap-1">
        <Tile n={0} title="CPU" value={stats ? `${stats.cpu.total}%` : '-'} sub={info?.cpuName ?? ''} data={cpuH} />
        <Tile n={1} title="Memory" value={stats ? `${Math.round(memPct)}%` : '-'} sub={stats ? `${formatBytes(stats.mem.used)} of ${formatBytes(stats.mem.total)}` : ''} data={memH} />
        <Tile n={2} title="Network" value={stats ? formatRate(stats.net.down) : '-'} sub={stats ? `Upload ${formatRate(stats.net.up)}` : ''} data={netH} max={Math.max(1024 * 100, ...netH)} />
        <Card className="fade-up p-4" style={{ animationDelay: '210ms' }}>
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold">System drive</span>
            <span className="text-[24px] font-semibold leading-8 tabular-nums">{stats ? `${Math.round(diskPct)}%` : '-'}</span>
          </div>
          <div className="my-[18px]"><ProgressBar value={diskPct} height={6} /></div>
          <div className="truncate text-[12px] text-mute">{stats ? `${formatBytes(stats.disk.free)} free of ${formatBytes(stats.disk.total)}` : ' '}</div>
          <div className="text-[12px] text-mute">Uptime {info ? formatDuration(info.uptimeSec) : '-'}</div>
        </Card>
      </div>

      <SectionTitle>Recommendations</SectionTitle>
      <div className="space-y-1">
        {!ready ? (
          <Setting icon="info" title="Scanning your PC..." />
        ) : issues.length === 0 ? (
          <Setting icon="thumb-up" title="Your PC is in great shape" description="Nothing needs attention." />
        ) : issues.map((i) => (
          <Setting key={i.text} icon={i.icon} title={i.text}>
            <Button variant="soft" onClick={() => go(i.to)}>{i.action}</Button>
          </Setting>
        ))}
      </div>

      <SectionTitle>Quick actions</SectionTitle>
      <div className="space-y-1">
        {quick.map((q) => <Setting key={q.to} icon={q.icon} title={q.title} description={q.sub} onClick={() => go(q.to)} />)}
      </div>

      <SectionTitle>About this PC</SectionTitle>
      <Card>
        <Row k="Processor" v={info ? `${info.cpuName} (${info.cores}C/${info.threads}T)` : '...'} />
        <Row k="Graphics" v={info ? ((info.gpu ?? []).join(', ') || 'Unknown') : '...'} />
        <Row k="Memory" v={info ? formatBytes(info.totalMem) : '...'} />
        <Row k="Junk found" v={junk === null ? 'Scanning...' : formatBytes(junk)} />
      </Card>
    </div>
  )
}

function Tile({ n, title, value, sub, data, max = 100 }: { n: number; title: string; value: string; sub: string; data: number[]; max?: number }) {
  return (
    <Card className="fade-up p-4" style={{ animationDelay: `${n * 70}ms` }}>
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="text-[24px] font-semibold leading-8 tabular-nums">{value}</span>
      </div>
      <div className="my-2"><Sparkline data={data} max={max} /></div>
      <div className="truncate text-[12px] text-mute">{sub || ' '}</div>
    </Card>
  )
}
