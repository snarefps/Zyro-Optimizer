import { useState } from 'react'
import { formatBytes, zy } from '../api'
import { runTask } from '../lib/tasks'
import { setThemeMode, ThemeMode } from '../lib/theme'
import { Badge, Button, Card, Loading, Modal, SectionTitle, Setting, useLoad, useToast } from './ui'

const PREF_KEYS = ['zyro-theme', 'zyro-sidebar-collapsed', 'zyro-notify-done']

function readPrefs(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of PREF_KEYS) {
    try { const v = localStorage.getItem(k); if (v !== null) out[k] = v } catch {}
  }
  return out
}

function applyPrefs(prefs: Record<string, string> | null) {
  if (!prefs) return
  for (const k of PREF_KEYS) {
    if (typeof prefs[k] !== 'string' || prefs[k].length > 20) continue
    try { localStorage.setItem(k, prefs[k]) } catch {}
  }
  const theme = prefs['zyro-theme']
  if (theme === 'dark' || theme === 'light' || theme === 'system') setThemeMode(theme as ThemeMode)
}

export function ReportRow() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const r = await runTask({ title: 'Saving a PC report', icon: 'computer', page: 'settings', message: 'Collecting the details of this PC...' }, async (h) => {
        const res = await zy.system.saveReport()
        h.done(`Saved to ${res.path}`)
        return res as { path: string }
      })
      zy.disk.reveal(r.path)
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(false)
  }

  return (
    <Setting icon="computer" title="Save a PC report" description="Saves a text file with your hardware, drives, startup items and junk size, to send when asking for help">
      <Button variant="ghost" onClick={save} busy={busy}>Save report</Button>
    </Setting>
  )
}

function Row({ time, source, message }: { time: number; source: string; message: string }) {
  return (
    <div className="border-b border-line px-1 py-2 last:border-0">
      <div className="flex items-center gap-2 text-[12px] text-mute"><span>{new Date(time).toLocaleString()}</span><Badge>{source}</Badge></div>
      <div className="break-words text-[14px] text-fg">{message}</div>
    </div>
  )
}

export function ErrorLogRow() {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const { data, loading, reload } = useLoad<{ ts: number; source: string; message: string }[]>(() => zy.errors.list(), [open])

  async function copy() {
    const text = (data ?? []).map((e) => `${new Date(e.ts).toISOString()}  ${e.source}  ${e.message}`).join('\n')
    try { await navigator.clipboard.writeText(text); toast('ok', 'The error log was copied') } catch { toast('err', 'Could not copy it') }
  }

  async function clear() {
    await zy.errors.clear()
    reload()
  }

  return (
    <>
      <Setting icon="error" title="Error log" description="Recent errors from Zyro. Copy them for a bug report" onClick={() => setOpen(true)} />
      <Modal wide open={open} title="Error log" onClose={() => setOpen(false)} actions={<><Button variant="ghost" onClick={clear} disabled={!data?.length}>Clear</Button><Button variant="ghost" onClick={copy} disabled={!data?.length}>Copy all</Button><Button onClick={() => setOpen(false)}>Close</Button></>}>
        {loading && !data ? <Loading /> : !data?.length ? <div className="py-6 text-center text-mute">No errors have been recorded</div> : (
          <div className="max-h-[50vh] overflow-auto pr-2">{data.map((e) => <Row key={`${e.ts}${e.message}`} time={e.ts} source={e.source} message={e.message} />)}</div>
        )}
      </Modal>
    </>
  )
}

export function BackupSection() {
  const toast = useToast()
  const { data, reload } = useLoad<{ name: string; modified: number; size: number }[]>(() => zy.system.listBackups())
  const [busy, setBusy] = useState<string | null>(null)

  async function save() {
    setBusy('save')
    try {
      const r = await zy.system.exportSettings(readPrefs())
      toast('ok', `Saved ${r.name}`)
      reload()
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(null)
  }

  async function restore(name: string) {
    setBusy(name)
    try {
      const r = await zy.system.importBackup(name)
      applyPrefs(r.prefs ?? null)
      window.dispatchEvent(new Event('zyro:changed'))
      toast('ok', `Settings restored. ${r.tweaksApplied} tweak(s) applied${r.tweaksSkipped ? `, ${r.tweaksSkipped} already on` : ''}`)
    } catch (e: any) { toast('err', String(e.message ?? e)) }
    setBusy(null)
  }

  return (
    <>
      <SectionTitle>Backup</SectionTitle>
      <div className="space-y-1">
        <Setting icon="restore-page" title="Back up your settings" description="Saves the schedule, automation, game list, theme and the tweaks you turned on into a file in Documents\Zyro Backups">
          <Button variant="ghost" onClick={() => zy.system.openBackupFolder()}>Open folder</Button>
          <Button onClick={save} busy={busy === 'save'}>Back up now</Button>
        </Setting>
      </div>
      {data && data.length > 0 && (
        <Card className="mt-1">
          {data.map((b) => (
            <div key={b.name} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px]">{new Date(b.modified).toLocaleString()}</div>
                <div className="truncate text-[12px] text-mute">{b.name} · {formatBytes(b.size)}</div>
              </div>
              <Button variant="ghost" busy={busy === b.name} onClick={() => restore(b.name)}>Restore</Button>
            </div>
          ))}
        </Card>
      )}
    </>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl + K', 'Search pages and actions'],
  ['Ctrl + 1 to 9', 'Open the first nine pages of the sidebar'],
  ['Ctrl + ,', 'Open Settings'],
  ['Esc', 'Close a dialog, the search or the Action Center'],
  ['Arrow keys and Enter', 'Move through and pick from the search and from drop-down lists']
]

export function ShortcutsSection() {
  return (
    <>
      <SectionTitle>Keyboard shortcuts</SectionTitle>
      <Card>
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="flex items-center justify-between gap-6 border-b border-line px-4 py-2.5 text-[14px] last:border-0">
            <span className="text-soft">{what}</span>
            <kbd className="whitespace-nowrap rounded border border-hover/10 bg-hover/[0.06] px-2 py-0.5 font-sans text-[12px] text-mute">{keys}</kbd>
          </div>
        ))}
      </Card>
    </>
  )
}
