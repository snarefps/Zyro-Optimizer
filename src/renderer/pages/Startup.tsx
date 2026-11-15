import { useMemo, useState } from 'react'
import type { ScanItem } from '../../shared/types'
import { zy } from '../api'
import { Badge, Button, Card, Empty, Modal, PageHeader, Pivot, RiskBadge, ScanBar, Loading, Toggle, useLoad, useToast } from '../components/ui'
import { applyEach } from '../lib/actions'
import { runTask } from '../lib/tasks'

const TABS = ['All', 'Startup entry', 'Startup folder', 'Service', 'Scheduled task'] as const

interface Boot { at: string; bootMs: number; kind?: string }
interface BootData { ok: boolean; source?: 'windows' | 'system'; boots?: Boot[]; reason?: string; admin?: boolean }

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(ms >= 100000 ? 0 : 1)} s`
}

function BootTimes() {
  const toast = useToast()
  const { data, loading } = useLoad<BootData>(() => zy.health.boots())
  const [asking, setAsking] = useState(false)
  const boots = data?.boots ?? []
  const last = boots[boots.length - 1]
  const earlier = boots.slice(0, -1)
  const average = earlier.length ? earlier.reduce((n, b) => n + b.bootMs, 0) / earlier.length : 0
  const diff = last && average ? (last.bootMs - average) / 1000 : 0
  const max = Math.max(1, ...boots.map((b) => b.bootMs))
  const fromWindows = data?.source === 'windows'

  async function allow() {
    setAsking(true)
    try {
      const r = await zy.health.allowBootLog()
      if (r.ok) toast('ok', "Done. Sign out and back in, then Zyro can read Windows' own start-up time")
      else toast('err', r.reason ?? 'Could not change it')
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setAsking(false)
  }

  return (
    <Card className="mb-3 p-4">
      <div className="flex items-center gap-6">
        <div className="w-52 shrink-0">
          <div className="text-[12px] text-mute">{fromWindows ? 'Last start-up time' : 'Last start, until you were signed in'}</div>
          <div className="text-[28px] font-semibold leading-9 tabular-nums">{last ? seconds(last.bootMs) : loading ? '...' : '-'}</div>
          <div className="text-[12px] leading-4 text-mute">
            {last ? (fromWindows
              ? (earlier.length === 0 ? new Date(last.at).toLocaleDateString() : Math.abs(diff) < 0.5 ? 'About the same as before' : `${Math.abs(diff).toFixed(1)} s ${diff < 0 ? 'faster' : 'slower'} than your earlier starts`)
              : `${last.kind ?? 'Start'}, ${new Date(last.at).toLocaleString()}`) : ''}
          </div>
        </div>
        {boots.length > 0 ? (
          <div className="flex h-16 flex-1 items-end gap-1.5" aria-label="Time of the last starts">
            {boots.map((b, i) => (
              <div key={b.at} title={`${new Date(b.at).toLocaleString()}${b.kind && !fromWindows ? ` · ${b.kind}` : ''} · ${seconds(b.bootMs)}`} className={`flex-1 rounded-sm ${i === boots.length - 1 ? 'bg-accent' : 'bg-hover/[0.22]'}`} style={{ height: `${Math.max(8, (b.bootMs / max) * 100)}%` }} />
            ))}
          </div>
        ) : (
          <div className="flex-1 text-[14px] text-mute">{loading ? 'Reading the start-up log...' : data?.reason}</div>
        )}
      </div>
      {data?.ok && !fromWindows && (
        <div className="mt-3 flex items-center gap-4 border-t border-line pt-3">
          <p className="flex-1 text-[12px] leading-4 text-mute">Real starts from the Windows System log. A start with a password includes the time spent typing it. Windows shares its own start-up time with administrators only</p>
          {!data.admin && <Button variant="ghost" busy={asking} onClick={allow} title="Adds this account to the Event Log Readers group. One administrator prompt, then sign out">Allow Zyro to read it</Button>}
        </div>
      )}
    </Card>
  )
}

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
      { title: 'Disabling startup items', icon: 'rocket', page: 'startup', message: 'Preparing...', progress: 2, cancellable: true },
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
        subtitle="Choose what starts with Windows. Disabling an item does not uninstall it, and every change can be undone here or on the Restore page"
        actions={<Button variant="ghost" icon="refresh" onClick={reload} busy={loading}>Rescan</Button>}
      />
      <BootTimes />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Pivot value={tab} onChange={setTab} options={TABS.map((t) => ({ value: t, label: t }))} />
        <input type="text" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="ml-2 w-52" />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[14px] text-mute">{enabledCount} enabled</span>
          <Button disabled={highTargets.length === 0} onClick={() => setBulk(true)}>Disable {highTargets.length} high-impact</Button>
        </div>
      </div>
      <Card className="min-h-0 flex-1 overflow-auto">
        <ScanBar active={loading} />
        {error ? <div className="p-6 text-bad">{error}</div> : loading && !data ? <Loading /> : items.length === 0 ? <Empty title="Nothing here" hint="No startup items in this category" /> : items.map((i, n) => (
          <div key={i.id} style={{ animationDelay: `${Math.min(n, 14) * 20}ms` }} className={`fade-up flex items-center gap-3 border-b border-line px-4 py-3 transition-opacity ${i.meta?.enabled ? '' : 'opacity-60'}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate">{i.label}</span>
                <Badge>{String(i.meta?.kind)}</Badge>
                {!!i.meta?.essential && <Badge title="Looks like a driver or security component. Better left on">Recommended on</Badge>}
              </div>
              <div className="truncate text-[12px] text-mute">{i.detail}</div>
            </div>
            {i.needsAdmin && <Badge>Needs admin</Badge>}
            <Badge tone={impactTone[i.meta?.impact as 'high']}>{String(i.meta?.impact)} impact</Badge>
            <RiskBadge risk={i.risk} />
            <Toggle on={!!i.meta?.enabled} busy={pending.has(i.id)} disabled={i.needsAdmin} onChange={(v) => set(i, v)} />
          </div>
        ))}
      </Card>
      <Modal open={bulk} title="Disable high-impact startup items?" onClose={() => setBulk(false)} actions={<><Button variant="ghost" onClick={() => setBulk(false)}>Cancel</Button><Button onClick={disableHigh}>Disable them</Button></>}>
        These apps will no longer start automatically. You can still open them manually, and you can turn them back on at any time
        <ul className="mt-3 max-h-48 list-disc overflow-auto pl-5 text-mute">{highTargets.map((i) => <li key={i.id}>{i.label}</li>)}</ul>
      </Modal>
    </>
  )
}
