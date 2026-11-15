import { useEffect, useMemo, useState } from 'react'
import type { ScanItem } from '../../shared/types'
import { formatBytes, zy } from '../api'
import { Icon } from '../components/Icon'
import { Badge, Button, Card, Loading, PageHeader, Pivot, RiskBadge, ScanBar, SectionTitle, Select, Setting, Toggle, useLoad, useToast } from '../components/ui'
import { applyEach } from '../lib/actions'
import { runTask } from '../lib/tasks'

type Tab = 'boost' | 'auto' | 'ready'
type Level = 'high' | 'above' | 'normal' | 'below'
interface Rule { exe: string; level: Level }
interface Auto { enabled: boolean; games: string[]; rules: Rule[] }
interface Check { id: string; label: string; detail: string; ok: boolean; fix: string }

const LEVELS: { value: Level; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'above', label: 'Above normal' },
  { value: 'normal', label: 'Normal' },
  { value: 'below', label: 'Below normal' }
]

function RemoveButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} title="Remove" className="flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-hover/[0.08]"><Icon name="cancel" size={16} /></button>
}

function useRunning() {
  const { data } = useLoad<{ name: string; hasWindow: boolean; protected: boolean }[]>(() => zy.processes.list())
  return useMemo(() => {
    const names = new Set<string>()
    for (const p of data ?? []) if (p.hasWindow && !p.protected) names.add(p.name)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [data])
}

function AutoTab() {
  const toast = useToast()
  const { data, setData } = useLoad<Auto>(() => zy.gamebooster.getAuto())
  const running = useRunning()
  const [game, setGame] = useState('')
  const [picked, setPicked] = useState('')
  const [ruleExe, setRuleExe] = useState('')
  const [ruleLevel, setRuleLevel] = useState<Level>('high')

  async function saveAuto(enabled: boolean, games: string[]) {
    try { setData(await zy.gamebooster.setAuto(enabled, games)) } catch (e: any) { toast('err', String(e.message ?? e)) }
  }
  async function saveRules(rules: Rule[]) {
    try { setData(await zy.gamebooster.setRules(rules)) } catch (e: any) { toast('err', String(e.message ?? e)) }
  }

  if (!data) return <Loading />

  const addGame = (name: string) => {
    const n = name.trim()
    if (!n) return
    saveAuto(data.enabled, [...data.games, n])
    setGame(''); setPicked('')
  }

  return (
    <>
      <SectionTitle className="!mt-0">Auto boost</SectionTitle>
      <Setting icon="controller" title="Boost automatically when a game starts" description="Switches to the high performance power plan, frees RAM and pauses background services while a listed game runs, then restores everything. Other apps are not closed">
        <Toggle on={data.enabled} onChange={(v) => saveAuto(v, data.games)} />
      </Setting>
      <Card className="mt-1">
        {data.games.length === 0 ? <div className="px-4 py-3 text-[14px] text-mute">No games yet. Add the program name, for example <span className="text-soft">eldenring</span></div> : data.games.map((g) => (
          <div key={g} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
            <Icon name="controller" size={20} />
            <span className="min-w-0 flex-1 truncate">{g}</span>
            <RemoveButton onClick={() => saveAuto(data.enabled, data.games.filter((x) => x !== g))} />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <input type="text" placeholder="Program name, e.g. csgo" value={game} onChange={(e) => setGame(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addGame(game)} className="w-56" />
          <Button variant="ghost" disabled={!game.trim()} onClick={() => addGame(game)}>Add</Button>
          <span className="text-[14px] text-mute">or</span>
          <Select value={picked} onChange={(v) => v && addGame(v)} className="w-56" options={[{ value: '', label: 'Pick a running app...' }, ...running.map((n) => ({ value: n, label: n }))]} />
        </div>
      </Card>

      <SectionTitle>Priority rules</SectionTitle>
      <p className="mb-2 text-[14px] text-mute">Set the processor priority a program gets each time it starts. System programs can not be changed</p>
      <Card>
        {data.rules.length === 0 ? <div className="px-4 py-3 text-[14px] text-mute">No rules yet</div> : data.rules.map((r) => (
          <div key={r.exe} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
            <span className="min-w-0 flex-1 truncate">{r.exe}</span>
            <Select<Level> value={r.level} onChange={(v) => saveRules(data.rules.map((x) => (x.exe === r.exe ? { ...x, level: v } : x)))} options={LEVELS} className="w-44" />
            <RemoveButton onClick={() => saveRules(data.rules.filter((x) => x.exe !== r.exe))} />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <input type="text" placeholder="Program name, e.g. obs64" value={ruleExe} onChange={(e) => setRuleExe(e.target.value)} className="w-56" />
          <Select<Level> value={ruleLevel} onChange={setRuleLevel} options={LEVELS} className="w-44" />
          <Button variant="ghost" disabled={!ruleExe.trim()} onClick={() => { saveRules([...data.rules, { exe: ruleExe.trim(), level: ruleLevel }]); setRuleExe('') }}>Add rule</Button>
        </div>
      </Card>
    </>
  )
}

function ReadyTab() {
  const toast = useToast()
  const { data, loading, error, reload } = useLoad<Check[]>(() => zy.gamebooster.checks())
  const [busy, setBusy] = useState<string | null>(null)

  async function fix(c: Check) {
    setBusy(c.id)
    try {
      const r = await zy.gamebooster.fixCheck(c.id)
      if (!r.ok) toast('err', `${c.label}: ${r.reason ?? 'Could not change it'}`)
      else if (c.id === 'hags') toast('info', 'Restart Windows to finish turning on GPU scheduling')
      window.dispatchEvent(new Event('zyro:changed'))
      await reload()
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(null)
  }

  return (
    <>
      <ScanBar active={loading} />
      {error ? <Setting icon="error" title="Could not run the checks" description={error} /> : !data ? <Loading /> : (
        <div className="space-y-1">
          {data.map((c) => (
            <Setting key={c.id} icon={c.ok ? 'checkmark' : 'info'} title={c.label} description={c.detail}>
              <Badge tone={c.ok ? 'safe' : 'medium'}>{c.ok ? 'Good' : 'Could be better'}</Badge>
              {!c.ok && <Button variant="soft" busy={busy === c.id} onClick={() => fix(c)}>{c.fix}</Button>}
            </Setting>
          ))}
        </div>
      )}
    </>
  )
}

function BoostTab() {
  const { data, loading, error, reload } = useLoad<ScanItem[]>(() => zy.gamebooster.scan())
  const toast = useToast()
  const [status, setStatus] = useState<any>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const refreshStatus = () => zy.gamebooster.status().then(setStatus)
  useEffect(() => {
    refreshStatus()
    return window.zyro.on('gamebooster:auto', () => { refreshStatus(); reload() })
  }, [])
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
        { title: 'Game Booster', icon: 'controller', page: 'gamebooster', message: 'Preparing...', progress: 2, cancellable: true },
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
      <Setting
        icon="controller"
        title={active ? 'Boost is on' : 'Boost is off'}
        description={active ? `Paused: ${status.pausedServices.length} service(s) · Closed: ${status.closed.length} app(s)` : `${sel.size} optimization(s) ready. Select what to include below`}
        className="mb-2 shrink-0"
      >
        {active ? <Button variant="soft" icon="restart" onClick={stop} busy={busy}>Stop and restore everything</Button> : <Button onClick={start} busy={busy} disabled={sel.size === 0}>Start boost</Button>}
      </Setting>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-6">
        <div className="col-span-5 min-h-0 overflow-auto">
          <SectionTitle className="!mt-0">Optimizations</SectionTitle>
          <Card>
            {opts.map((i) => (
              <label key={i.id} className={`flex cursor-pointer items-start gap-3 border-b border-line px-4 py-3 last:border-0 ${i.needsAdmin ? 'opacity-60' : ''}`}>
                <input type="checkbox" className="mt-0.5" checked={sel.has(i.id)} disabled={i.needsAdmin || active} onChange={() => toggle(i.id)} />
                <div className="flex-1">
                  <div>{i.label}</div>
                  <div className="text-[12px] leading-4 text-mute">{i.detail}</div>
                </div>
                {i.needsAdmin && <Badge>Needs admin</Badge>}
              </label>
            ))}
          </Card>
        </div>
        <div className="col-span-7 flex min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold leading-5">Background apps to close</h2>
            <button className="link rounded px-2 py-0.5 text-[14px]" onClick={reload}>Rescan</button>
          </div>
          <Card className="min-h-0 flex-1 overflow-auto">
            <ScanBar active={loading} />
            {error ? <div className="p-5 text-bad">{error}</div> : loading && !data ? <Loading /> : procs.length === 0 ? <div className="p-6 text-center text-mute">No heavy background apps found</div> : procs.map((i, n) => (
              <label key={i.id} style={{ animationDelay: `${Math.min(n, 14) * 20}ms` }} className="fade-up flex cursor-pointer items-center gap-3 border-b border-line px-4 py-2.5 transition-colors duration-[83ms] hover:bg-hover/[0.04]">
                <input type="checkbox" checked={sel.has(i.id)} disabled={active} onChange={() => toggle(i.id)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate">{i.label} {!!i.meta?.suggested && <Badge>Suggested</Badge>}</div>
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

export function GameBooster() {
  const [tab, setTab] = useState<Tab>('boost')
  return (
    <>
      <PageHeader title="Game Booster" subtitle="Frees CPU and RAM for your game by pausing background apps and services, then puts everything back when you stop. Apps with open windows are asked to close politely, so save your work first" />
      <div className="mb-3"><Pivot<Tab> value={tab} onChange={setTab} options={[{ value: 'boost', label: 'Boost' }, { value: 'auto', label: 'Automation' }, { value: 'ready', label: 'Readiness' }]} /></div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto pb-2 pr-1">
        {tab === 'boost' ? <BoostTab /> : tab === 'auto' ? <AutoTab /> : <ReadyTab />}
      </div>
    </>
  )
}
