import { formatBytes, zy } from '../api'
import type { ItemResult } from '../../shared/types'
import { Handle, runTask } from './tasks'

export async function applyEach(
  h: Handle,
  ids: string[],
  labelOf: (id: string) => string,
  verb: string,
  call: (ids: string[]) => Promise<ItemResult[]>,
  range: { from: number; to: number } = { from: 0, to: 100 }
): Promise<ItemResult[]> {
  const out: ItemResult[] = []
  for (let i = 0; i < ids.length; i++) {
    const pct = range.from + ((range.to - range.from) * i) / Math.max(1, ids.length)
    h.update({ progress: pct, message: `${verb} ${labelOf(ids[i])} (${i + 1} of ${ids.length})` })
    try {
      out.push(...(await call([ids[i]])))
    } catch (e: any) {
      out.push({ id: ids[i], status: 'failed', reason: String(e?.message ?? e) })
    }
  }
  h.update({ progress: range.to })
  return out
}

export const sumFreed = (r: ItemResult[]) => r.reduce((n, x) => n + (x.freedBytes ?? 0), 0)

export function smartOptimize() {
  return runTask(
    { title: 'Smart Optimize', icon: 'sparkling', page: 'dashboard', message: 'Scanning for junk files...', progress: 4 },
    async (h) => {
      const items: any[] = await zy.cleaner.scan()
      const safe = items.filter((i) => !i.needsAdmin && (i.risk === 'safe' || i.risk === 'low') && i.id !== 'recycle-bin')
      const labels = new Map<string, string>(safe.map((i) => [i.id, i.label]))
      const res = await applyEach(h, safe.map((i) => i.id), (id) => labels.get(id) ?? id, 'Cleaning', (ids) => zy.cleaner.apply(ids), { from: 8, to: 82 })
      h.update({ progress: 88, message: 'Freeing idle memory...' })
      const trim = await zy.processes.trimMemory()
      window.dispatchEvent(new Event('zyro:changed'))
      return { freed: sumFreed(res), ram: trim.freedBytes as number }
    },
    (r) => `Freed ${formatBytes(r.freed)} of disk space and ${formatBytes(r.ram)} of RAM`
  )
}
