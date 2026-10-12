import { useEffect, useMemo, useState } from 'react'
import type { ScanItem } from '../../shared/types'
import { formatBytes, zy } from '../api'
import { Icon } from '../components/Icon'
import { Badge, Button, Card, PageHeader, RiskBadge, ScanBar, Skeleton, useLoad, useToast } from '../components/ui'
import { applyEach } from '../lib/actions'
import { runTask } from '../lib/tasks'

export function GameBooster() {
  const { data, loading, error, reload } = useLoad<ScanItem[]>(() => zy.gamebooster.scan())
  const toast = useToast()
  const [status, setStatus] = useState<any>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const refreshStatus = () => zy.gamebooster.status().then(setStatus)
  useEffect(() => { refreshStatus() }, [])
  useEffect(() => {
    if (!data) return
    setSel(new Set(data.filter((i) => !i.needsAdmin && (i.id.startsWith('opt:') || i.meta?.suggested)).map((i) => i.id)))
  }, [data])

  const procs = useMemo(() => (data ?? []).filter((i) => i.id.startsWith('proc:')), [data])
  const opts = useMemo(() => (data ?? []).filter((i) => i.id.startsWith('opt:')), [data])
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function start() {
    setBusy(true)
    const labels = new Map((data ?? []).map((i) => [i.id, i.label]))
    try {
      await runTask(
        { title: 'Game Booster', icon: 'controller', page: 'gamebooster', message: 'Preparing...', progress: 2 },
        (h) => applyEach(h, [...sel], (id) => labels.get(id) ?? id, 'Applying', (ids) => zy.gamebooster.apply(ids)),
        (r) => `Boost active: ${r.filter((x) => x.status === 'ok').length} optimization(s) applied`
      )
      await refreshStatus(); await reload()
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(false)
  }

  async function stop() {
    setBusy(true)
    try {
      await runTask({ title: 'Restoring after Game Booster', icon: 'restart', page: 'gamebooster', message: 'Putting everything back...' }, async (h) => {
        const r = await zy.gamebooster.restore()
        h.done(`Restored ${r.restored.length} item(s)${r.failed.length ? `, could not restore: ${r.failed.join(', ')}` : ''}`)
      })
      await refreshStatus(); await reload()
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(false)
  }

  const active = !!status?.active

  return (
    <>
      <PageHeader title="Game Booster" subtitle="Frees CPU and RAM for your game by pausing background apps and services, then puts everything back when you stop. Apps with open windows are asked to close politely, so save your work first." />
      <Card className={`mb-4 flex items-center gap-5 p-5 transition-colors ${active ? 'border-ok/40' : ''}`}>
        <div className={`flex h-14 w-14 items-center justify-center rounded-lg ${active ? 'bg-ok/15 pulse-ring' : 'bg-hover/5'}`}><Icon name="controller" size={36} className={active ? 'float' : ''} /></div>
        <div className="flex-1">
          <div className="text-lg font-bold">{active ? 'Boost is active' : 'Boost is off'}</div>
          <div className="text-[13px] text-mute">
            {active ? `Paused: ${status.pausedServices.length} service(s) · Closed: ${status.closed.length} app(s)` : `${sel.size} optimization(s) ready. Select what to include below.`}
          </div>
        </div>
        {active ? <Button variant="danger" icon="restart" onClick={stop} busy={busy}>Stop and restore everything</Button> : <Button icon="rocket" onClick={start} busy={busy} disabled={sel.size === 0}>Start boost</Button>}
      </Card>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-4">
        <div className="col-span-5 min-h-0 overflow-auto">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mute">Optimizations</div>
          <Card>
            {opts.map((i) => (
              <label key={i.id} className={`flex cursor-pointer items-start gap-3 border-b border-line/60 px-4 py-3 last:border-0 ${i.needsAdmin ? 'opacity-60' : ''}`}>
                <input type="checkbox" className="mt-1" checked={sel.has(i.id)} disabled={i.needsAdmin || active} onChange={() => toggle(i.id)} />
                <div className="flex-1">
                  <div className="font-medium">{i.label}</div>
                  <div className="text-[12px] leading-4 text-mute">{i.detail}</div>
                </div>
                {i.needsAdmin && <Badge tone="info">Needs admin</Badge>}
              </label>
            ))}
          </Card>
        </div>
        <div className="col-span-7 flex min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.14em] text-mute">
            <span>Background apps to close</span>
            <button className="normal-case tracking-normal text-accent hover:underline" onClick={reload}>Rescan</button>
          </div>
          <Card className="min-h-0 flex-1 overflow-auto">
            <ScanBar active={loading} />
            {error ? <div className="p-5 text-bad">{error}</div> : loading && !data ? <Skeleton /> : procs.length === 0 ? <div className="p-6 text-center text-mute">No heavy background apps found.</div> : procs.map((i, n) => (
              <label key={i.id} style={{ animationDelay: `${Math.min(n, 14) * 20}ms` }} className="fade-up flex cursor-pointer items-center gap-3 border-b border-line/60 px-4 py-2.5 transition-colors hover:bg-hover/[0.04]">
                <input type="checkbox" checked={sel.has(i.id)} disabled={active} onChange={() => toggle(i.id)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate font-medium">{i.label} {!!i.meta?.suggested && <Badge tone="info">Suggested</Badge>}</div>
                  <div className="truncate text-[12px] text-mute">{i.detail}</div>
                </div>
                <RiskBadge risk={i.risk} />
                <div className="w-20 text-right tabular-nums text-soft">{formatBytes(i.sizeBytes)}</div>
              </label>
            ))}
          </Card>
        </div>
      </div>
    </>
  )
}
