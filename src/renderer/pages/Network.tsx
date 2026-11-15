import { useEffect, useMemo, useRef, useState } from 'react'
import { zy } from '../api'
import { Sparkline } from '../components/charts'
import { Badge, Button, Card, Loading, PageHeader, Pivot, ScanBar, SectionTitle, Setting, Toggle, useLoad, useToast } from '../components/ui'
import { runTask } from '../lib/tasks'

interface Target { id: string; name: string; group: string; host: string }
type Tab = 'latency' | 'hosts'

const HISTORY = 30
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i

function Latency({ ms }: { ms: number | null | undefined }) {
  if (ms === undefined) return null
  if (ms === null) return <Badge title="No answer within 2 seconds">No answer</Badge>
  return <Badge tone={ms < 60 ? 'safe' : ms < 150 ? 'medium' : 'high'}>{ms} ms</Badge>
}

function LatencyTab() {
  const toast = useToast()
  const { data: targets, loading, error } = useLoad<Target[]>(() => zy.net.targets())
  const [last, setLast] = useState<Record<string, number | null>>({})
  const [history, setHistory] = useState<Record<string, number[]>>({})
  const [testing, setTesting] = useState(false)
  const [live, setLive] = useState(false)
  const busy = useRef(false)

  const groups = useMemo(() => {
    const m = new Map<string, Target[]>()
    for (const t of targets ?? []) m.set(t.group, [...(m.get(t.group) ?? []), t])
    return [...m.entries()]
  }, [targets])

  async function run() {
    if (busy.current || !targets) return
    busy.current = true
    try {
      const rows: { id: string; ms: number | null }[] = await zy.net.ping(targets.map((t) => t.id))
      setLast(Object.fromEntries(rows.map((r) => [r.id, r.ms])))
      setHistory((h) => {
        const next = { ...h }
        for (const r of rows) next[r.id] = [...(next[r.id] ?? []).slice(-(HISTORY - 1)), r.ms ?? 0]
        return next
      })
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    busy.current = false
  }

  async function testOnce() {
    setTesting(true)
    await run()
    setTesting(false)
  }

  useEffect(() => {
    if (!live) return
    run()
    const t = setInterval(run, 2500)
    return () => clearInterval(t)
  }, [live, targets])

  async function flush() {
    try {
      await runTask({ title: 'Flushing the DNS cache', icon: 'wifi', page: 'network', message: 'Clearing the resolver cache...' }, async (h) => {
        const r = await zy.tweaks.runAction('flush-dns')
        if (r.status !== 'ok') throw new Error(r.reason ?? r.status)
        h.done('DNS cache cleared')
      })
    } catch (e: any) { toast('err', String(e.message ?? e)) }
  }

  return (
    <>
      <div className="mb-1 space-y-1">
        <Setting icon="wifi" title="Live monitor" description="Tests each server every few seconds. The time is how long a connection takes to open, so it reads a little higher than a ping">
          <Button variant="ghost" busy={testing} disabled={live} onClick={testOnce}>Test once</Button>
          <Toggle on={live} onChange={setLive} />
        </Setting>
        <Setting icon="refresh" title="Flush the DNS cache" description="Clears cached name lookups">
          <Button variant="ghost" onClick={flush}>Flush</Button>
        </Setting>
      </div>
      <ScanBar active={loading} />
      {error ? <Setting icon="error" title="Could not load the server list" description={error} /> : !targets ? <Loading /> : groups.map(([group, list]) => (
        <section key={group}>
          <SectionTitle>{group}</SectionTitle>
          <div className="space-y-1">
            {list.map((t) => (
              <Setting key={t.id} title={t.name} description={t.host}>
                {(history[t.id]?.length ?? 0) > 1 && <div className="w-40"><Sparkline data={history[t.id]} max={Math.max(150, ...history[t.id])} height={28} /></div>}
                <div className="w-20 text-right"><Latency ms={last[t.id]} /></div>
              </Setting>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function HostsTab() {
  const toast = useToast()
  const { data, loading, error, reload } = useLoad<{ path: string; text: string; admin: boolean }>(() => zy.net.hostsRead())
  const [text, setText] = useState('')
  const [site, setSite] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (data) setText(data.text) }, [data])

  const dirty = !!data && text !== data.text

  function block() {
    const d = site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!DOMAIN.test(d)) { toast('err', 'That does not look like a website name, for example ads.example.com'); return }
    const line = `0.0.0.0 ${d}`
    if (text.split(/\r?\n/).some((l) => l.trim().toLowerCase() === line)) { toast('info', `${d} is already blocked`); return }
    setText((t) => `${t.replace(/\s+$/, '')}\n${line}\n`)
    setSite('')
  }

  async function save() {
    setSaving(true)
    try {
      const r = await zy.net.hostsWrite(text)
      if (r.ok) { toast('ok', 'The hosts file was saved. A backup was kept, you can undo it from Restore & History'); window.dispatchEvent(new Event('zyro:changed')); reload() } else toast('err', r.reason ?? 'Could not save')
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setSaving(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {data && !data.admin && <Setting icon="info" title="Saving needs administrator rights" description="Restart as admin from the sidebar to save" />}
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" placeholder="Block a website, e.g. ads.example.com" value={site} onChange={(e) => setSite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && block()} className="w-80" />
        <Button variant="ghost" disabled={!site.trim()} onClick={block}>Add to the list</Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" icon="refresh" onClick={reload} busy={loading}>Reload</Button>
          <Button busy={saving} disabled={!dirty || !data?.admin} onClick={save}>Save</Button>
        </div>
      </div>
      {error ? <Card className="p-6 text-bad">{error}</Card> : loading && !data ? <Loading /> : (
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="min-h-0 flex-1" style={{ minHeight: 320 }} />
      )}
      <p className="text-[12px] leading-5 text-mute">A line like <span className="text-soft">0.0.0.0 ads.example.com</span> blocks that name. A backup is saved before every change</p>
    </div>
  )
}

export function Network() {
  const [tab, setTab] = useState<Tab>('latency')
  return (
    <>
      <PageHeader title="Network Tools" subtitle="Connection times to DNS servers and game services, DNS cache flush and a hosts file editor" />
      <div className="mb-3"><Pivot<Tab> value={tab} onChange={setTab} options={[{ value: 'latency', label: 'Connection' }, { value: 'hosts', label: 'Hosts file' }]} /></div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto pb-2 pr-1">
        {tab === 'latency' ? <LatencyTab /> : <HostsTab />}
      </div>
    </>
  )
}
