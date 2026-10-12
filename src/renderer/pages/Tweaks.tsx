import { useState } from 'react'
import type { ScanItem } from '../../shared/types'
import { zy } from '../api'
import { Icon } from '../components/Icon'
import { Badge, Button, Card, PageHeader, RiskBadge, ScanBar, Skeleton, Toggle, useLoad, useToast } from '../components/ui'
import { applyEach } from '../lib/actions'
import { autoRestorePoint } from '../lib/restore'
import { runTask } from '../lib/tasks'

const CATEGORIES: { name: string; icon: string }[] = [
  { name: 'Privacy', icon: 'privacy' },
  { name: 'Performance', icon: 'speed' },
  { name: 'Gaming', icon: 'controller' },
  { name: 'Network', icon: 'wifi' },
  { name: 'Windows 11', icon: 'windows-11' }
]
const RECOMMENDED = ['ad-id-off', 'tailored-off', 'suggestions-off', 'bing-search-off', 'activity-history-off', 'telemetry-off', 'game-dvr-off', 'game-mode-on', 'show-extensions', 'transparency-off', 'fast-shutdown']

export function Tweaks() {
  const { data, loading, error, reload, setData } = useLoad<ScanItem[]>(() => zy.tweaks.scan())
  const actions = useLoad<any[]>(() => zy.tweaks.actionsList())
  const toast = useToast()
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  async function setTweak(i: ScanItem, on: boolean) {
    setPending((p) => new Set(p).add(i.id))
    try {
      await autoRestorePoint(`Tweak - ${i.label}`)
      const res = await (on ? zy.tweaks.apply([i.id]) : zy.tweaks.revert(i.id))
      const r = Array.isArray(res) ? res[0] : res
      if (r.status === 'ok') {
        setData((d) => (d ?? []).map((x) => (x.id === i.id ? { ...x, meta: { ...x.meta, applied: on } } : x)))
        toast('ok', `${i.label}: ${on ? 'applied' : 'undone'}${r.reason ? `. ${r.reason}` : ''}`)
        window.dispatchEvent(new Event('zyro:changed'))
      } else toast('err', `${i.label}: ${r.reason ?? r.status}`)
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setPending((p) => { const n = new Set(p); n.delete(i.id); return n })
  }

  async function applyRecommended() {
    setBulkBusy(true)
    const todo = (data ?? []).filter((i) => RECOMMENDED.includes(i.id) && !i.meta?.applied && !i.needsAdmin)
    const labels = new Map(todo.map((i) => [i.id, i.label]))
    try {
      if (todo.length === 0) toast('info', 'The recommended tweaks are already applied')
      else await runTask(
        { title: 'Applying recommended tweaks', icon: 'control-panel', page: 'tweaks', message: 'Preparing...', progress: 2 },
        async (h) => {
          await autoRestorePoint('Recommended tweaks', h)
          return applyEach(h, todo.map((i) => i.id), (id) => labels.get(id) ?? id, 'Applying', (ids) => zy.tweaks.apply(ids))
        },
        (r) => `Applied ${r.filter((x) => x.status === 'ok').length} of ${r.length} recommended tweak(s)`
      )
      await reload()
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBulkBusy(false)
  }

  async function runAction(id: string, label: string) {
    setRunning(id)
    try {
      await runTask({ title: label, icon: 'maintenance', page: 'tweaks', message: 'Working...' }, async (h) => {
        // only the heavy jobs get a restore point
        if (id === 'trim-ssd' || id === 'dism-cleanup') await autoRestorePoint(label, h)
        const r = await zy.tweaks.runAction(id)
        if (r.status !== 'ok') throw new Error(r.reason ?? r.status)
        h.done(r.reason ?? 'Done')
      })
    } catch (e: any) { toast('err', `${label}: ${String(e.message ?? e)}`) }
    setRunning(null)
  }

  return (
    <>
      <PageHeader
        title="Tweaks"
        subtitle="Privacy, performance, gaming, network and Windows 11 settings. Each switch records the previous value, so turning it off restores exactly what you had."
        actions={<><Button variant="ghost" icon="refresh" onClick={reload} busy={loading}>Refresh</Button><Button icon="sparkling" onClick={applyRecommended} busy={bulkBusy}>Apply recommended</Button></>}
      />
      <div className="min-h-0 flex-1 space-y-5 overflow-auto pr-1">
        <ScanBar active={loading} />
        {error ? <Card className="p-6 text-bad">{error}</Card> : loading && !data ? <Skeleton rows={8} /> : CATEGORIES.map((cat) => (
          <section key={cat.name}>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mute"><Icon name={cat.icon} size={20} />{cat.name}</div>
            <Card>
              {(data ?? []).filter((i) => i.meta?.category === cat.name).map((i, n) => (
                <div key={i.id} style={{ animationDelay: `${n * 25}ms` }} className="fade-up flex items-center gap-4 border-b border-line/60 px-4 py-3 last:border-0">
                  <Toggle on={!!i.meta?.applied} busy={pending.has(i.id)} disabled={i.needsAdmin} onChange={(v) => setTweak(i, v)} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{i.label}</div>
                    <div className="text-[12px] leading-4 text-mute">{i.detail}</div>
                  </div>
                  {i.needsAdmin && <Badge tone="info">Needs admin</Badge>}
                  {!!i.meta?.needsRestart && <Badge title="Takes effect after a restart or sign-out">Restart</Badge>}
                  <RiskBadge risk={i.risk} />
                </div>
              ))}
            </Card>
          </section>
        ))}
        <section>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mute"><Icon name="maintenance" size={20} />Maintenance</div>
          <Card>
            {(actions.data ?? []).map((a) => (
              <div key={a.id} className="flex items-center gap-4 border-b border-line/60 px-4 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{a.label}</div>
                  <div className="text-[12px] text-mute">{a.description}</div>
                </div>
                {a.needsAdmin && <Badge tone="info">Needs admin</Badge>}
                <Button variant="soft" disabled={a.needsAdmin} busy={running === a.id} onClick={() => runAction(a.id, a.label)}>Run</Button>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </>
  )
}
