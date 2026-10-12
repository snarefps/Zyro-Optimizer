import { useEffect, useMemo, useState } from 'react'
import { formatBytes, zy } from '../api'
import { Badge, Button, Card, PageHeader, Skeleton, useToast } from '../components/ui'
import { runTask } from '../lib/tasks'

interface Proc { pid: number; name: string; memBytes: number; cpuPct: number; path: string | null; title: string; hasWindow: boolean; protected: boolean }
type Sort = 'mem' | 'cpu' | 'name'

export function Processes() {
  const toast = useToast()
  const [procs, setProcs] = useState<Proc[]>([])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('mem')
  const [trimBusy, setTrimBusy] = useState(false)
  const [auto, setAuto] = useState(true)
  const [loaded, setLoaded] = useState(false)

  const refresh = () => zy.processes.list().then((p: Proc[]) => { setProcs(p); setLoaded(true) }).catch(() => undefined)
  useEffect(() => {
    refresh()
    if (!auto) return
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [auto])

  const list = useMemo(() => {
    const l = procs.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.title.toLowerCase().includes(q.toLowerCase()))
    return [...l].sort((a, b) => (sort === 'mem' ? b.memBytes - a.memBytes : sort === 'cpu' ? b.cpuPct - a.cpuPct : a.name.localeCompare(b.name))).slice(0, 200)
  }, [procs, q, sort])
  const totalMem = procs.reduce((n, p) => n + p.memBytes, 0)

  async function trim() {
    setTrimBusy(true)
    try {
      await runTask(
        { title: 'Freeing up RAM', icon: 'flash-on', page: 'processes', message: 'Asking Windows to trim idle memory...' },
        async () => (await zy.processes.trimMemory()) as { freedBytes: number; processes: number },
        (r) => `Released ${formatBytes(r.freedBytes)} of RAM from ${r.processes} processes`
      )
      refresh()
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setTrimBusy(false)
  }

  async function kill(p: Proc) {
    const r = await zy.processes.kill(p.pid)
    toast(r.ok ? 'ok' : 'err', r.ok ? `Ended ${p.name}` : r.reason)
    refresh()
  }

  const head = (s: Sort, label: string, cls: string) => (
    <button onClick={() => setSort(s)} className={`${cls} text-left text-[11px] font-bold uppercase tracking-wider transition ${sort === s ? 'text-fg' : 'text-mute hover:text-soft'}`}>{label}{sort === s ? ' ↓' : ''}</button>
  )

  return (
    <>
      <PageHeader title="Processes & RAM" subtitle="See what is using your memory and CPU. Free RAM asks Windows to page out idle memory from every process. Nothing is closed." actions={<Button icon="flash-on" onClick={trim} busy={trimBusy}>Free up RAM</Button>} />
      <div className="mb-3 flex items-center gap-3">
        <input type="text" placeholder="Search processes..." value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <label className="flex items-center gap-2 text-[13px] text-soft"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh</label>
        <span className="ml-auto text-[13px] text-mute">{procs.length} processes · {formatBytes(totalMem)} in use</span>
      </div>
      <Card className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line/60 bg-panel px-4 py-2">
          {head('name', 'Name', 'flex-1')}{head('cpu', 'CPU', 'w-16 text-right')}{head('mem', 'Memory', 'w-24 text-right')}<span className="w-20" />
        </div>
        {!loaded ? <Skeleton rows={8} /> : list.map((p) => (
          <div key={p.pid} className="flex items-center gap-3 border-b border-line/50 px-4 py-2 transition-colors hover:bg-hover/[0.04]">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="truncate font-medium">{p.name}</span>{p.hasWindow && <Badge tone="info">Window</Badge>}</div>
              <div className="truncate text-[12px] text-mute">{p.title || p.path || `PID ${p.pid}`}</div>
            </div>
            <div className="w-16 text-right tabular-nums">{p.cpuPct.toFixed(1)}%</div>
            <div className="w-24 text-right tabular-nums">{formatBytes(p.memBytes)}</div>
            {p.protected ? <span className="w-20 text-center"><Badge title="System process, cannot be ended from here">Protected</Badge></span> : <Button variant="soft" className="w-20 !px-2 !py-1" onClick={() => kill(p)}>End</Button>}
          </div>
        ))}
      </Card>
    </>
  )
}
