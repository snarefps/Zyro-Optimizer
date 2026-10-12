import { useState } from 'react'
import type { ScanItem } from '../../shared/types'
import { zy } from '../api'
import { Badge, Button, Card, Empty, PageHeader, ScanBar, Skeleton, useLoad } from '../components/ui'
import { ScanList } from '../components/ScanList'
import { Icon } from '../components/Icon'

export function Updates() {
  const [tab, setTab] = useState<'apps' | 'drivers'>('apps')
  return (
    <>
      <PageHeader title="Updates & Drivers" subtitle="Keep apps current with winget, and review driver ages. Outdated apps are a common source of bugs and security holes." />
      <div className="mb-3 flex gap-1.5">
        {([['apps', 'App updates', 'software-installer'], ['drivers', 'Drivers', 'processor']] as const).map(([t, l, ic]) => (
          <button key={t} onClick={() => setTab(t)} className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-medium transition ${tab === t ? 'bg-accent/[0.13] text-fg' : 'text-soft hover:bg-hover/5'}`}><Icon name={ic} size={20} />{l}</button>
        ))}
      </div>
      {tab === 'apps' ? (
        <ScanList
          load={() => zy.updates.scan()}
          apply={(ids) => zy.updates.apply(ids)}
          applyLabel="Update selected"
          task={{ title: 'Updating apps', icon: 'available-updates', verb: 'Updating', page: 'updates' }}
          showSize={false}
          search
          preselect={() => true}
          confirmText="The selected apps will be updated silently by winget. Updates run one at a time and can take a few minutes. Close the apps first so they can update."
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
        <span className="ml-auto text-[13px] text-mute">{old} driver(s) older than 2 years</span>
      </div>
      <Card className="min-h-0 flex-1 overflow-auto">
        <ScanBar active={loading} />
        {error ? <div className="p-6 text-bad">{error}</div> : loading && !data ? <Skeleton /> : !data?.length ? <Empty title="No drivers listed" /> : data.map((d, n) => (
          <div key={d.id} style={{ animationDelay: `${Math.min(n, 14) * 22}ms` }} className="fade-up flex items-center gap-3 border-b border-line/60 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{d.label}</div>
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
