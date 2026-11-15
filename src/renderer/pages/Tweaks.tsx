import { useState } from 'react'
import type { ScanItem } from '../../shared/types'
import { zy } from '../api'
import { Badge, Button, Card, PageHeader, RiskBadge, ScanBar, SectionTitle, Setting, Loading, Toggle, useLoad, useToast } from '../components/ui'
import { applyEach } from '../lib/actions'
import { createRestorePoint } from '../lib/restore'
import { runTask } from '../lib/tasks'
import { PRESETS, switchTweak } from '../lib/tweaks'

const CATEGORIES: { name: string; icon: string }[] = [
  { name: 'Privacy', icon: 'privacy' },
  { name: 'Performance', icon: 'speed' },
  { name: 'Gaming', icon: 'controller' },
  { name: 'Network', icon: 'wifi' },
  { name: 'Windows 11', icon: 'windows-11' }
]

export function Tweaks() {
  const { data, loading, error, reload, setData } = useLoad<ScanItem[]>(() => zy.tweaks.scan())
  const actions = useLoad<any[]>(() => zy.tweaks.actionsList())
  const toast = useToast()
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState<string | null>(null)
  const [presetBusy, setPresetBusy] = useState<string | null>(null)
  const [rpBusy, setRpBusy] = useState(false)

  async function setTweak(i: ScanItem, on: boolean) {
    setPending((p) => new Set(p).add(i.id))
    try {
      const r = await switchTweak(i.id, on)
      if (r.status === 'ok') {
        setData((d) => (d ?? []).map((x) => (x.id === i.id ? { ...x, meta: { ...x.meta, applied: on } } : x)))
        toast('ok', `${i.label}: ${on ? 'applied' : 'undone'}${r.reason ? `. ${r.reason}` : ''}`)
        window.dispatchEvent(new Event('zyro:changed'))
      } else toast('err', `${i.label}: ${r.reason ?? r.status}`)
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setPending((p) => { const n = new Set(p); n.delete(i.id); return n })
  }

  async function applyPreset(preset: (typeof PRESETS)[number]) {
    setPresetBusy(preset.id)
    const wanted = (data ?? []).filter((i) => preset.ids.includes(i.id) && !i.meta?.applied)
    const todo = wanted.filter((i) => !i.needsAdmin)
    const labels = new Map(todo.map((i) => [i.id, i.label]))
    try {
      if (todo.length === 0) toast('info', wanted.length ? 'The rest of this preset needs administrator rights' : `The ${preset.name} preset is already applied`)
      else await runTask(
        { title: `Applying the ${preset.name} preset`, icon: 'control-panel', page: 'tweaks', message: 'Preparing...', progress: 2, cancellable: true },
        (h) => applyEach(h, todo.map((i) => i.id), (id) => labels.get(id) ?? id, 'Applying', (ids) => zy.tweaks.apply(ids)),
        (r) => `Applied ${r.filter((x) => x.status === 'ok').length} of ${preset.ids.length} tweak(s)${wanted.length > todo.length ? `, ${wanted.length - todo.length} need administrator rights` : ''}`
      )
      window.dispatchEvent(new Event('zyro:changed'))
      await reload()
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setPresetBusy(null)
  }

  async function restorePoint() {
    setRpBusy(true)
    try { await createRestorePoint('tweaks') } catch (e: any) { toast('err', `Could not create a restore point: ${String(e.message ?? e)}`) }
    setRpBusy(false)
  }

  async function runAction(id: string, label: string) {
    setRunning(id)
    try {
      await runTask({ title: label, icon: 'maintenance', page: 'tweaks', message: 'Working...' }, async (h) => {
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
        subtitle="Privacy, performance, gaming, network and Windows 11 settings. Each switch records the previous value, so turning it off restores exactly what you had"
        actions={<><Button variant="ghost" icon="restore-page" onClick={restorePoint} busy={rpBusy} title="Create a Windows restore point you can go back to">Restore point</Button><Button variant="ghost" icon="refresh" onClick={reload} busy={loading}>Refresh</Button><Button icon="sparkling" onClick={() => applyPreset(PRESETS[0])} busy={presetBusy === 'balanced'}>Apply recommended</Button></>}
      />
      <div className="min-h-0 flex-1 overflow-auto pb-2 pr-1">
        <ScanBar active={loading} />
        {error ? <Card className="p-6 text-bad">{error}</Card> : loading && !data ? <Loading /> : (
          <section>
            <SectionTitle className="!mt-0">Presets</SectionTitle>
            <div className="grid grid-cols-2 gap-1">
              {PRESETS.map((p) => (
                <Card key={p.id} className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold">{p.name}</div>
                    <div className="text-[12px] leading-4 text-mute">{p.description}</div>
                  </div>
                  <Button variant="soft" busy={presetBusy === p.id} disabled={presetBusy !== null} onClick={() => applyPreset(p)}>Apply</Button>
                </Card>
              ))}
            </div>
          </section>
        )}
        {!error && !(loading && !data) && CATEGORIES.map((cat) => (
          <section key={cat.name}>
            <SectionTitle icon={cat.icon}>{cat.name}</SectionTitle>
            <div className="space-y-1">
              {(data ?? []).filter((i) => i.meta?.category === cat.name).map((i, n) => (
                <div key={i.id} style={{ animationDelay: `${n * 25}ms` }} className="fade-up">
                  <Setting title={i.label} description={i.detail} disabled={i.needsAdmin}>
                    {i.needsAdmin && <Badge title="Restart Zyro as administrator to use this">Needs admin</Badge>}
                    {!!i.meta?.needsRestart && <Badge title="Takes effect after a restart or sign-out">Restart</Badge>}
                    <RiskBadge risk={i.risk} />
                    <Toggle on={!!i.meta?.applied} busy={pending.has(i.id)} disabled={i.needsAdmin} onChange={(v) => setTweak(i, v)} />
                  </Setting>
                </div>
              ))}
            </div>
          </section>
        ))}
        <section>
          <SectionTitle icon="maintenance">Maintenance</SectionTitle>
          <div className="space-y-1">
            {(actions.data ?? []).map((a) => (
              <Setting key={a.id} title={a.label} description={a.description}>
                {a.needsAdmin && <Badge title="Restart Zyro as administrator to use this">Needs admin</Badge>}
                <Button variant="soft" disabled={a.needsAdmin} busy={running === a.id} onClick={() => runAction(a.id, a.label)}>Run</Button>
              </Setting>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
