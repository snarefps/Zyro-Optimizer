import { useSyncExternalStore } from 'react'

type TaskStatus = 'running' | 'done' | 'error'

export interface Task {
  id: number
  title: string
  icon: string
  status: TaskStatus
  progress: number | null
  message: string
  startedAt: number
  finishedAt?: number
  page?: string
}

const KEY = 'zyro-tasks'
const MAX = 40

function load(): Task[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return (JSON.parse(raw) as Task[]).filter((t) => t.status !== 'running').slice(0, MAX)
  } catch { return [] }
}

let tasks: Task[] = load()
let snapshot: Task[] = tasks
let seq = Date.now()
const listeners = new Set<() => void>()

function commit() {
  snapshot = [...tasks]
  try { localStorage.setItem(KEY, JSON.stringify(snapshot.filter((t) => t.status !== 'running').slice(0, 30))) } catch {}
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }
export const useTasks = () => useSyncExternalStore(subscribe, () => snapshot)

export interface Handle {
  id: number
  update(p: { progress?: number | null; message?: string }): void
  done(message: string): void
  fail(message: string): void
}

function startTask(o: { title: string; icon: string; page?: string; message?: string; progress?: number | null }): Handle {
  const id = ++seq
  const t: Task = { id, title: o.title, icon: o.icon, page: o.page, status: 'running', progress: o.progress ?? null, message: o.message ?? 'Starting...', startedAt: Date.now() }
  tasks = [t, ...tasks].slice(0, MAX)
  commit()
  const patch = (p: Partial<Task>) => { tasks = tasks.map((x) => (x.id === id ? { ...x, ...p } : x)); commit() }
  return {
    id,
    update: (p) => patch({ ...(p.progress !== undefined ? { progress: p.progress === null ? null : Math.max(0, Math.min(100, p.progress)) } : {}), ...(p.message !== undefined ? { message: p.message } : {}) }),
    done: (message) => patch({ status: 'done', progress: 100, message, finishedAt: Date.now() }),
    fail: (message) => patch({ status: 'error', message, finishedAt: Date.now() })
  }
}

export async function runTask<T>(o: { title: string; icon: string; page?: string; message?: string; progress?: number | null }, job: (h: Handle) => Promise<T>, summarize?: (r: T) => string): Promise<T> {
  const h = startTask(o)
  try {
    const r = await job(h)
    const current = tasks.find((t) => t.id === h.id)
    if (current?.status === 'running') h.done(summarize ? summarize(r) : current.message === 'Starting...' ? 'Done' : current.message)
    return r
  } catch (e: any) {
    h.fail(String(e?.message ?? e))
    throw e
  }
}

export function logTask(o: { title: string; icon: string; message: string; page?: string }) {
  const h = startTask({ ...o, progress: 100 })
  h.done(o.message)
}

export function clearFinished() {
  tasks = tasks.filter((t) => t.status === 'running')
  commit()
}

export function dismissTask(id: number) {
  tasks = tasks.filter((t) => t.id !== id)
  commit()
}

let open = false
const openListeners = new Set<() => void>()
export const setActionCenterOpen = (v: boolean) => { open = v; openListeners.forEach((l) => l()) }
export const useActionCenterOpen = () => useSyncExternalStore((l) => { openListeners.add(l); return () => openListeners.delete(l) }, () => open)
