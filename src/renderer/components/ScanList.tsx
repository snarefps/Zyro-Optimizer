import { ReactNode, useEffect, useMemo, useState } from 'react'
import { GLYPH_FONT } from './Icon'
import type { ItemResult, ScanItem } from '../../shared/types'
import { formatBytes } from '../api'
import { applyEach } from '../lib/actions'
import { runTask } from '../lib/tasks'
import { Badge, Button, Card, Empty, Loading, Modal, ProgressRing, RiskBadge, ScanBar, useLoad, useToast } from './ui'

interface Props {
  load: () => Promise<ScanItem[]>
  apply: (ids: string[]) => Promise<ItemResult[]>
  applyLabel: string
  task: { title: string; icon: string; verb: string; page: string }
  preselect?: (i: ScanItem) => boolean
  groupBy?: (i: ScanItem) => string
  emptyTitle: string
  emptyHint?: string
  emptyIcon?: string
  confirmText?: string
  showSize?: boolean
  summarize?: (results: ItemResult[]) => string
  extra?: (i: ScanItem) => ReactNode
  toolbar?: ReactNode
  search?: boolean
  loadingHint?: string
  progressChannel?: string
  details?: (id: string) => Promise<{ items: { name: string; path: string; size: number; isDir: boolean }[]; total: number; note?: string }>
}

type Detail = { items: { name: string; path: string; size: number; isDir: boolean }[]; total: number; note?: string } | { error: string } | null

