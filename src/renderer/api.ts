import type { ItemResult, ScanItem, UndoEntry } from '../shared/types'

declare global {
  interface Window {
    zyro: {
      invoke(mod: string, method: string, ...args: unknown[]): Promise<any>
      on(channel: string, cb: (payload: any) => void): () => void
    }
  }
}

const mod = (name: string) =>
  new Proxy({}, { get: (_t, method: string) => (...args: unknown[]) => window.zyro.invoke(name, method, ...args) }) as Record<string, (...a: any[]) => Promise<any>>

export const zy = {
  cleaner: mod('cleaner'),
  startup: mod('startup'),
  debloat: mod('debloat'),
  tweaks: mod('tweaks'),
  gamebooster: mod('gamebooster'),
  uninstaller: mod('uninstaller'),
  disk: mod('disk'),
  processes: mod('processes'),
  updates: mod('updates'),
  monitor: mod('monitor'),
  scheduler: mod('scheduler'),
  system: mod('system'),
  dns: mod('dns'),
  apps: mod('apps'),
  idm: mod('idm'),
  history: mod('history')
}

export type { ItemResult, ScanItem, UndoEntry }

export function formatBytes(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return ''
  if (n < 1024) return `${Math.round(n)} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${u[i]}`
}

export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

export function formatDuration(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}
