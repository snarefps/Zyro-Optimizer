import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import type { Risk } from '../../shared/types'
import { usePresence } from '../hooks/usePresence'
import { Icon } from './Icon'

export function Card({ children, className = '', lift = false, style }: { children: ReactNode; className?: string; lift?: boolean; style?: React.CSSProperties }) {
  return (
    <div style={style} className={`rounded-lg border border-line bg-panel shadow-card ${lift ? 'transition-colors duration-[167ms] hover:border-accent/40' : ''} ${className}`}>
      {children}
    </div>
  )
}

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'soft'
export function Button({
  variant = 'primary', busy, icon, className = '', children, ...rest
}: { variant?: BtnVariant; busy?: boolean; icon?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = 'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-[13px] font-semibold transition-colors duration-[83ms] disabled:cursor-not-allowed disabled:opacity-45'
  const styles: Record<BtnVariant, string> = {
    primary: 'btn-primary',
    ghost: 'border border-line text-soft hover:bg-hover/5 hover:text-fg active:bg-hover/[0.03]',
    soft: 'bg-hover/[0.06] text-fg hover:bg-hover/10 active:bg-hover/[0.04]',
    danger: 'bg-bad text-white hover:brightness-110 active:brightness-90'
  }
  return (
    <button {...rest} disabled={rest.disabled || busy} className={`${base} ${styles[variant]} ${className}`}>
      {busy ? <Spinner size={14} /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  )
}

function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

const TONES = {
  safe: 'bg-ok/15 text-ok border-ok/30',
  low: 'bg-info/15 text-info border-info/30',
  medium: 'bg-warn/15 text-warn border-warn/30',
  high: 'bg-bad/15 text-bad border-bad/30',
  info: 'bg-accent/15 text-accent border-accent/30',
  muted: 'bg-hover/[0.06] text-mute border-hover/10'
}
export type Tone = keyof typeof TONES

export function Badge({ tone = 'muted', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>{children}</span>
}

const RISK_LABEL: Record<Risk, string> = { safe: 'Safe', low: 'Low risk', medium: 'Caution', high: 'High risk' }
export function RiskBadge({ risk }: { risk: Risk }) {
  return <Badge tone={risk}>{RISK_LABEL[risk]}</Badge>
}

export function Toggle({ on, onChange, disabled, busy }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; busy?: boolean }) {
  // winui toggle: 40x20 track, the knob grows on hover
  const ease = 'duration-[167ms] ease-[cubic-bezier(0.1,0.9,0.2,1)]'
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled || busy}
      onClick={() => onChange(!on)}
      className={`group relative h-5 w-10 shrink-0 rounded-full border transition-colors ${ease} disabled:opacity-45 ${busy ? 'animate-pulse' : ''} ${on ? 'border-accent bg-accent' : 'border-hover/55 bg-transparent hover:bg-hover/[0.06]'}`}
    >
      <span
        className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-all ${ease} group-hover:h-[14px] group-hover:w-[14px] group-active:w-[17px] ${
          on ? 'left-[22px] bg-white group-hover:left-[21px] group-active:left-[18px]' : 'left-[3px] bg-soft group-hover:left-[2px]'
        }`}
      />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-panel2 p-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${value === o.value ? 'bg-panel text-fg shadow-card' : 'text-mute hover:text-fg'}`}>
          {o.icon && <Icon name={o.icon} size={16} />}{o.label}
        </button>
      ))}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-bold leading-7 tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 max-w-2xl text-[13px] leading-5 text-mute">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  )
}

export function Empty({ title, hint, icon = 'thumb-up' }: { title: string; hint?: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center fade-up">
      <Icon name={icon} size={64} className="mb-3" />
      <div className="text-base font-semibold">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-[13px] text-mute">{hint}</div>}
    </div>
  )
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-14 rounded-md" style={{ animationDelay: `${i * 80}ms` }} />)}
    </div>
  )
}

export function Modal({ open, title, icon, children, onClose, actions, wide }: { open: boolean; title: string; icon?: string; children: ReactNode; onClose: () => void; actions?: ReactNode; wide?: boolean }) {
  const { mounted, closing } = usePresence(open, 167)
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!mounted) return null
  return (
    <div className={`fixed inset-0 z-[70] flex items-center justify-center bg-black/50 ${closing ? 'fade-out' : 'fade-in'}`} onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className={`max-h-[80vh] overflow-auto rounded-lg border border-line bg-panel p-6 shadow-pop ${closing ? 'pop-out' : 'pop-in'} ${wide ? 'w-[760px]' : 'w-[460px]'}`}>
        <div className="mb-3 flex items-center gap-3">
          {icon && <Icon name={icon} size={30} />}
          <h2 className="text-lg font-bold">{title}</h2>
        </div>
        <div className="text-[13px] leading-5 text-soft">{children}</div>
        {actions && <div className="mt-5 flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function ProgressBar({ value, tone = 'accent', running = false, height = 6 }: { value: number | null; tone?: 'accent' | 'ok' | 'warn' | 'bad'; running?: boolean; height?: number }) {
  const color = { accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }[tone]
  return (
    <div className="relative overflow-hidden rounded-full bg-hover/10" style={{ height }} role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {value === null ? (
        <><div className={`progress-ind-a absolute inset-y-0 rounded-full ${color}`} /><div className={`progress-ind-b absolute inset-y-0 rounded-full ${color}`} /></>
      ) : (
        <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${color} ${running ? 'progress-shimmer' : ''}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      )}
    </div>
  )
}

export function ScanBar({ active }: { active: boolean }) {
  return <div className={`h-[3px] overflow-hidden transition-opacity duration-300 ${active ? 'opacity-100' : 'opacity-0'}`}><ProgressBar value={null} height={3} /></div>
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line bg-panel2 px-1.5 py-0.5 font-sans text-[11px] font-medium text-mute">{children}</kbd>
}

type Toast = { id: number; kind: 'ok' | 'err' | 'info'; text: string }
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => undefined)
export const useToast = () => useContext(ToastCtx)

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }, [])
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.text) push(d.kind ?? 'info', d.text) }
    window.addEventListener('zyro:toast', h)
    return () => window.removeEventListener('zyro:toast', h)
  }, [push])
  const icon = { ok: 'checkmark', err: 'error', info: 'info' } as const
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[80] flex w-[380px] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="slide-up pointer-events-auto flex items-start gap-3 rounded-md border border-line bg-panel px-4 py-3 text-[13px] shadow-pop">
            <Icon name={icon[t.kind]} size={20} />
            <span className="leading-5">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await loader()) } catch (e: any) { setError(String(e?.message ?? e)) } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { reload() }, [reload])
  return { data, loading, error, reload, setData }
}
