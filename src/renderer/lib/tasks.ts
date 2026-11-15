import { useSyncExternalStore } from 'react'
import { zy } from '../api'

type TaskStatus = 'running' | 'done' | 'error' | 'cancelled'

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
  cancellable?: boolean
  cancelling?: boolean
}

interface Options {
  title: string
  icon: string
  page?: string
  message?: string
  progress?: number | null
  cancellable?: boolean | (() => unknown)
}

const KEY = 'zyro-tasks'
const NOTIFY_KEY = 'zyro-notify-done'
const LONG_JOB_MS = 4000
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
const cancelActions = new Map<number, () => unknown>()
const cancelled = new Set<number>()

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
  stop(message: string): void
  cancelled(): boolean
}

function startTask(o: Options): Handle {
  const id = ++seq
  const t: Task = { id, title: o.title, icon: o.icon, page: o.page, status: 'running', progress: o.progress ?? null, message: o.message ?? 'Starting...', startedAt: Date.now(), cancellable: !!o.cancellable }
  tasks = [t, ...tasks].slice(0, MAX)
  if (o.cancellable) cancelActions.set(id, typeof o.cancellable === 'function' ? o.cancellable : () => zy.jobs.cancel())
  commit()
  const patch = (p: Partial<Task>) => { tasks = tasks.map((x) => (x.id === id ? { ...x, ...p } : x)); commit() }
  return {
    id,
    update: (p) => patch({ ...(p.progress !== undefined ? { progress: p.progress === null ? null : Math.max(0, Math.min(100, p.progress)) } : {}), ...(p.message !== undefined ? { message: p.message } : {}) }),
    done: (message) => patch({ status: 'done', progress: 100, message, finishedAt: Date.now(), cancelling: false }),
    fail: (message) => patch({ status: 'error', message, finishedAt: Date.now(), cancelling: false }),
    stop: (message) => patch({ status: 'cancelled', message, finishedAt: Date.now(), cancelling: false }),
    cancelled: () => cancelled.has(id)
  }
}

export function cancelTask(id: number) {
  const t = tasks.find((x) => x.id === id)
  if (!t || t.status !== 'running' || !t.cancellable || cancelled.has(id)) return
  cancelled.add(id)
  tasks = tasks.map((x) => (x.id === id ? { ...x, cancelling: true, message: 'Cancelling after the current step...' } : x))
  commit()
  Promise.resolve(cancelActions.get(id)?.()).catch(() => undefined)
}

export const notifyEnabled = () => { try { return localStorage.getItem(NOTIFY_KEY) !== '0' } catch { return true } }
export const setNotifyEnabled = (on: boolean) => { try { localStorage.setItem(NOTIFY_KEY, on ? '1' : '0') } catch {} }

function tellIfAway(id: number, message: string) {
  const t = tasks.find((x) => x.id === id)
  if (!t || document.hasFocus() || Date.now() - t.startedAt < LONG_JOB_MS || !notifyEnabled()) return
  zy.system.notify(`${t.title}: ${message}`).catch(() => undefined)
}

export async function runTask<T>(o: Options, job: (h: Handle) => Promise<T>, summarize?: (r: T) => string): Promise<T> {
  const h = startTask(o)
  const usesBackendFlag = o.cancellable === true
  if (usesBackendFlag) await zy.jobs.reset().catch(() => undefined)
  try {
    const r = await job(h)
    const current = tasks.find((t) => t.id === h.id)
    if (current?.status === 'running') {
      const text = summarize ? summarize(r) : current.message === 'Starting...' ? 'Done' : current.message
      if (cancelled.has(h.id)) h.stop(`Cancelled. ${text}`)
      else h.done(text)
    }
    tellIfAway(h.id, tasks.find((t) => t.id === h.id)?.message ?? 'Done')
    return r
  } catch (e: any) {
    h.fail(String(e?.message ?? e))
    tellIfAway(h.id, `Failed. ${String(e?.message ?? e)}`)
    throw e
  } finally {
    cancelActions.delete(h.id)
    cancelled.delete(h.id)
    if (usesBackendFlag) zy.jobs.reset().catch(() => undefined)
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
