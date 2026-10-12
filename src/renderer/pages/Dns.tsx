import { useEffect, useMemo, useState } from 'react'
import { zy } from '../api'
import { Icon } from '../components/Icon'
import { Badge, Button, Card, PageHeader, ScanBar, Skeleton, useLoad, useToast } from '../components/ui'
import { runTask } from '../lib/tasks'

interface Adapter { name: string; description: string; dns: string[]; isStatic: boolean; gateway: boolean }
interface Preset { id: string; name: string; group: string; servers: [string, string]; gaming: boolean; note: string }
interface DnsInfo { admin: boolean; adapters: Adapter[]; presets: Preset[] }

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const validIp = (s: string) => { const m = IPV4.exec(s.trim()); return !!m && m.slice(1).every((p) => Number(p) <= 255) }

function Latency({ ms }: { ms: number | null | undefined }) {
  if (ms === undefined) return null
  if (ms === null) return <Badge tone="muted" title="No answer within 1.2 seconds from this network">No response</Badge>
  return <Badge tone={ms < 60 ? 'safe' : ms < 150 ? 'medium' : 'high'}>{ms} ms</Badge>
}

export function Dns() {
  const { data, loading, error, reload } = useLoad<DnsInfo>(() => zy.dns.list())
  const toast = useToast()
  const [adapter, setAdapter] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [speeds, setSpeeds] = useState<Record<string, number | null>>({})
  const [custom, setCustom] = useState({ primary: '', secondary: '' })

  useEffect(() => {
    if (!data || data.adapters.some((a) => a.name === adapter)) return
    setAdapter((data.adapters.find((a) => a.gateway) ?? data.adapters[0])?.name ?? '')
  }, [data, adapter])

  const current = data?.adapters.find((a) => a.name === adapter)
  const admin = !!data?.admin
  const groups = useMemo(() => {
    const m = new Map<string, Preset[]>()
    for (const p of data?.presets ?? []) m.set(p.group, [...(m.get(p.group) ?? []), p])
    return [...m.entries()]
  }, [data])

  const inUse = (p: Preset) => !!current?.isStatic && current.dns[0] === p.servers[0] && (current.dns[1] ?? '') === p.servers[1]
  const canApply = admin && !!current && !busy

  async function change(key: string, title: string, primary: string, secondary: string) {
    setBusy(key)
    try {
      await runTask({ title, icon: 'wifi', page: 'dns', message: `Changing the DNS servers on ${adapter}...` }, async (h) => {
        const r = await zy.dns.apply(adapter, primary, secondary)
        if (!r.ok) throw new Error(r.reason ?? 'Failed')
        h.done(`${adapter} now uses ${[primary, secondary].filter(Boolean).join(', ')}`)
      })
      window.dispatchEvent(new Event('zyro:changed'))
      await reload()
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(null)
  }

  async function automatic() {
    setBusy('auto')
    try {
      await runTask({ title: 'Using automatic DNS', icon: 'wifi', page: 'dns', message: `Resetting the DNS servers on ${adapter}...` }, async (h) => {
        const r = await zy.dns.reset(adapter)
        if (!r.ok) throw new Error(r.reason ?? 'Failed')
        h.done(`${adapter} gets its DNS from the router again`)
      })
      window.dispatchEvent(new Event('zyro:changed'))
      await reload()
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(null)
  }

  async function testSpeed() {
    if (!data) return
    setTesting(true)
    try {
      const res: { server: string; ms: number | null }[] = await zy.dns.ping(data.presets.flatMap((p) => p.servers))
      setSpeeds(Object.fromEntries(res.map((r) => [r.server, r.ms])))
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setTesting(false)
  }

  const customOk = validIp(custom.primary) && (custom.secondary.trim() === '' || validIp(custom.secondary))

  return (
    <>
      <PageHeader
        title="DNS Changer"
        subtitle="Switch the DNS servers of a network adapter in one click. Pick a global resolver, or an Iranian one that helps game services connect. Every change can be undone from the Restore page."
        actions={<><Button variant="ghost" icon="refresh" onClick={reload} busy={loading}>Refresh</Button><Button icon="speed" onClick={testSpeed} busy={testing} disabled={!data}>Test speed</Button></>}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
        <ScanBar active={loading || testing} />
        {error ? <Card className="p-6 text-bad">{error}</Card> : loading && !data ? <Skeleton rows={6} /> : data && (
          <>
            {!admin && (
              <Card className="flex items-start gap-3 p-4 text-[13px] text-soft">
                <Icon name="info" size={22} />
                <span>Changing DNS needs administrator rights. Use <b className="font-semibold text-fg">Restart as admin</b> in the sidebar, then come back here.</span>
              </Card>
            )}

            <Card className="p-5">
              {data.adapters.length === 0 ? (
                <div className="text-[13px] text-mute">No connected network adapter was found.</div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-mute">Network adapter</div>
                    <select value={adapter} onChange={(e) => setAdapter(e.target.value)} className="min-w-[260px]">
                      {data.adapters.map((a) => <option key={a.name} value={a.name}>{a.name}{a.gateway ? ' (internet)' : ''}</option>)}
                    </select>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-mute">Current DNS</div>
                    <div className="truncate text-[13px] font-medium">
                      {current && current.dns.length > 0 ? current.dns.join(', ') : 'None'}
                      <span className="ml-2 font-normal text-mute">{current?.isStatic ? 'set manually' : 'automatic from the router'}</span>
                    </div>
                    {current && <div className="truncate text-[12px] text-mute">{current.description}</div>}
                  </div>
                  <Button variant="soft" icon="undo" onClick={automatic} busy={busy === 'auto'} disabled={!canApply || !current?.isStatic} title="Let the router hand out DNS again">Use automatic</Button>
                </div>
              )}
            </Card>

            {groups.map(([group, presets]) => (
              <section key={group}>
                <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mute">
                  <Icon name={group.includes('games') ? 'controller' : 'wifi'} size={20} />{group}
                </div>
                <Card>
                  {presets.map((p, n) => (
                    <div key={p.id} style={{ animationDelay: `${n * 25}ms` }} className="fade-up flex items-center gap-4 border-b border-line/60 px-4 py-3 last:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-medium">
                          {p.name}
                          {p.gaming && <Badge tone="info">Gaming</Badge>}
                          {inUse(p) && <Badge tone="safe">In use</Badge>}
                        </div>
                        <div className="truncate text-[12px] tabular-nums text-soft">{p.servers.join('   ')}</div>
                        <div className="text-[12px] leading-4 text-mute">{p.note}</div>
                      </div>
                      <Latency ms={speeds[p.servers[0]]} />
                      <Button variant={inUse(p) ? 'ghost' : 'soft'} busy={busy === p.id} disabled={!canApply || inUse(p)} onClick={() => change(p.id, `Setting DNS to ${p.name}`, p.servers[0], p.servers[1])}>
                        {inUse(p) ? 'Active' : 'Use'}
                      </Button>
                    </div>
                  ))}
                </Card>
              </section>
            ))}

            <section>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mute"><Icon name="settings" size={20} />Custom</div>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <input type="text" placeholder="Primary, e.g. 9.9.9.9" value={custom.primary} onChange={(e) => setCustom({ ...custom, primary: e.target.value })} className="w-52" />
                <input type="text" placeholder="Secondary (optional)" value={custom.secondary} onChange={(e) => setCustom({ ...custom, secondary: e.target.value })} className="w-52" />
                <Button busy={busy === 'custom'} disabled={!canApply || !customOk} onClick={() => change('custom', 'Setting custom DNS', custom.primary.trim(), custom.secondary.trim())}>Apply</Button>
              </Card>
            </section>

            <p className="pb-2 text-[12px] leading-5 text-mute">
              The Iranian addresses come from the providers' public pages and the community lists that mirror them, and they can change. Radar Game and 403 use private addresses, so they normally only answer on Iranian networks. Use Test speed to see what works from where you are.
            </p>
          </>
        )}
      </div>
    </>
  )
}
