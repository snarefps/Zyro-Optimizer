import { zy } from '../api'
import { PageHeader } from '../components/ui'
import { ScanList } from '../components/ScanList'

export function Debloat() {
  return (
    <>
      <PageHeader title="Debloater" subtitle="Removes preinstalled promotional and rarely used apps from a curated list. Core Windows apps (Store, Settings, Photos, Calculator, Terminal) are never listed. Removed apps can be restored from the Restore page or the Microsoft Store." />
      <ScanList
        load={() => zy.debloat.scan()}
        apply={(ids) => zy.debloat.apply(ids)}
        applyLabel="Remove selected apps"
        task={{ title: 'Removing apps', icon: 'cut', verb: 'Removing', page: 'debloat' }}
        showSize={false}
        restorePoint="Removing apps"
        preselect={(i) => i.risk === 'safe'}
        confirmText="These apps will be removed for your account. A restore point is created first when running as administrator, and each removal is logged so you can bring it back."
        emptyTitle="No removable bloatware found"
        emptyHint="Your Windows install is already clean."
        loadingHint="Reading installed Store apps..."
        summarize={(r) => `Removed ${r.filter((x) => x.status === 'ok').length} app(s)`}
      />
    </>
  )
}
