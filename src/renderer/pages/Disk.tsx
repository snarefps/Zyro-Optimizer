import { useEffect, useRef, useState } from 'react'
import { formatBytes, zy } from '../api'
import { Treemap, TreeItem } from '../components/charts'
import { Button, Card, Empty, Modal, PageHeader, Pivot, ProgressBar, ScanBar, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { runTask } from '../lib/tasks'

type Tab = 'map' | 'large' | 'dups'
interface FileRef { path: string; size: number }
interface DupGroup { size: number; hash: string; files: string[] }

export function Disk() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('map')
  const [drives, setDrives] = useState<any[]>([])
  const [path, setPath] = useState('')
  const [map, setMap] = useState<{ total: number; partial: boolean; children: TreeItem[] } | null>(null)
  const [mapBusy, setMapBusy] = useState(false)
  const [large, setLarge] = useState<FileRef[] | null>(null)
  const [dups, setDups] = useState<DupGroup[] | null>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(900)

  useEffect(() => {
    zy.disk.drives().then(setDrives)
    return window.zyro.on('disk:progress', (p) => setProgress(`${Number(p.scanned).toLocaleString()} · ${p.current}`))
  }, [])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el); setW(el.clientWidth)
    return () => ro.disconnect()
  }, [tab])

  async function analyze(p: string) {
    setMapBusy(true)
    try { const m = await zy.disk.analyze(p); setPath(m.path); setMap(m) } catch (e: any) { toast('err', String(e.message ?? e)) }
    setMapBusy(false)
  }
  useEffect(() => { analyze('~') }, [])

  const up = () => {
    const parts = path.replace(/\\$/, '').split('\\')
    if (parts.length <= 1) return
    analyze(parts.length === 2 ? `${parts[0]}\\` : parts.slice(0, -1).join('\\'))
  }

  async function scanLarge() {
    setScanBusy(true); setLarge(null); setProgress('')
    try {
      setLarge(await runTask<FileRef[]>(
        { title: 'Finding large files', icon: 'database', page: 'disk', message: 'Scanning your user folder...' },
        async (h) => {
          const off = window.zyro.on('disk:progress', (p) => h.update({ message: `Scanned ${Number(p.scanned).toLocaleString()} files...` }))
          try { return await zy.disk.largeFiles('~', 100, 200) } finally { off() }
        },
        (r) => `Found ${r.length} file(s) over 100 MB`
      ))
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setScanBusy(false)
  }
  async function scanDups() {
    setScanBusy(true); setDups(null); setProgress('')
    try {
      setDups(await runTask<DupGroup[]>(
        { title: 'Finding duplicate files', icon: 'folder-tree', page: 'disk', message: 'Scanning your user folder...' },
        async (h) => {
          const off = window.zyro.on('disk:progress', (p) => h.update({ message: String(p.current).startsWith('Comparing') ? String(p.current) : `Scanned ${Number(p.scanned).toLocaleString()} files...` }))
          try { return await zy.disk.duplicates('~', 1) } finally { off() }
        },
        (r) => (r.length ? `Found ${r.length} group(s) of duplicate files` : 'No duplicates found')
      ))
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setScanBusy(false)
  }

  async function trash() {
    setConfirm(false)
    const paths = [...picked]
    try {
      const res: any[] = await runTask(
        { title: 'Moving files to the Recycle Bin', icon: 'recycle-bin', page: 'disk', message: `Moving ${paths.length} file(s)...` },
        async () => zy.disk.trash(paths),
        (r: any[]) => `Moved ${r.filter((x) => x.ok).length} file(s) to the Recycle Bin${r.some((x) => !x.ok) ? `, ${r.filter((x) => !x.ok).length} refused` : ''}`
      )
      const gone = new Set(res.filter((r) => r.ok).map((r) => r.path))
      setLarge((l) => l && l.filter((f) => !gone.has(f.path)))
      setDups((d) => d && d.map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f)) })).filter((g) => g.files.length > 1))
      setPicked(new Set())
      window.dispatchEvent(new Event('zyro:changed'))
    } catch (e: any) { toast('err', String(e.message ?? e)) }
  }

  const toggle = (p: string) => setPicked((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n })
  const pickedSize = [...picked].reduce((n, p) => n + (large?.find((f) => f.path === p)?.size ?? dups?.find((g) => g.files.includes(p))?.size ?? 0), 0)

  return (
    <>
      <PageHeader title="Disk Analyzer" subtitle="See where your space goes, find huge files and remove duplicates. Files you remove go to the Recycle Bin, so you can always get them back." />
      <div className="mb-4 grid grid-cols-4 gap-3">
        {drives.map((d) => {
          const pct = ((d.total - d.free) / d.total) * 100
          return (
            <button key={d.letter} onClick={() => { setTab('map'); analyze(`${d.letter}:\\`) }} className="text-left">
              <Card lift className={`p-3 ${path.startsWith(d.letter) ? '!border-accent' : ''}`}>
                <div className="flex items-center justify-between text-[14px]"><span className="flex items-center gap-2"><Icon name="ssd" size={20} />{d.letter}:</span><span className="text-[12px] text-mute">{formatBytes(d.free)} free</span></div>
                <div className="my-2.5"><ProgressBar value={pct} /></div>
                <div className="text-[12px] text-mute">{formatBytes(d.total - d.free)} of {formatBytes(d.total)}</div>
              </Card>
            </button>
          )
        })}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Pivot<Tab> value={tab} onChange={setTab} options={[{ value: 'map', label: 'Space map' }, { value: 'large', label: 'Large files' }, { value: 'dups', label: 'Duplicates' }]} />
        {tab !== 'map' && (
          <>
            <Button onClick={tab === 'large' ? scanLarge : scanDups} busy={scanBusy}>{tab === 'large' ? 'Find files over 100 MB' : 'Find duplicates'}</Button>
            {scanBusy ? <><span className="max-w-[220px] truncate text-[12px] text-mute">{progress}</span><Button variant="ghost" onClick={() => zy.disk.cancel()}>Stop</Button></> : <span className="text-[12px] text-mute">Scans your user folder</span>}
            <div className="ml-auto flex shrink-0 items-center gap-3 whitespace-nowrap">
              <span className="text-[14px] text-mute">{picked.size} selected · {formatBytes(pickedSize)}</span>
              <Button variant="danger" icon="recycle-bin" disabled={picked.size === 0} onClick={() => setConfirm(true)}>Move to Recycle Bin</Button>
            </div>
          </>
        )}
      </div>

      <Card className="min-h-0 flex-1 overflow-auto">
        <ScanBar active={mapBusy || scanBusy} />
        <div className="p-4">
          {tab === 'map' && (
            <div ref={box}>
              <div className="mb-3 flex items-center gap-2 text-[14px]">
                <Button variant="ghost" onClick={up} disabled={path.replace(/\\$/, '').split('\\').length <= 1}>↑ Up</Button>
                <span className="text-soft">{path || '...'}</span>
                {map && <span className="ml-auto text-mute">{formatBytes(map.total)}{map.partial ? ' (partial: some folders took too long)' : ''}</span>}
              </div>
              {map && map.children.length > 0 ? (
                <Treemap items={map.children} width={Math.max(300, w)} height={400} fmt={formatBytes} onOpen={(i) => (i.isDir ? analyze(i.path) : zy.disk.reveal(i.path))} />
              ) : !mapBusy && <Empty title="Empty or unreadable" hint="This folder has no readable contents." icon="folder-tree" />}
              {mapBusy && !map && <div className="py-16 text-center text-mute">Measuring folders... large drives can take a minute.</div>}
            </div>
          )}
          {tab === 'large' && (large === null ? <Empty title="Find your biggest files" hint="Scans your user folder for files over 100 MB." icon="database" /> : large.length === 0 ? <Empty title="No large files found" /> : large.map((f, n) => (
            <label key={f.path} style={{ animationDelay: `${Math.min(n, 14) * 18}ms` }} className="fade-up flex cursor-pointer items-center gap-3 border-b border-line py-2 transition-colors duration-[83ms] hover:bg-hover/[0.04]">
              <input type="checkbox" checked={picked.has(f.path)} onChange={() => toggle(f.path)} />
              <span className="min-w-0 flex-1 truncate" title={f.path}>{f.path}</span>
              <button className="link rounded px-2 py-0.5 text-[12px]" onClick={(e) => { e.preventDefault(); zy.disk.reveal(f.path) }}>Show</button>
              <span className="w-24 text-right tabular-nums text-soft">{formatBytes(f.size)}</span>
            </label>
          )))}
          {tab === 'dups' && (dups === null ? <Empty title="Find duplicate files" hint="Compares files by content (not just name), so only true copies are listed. Tick the extra copies to remove and keep one." icon="folder-tree" /> : dups.length === 0 ? <Empty title="No duplicates found" /> : dups.map((g) => (
            <div key={g.hash} className="fade-up mb-3 rounded-lg border border-line p-3">
              <div className="mb-1 text-[12px] text-mute">{g.files.length} copies · {formatBytes(g.size)} each · wasting {formatBytes(g.size * (g.files.length - 1))}</div>
              {g.files.map((f) => (
                <label key={f} className="flex cursor-pointer items-center gap-3 py-1">
                  <input type="checkbox" checked={picked.has(f)} onChange={() => toggle(f)} />
                  <span className="truncate" title={f}>{f}</span>
                </label>
              ))}
            </div>
          )))}
        </div>
      </Card>

      <Modal open={confirm} title="Move to Recycle Bin?" onClose={() => setConfirm(false)} actions={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={trash}>Move {picked.size} file(s)</Button></>}>
        {formatBytes(pickedSize)} will move to the Recycle Bin. You can restore them from there until you empty it.
        {tab === 'dups' && dups?.some((g) => g.files.every((f) => picked.has(f))) && <div className="mt-3 rounded-lg border border-line bg-hover/[0.04] p-3 text-fg">Warning: you ticked every copy of at least one file. Untick one copy per group to keep it.</div>}
      </Modal>
    </>
  )
}
