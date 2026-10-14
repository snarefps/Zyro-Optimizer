import { useState } from 'react'
import type { ScanItem } from '../../shared/types'
import { zy } from '../api'
import { Badge, Button, Card, Empty, PageHeader, Pivot, ScanBar, Loading, useLoad } from '../components/ui'
import { ScanList } from '../components/ScanList'

export function Updates() {
  const [tab, setTab] = useState<'apps' | 'drivers'>('apps')
  return (
    <>
      <PageHeader title="Updates & Drivers" subtitle="Keep apps current with winget, and review driver ages. Outdated apps are a common source of bugs and security holes." />
      <div className="mb-3">
        <Pivot value={tab} onChange={setTab} options={[{ value: 'apps', label: 'App updates' }, { value: 'drivers', label: 'Drivers' }]} />
      </div>
      {tab === 'apps' ? (
        <ScanList
          load={() => zy.updates.scan()}
          apply={(ids) => zy.updates.apply(ids)}
          applyLabel="Update selected"
          task={{ title: 'Updating apps', icon: 'available-updates', verb: 'Updating', page: 'updates' }}
          showSize={false}
          search
          progressChannel="update:progress"
          preselect={() => true}
          confirmText="The selected apps will be updated silently by winget, one at a time. Zyro reads the version back afterwards, so an update that did not really happen is reported as failed. Each update can be undone from Restore & History, which reinstalls the previous version. Close the apps first so they can update."
          emptyTitle="Everything is up to date"
          emptyHint="winget did not report any newer versions of your installed apps."
          loadingHint="Asking winget for updates. This can take up to a minute."
          summarize={(r) => `Updated ${r.filter((x) => x.status === 'ok').length} app(s)`}
        />
      ) : <Drivers />}
    </>
  )
}

function Drivers() {
  const { data, loading, error, reload } = useLoad<ScanItem[]>(() => zy.updates.drivers())
  const old = (data ?? []).filter((d) => d.meta?.old).length
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" icon="refresh" onClick={reload} busy={loading}>Rescan</Button>
        <Button icon="available-updates" onClick={() => zy.updates.openWindowsUpdate()}>Check Windows Update for drivers</Button>
        <span className="ml-auto text-[14px] text-mute">{old} driver(s) older than 2 years</span>
      </div>
      <Card className="min-h-0 flex-1 overflow-auto">
        <ScanBar active={loading} />
        {error ? <div className="p-6 text-bad">{error}</div> : loading && !data ? <Loading /> : !data?.length ? <Empty title="No drivers listed" /> : data.map((d, n) => (
          <div key={d.id} style={{ animationDelay: `${Math.min(n, 14) * 22}ms` }} className="fade-up flex items-center gap-3 border-b border-line px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate">{d.label}</div>
              <div className="truncate text-[12px] text-mute">{d.detail}</div>
            </div>
            <Badge>{String(d.meta?.deviceClass)}</Badge>
            <Badge tone={d.meta?.old ? 'medium' : 'safe'}>{Math.floor(Number(d.meta?.ageDays) / 365 * 10) / 10} yr old</Badge>
          </div>
        ))}
      </Card>
      <p className="text-[12px] text-mute">Zyro lists drivers but does not download them from third-party sites. For graphics drivers, use your GPU maker's official app or Windows Update.</p>
    </div>
  )
}
