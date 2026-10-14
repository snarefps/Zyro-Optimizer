import { useEffect, useState } from 'react'
import type { ScanItem } from '../../shared/types'
import { formatBytes, zy } from '../api'
import { Badge, Button, Modal, PageHeader, Loading, useToast } from '../components/ui'
import { ScanList } from '../components/ScanList'
import { runTask } from '../lib/tasks'

interface Info {
  version: string; publisher: string; homepage: string; license: string
  installerType: string; installerUrl: string; sha256: string; releaseDate: string; howto: string | null
}
interface Saved { folder: string; verified: boolean; files: { name: string; size: number; sha256: string }[] }

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-3 border-b border-line py-1.5 last:border-0">
      <div className="w-28 shrink-0 text-mute">{label}</div>
      <div className="min-w-0 flex-1 break-all text-fg">{value}</div>
    </div>
  )
}

function Details({ item, onClose }: { item: ScanItem | null; onClose: () => void }) {
  const toast = useToast()
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(null)

  useEffect(() => {
    setInfo(null); setError(null); setSaved(null)
    if (!item) return
    let cancelled = false
    zy.apps.info(item.id).then((r: Info) => !cancelled && setInfo(r)).catch((e: any) => !cancelled && setError(String(e?.message ?? e)))
    return () => { cancelled = true }
  }, [item])

  async function save() {
    if (!item) return
    setSaving(true)
    try {
      const r = await runTask({ title: `Downloading ${item.label}`, icon: 'software-installer', page: 'apps', message: 'Downloading and checking the vendor installer...' }, async (h) => {
        const res = await zy.apps.download(item.id)
        if (!res.ok) throw new Error(res.reason ?? 'The download failed')
        h.done(`Saved to ${res.folder}`)
        return res as Saved
      })
      setSaved(r)
    } catch (e: any) { toast('err', `Could not download it: ${String(e.message ?? e)}`) }
    setSaving(false)
  }

  const first = saved?.files[0]
  return (
    <Modal
      open={!!item}
      wide
      title={item?.label ?? ''}
      onClose={onClose}
      actions={
        <>
          {first && <Button variant="ghost" icon="hdd" onClick={() => zy.disk.reveal(`${saved!.folder}\\${first.name}`)}>Show in folder</Button>}
          <Button variant="soft" icon="software-installer" busy={saving} disabled={!info} onClick={save}>Save installer only</Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {error ? <div className="text-bad">{error}</div> : !info ? <Loading /> : (
        <>
          <div className="text-[14px]">
            <Field label="Latest version" value={info.version} />
            <Field label="Installed" value={item?.meta?.installed ? String(item.meta.version ?? 'yes') : 'Not installed'} />
            <Field label="Publisher" value={info.publisher} />
            <Field label="Released" value={info.releaseDate} />
            <Field label="License" value={info.license} />
            <Field label="Website" value={info.homepage} />
            <Field label="Installer" value={info.installerType} />
            <Field label="Downloaded from" value={info.installerUrl} />
            <Field label="SHA-256" value={info.sha256} />
          </div>
          {info.howto && (
            <div className="mt-3 rounded-lg border border-line bg-hover/[0.04] p-3 text-[14px] leading-5">
              <div className="mb-0.5 font-semibold text-fg">After the install</div>
              {info.howto}
            </div>
          )}
          {saved && (
            <div className="mt-3 text-[14px] text-fg">
              Saved {saved.files.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ')} to {saved.folder}.
              {saved.verified && ' Its SHA-256 matches the checksum in the winget manifest.'}
              <div className="mt-1 break-all text-[12px] text-mute">SHA-256 {saved.files[0]?.sha256}</div>
            </div>
          )}
          <p className="mt-3 text-[12px] text-mute">The installer is downloaded from the address above by winget, which checks it against the SHA-256 before running it.</p>
        </>
      )}
    </Modal>
  )
}

export function Apps() {
  const toast = useToast()
  const [detail, setDetail] = useState<ScanItem | null>(null)
  return (
    <>
      <PageHeader
        title="Install Apps"
        subtitle="Pick the apps you want and Zyro installs them silently with winget, straight from each vendor's official installer. Use Details to see the version and where the installer comes from, or to save it without installing."
      />
      <ScanList
        load={() => zy.apps.scan()}
        apply={(ids) => zy.apps.apply(ids)}
        applyLabel="Install or update selected"
        task={{ title: 'Installing apps', icon: 'software-installer', verb: 'Installing', page: 'apps' }}
        showSize={false}
        search
        progressChannel="update:progress"
        preselect={() => false}
        groupBy={(i) => String(i.meta?.category ?? '')}
        extra={(i) => (
          <>
            {i.meta?.update ? <Badge tone="medium" title={`Version ${i.meta.update} is available`}>Update {String(i.meta.update)}</Badge> : null}
            {i.meta?.installed ? <Badge tone="safe">Installed{i.meta.version ? ` ${String(i.meta.version)}` : ''}</Badge> : null}
            {i.id === 'Tonec.InternetDownloadManager' && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); zy.apps.helper().catch((err: any) => toast('err', String(err?.message ?? err))) }}
                className="link rounded px-2.5 py-1 text-[14px]"
              >
                Helper
              </button>
            )}
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDetail(i) }}
              className="link rounded px-2.5 py-1 text-[14px]"
            >
              Details
            </button>
          </>
        )}
        confirmText="The selected apps will be downloaded and installed one at a time. Some installers show a Windows permission prompt, and big ones can take a few minutes."
        emptyTitle="Nothing matches"
        emptyHint="Try a different search."
        loadingHint="Checking which apps you already have..."
        summarize={(r) => `Installed or updated ${r.filter((x) => x.status === 'ok').length} app(s)`}
      />
      <Details item={detail} onClose={() => setDetail(null)} />
    </>
  )
}
