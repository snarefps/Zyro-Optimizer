import { useMemo, useState } from 'react'
import type { ScanItem } from '../../shared/types'
import { zy } from '../api'
import { Badge, Button, Card, Empty, Modal, PageHeader, RiskBadge, ScanBar, Skeleton, Toggle, useLoad, useToast } from '../components/ui'
import { applyEach } from '../lib/actions'
import { runTask } from '../lib/tasks'

const TABS = ['All', 'Startup entry', 'Startup folder', 'Service', 'Scheduled task'] as const

export function Startup() {
  const { data, loading, error, reload, setData } = useLoad<ScanItem[]>(() => zy.startup.scan())
  const toast = useToast()
  const [tab, setTab] = useState<(typeof TABS)[number]>('All')
  const [q, setQ] = useState('')
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState(false)

  const items = useMemo(
    () => (data ?? []).filter((i) => (tab === 'All' || i.meta?.kind === tab) && (!q || `${i.label} ${i.detail}`.toLowerCase().includes(q.toLowerCase()))),
    [data, tab, q]
  )
  const enabledCount = (data ?? []).filter((i) => i.meta?.enabled).length
  const highTargets = (data ?? []).filter((i) => i.meta?.enabled && i.meta?.impact === 'high' && !i.meta?.essential && i.meta?.kind !== 'Service' && !i.needsAdmin)

  async function set(i: ScanItem, enable: boolean) {
    setPending((p) => new Set(p).add(i.id))
    try {
      const [res] = await (enable ? zy.startup.enable([i.id]) : zy.startup.apply([i.id]))
      if (res.status === 'ok') setData((d) => (d ?? []).map((x) => (x.id === i.id ? { ...x, meta: { ...x.meta, enabled: enable } } : x)))
      else toast('err', `${i.label}: ${res.reason ?? res.status}`)
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setPending((p) => { const n = new Set(p); n.delete(i.id); return n })
  }

  async function disableHigh() {
    setBulk(false)
    const labels = new Map(highTargets.map((i) => [i.id, i.label]))
    await runTask(
      { title: 'Disabling startup items', icon: 'rocket', page: 'startup', message: 'Preparing...', progress: 2 },
      (h) => applyEach(h, highTargets.map((i) => i.id), (id) => labels.get(id) ?? id, 'Disabling', (ids) => zy.startup.apply(ids)),
      (r) => `Disabled ${r.filter((x) => x.status === 'ok').length} startup item(s)`
    ).catch(() => undefined)
    window.dispatchEvent(new Event('zyro:changed'))
    reload()
  }

  const impactTone = { high: 'high', medium: 'medium', low: 'safe' } as const

  return (
    <>
      <PageHeader
        title="Startup Manager"
        subtitle="Choose what starts with Windows. Disabling an item does not uninstall it, and every change can be undone here or on the Restore page."
        actions={<Button variant="ghost" icon="refresh" onClick={reload} busy={loading}>Rescan</Button>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium transition ${tab === t ? 'bg-accent/[0.13] text-fg' : 'text-soft hover:bg-hover/5'}`}>{t}</button>
        ))}
        <input type="text" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="ml-2 w-52" />
        <span className="ml-auto text-[13px] text-mute">{enabledCount} enabled</span>
        <Button disabled={highTargets.length === 0} onClick={() => setBulk(true)}>Disable {highTargets.length} high-impact</Button>
      </div>
      <Card className="min-h-0 flex-1 overflow-auto">
        <ScanBar active={loading} />
        {error ? <div className="p-6 text-bad">{error}</div> : loading && !data ? <Skeleton rows={8} /> : items.length === 0 ? <Empty title="Nothing here" hint="No startup items in this category." /> : items.map((i, n) => (
          <div key={i.id} style={{ animationDelay: `${Math.min(n, 14) * 20}ms` }} className={`fade-up flex items-center gap-3 border-b border-line/60 px-4 py-3 transition-opacity ${i.meta?.enabled ? '' : 'opacity-55'}`}>
            <Toggle on={!!i.meta?.enabled} busy={pending.has(i.id)} disabled={i.needsAdmin} onChange={(v) => set(i, v)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{i.label}</span>
                <Badge>{String(i.meta?.kind)}</Badge>
                {!!i.meta?.essential && <Badge tone="info" title="Looks like a driver or security component. Better left on.">Recommended on</Badge>}
              </div>
              <div className="truncate text-[12px] text-mute">{i.detail}</div>
            </div>
            {i.needsAdmin && <Badge tone="info">Needs admin</Badge>}
            <Badge tone={impactTone[i.meta?.impact as 'high']}>{String(i.meta?.impact)} impact</Badge>
            <RiskBadge risk={i.risk} />
          </div>
        ))}
      </Card>
      <Modal open={bulk} icon="rocket" title="Disable high-impact startup items?" onClose={() => setBulk(false)} actions={<><Button variant="ghost" onClick={() => setBulk(false)}>Cancel</Button><Button onClick={disableHigh}>Disable them</Button></>}>
        These apps will no longer start automatically. You can still open them manually, and you can turn them back on at any time.
        <ul className="mt-3 max-h-48 list-disc overflow-auto pl-5 text-mute">{highTargets.map((i) => <li key={i.id}>{i.label}</li>)}</ul>
      </Modal>
    </>
  )
}
