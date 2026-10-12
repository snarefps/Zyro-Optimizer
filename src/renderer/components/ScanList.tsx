import { ReactNode, useEffect, useMemo, useState } from 'react'
import type { ItemResult, ScanItem } from '../../shared/types'
import { formatBytes } from '../api'
import { applyEach } from '../lib/actions'
import { autoRestorePoint } from '../lib/restore'
import { runTask } from '../lib/tasks'
import { Badge, Button, Card, Empty, Modal, RiskBadge, ScanBar, Skeleton, useLoad, useToast } from './ui'

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
  restorePoint?: string
  showSize?: boolean
  summarize?: (results: ItemResult[]) => string
  extra?: (i: ScanItem) => ReactNode
  toolbar?: ReactNode
  search?: boolean
  loadingHint?: string
}

export function ScanList({ load, apply, applyLabel, task, preselect, groupBy, emptyTitle, emptyHint, emptyIcon, confirmText, restorePoint, showSize = true, summarize, extra, toolbar, search, loadingHint }: Props) {
  const { data, loading, error, reload } = useLoad(load)
  const toast = useToast()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [results, setResults] = useState<Record<string, ItemResult>>({})
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!data) return
    const pre = preselect ?? ((i: ScanItem) => i.risk === 'safe' && !i.needsAdmin)
    setSel(new Set(data.filter((i) => pre(i) && !i.needsAdmin).map((i) => i.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          if (restorePoint) await autoRestorePoint(restorePoint, h)
          return applyEach(h, [...sel], (id) => labels.get(id) ?? id, task.verb, apply)
        },
        (r) => {
          const bad = r.filter((x) => x.status !== 'ok').length
          return `${summarize ? summarize(r) : `${r.filter((x) => x.status === 'ok').length} item(s) done`}${bad ? `, ${bad} skipped or failed` : ''}`
        }
      )
      setResults(Object.fromEntries(res.map((r) => [r.id, r])))
      window.dispatchEvent(new Event('zyro:changed'))
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
          <span className="text-[13px] text-mute">{sel.size} selected{showSize && totalSize > 0 ? ` · ${formatBytes(totalSize)}` : ''}</span>
          <Button busy={busy} disabled={sel.size === 0 || loading} onClick={() => (needsConfirm ? setConfirm(true) : run())}>{applyLabel}</Button>
        </div>
      </div>

      <Card className="min-h-0 flex-1 overflow-auto">
        <ScanBar active={loading} />
        {loading && !data ? (
          <>
            <Skeleton />
            {loadingHint && <div className="pb-4 text-center text-[12px] text-mute">{loadingHint}</div>}
          </>
        ) : items.length === 0 ? <Empty title={emptyTitle} hint={emptyHint} icon={emptyIcon} /> : (
          groups.map(([g, list]) => (
            <div key={g}>
              {g && <div className="sticky top-0 z-10 bg-panel/95 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-mute backdrop-blur">{g}</div>}
              {list.map((i, n) => {
                const r = results[i.id]
                return (
                  <label key={i.id} style={{ animationDelay: `${Math.min(n, 14) * 22}ms` }} className={`fade-up flex cursor-pointer items-center gap-3 border-b border-line/60 px-4 py-2.5 transition-colors hover:bg-hover/[0.04] ${i.needsAdmin ? 'opacity-60' : ''}`}>
                    <input type="checkbox" checked={sel.has(i.id)} disabled={i.needsAdmin} onChange={() => toggle(i.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{i.label}</div>
                      {i.detail && <div className="truncate text-[12px] text-mute">{i.detail}</div>}
                    </div>
                    {extra?.(i)}
                    {i.needsAdmin && <Badge tone="info" title="Restart Zyro as administrator to use this">Needs admin</Badge>}
                    <RiskBadge risk={i.risk} />
                    {showSize && <div className="w-24 text-right tabular-nums text-soft">{formatBytes(i.sizeBytes)}</div>}
                    {r && <Badge tone={r.status === 'ok' ? 'safe' : r.status === 'skipped' ? 'medium' : 'high'} title={r.reason}>{r.status === 'ok' ? 'Done' : r.status === 'skipped' ? 'Skipped' : 'Failed'}</Badge>}
                  </label>
                )
              })}
            </div>
          ))
        )}
      </Card>

      <Modal open={confirm} icon="box-important" title="Please confirm" onClose={() => setConfirm(false)} actions={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button onClick={run}>{applyLabel}</Button></>}>
        {confirmText ?? 'Some selected items are marked "Caution". Zyro records how to undo them on the Restore page, but please check the list first.'}
        <ul className="mt-3 max-h-48 list-disc overflow-auto pl-5 text-mute">
          {selectedItems.slice(0, 40).map((i) => <li key={i.id}>{i.label}</li>)}
        </ul>
      </Modal>
    </div>
  )
}
