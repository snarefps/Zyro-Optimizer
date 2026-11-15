import { useState } from 'react'
import { formatBytes, zy } from '../api'
import { Icon } from '../components/Icon'
import { Button, Card, Empty, Modal, PageHeader, Setting, useToast } from '../components/ui'
import { runTask } from '../lib/tasks'

interface Entry { path: string; size: number }
interface Row { path: string; ok: boolean; reason?: string }

export function Shredder() {
  const toast = useToast()
  const [entries, setEntries] = useState<Entry[]>([])
  const [path, setPath] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const total = entries.reduce((n, e) => n + e.size, 0)

  async function add() {
    const p = path.trim().replace(/^"|"$/g, '')
    if (!p) return
    if (entries.some((e) => e.path.toLowerCase() === p.toLowerCase())) { setPath(''); return }
    setAdding(true)
    try {
      const r = await zy.shred.inspect(p)
      if (r.ok) { setEntries((l) => [...l, { path: r.path, size: r.size }]); setPath('') } else toast('err', `${p}: ${r.reason}`)
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setAdding(false)
  }

  async function shred() {
    setConfirm(false)
    setBusy(true)
    const paths = entries.map((e) => e.path)
    try {
      const rows = await runTask<Row[]>(
        { title: 'Shredding files', icon: 'recycle-bin', page: 'shredder', message: `Overwriting ${paths.length} file(s)...`, cancellable: true },
        () => zy.shred.run(paths),
        (r) => `Shredded ${r.filter((x) => x.ok).length} file(s)${r.some((x) => !x.ok) ? `, ${r.filter((x) => !x.ok).length} failed` : ''}`
      )
      const gone = new Set(rows.filter((r) => r.ok).map((r) => r.path))
      rows.filter((r) => !r.ok).forEach((r) => toast('err', `${r.path}: ${r.reason}`))
      setEntries((l) => l.filter((e) => !gone.has(e.path)))
      window.dispatchEvent(new Event('zyro:changed'))
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(false)
  }

  return (
    <>
      <PageHeader title="File Shredder" subtitle="Overwrites a file three times, then deletes it. The files skip the Recycle Bin and can not be recovered" />
      <div className="mb-3"><Setting icon="info" title="Works best on hard drives" description="On SSDs and USB sticks an overwrite is not guaranteed. Use BitLocker for those" /></div>
      <div className="mb-3 flex items-center gap-2">
        <input type="text" placeholder="Paste the path of a file, e.g. C:\Users\you\secret.docx" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} className="min-w-0 flex-1" />
        <Button variant="ghost" busy={adding} disabled={!path.trim()} onClick={add}>Add file</Button>
        <span className="ml-3 text-[14px] text-mute">{entries.length} file(s){total > 0 ? ` · ${formatBytes(total)}` : ''}</span>
        <Button variant="danger" busy={busy} disabled={entries.length === 0} onClick={() => setConfirm(true)}>Shred files</Button>
      </div>
      <Card className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 ? <Empty title="No files added" hint="In File Explorer, Shift + right-click a file and choose Copy as path" icon="recycle-bin" /> : entries.map((e) => (
          <div key={e.path} className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <Icon name="recycle-bin" size={20} />
            <span className="min-w-0 flex-1 truncate" title={e.path}>{e.path}</span>
            <span className="w-24 text-right tabular-nums text-soft">{formatBytes(e.size)}</span>
            <button onClick={() => setEntries((l) => l.filter((x) => x.path !== e.path))} title="Remove from the list" className="flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-hover/[0.08]"><Icon name="cancel" size={16} /></button>
          </div>
        ))}
      </Card>
      <Modal open={confirm} title="Shred these files?" onClose={() => setConfirm(false)} actions={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={shred}>Shred {entries.length} file(s)</Button></>}>
        {formatBytes(total)} will be overwritten and deleted for good. They will not be in the Recycle Bin and you can not get them back
        <ul className="mt-3 max-h-40 list-disc overflow-auto pl-5 text-mute">{entries.slice(0, 30).map((e) => <li key={e.path} className="truncate">{e.path}</li>)}</ul>
      </Modal>
    </>
  )
}
