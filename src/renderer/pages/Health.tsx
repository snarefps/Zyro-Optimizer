import { formatBytes, zy } from '../api'
import { Badge, Button, Card, Loading, PageHeader, ProgressBar, ScanBar, SectionTitle, Setting, useLoad, useToast } from '../components/ui'
import { runTask } from '../lib/tasks'

interface Drive { name: string; media: string; bus: string; health: string; size: number; temp: number | null; wear: number | null; hours: number | null; readErrors: number | null; writeErrors: number | null }
interface Battery { present: boolean; percent?: number; status?: number; design?: number | null; full?: number | null; cycles?: number | null }

const STATUS: Record<number, string> = { 1: 'On battery', 2: 'Plugged in', 3: 'Fully charged', 4: 'Low', 5: 'Critical', 6: 'Charging', 7: 'Charging', 8: 'Charging', 9: 'Charging', 11: 'Partly charged' }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] text-mute">{label}</div>
      <div className="text-[14px]">{value}</div>
    </div>
  )
}

function DriveCard({ d, admin }: { d: Drive; admin: boolean }) {
  const stats: [string, string | null][] = [
    ['Temperature', d.temp != null ? `${d.temp} °C` : null],
    ['Wear used', d.wear != null ? `${d.wear}%` : null],
    ['Powered on', d.hours != null ? `${Math.round(d.hours / 24).toLocaleString()} days` : null],
    ['Read / write errors', d.readErrors != null || d.writeErrors != null ? `${d.readErrors ?? 0} / ${d.writeErrors ?? 0}` : null]
  ]
  const shown = stats.filter((x): x is [string, string] => x[1] !== null)
  const missing = stats.filter((x) => x[1] === null).map((x) => x[0].toLowerCase())
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{d.name}</div>
          <div className="text-[12px] text-mute">{[d.media, d.bus, formatBytes(d.size)].filter(Boolean).join(' · ')}</div>
        </div>
        <Badge tone={d.health === 'Healthy' ? 'safe' : 'high'}>{d.health || 'Unknown'}</Badge>
      </div>
      {shown.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-4">
          {shown.map(([label, value]) => <Stat key={label} label={label} value={value} />)}
        </div>
      )}
      {missing.length > 0 && (
        <div className="mt-3 text-[12px] text-mute">
          {shown.length === 0 && !admin
            ? 'Windows only reports temperature, wear and hours to administrators. Restart Zyro as administrator to see them'
            : `Windows does not report ${missing.join(', ')} for this drive`}
        </div>
      )}
    </Card>
  )
}

export function Health() {
  const toast = useToast()
  const admin = useLoad<boolean>(() => zy.system.isAdmin())
  const drives = useLoad<Drive[]>(() => zy.health.drives())
  const battery = useLoad<Battery>(() => zy.health.battery())
  const b = battery.data
  const pct = b?.design && b.full ? Math.round((b.full / b.design) * 100) : null

  async function report() {
    try {
      await runTask({ title: 'Creating a battery report', icon: 'ssd', page: 'health', message: 'Asking Windows for the battery report...' }, async (h) => {
        const r = await zy.health.batteryReport()
        h.done(`Saved to ${r.path}`)
      })
    } catch (e: any) { toast('err', String(e.message ?? e)) }
  }

  return (
    <>
      <PageHeader
        title="Health"
        subtitle="Drive and battery health, from the numbers Windows keeps"
        actions={<Button variant="ghost" icon="refresh" onClick={() => { drives.reload(); battery.reload() }} busy={drives.loading || battery.loading}>Refresh</Button>}
      />
      <div className="min-h-0 flex-1 overflow-auto pb-2 pr-1">
        <ScanBar active={drives.loading || battery.loading} />
        <SectionTitle className="!mt-0">Drives</SectionTitle>
        <div className="space-y-1">
          {drives.error ? <Setting icon="error" title="Could not read the drives" description={drives.error} />
            : !drives.data ? <Loading />
            : drives.data.length === 0 ? <Setting icon="info" title="Windows did not list any physical drives" />
            : drives.data.map((d) => <DriveCard key={d.name} d={d} admin={!!admin.data} />)}
        </div>

        <SectionTitle>Battery</SectionTitle>
        {battery.error ? <Setting icon="error" title="Could not read the battery" description={battery.error} />
          : !b ? <Loading />
          : !b.present ? <Setting icon="info" title="No battery found" description="This looks like a desktop PC" />
          : (
            <div className="space-y-1">
              <Card className="p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-[14px] font-semibold">Charge</span>
                  <span className="text-[24px] font-semibold leading-8 tabular-nums">{b.percent ?? 0}%</span>
                </div>
                <div className="my-3"><ProgressBar value={b.percent ?? 0} height={6} /></div>
                <div className="text-[12px] text-mute">{STATUS[b.status ?? 0] ?? 'Status unknown'}</div>
              </Card>
              <Card className="p-4">
                <div className="grid grid-cols-4 gap-4">
                  <Stat label="Capacity now" value={b.full ? `${(b.full / 1000).toFixed(1)} Wh` : 'Not reported'} />
                  <Stat label="Capacity when new" value={b.design ? `${(b.design / 1000).toFixed(1)} Wh` : 'Not reported'} />
                  <Stat label="Battery health" value={pct != null ? `${pct}%` : 'Not reported'} />
                  <Stat label="Charge cycles" value={b.cycles ? String(b.cycles) : 'Not reported by the battery'} />
                </div>
                {pct == null && <div className="mt-3 text-[12px] text-mute">This battery does not report its capacity when new, so the health can not be worked out</div>}
              </Card>
              <Setting icon="ssd" title="Battery report" description="Windows writes a battery report and opens it">
                <Button variant="ghost" onClick={report}>Create report</Button>
              </Setting>
            </div>
          )}
      </div>
    </>
  )
}
