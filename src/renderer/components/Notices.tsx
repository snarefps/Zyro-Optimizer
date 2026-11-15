import { useEffect, useState } from 'react'
import { zy } from '../api'
import { smartOptimize } from '../lib/actions'
import { go } from '../lib/routes'
import { Icon } from './Icon'
import { Button, Modal, useToast } from './ui'

interface NewItem { id: string; name: string; cmd: string }

export function StartupAlert() {
  const toast = useToast()
  const [items, setItems] = useState<NewItem[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => window.zyro.on('startup:new', (list: NewItem[]) => setItems((cur) => [...cur, ...list.filter((n) => !cur.some((c) => c.id === n.id))])), [])

  if (items.length === 0) return null

  async function turnOff() {
    setBusy(true)
    try {
      const rows: { status: string; reason?: string }[] = await zy.startup.apply(items.map((i) => i.id))
      const bad = rows.filter((r) => r.status !== 'ok')
      if (bad.length) toast('err', bad[0].reason ?? 'Could not turn it off')
      else toast('ok', 'Turned off. You can turn it back on in the Startup Manager')
      window.dispatchEvent(new Event('zyro:changed'))
      setItems([])
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(false)
  }

  return (
    <div className="fade-up mb-1 ml-10 mr-8 mt-2 flex shrink-0 items-center gap-3 rounded-lg bg-panel py-2 pl-4 pr-2 text-[14px]">
      <Icon name="rocket" size={20} />
      <div className="min-w-0 flex-1 truncate" title={items.map((i) => i.cmd).join('\n')}>
        <span className="font-semibold">New startup item: {items.map((i) => i.name).join(', ')}</span> <span className="text-mute">It starts with Windows now</span>
      </div>
      <Button variant="ghost" onClick={() => { go('startup'); setItems([]) }}>Review</Button>
      <Button busy={busy} onClick={turnOff}>Turn off</Button>
      <button onClick={() => setItems([])} title="Keep it" aria-label="Keep it" className="flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-hover/[0.08]"><Icon name="cancel" size={16} /></button>
    </div>
  )
}

const INTRO_KEY = 'zyro-intro-done'

export function Intro() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(INTRO_KEY) !== '1' } catch { return false } })
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const close = () => { try { localStorage.setItem(INTRO_KEY, '1') } catch {} setOpen(false) }

  async function optimize() {
    setBusy(true)
    try { await smartOptimize() } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(false)
    close()
  }

  return (
    <Modal open={open} title="Welcome to Zyro Optimizer" onClose={close} actions={<><Button variant="ghost" onClick={close}>Skip</Button><Button busy={busy} onClick={optimize}>Safe optimize</Button></>}>
      <ul className="space-y-2.5">
        <li>Every change is listed under Restore &amp; History, with Undo where it is possible</li>
        <li>Zyro asks before it removes anything and does not create restore points by itself</li>
        <li>Items marked Needs admin need Restart as admin from the sidebar</li>
      </ul>
      <p className="mt-3">Safe optimize removes junk files and frees idle RAM. Your personal files are not touched</p>
    </Modal>
  )
}
