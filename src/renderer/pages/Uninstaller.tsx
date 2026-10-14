import { useMemo, useState } from 'react'
import type { ScanItem } from '../../shared/types'
import { formatBytes, zy } from '../api'
import { Button, Card, Empty, Modal, PageHeader, ScanBar, Select, Loading, useLoad, useToast } from '../components/ui'
import { runTask } from '../lib/tasks'

type Sort = 'name' | 'size' | 'date'

export function Uninstaller() {
  const { data, loading, error, reload } = useLoad<ScanItem[]>(() => zy.uninstaller.scan())
  const toast = useToast()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [target, setTarget] = useState<ScanItem | null>(null)
  const [leftoverFor, setLeftoverFor] = useState<ScanItem | null>(null)
  const [leftovers, setLeftovers] = useState<ScanItem[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const list = useMemo(() => {
    const l = (data ?? []).filter((i) => !q || `${i.label} ${i.detail}`.toLowerCase().includes(q.toLowerCase()))
    return [...l].sort((a, b) => sort === 'size' ? (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) : sort === 'date' ? String(b.meta?.installDate).localeCompare(String(a.meta?.installDate)) : a.label.localeCompare(b.label))
  }, [data, q, sort])

  async function uninstall() {
    const t = target!
    setTarget(null)
    try {
      await runTask({ title: `Uninstalling ${t.label}`, icon: 'package', page: 'uninstaller', message: 'Starting the uninstaller...' }, async (h) => {
        const [r] = await zy.uninstaller.apply([t.id])
        if (r.status !== 'ok') throw new Error(r.reason ?? 'Failed')
        h.done('Uninstaller opened. Follow its window to finish.')
      })
      setLeftoverFor(t)
    } catch (e: any) { toast('err', `${t.label}: ${String(e.message ?? e)}`) }
  }

  async function findLeftovers() {
    const t = leftoverFor!
    setBusy(true)
    try {
      const items = await runTask<ScanItem[]>(
        { title: `Looking for leftovers of ${t.label}`, icon: 'folder-tree', page: 'uninstaller', message: 'Checking Program Files and AppData...' },
        async () => zy.uninstaller.leftovers(t.label),
        (r) => (r.length ? `Found ${r.length} possible leftover folder(s)` : 'No leftovers found')
      )
      setLeftovers(items)
      setPicked(new Set())
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(false)
  }

  async function removeLeftovers() {
    const paths = [...picked]
    try {
      await runTask({ title: 'Removing leftover folders', icon: 'broom', page: 'uninstaller', message: `Removing ${paths.length} folder(s)...` }, async (h) => {
        const res: any[] = await zy.uninstaller.removeLeftovers(paths)
        h.done(`Removed ${res.filter((r) => r.status === 'ok').length} leftover folder(s)`)
      })
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setLeftovers(null); setLeftoverFor(null); reload()
  }

  return (
    <>
      <PageHeader title="Uninstaller" subtitle="Remove programs with their own uninstaller, then scan for leftover folders they left behind." actions={<Button variant="ghost" icon="refresh" onClick={reload} busy={loading}>Rescan</Button>} />
      <div className="mb-3 flex items-center gap-2">
        <input type="text" placeholder="Search programs..." value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <span className="ml-3 text-[14px] text-mute">Sort by</span>
        <Select<Sort> value={sort} onChange={setSort} className="w-44" options={[{ value: 'name', label: 'Name' }, { value: 'size', label: 'Size' }, { value: 'date', label: 'Install date' }]} />
        <span className="ml-auto text-[14px] text-mute">{list.length} programs</span>
      </div>
      <Card className="min-h-0 flex-1 overflow-auto">
        <ScanBar active={loading} />
        {error ? <div className="p-6 text-bad">{error}</div> : loading && !data ? <Loading /> : list.length === 0 ? <Empty title="No programs found" icon="package" /> : list.map((i, n) => (
          <div key={i.id} style={{ animationDelay: `${Math.min(n, 14) * 18}ms` }} className="fade-up flex items-center gap-3 border-b border-line px-4 py-2.5 transition-colors duration-[83ms] hover:bg-hover/[0.04]">
            <div className="min-w-0 flex-1">
              <div className="truncate">{i.label}</div>
              <div className="truncate text-[12px] text-mute">{i.detail}</div>
            </div>
            <div className="w-24 text-right tabular-nums text-soft">{formatBytes(i.sizeBytes)}</div>
            <Button variant="soft" onClick={() => setTarget(i)}>Uninstall</Button>
          </div>
        ))}
      </Card>

      <Modal open={!!target} title={`Uninstall ${target?.label ?? ''}?`} onClose={() => setTarget(null)} actions={<><Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button><Button variant="danger" onClick={uninstall}>Uninstall</Button></>}>
        This starts the program's own uninstaller. Follow its window to finish. When it is done, come back to scan for leftover files.
      </Modal>

      <Modal open={!!leftoverFor && !leftovers} title="Scan for leftovers?" onClose={() => setLeftoverFor(null)} actions={<><Button variant="ghost" onClick={() => setLeftoverFor(null)}>Not now</Button><Button onClick={findLeftovers} busy={busy}>Scan for leftovers</Button></>}>
        Once {leftoverFor?.label} has finished uninstalling, Zyro can look for folders it left in Program Files and AppData. Only continue after the uninstaller has completed.
      </Modal>

      <Modal wide open={!!leftovers} title={`Leftovers of ${leftoverFor?.label ?? ''}`} onClose={() => setLeftovers(null)} actions={<><Button variant="ghost" onClick={() => setLeftovers(null)}>Close</Button><Button variant="danger" disabled={picked.size === 0} onClick={removeLeftovers}>Delete selected</Button></>}>
        {leftovers && leftovers.length === 0 ? 'No leftovers found. Either the program is still installed or it cleaned up after itself.' : (
          <div className="space-y-1">
            {(leftovers ?? []).map((l) => (
              <label key={l.id} className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-hover/[0.05]">
                <input type="checkbox" checked={picked.has(l.id)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n })} />
                <span className="flex-1 truncate">{l.label}</span>
                <span className="tabular-nums">{formatBytes(l.sizeBytes)}</span>
              </label>
            ))}
          </div>
        )}
      </Modal>
    </>
  )
}
