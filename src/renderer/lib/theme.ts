import { useSyncExternalStore } from 'react'

export type ThemeMode = 'dark' | 'light' | 'system'

const KEY = 'zyro-theme'
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
const listeners = new Set<() => void>()

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'dark' || v === 'light' || v === 'system') return v
  } catch {}
  return 'dark'
}

let mode: ThemeMode = read()

export const resolve = (m: ThemeMode): 'dark' | 'light' => (m === 'system' ? (media?.matches ? 'dark' : 'light') : m)

function apply() {
  const t = resolve(mode)
  document.documentElement.dataset.theme = t
  import('@tauri-apps/api/window').then((w) => w.getCurrentWindow().setTheme(mode === 'system' ? null : t)).catch(() => undefined)
  listeners.forEach((l) => l())
}

export function setThemeMode(m: ThemeMode) {
  mode = m
  try { localStorage.setItem(KEY, m) } catch {}
  apply()
}

export function initTheme() {
  document.documentElement.dataset.theme = resolve(mode)
  media?.addEventListener('change', () => { if (mode === 'system') apply() })
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => mode)
}
