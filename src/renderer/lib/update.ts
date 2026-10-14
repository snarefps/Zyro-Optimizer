import { useSyncExternalStore } from 'react'
import { zy } from '../api'

export interface UpdateInfo { current: string; latest: string; available: boolean; notes: string; published: string }
interface State { status: 'idle' | 'checking' | 'done' | 'error'; info: UpdateInfo | null; error: string | null; dismissed: string | null; checkedAt: number }

const DISMISS_KEY = 'zyro-update-dismissed'
const CHECK_KEY = 'zyro-update-checked'
const EVERY = 12 * 3600_000

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch {} }

let state: State = { status: 'idle', info: null, error: null, dismissed: read(DISMISS_KEY), checkedAt: Number(read(CHECK_KEY) ?? 0) }
const listeners = new Set<() => void>()
const set = (p: Partial<State>) => { state = { ...state, ...p }; listeners.forEach((l) => l()) }

export const useUpdate = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => state)

export async function checkForUpdate(): Promise<void> {
  if (state.status === 'checking') return
  set({ status: 'checking', error: null })
  try {
    const info: UpdateInfo = await zy.system.checkUpdate()
    write(CHECK_KEY, String(Date.now()))
    set({ status: 'done', info, checkedAt: Date.now() })
  } catch (e: any) {
    set({ status: 'error', error: String(e?.message ?? e) })
  }
}

export function checkOnStartup() {
  if (Date.now() - state.checkedAt > EVERY) void checkForUpdate()
}

export function dismissUpdate(version: string) {
  write(DISMISS_KEY, version)
  set({ dismissed: version })
}

export const openReleases = () => zy.system.openReleases()
