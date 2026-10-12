import { useState } from 'react'
import type { UndoEntry } from '../../shared/types'
import { zy } from '../api'
import { Icon } from '../components/Icon'
import { Badge, Button, Card, Empty, PageHeader, ScanBar, Skeleton, useLoad, useToast } from '../components/ui'
import { createRestorePoint } from '../lib/restore'
import { runTask } from '../lib/tasks'

const UNDOABLE = new Set(['registry', 'startup', 'appx', 'dns'])
const MODULE_ICON: Record<string, string> = {
  tweaks: 'control-panel', startup: 'rocket', debloat: 'cut', cleaner: 'broom', gamebooster: 'controller', uninstaller: 'package', disk: 'recycle-bin', updates: 'available-updates', dns: 'wifi'
}

export function History() {
  const { data, loading, reload } = useLoad<UndoEntry[]>(() => zy.history.list())
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [rp, setRp] = useState(false)

  async function revert(e: UndoEntry) {
    setBusy(e.id)
    try {
      await runTask({ title: 'Undoing a change', icon: 'undo', page: 'history', message: e.label }, async (h) => {
        const r = await zy.history.revert(e.id)
        if (!r.ok) throw new Error(r.reason ?? 'Could not undo')
        h.done(`Undone: ${e.label}`)
      })
      window.dispatchEvent(new Event('zyro:changed'))
    } catch (err: any) { toast('err', String(err.message ?? err)) }
    setBusy(null); reload()
  }

  async function restorePoint() {
    setRp(true)
    try {
      await createRestorePoint('history')
    } catch (err: any) { toast('err', `Could not create restore point: ${String(err.message ?? err)}`) }
    setRp(false)
  }

  return (
    <>
      <PageHeader
        title="Restore & History"
        subtitle="Every change Zyro makes is logged here. Registry tweaks, startup changes and removed apps can be undone with one click."
        actions={<><Button variant="ghost" icon="refresh" onClick={reload} busy={loading}>Refresh</Button><Button icon="restore-page" onClick={restorePoint} busy={rp}>Create restore point</Button></>}
      />
      <Card className="min-h-0 flex-1 overflow-auto">
        <ScanBar active={loading} />
        {loading && !data ? <Skeleton /> : !data?.length ? <Empty title="No changes yet" hint="Actions you take will be listed here so you can review or undo them." icon="time-machine" /> : data.map((e, n) => (
          <div key={e.id} style={{ animationDelay: `${Math.min(n, 14) * 18}ms` }} className="fade-up flex items-center gap-3 border-b border-line/60 px-4 py-3 transition-colors hover:bg-hover/[0.04]">
            <Icon name={MODULE_ICON[e.module] ?? 'time'} size={28} />
            <div className="min-w-0 flex-1">
              <div className={`truncate font-medium ${e.reverted ? 'text-mute line-through' : ''}`}>{e.label}</div>
              <div className="text-[12px] text-mute">{new Date(e.ts).toLocaleString()} · {e.module}</div>
            </div>
            {e.reverted ? <Badge>Undone</Badge> : UNDOABLE.has(e.kind) ? <Button variant="soft" icon="undo" busy={busy === e.id} onClick={() => revert(e)}>Undo</Button> : <Badge>Not reversible</Badge>}
          </div>
        ))}
      </Card>
    </>
  )
}
