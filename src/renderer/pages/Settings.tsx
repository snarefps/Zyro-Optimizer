import { useCallback, useEffect, useState } from 'react'
import { zy } from '../api'
import { Icon } from '../components/Icon'
import { Badge, Button, Card, Modal, PageHeader, ScanBar, SectionTitle, Select, Setting, Toggle, useToast } from '../components/ui'
import { createRestorePoint } from '../lib/restore'
import { clearFinished, runTask } from '../lib/tasks'
import { setThemeMode, ThemeMode, useThemeMode } from '../lib/theme'
import { checkForUpdate, openReleases, useUpdate } from '../lib/update'

interface RestorePoint { seq: number; description: string; created: string; byZyro: boolean }
type PointsState = { ok: true; points: RestorePoint[] } | { ok: false; reason: string } | null

type SysSettings = { launchAtLogin: boolean; minimizeToTray: boolean }

export function Settings() {
  const mode = useThemeMode()
  const toast = useToast()
  const update = useUpdate()
  const [sys, setSys] = useState<SysSettings | null>(null)
  const [version, setVersion] = useState('')
  const [points, setPoints] = useState<PointsState>(null)
  const [loadingPoints, setLoadingPoints] = useState(false)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<RestorePoint | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadPoints = useCallback(async () => {
    setLoadingPoints(true)
    try { setPoints(await zy.system.listRestorePoints()) } catch (e: any) { setPoints({ ok: false, reason: String(e?.message ?? e) }) }
    setLoadingPoints(false)
  }, [])

  useEffect(() => {
    zy.system.getSettings().then(setSys)
    zy.system.version().then(setVersion)
    loadPoints()
  }, [loadPoints])

  const set = async (key: keyof SysSettings, v: boolean) => {
    try { setSys(await zy.system.setSetting(key, v)) } catch (e: any) { toast('err', String(e.message ?? e)) }
  }

  async function createNow() {
    setCreating(true)
    try {
      await createRestorePoint('settings')
      await loadPoints()
    } catch (e: any) { toast('err', `Could not create a restore point: ${String(e.message ?? e)}`) }
    setCreating(false)
  }

  async function deletePoint() {
    const p = toDelete
    if (!p) return
    setDeleting(true)
    try {
      await runTask({ title: 'Deleting a restore point', icon: 'recycle-bin', page: 'settings', message: p.description || 'Restore point' }, async (h) => {
        const r = await zy.system.deleteRestorePoint(p.seq)
        if (!r.ok) throw new Error(r.reason ?? 'Failed')
        h.done('Restore point deleted')
      })
      setToDelete(null)
      await loadPoints()
    } catch (e: any) { toast('err', `Could not delete it: ${String(e.message ?? e)}`) }
    setDeleting(false)
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Appearance, startup behaviour, restore points and information about Zyro Optimizer." />
      <div className="pb-2">
        <SectionTitle className="!mt-0">Appearance</SectionTitle>
        <Setting icon="sun--v1" title="Choose your mode" description="Change the colors that appear in Zyro Optimizer, or follow your Windows setting.">
          <Select<ThemeMode> value={mode} onChange={setThemeMode} className="min-w-[200px]" options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'Use Windows setting' }]} />
        </Setting>

        <SectionTitle>Behaviour</SectionTitle>
        {sys && (
          <div className="space-y-1">
            <Setting icon="rocket" title="Start with Windows" description="Starts minimized in the tray so scheduled cleaning keeps working.">
              <Toggle on={sys.launchAtLogin} onChange={(v) => set('launchAtLogin', v)} />
            </Setting>
            <Setting icon="processor" title="Keep running in the tray when the window is closed" description="Closing the window frees almost all memory. The tray agent uses only a few MB.">
              <Toggle on={sys.minimizeToTray} onChange={(v) => set('minimizeToTray', v)} />
            </Setting>
          </div>
        )}

        <SectionTitle>Restore points</SectionTitle>
        <div className="space-y-1">
          <Setting icon="restore-page" title="Create a restore point" description="Zyro never creates restore points on its own. Needs administrator rights and System Protection turned on.">
            <Button onClick={createNow} busy={creating}>Create now</Button>
          </Setting>
          <Setting icon="refresh" title="Refresh the list" description="Read the restore points Windows has stored.">
            <Button variant="ghost" onClick={loadPoints} busy={loadingPoints}>Refresh</Button>
          </Setting>
          <Setting icon="time-machine" title="Open System Restore" description="To go back to a restore point, open System Restore and choose it there." onClick={() => zy.system.openSystemRestore()} />
        </div>
        <Card className="relative mt-1 overflow-hidden">
          <ScanBar active={loadingPoints} />
          {points === null ? (
            <div className="p-4 text-[14px] text-mute">Reading restore points...</div>
          ) : !points.ok ? (
            <div className="flex items-start gap-3 p-4 text-[14px] text-mute"><Icon name="info" size={20} />{points.reason}. Restart Zyro as administrator to see and create restore points.</div>
          ) : points.points.length === 0 ? (
            <div className="p-4 text-[14px] text-mute">No restore points yet. If this stays empty, System Protection may be turned off for your system drive.</div>
          ) : (
            <div className="max-h-[300px] overflow-auto">
              {points.points.map((p, n) => (
                <div key={p.seq} style={{ animationDelay: `${Math.min(n, 10) * 22}ms` }} className="fade-up flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                  <Icon name="restore-page" size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px]">{p.description || 'Restore point'}</div>
                    <div className="text-[12px] text-mute">{p.created ? new Date(p.created).toLocaleString() : ''}</div>
                  </div>
                  {p.byZyro && <Badge>Zyro</Badge>}
                  <Button variant="ghost" icon="recycle-bin" onClick={() => setToDelete(p)}>Delete</Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Modal
          open={!!toDelete}
          title="Delete this restore point?"
          onClose={() => !deleting && setToDelete(null)}
          actions={<><Button variant="ghost" onClick={() => setToDelete(null)} disabled={deleting}>Cancel</Button><Button variant="danger" busy={deleting} onClick={deletePoint}>Delete</Button></>}
        >
          {toDelete?.description || 'Restore point'}{toDelete?.created ? ` from ${new Date(toDelete.created).toLocaleString()}` : ''} will be removed from Windows. You will not be able to go back to it.
        </Modal>

        <SectionTitle>Action Center</SectionTitle>
        <Setting icon="bell" title="Clear activity history" description="Finished jobs stay in the Action Center so you can review them.">
          <Button variant="ghost" onClick={() => { clearFinished(); toast('ok', 'Action Center history cleared') }}>Clear history</Button>
        </Setting>

        <SectionTitle>About</SectionTitle>
        <div className="space-y-1">
          <Setting
            icon="available-updates"
            title="Check for updates"
            description={
              update.status === 'checking' ? 'Checking for updates...'
              : update.status === 'error' ? `Could not check: ${update.error}`
              : update.info ? (update.info.available ? `Version ${update.info.latest} is available. You have ${update.info.current}.` : `You have the latest version (${update.info.current}).`)
              : 'Look for a newer version of Zyro Optimizer. Nothing is installed automatically.'
            }
          >
            {update.info?.available && <Button onClick={() => openReleases()}>Download</Button>}
            <Button variant="ghost" onClick={() => checkForUpdate()} busy={update.status === 'checking'}>Check now</Button>
          </Setting>
          <Setting title="Zyro Optimizer" description={`Version ${version || '...'}. Zyro does not collect or send any data. Every change it makes is logged on the Restore page so it can be undone.`}>
            <img src="./icon.png" alt="" draggable={false} className="h-10 w-10" />
          </Setting>
          <Setting
            title="Telegram channel"
            description="t.me/ZeroNullex"
            onClick={() => zy.system.openTelegram()}
          />
          <div className="pt-3 text-[12px] text-mute">Made by the ZeroNullex Team.</div>
        </div>
      </div>
    </>
  )
}
