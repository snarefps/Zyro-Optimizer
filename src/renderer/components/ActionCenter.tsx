import { useEffect, useState } from 'react'
import { usePresence } from '../hooks/usePresence'
import { clearFinished, dismissTask, setActionCenterOpen, Task, useActionCenterOpen, useTasks } from '../lib/tasks'
import { Icon } from './Icon'
import { Button, ProgressBar } from './ui'

const go = (page?: string) => { if (page) window.location.hash = `#/${page}` }

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(ts).toLocaleDateString()
}

function useTick(active: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => set((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [active])
}

let seenAt = Date.now()

export function ActionCenterButton() {
  const tasks = useTasks()
  const open = useActionCenterOpen()
  const [, force] = useState(0)
  const running = tasks.filter((t) => t.status === 'running')
  const unseen = tasks.filter((t) => t.finishedAt && t.finishedAt > seenAt).length
  useEffect(() => {
    if (open) { seenAt = Date.now(); force((n) => n + 1) }
  }, [open])
  return (
    <button
      onClick={() => setActionCenterOpen(!open)}
      title="Action Center"
      className={`relative flex h-9 w-9 items-center justify-center rounded-md border border-line bg-panel transition hover:border-accent/40 hover:bg-hover/5 ${running.length ? 'pulse-ring' : ''}`}
    >
      <Icon name="bell" size={20} />
      {running.length > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{running.length}</span>
      ) : unseen > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-ok" />
      ) : null}
    </button>
  )
}

function TaskCard({ t }: { t: Task }) {
  const running = t.status === 'running'
  const tone = t.status === 'error' ? 'bad' : t.status === 'done' ? 'ok' : 'accent'
  return (
    <div
      onClick={() => { if (t.page) { go(t.page); setActionCenterOpen(false) } }}
      className={`group fade-up rounded-md border border-line bg-panel2/60 p-3 transition ${t.page ? 'cursor-pointer hover:border-accent/40' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <Icon name={t.icon} size={32} />
          {!running && <Icon name={t.status === 'done' ? 'checkmark' : 'error'} size={16} className="check-pop absolute -bottom-1 -right-1 rounded-full bg-panel" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold">{t.title}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-mute">{running ? elapsed(Date.now() - t.startedAt) : ago(t.finishedAt ?? t.startedAt)}</span>
          </div>
          <div className={`mt-0.5 line-clamp-2 text-[12px] leading-4 ${t.status === 'error' ? 'text-bad' : 'text-mute'}`}>{t.message}</div>
        </div>
        {!running && (
          <button onClick={(e) => { e.stopPropagation(); dismissTask(t.id) }} title="Dismiss" className="opacity-0 transition group-hover:opacity-100">
            <Icon name="cancel" size={16} />
          </button>
        )}
      </div>
      {running && (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1"><ProgressBar value={t.progress} running tone={tone} /></div>
          {t.progress !== null && <span className="w-9 text-right text-[11px] font-semibold tabular-nums text-soft">{Math.round(t.progress)}%</span>}
        </div>
      )}
    </div>
  )
}

export function ActionCenterPanel() {
  const open = useActionCenterOpen()
  const tasks = useTasks()
  const { mounted, closing } = usePresence(open, 167)
  const running = tasks.filter((t) => t.status === 'running')
  const recent = tasks.filter((t) => t.status !== 'running')
  useTick(open && running.length > 0)
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setActionCenterOpen(false)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open])
  if (!mounted) return null
  return (
    <div className="fixed inset-0 z-[60]" onMouseDown={() => setActionCenterOpen(false)}>
      <aside onMouseDown={(e) => e.stopPropagation()} className={`${closing ? 'slide-out-right' : 'slide-in-right'} absolute bottom-3 right-3 top-11 flex w-[400px] flex-col rounded-lg border border-line bg-panel shadow-pop`}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Icon name="bell" size={26} />
          <div className="flex-1">
            <div className="text-[15px] font-bold leading-5">Action Center</div>
            <div className="text-[12px] text-mute">{running.length ? `${running.length} running` : 'Everything is idle'}</div>
          </div>
          {recent.length > 0 && <Button variant="ghost" className="!px-3 !py-1.5" onClick={clearFinished}>Clear all</Button>}
          <button onClick={() => setActionCenterOpen(false)} className="rounded-lg p-1 transition hover:bg-hover/10" title="Close"><Icon name="cancel" size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
          {tasks.length === 0 && (
            <div className="flex flex-col items-center py-16 text-center">
              <Icon name="checkmark" size={56} className="mb-3" />
              <div className="font-semibold">No activity yet</div>
              <div className="mt-1 max-w-[260px] text-[12px] text-mute">Cleaning, boosting and updating show their progress here, and finished jobs stay for review.</div>
            </div>
          )}
          {running.length > 0 && (
            <section>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-mute">In progress</div>
              <div className="space-y-2">{running.map((t) => <TaskCard key={t.id} t={t} />)}</div>
            </section>
          )}
          {recent.length > 0 && (
            <section>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-mute">Recent</div>
              <div className="space-y-2">{recent.map((t) => <TaskCard key={t.id} t={t} />)}</div>
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}

export function TaskDock() {
  const tasks = useTasks()
  const open = useActionCenterOpen()
  const [now, setNow] = useState(Date.now())
  const running = tasks.filter((t) => t.status === 'running')
  const lastDone = tasks.find((t) => t.status !== 'running' && t.finishedAt && now - t.finishedAt < 6000)
  const shown = running[0] ?? lastDone
  useEffect(() => {
    if (!shown) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [shown])
  if (!shown || open) return null
  const isRunning = shown.status === 'running'
  return (
    <button onClick={() => setActionCenterOpen(true)} key={shown.id} className="slide-up fixed bottom-5 right-5 z-[55] w-[340px] rounded-lg border border-line bg-panel p-4 text-left shadow-pop transition hover:border-accent/40">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Icon name={shown.icon} size={32} />
          {!isRunning && <Icon name={shown.status === 'done' ? 'checkmark' : 'error'} size={16} className="check-pop absolute -bottom-1 -right-1 rounded-full bg-panel" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="truncate text-[13px] font-semibold">{shown.title}</span>
            {running.length > 1 && <span className="rounded-md bg-accent/15 px-1.5 text-[11px] font-semibold text-accent">+{running.length - 1}</span>}
          </div>
          <div className={`truncate text-[12px] ${shown.status === 'error' ? 'text-bad' : 'text-mute'}`}>{shown.message}</div>
        </div>
      </div>
      {isRunning && (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1"><ProgressBar value={shown.progress} running /></div>
          {shown.progress !== null && <span className="w-9 text-right text-[11px] font-semibold tabular-nums text-soft">{Math.round(shown.progress)}%</span>}
        </div>
      )}
    </button>
  )
}
