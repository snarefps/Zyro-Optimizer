import { useState } from 'react'
import type { ScanItem } from '../../shared/types'
import { zy } from '../api'
import { Badge, Card, Loading, PageHeader, RiskBadge, ScanBar, SectionTitle, Setting, Toggle, useLoad, useToast } from '../components/ui'
import { switchTweak } from '../lib/tweaks'

interface Access { app: string; lastUsed: number; inUse: boolean }
interface Capability { id: string; label: string; allowed: boolean; apps: Access[] }

const SWITCHES = ['ad-id-off', 'telemetry-off', 'camera-off', 'microphone-off', 'location-off']

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`
  return new Date(ms).toLocaleDateString()
}

export function Privacy() {
  const toast = useToast()
  const tweaks = useLoad<ScanItem[]>(() => zy.tweaks.scan())
  const access = useLoad<Capability[]>(() => zy.privacy.recent())
  const [pending, setPending] = useState<Set<string>>(new Set())

  const items = (tweaks.data ?? []).filter((i) => SWITCHES.includes(i.id)).sort((a, b) => SWITCHES.indexOf(a.id) - SWITCHES.indexOf(b.id))

  async function set(i: ScanItem, on: boolean) {
    setPending((p) => new Set(p).add(i.id))
    try {
      const r = await switchTweak(i.id, on)
      if (r.status === 'ok') {
        tweaks.setData((d) => (d ?? []).map((x) => (x.id === i.id ? { ...x, meta: { ...x.meta, applied: on } } : x)))
        window.dispatchEvent(new Event('zyro:changed'))
        access.reload()
      } else toast('err', `${i.label}: ${r.reason ?? r.status}`)
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setPending((p) => { const n = new Set(p); n.delete(i.id); return n })
  }

  return (
    <>
      <PageHeader title="Privacy" subtitle="Switch off what apps can use, and see which apps used the camera, microphone or location recently" />
      <div className="min-h-0 flex-1 overflow-auto pb-2 pr-1">
        <ScanBar active={tweaks.loading || access.loading} />
        <SectionTitle className="!mt-0">Switches</SectionTitle>
        <div className="space-y-1">
          {!tweaks.data ? <Loading /> : items.map((i) => (
            <Setting key={i.id} title={i.label} description={i.detail} disabled={i.needsAdmin}>
              {i.needsAdmin && <Badge title="Restart Zyro as administrator to use this">Needs admin</Badge>}
              <RiskBadge risk={i.risk} />
              <Toggle on={!!i.meta?.applied} busy={pending.has(i.id)} disabled={i.needsAdmin} onChange={(v) => set(i, v)} />
            </Setting>
          ))}
        </div>

        <SectionTitle>Recent access</SectionTitle>
        {!access.data ? <Loading /> : (
          <div className="space-y-1">
            {access.data.map((c) => (
              <Card key={c.id}>
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <span className="text-[14px] font-semibold">{c.label}</span>
                  <Badge tone={c.allowed ? 'muted' : 'medium'}>{c.allowed ? 'Apps may use it' : 'Blocked for apps'}</Badge>
                </div>
                {c.apps.length === 0 ? <div className="px-4 py-3 text-[14px] text-mute">No app has used it lately</div> : c.apps.map((a) => (
                  <div key={a.app + a.lastUsed} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                    <span className="min-w-0 flex-1 truncate">{a.app}</span>
                    {a.inUse && <Badge tone="medium">Using it now</Badge>}
                    <span className="w-28 text-right text-[12px] text-mute">{ago(a.lastUsed)}</span>
                  </div>
                ))}
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