export function ScanList({ load, apply, applyLabel, task, preselect, groupBy, emptyTitle, emptyHint, emptyIcon, confirmText, showSize = true, summarize, extra, toolbar, search, loadingHint, progressChannel, details }: Props) {
  const { data, loading, error, reload } = useLoad(load)
  const toast = useToast()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [results, setResults] = useState<Record<string, ItemResult>>({})
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [info, setInfo] = useState<Record<string, Detail>>({})

  function expand(id: string) {
    const isOpen = open.has(id)
    setOpen((s) => { const n = new Set(s); isOpen ? n.delete(id) : n.add(id); return n })
    if (!isOpen && details && info[id] === undefined) {
      setInfo((m) => ({ ...m, [id]: null }))
      details(id).then((d) => setInfo((m) => ({ ...m, [id]: d }))).catch((e) => setInfo((m) => ({ ...m, [id]: { error: String(e?.message ?? e) } })))
    }
  }

  useEffect(() => {
    if (!data) return
    const pre = preselect ?? ((i: ScanItem) => i.risk === 'safe' && !i.needsAdmin)
    setSel(new Set(data.filter((i) => pre(i) && !i.needsAdmin).map((i) => i.id)))
  }, [data])

  const items = useMemo(() => (data ?? []).filter((i) => !q || `${i.label} ${i.detail ?? ''}`.toLowerCase().includes(q.toLowerCase())), [data, q])
  const selectedItems = (data ?? []).filter((i) => sel.has(i.id))
  const totalSize = selectedItems.reduce((n, i) => n + (i.sizeBytes ?? 0), 0)
  const needsConfirm = selectedItems.some((i) => i.risk === 'medium' || i.risk === 'high') || !!confirmText

  const groups = useMemo(() => {
    const m = new Map<string, ScanItem[]>()
    for (const i of items) {
      const g = groupBy ? groupBy(i) : ''
      m.set(g, [...(m.get(g) ?? []), i])
    }
    return [...m.entries()]
  }, [items, groupBy])

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function run() {
    setConfirm(false); setBusy(true)
    const labels = new Map((data ?? []).map((i) => [i.id, i.label]))
    try {
      const res = await runTask(
        { title: task.title, icon: task.icon, page: task.page, message: 'Preparing...', progress: 2 },
        async (h) => {
          const off = progressChannel ? window.zyro.on(progressChannel, (e: { message?: string }) => e.message && h.update({ message: e.message })) : null
          try { return await applyEach(h, [...sel], (id) => labels.get(id) ?? id, task.verb, apply) } finally { off?.() }
        },
        (r) => {
          const bad = r.filter((x) => x.status !== 'ok').length
          return `${summarize ? summarize(r) : `${r.filter((x) => x.status === 'ok').length} item(s) done`}${bad ? `, ${bad} skipped or failed` : ''}`
        }
      )
      setResults(Object.fromEntries(res.map((r) => [r.id, r])))
      window.dispatchEvent(new Event('zyro:changed'))
      setInfo({}); setOpen(new Set())
      await reload()
    } catch (e: any) { toast('err', String(e.message ?? e)) } finally { setBusy(false) }
  }

  if (error) return <Card className="p-6 text-bad">Could not scan: {error} <Button className="ml-3" variant="ghost" onClick={reload}>Retry</Button></Card>

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => setSel(new Set((data ?? []).filter((i) => !i.needsAdmin).map((i) => i.id)))}>Select all</Button>
        <Button variant="ghost" onClick={() => setSel(new Set())}>Select none</Button>
        <Button variant="ghost" icon="refresh" onClick={reload} busy={loading}>Rescan</Button>
        {search && <input type="text" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />}
        {toolbar}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[14px] text-mute">{sel.size} selected{showSize && totalSize > 0 ? ` · ${formatBytes(totalSize)}` : ''}</span>
          <Button busy={busy} disabled={sel.size === 0 || loading} onClick={() => (needsConfirm ? setConfirm(true) : run())}>{applyLabel}</Button>
        </div>
      </div>

      <Card className="min-h-0 flex-1 overflow-auto">
        <ScanBar active={loading} />
        {loading && !data ? (
          <>
            <Loading label={loadingHint} />
          </>
        ) : items.length === 0 ? <Empty title={emptyTitle} hint={emptyHint} icon={emptyIcon} /> : (
          groups.map(([g, list]) => (
            <div key={g}>
              {g && <div className="sticky top-0 z-10 border-b border-line bg-panel px-4 py-2 text-[12px] font-semibold text-mute">{g}</div>}
              {list.map((i, n) => {
                const r = results[i.id]
                const isOpen = open.has(i.id)
                const d = info[i.id]
                return (
                  <div key={i.id} className="border-b border-line">
                    <label style={{ animationDelay: `${Math.min(n, 14) * 22}ms` }} className={`fade-up flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors duration-[83ms] hover:bg-hover/[0.04] ${i.needsAdmin ? 'opacity-60' : ''}`}>
                      <input type="checkbox" checked={sel.has(i.id)} disabled={i.needsAdmin} onChange={() => toggle(i.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{i.label}</div>
                        {i.detail && <div className="truncate text-[12px] text-mute">{i.detail}</div>}
                        {r && r.status !== 'ok' && r.reason && <div className={`truncate text-[12px] ${r.status === 'failed' ? 'text-bad' : 'text-mute'}`} title={r.reason}>{r.reason}</div>}
                      </div>
                      {extra?.(i)}
                      {i.needsAdmin && <Badge tone="info" title="Restart Zyro as administrator to use this">Needs admin</Badge>}
                      <RiskBadge risk={i.risk} />
                      {showSize && <div className="w-24 text-right tabular-nums text-soft">{formatBytes(i.sizeBytes)}</div>}
                      {r && <Badge tone={r.status === 'ok' ? 'safe' : r.status === 'skipped' ? 'medium' : 'high'} title={r.reason}>{r.status === 'ok' ? 'Done' : r.status === 'skipped' ? 'Skipped' : 'Failed'}</Badge>}
                      {details && (
                        <button
                          type="button"
                          title={isOpen ? 'Hide details' : 'Show what is inside'}
                          aria-expanded={isOpen}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); expand(i.id) }}
                          className="flex h-8 w-9 shrink-0 items-center justify-center rounded text-fg transition-colors duration-[83ms] hover:bg-hover/[0.08]"
                        >
                          <span aria-hidden className={`transition-transform duration-[250ms] ease-[cubic-bezier(0.1,0.9,0.2,1)] ${isOpen ? 'rotate-180' : ''}`} style={{ fontFamily: GLYPH_FONT, fontSize: 12 }}>{'\uE70D'}</span>
                        </button>
                      )}
                    </label>
                    {details && (
                      <div className={`grid transition-[grid-template-rows] duration-[250ms] ease-[cubic-bezier(0.1,0.9,0.2,1)] ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                        <div className="min-h-0 overflow-hidden">
                          <div className="border-t border-line bg-hover/[0.03]">
                            {d === undefined || d === null ? <div className="flex justify-center py-5 text-accent"><ProgressRing size={24} /></div>
                              : 'error' in d ? <div className="px-4 py-3 pl-[52px] text-[14px] text-bad">{d.error}</div>
                              : d.items.length === 0 ? <div className="px-4 py-3 pl-[52px] text-[14px] text-mute">{d.note ?? 'Nothing to list.'}</div>
                              : (
                                <>
                                  {d.items.map((f) => (
                                    <div key={f.path} className="flex items-center gap-3 border-b border-line py-2 pl-[52px] pr-4 last:border-0" title={f.path}>
                                      <span aria-hidden className="w-4 shrink-0 text-center text-mute" style={{ fontFamily: GLYPH_FONT, fontSize: 14 }}>{f.isDir ? '\uE8B7' : '\uE7C3'}</span>
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-[14px]">{f.name}</div>
                                        <div className="truncate text-[12px] text-mute">{f.path}</div>
                                      </div>
                                      <div className="w-24 shrink-0 text-right text-[14px] tabular-nums text-soft">{formatBytes(f.size)}</div>
                                      <span className="w-9 shrink-0" />
                                    </div>
                                  ))}
                                  {d.total > d.items.length && <div className="py-2.5 pl-[52px] pr-4 text-[12px] text-mute">and {d.total - d.items.length} more, the largest {d.items.length} are shown</div>}
                                </>
                              )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </Card>

      <Modal open={confirm} title="Please confirm" onClose={() => setConfirm(false)} actions={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={run}>{applyLabel}</Button></>}>
        {confirmText ?? 'Some selected items are marked "Caution". Zyro records how to undo them on the Restore page, but please check the list first.'}
        <ul className="mt-3 max-h-48 list-disc overflow-auto pl-5 text-mute">
          {selectedItems.slice(0, 40).map((i) => <li key={i.id}>{i.label}</li>)}
        </ul>
      </Modal>
    </div>
  )
}
