import { zy } from '../api'
import { PageHeader } from '../components/ui'
import { ScanList } from '../components/ScanList'

export function Tidy() {
  return (
    <>
      <PageHeader title="Tidy Up" subtitle="Empty folders in your personal folders and shortcuts to programs that no longer exist. Shortcuts go to the Recycle Bin" />
      <ScanList
        load={() => zy.tidy.scan()}
        apply={(ids) => zy.tidy.apply(ids)}
        applyLabel="Remove selected"
        task={{ title: 'Tidying up', icon: 'maintenance', verb: 'Removing', page: 'tidy' }}
        groupBy={(i) => String(i.meta?.group ?? '')}
        showSize={false}
        search
        loadingHint="Looking through your folders..."
        emptyTitle="Nothing to tidy up"
        emptyHint="No empty folders or broken shortcuts found"
        summarize={(r) => `Removed ${r.filter((x) => x.status === 'ok').length} item(s)`}
      />
    </>
  )
}
