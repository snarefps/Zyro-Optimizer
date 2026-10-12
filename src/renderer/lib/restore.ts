import { zy } from '../api'
import { Handle, runTask } from './tasks'

let warnedAboutAdmin = false

function notify(kind: 'ok' | 'err' | 'info', text: string) {
  window.dispatchEvent(new CustomEvent('zyro:toast', { detail: { kind, text } }))
}

export async function autoRestorePoint(label: string, h?: Handle): Promise<void> {
  let need: { needed: boolean; reason?: string }
  try { need = await zy.system.restorePointNeeded() } catch { return }

  if (!need.needed) {
    if (need.reason && need.reason !== 'disabled' && need.reason !== 'recent' && !warnedAboutAdmin) {
      warnedAboutAdmin = true
      notify('info', `No restore point was created: ${need.reason}. Restart as administrator to protect Tune changes with one.`)
    }
    return
  }

  const create = async (handle?: Handle): Promise<boolean> => {
    handle?.update({ message: 'Creating a restore point first...', progress: null })
    const r = await zy.system.autoRestorePoint(label)
    if (!r.created && r.reason && r.reason !== 'recent' && r.reason !== 'disabled') notify('info', `Restore point not created: ${r.reason}`)
    return !!r.created
  }

  if (h) { await create(h); return }
  await runTask(
    { title: 'Creating a restore point', icon: 'restore-page', page: 'settings', message: 'Creating a restore point first...' },
    (hh) => create(hh),
    (ok) => (ok ? 'Restore point created' : 'Could not create a restore point, continuing without one')
  )
}
