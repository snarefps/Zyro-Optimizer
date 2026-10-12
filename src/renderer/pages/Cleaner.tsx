import { formatBytes, zy } from '../api'
import { PageHeader } from '../components/ui'
import { ScanList } from '../components/ScanList'
import { sumFreed } from '../lib/actions'

export function Cleaner() {
  return (
    <>
      <PageHeader title="Junk Cleaner" subtitle="Finds temporary files, caches, logs and crash dumps. Nothing is deleted until you press Clean. Personal folders are never touched." />
      <ScanList
        load={() => zy.cleaner.scan()}
        apply={(ids) => zy.cleaner.apply(ids)}
        applyLabel="Clean selected"
        task={{ title: 'Junk cleaning', icon: 'broom', verb: 'Cleaning', page: 'cleaner' }}
        groupBy={(i) => String(i.meta?.group ?? '')}
        preselect={(i) => i.risk !== 'medium' && i.risk !== 'high'}
        emptyTitle="Your PC is already clean"
        emptyHint="No removable junk was found. Items marked 'Needs admin' appear once you restart Zyro as administrator."
        summarize={(r) => `Freed ${formatBytes(sumFreed(r))}`}
      />
    </>
  )
}
