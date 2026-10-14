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
      aria-label="Action Center"
      className="relative flex h-8 w-10 items-center justify-center text-fg transition-colors duration-[83ms] hover:bg-hover/[0.06] active:bg-hover/[0.04]"
    >
      <Icon name="bell" size={20} />
      {running.length > 0 ? (
        <span className="absolute right-1.5 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-onaccent">{running.length}</span>
      ) : unseen > 0 ? (
        <span className="absolute right-2.5 top-1.5 h-2 w-2 rounded-full bg-accent" />
      ) : null}
    </button>
  )
}

function TaskCard({ t }: { t: Task }) {
  const running = t.status === 'running'
  return (
    <div
      onClick={() => { if (t.page) { go(t.page); setActionCenterOpen(false) } }}
      className={`group fade-up rounded-lg bg-hover/[0.05] p-3 transition-colors duration-[83ms] ${t.page ? 'cursor-pointer hover:bg-hover/[0.09]' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <Icon name={t.icon} size={32} />
          {!running && <Icon name={t.status === 'done' ? 'checkmark' : 'error'} size={16} className="check-pop absolute -bottom-1 -right-1 rounded-full bg-panel" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[14px] font-semibold">{t.title}</span>
            <span className="shrink-0 text-[12px] tabular-nums text-mute">{running ? elapsed(Date.now() - t.startedAt) : ago(t.finishedAt ?? t.startedAt)}</span>
          </div>
          <div className={`mt-0.5 line-clamp-2 text-[12px] leading-4 ${t.status === 'error' ? 'text-bad' : 'text-mute'}`}>{t.message}</div>
        </div>
        {!running && (
          <button onClick={(e) => { e.stopPropagation(); dismissTask(t.id) }} title="Dismiss" className="rounded p-1 opacity-0 transition hover:bg-hover/10 group-hover:opacity-100">
            <Icon name="cancel" size={16} />
          </button>
        )}
      </div>
      {running && (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1"><ProgressBar value={t.progress} /></div>
          {t.progress !== null && <span className="w-9 text-right text-[12px] tabular-nums text-soft">{Math.round(t.progress)}%</span>}
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
      <aside onMouseDown={(e) => e.stopPropagation()} className={`${closing ? 'slide-out-right' : 'slide-in-right'} absolute bottom-3 right-3 top-9 flex w-[400px] flex-col rounded-lg bg-panel shadow-pop`}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <div className="flex-1">
            <div className="text-[16px] font-semibold leading-5">Action Center</div>
            <div className="text-[12px] text-mute">{running.length ? `${running.length} running` : 'Everything is idle'}</div>
          </div>
          {recent.length > 0 && <Button variant="ghost" onClick={clearFinished}>Clear all</Button>}
          <button onClick={() => setActionCenterOpen(false)} className="rounded p-1.5 transition-colors hover:bg-hover/10" title="Close"><Icon name="cancel" size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
          {tasks.length === 0 && (
            <div className="flex flex-col items-center py-16 text-center">
              <Icon name="checkmark" size={56} className="mb-3 text-mute" />
              <div className="font-semibold">No activity yet</div>
              <div className="mt-1 max-w-[260px] text-[12px] text-mute">Cleaning, boosting and updating show their progress here, and finished jobs stay for review.</div>
            </div>
          )}
          {running.length > 0 && (
            <section>
              <div className="mb-2 text-[12px] font-semibold text-mute">In progress</div>
              <div className="space-y-2">{running.map((t) => <TaskCard key={t.id} t={t} />)}</div>
            </section>
          )}
          {recent.length > 0 && (
            <section>
              <div className="mb-2 text-[12px] font-semibold text-mute">Recent</div>
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
  const [closed, setClosed] = useState<Set<number>>(new Set())
  const running = tasks.filter((t) => t.status === 'running' && !closed.has(t.id))
  const lastDone = tasks.find((t) => t.status !== 'running' && !closed.has(t.id) && t.finishedAt && now - t.finishedAt < 6000)
  const shown = running[0] ?? lastDone
  useEffect(() => {
    if (!shown) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [shown])
  if (!shown || open) return null
  const isRunning = shown.status === 'running'
  return (
    <div role="button" tabIndex={0} onClick={() => setActionCenterOpen(true)} onKeyDown={(e) => e.key === 'Enter' && setActionCenterOpen(true)} key={shown.id} className="slide-up group fixed bottom-5 right-5 z-[55] w-[340px] cursor-pointer rounded-lg bg-panel p-4 text-left shadow-pop transition-colors hover:bg-panel2">
      <button
        title="Close"
        aria-label="Close"
        onClick={(e) => { e.stopPropagation(); setClosed((c) => new Set(c).add(shown.id)) }}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-mute transition-colors hover:bg-hover/10 hover:text-fg"
      >
        <Icon name="cancel" size={16} />
      </button>
      <div className="flex items-center gap-3 pr-6">
        <div className="relative">
          <Icon name={shown.icon} size={32} />
          {!isRunning && <Icon name={shown.status === 'done' ? 'checkmark' : 'error'} size={16} className="check-pop absolute -bottom-1 -right-1 rounded-full bg-panel" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="truncate text-[14px] font-semibold">{shown.title}</span>
            {running.length > 1 && <span className="rounded bg-hover/10 px-1.5 text-[12px] text-soft">+{running.length - 1}</span>}
          </div>
          <div className={`truncate text-[12px] ${shown.status === 'error' ? 'text-bad' : 'text-mute'}`}>{shown.message}</div>
        </div>
      </div>
      {isRunning && (
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1"><ProgressBar value={shown.progress} /></div>
          {shown.progress !== null && <span className="w-9 text-right text-[12px] tabular-nums text-soft">{Math.round(shown.progress)}%</span>}
        </div>
      )}
    </div>
  )
}
