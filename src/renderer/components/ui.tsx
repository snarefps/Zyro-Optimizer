import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Risk } from '../../shared/types'
import { usePresence } from '../hooks/usePresence'
import { GLYPH_FONT, Icon } from './Icon'

export function Card({ children, className = '', lift = false, style }: { children: ReactNode; className?: string; lift?: boolean; style?: React.CSSProperties }) {
  return (
    <div style={style} className={`rounded-lg border border-hover/[0.07] bg-panel shadow-card ${lift ? 'transition-colors duration-[83ms] hover:bg-panel2' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function Setting({ icon, title, description, children, onClick, disabled, className = '' }: { icon?: string; title: ReactNode; description?: ReactNode; children?: ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  const inner = (
    <>
      {icon && <Icon name={icon} size={24} className="text-fg" />}
      <div className="min-w-0 flex-1 text-left">
        <div className="text-[14px] leading-5 text-fg">{title}</div>
        {description && <div className="text-[12px] leading-4 text-mute">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2" onClick={onClick ? (e) => e.stopPropagation() : undefined}>{children}</div>}
      {onClick && <span aria-hidden className="shrink-0 text-mute" style={{ fontFamily: GLYPH_FONT, fontSize: 12 }}>{'\uE76C'}</span>}
    </>
  )
  const box = `flex min-h-[62px] w-full items-center gap-4 rounded-lg border border-hover/[0.07] bg-panel px-4 py-3 ${className}`
  if (onClick) {
    return <button onClick={onClick} disabled={disabled} className={`${box} transition-colors duration-[83ms] hover:bg-panel2 active:bg-panel2/70 disabled:opacity-45`}>{inner}</button>
  }
  return <div className={`${box} ${disabled ? 'opacity-60' : ''}`}>{inner}</div>
}

export function SectionTitle({ children, icon, className = '' }: { children: ReactNode; icon?: string; className?: string }) {
  return (
    <h2 className={`mb-2 mt-6 flex items-center gap-2 text-[14px] font-semibold leading-5 text-fg ${className}`}>
      {icon && <Icon name={icon} size={20} />}
      {children}
    </h2>
  )
}

export function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-6 border-b border-line px-4 py-2.5 text-[14px] last:border-0">
      <span className="text-mute">{k}</span>
      <span className="truncate text-right">{v}</span>
    </div>
  )
}

type BtnVariant = 'primary' | 'ghost' | 'danger' | 'soft'
export function Button({
  variant = 'primary', busy, icon, className = '', children, ...rest
}: { variant?: BtnVariant; busy?: boolean; icon?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = 'inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded px-[11px] text-[14px] disabled:cursor-not-allowed'
  const styles: Record<BtnVariant, string> = {
    primary: 'btn-primary',
    ghost: 'btn-std',
    soft: 'btn-std',
    danger: 'btn-std !text-bad'
  }
  return (
    <button {...rest} disabled={rest.disabled || busy} className={`${base} ${styles[variant]} ${className}`}>
      {busy ? <ProgressRing size={16} /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  )
}

export function ProgressRing({ size = 32, stroke, className = '' }: { size?: number; stroke?: number; className?: string }) {
  const w = stroke ?? (size <= 20 ? 2.5 : size <= 32 ? 3 : 4)
  const r = (size - w) / 2
  return (
    <svg role="progressbar" aria-busy="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`ring-spin shrink-0 ${className}`}>
      <circle className="ring-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" pathLength={100} />
    </svg>
  )
}

const TONES = {
  safe: 'bg-hover/[0.06] text-soft',
  low: 'bg-hover/[0.06] text-soft',
  medium: 'bg-hover/[0.1] text-fg',
  high: 'bg-hover/[0.16] font-semibold text-fg',
  info: 'bg-hover/[0.06] text-soft',
  muted: 'bg-hover/[0.06] text-soft'
}
export type Tone = keyof typeof TONES

export function Badge({ tone = 'muted', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-px text-[12px] leading-4 ${TONES[tone]}`}>{children}</span>
}

const RISK_LABEL: Record<Risk, string> = { safe: 'Safe', low: 'Low risk', medium: 'Caution', high: 'High risk' }
export function RiskBadge({ risk }: { risk: Risk }) {
  return <Badge tone={risk}>{RISK_LABEL[risk]}</Badge>
}

export function Toggle({ on, onChange, disabled, busy, label = true }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; busy?: boolean; label?: boolean }) {
  const ease = 'duration-[167ms] ease-[cubic-bezier(0.1,0.9,0.2,1)]'
  return (
    <div className="flex items-center gap-3">
      {label && <span className="w-6 select-none text-right text-[14px] text-fg">{on ? 'On' : 'Off'}</span>}
      <button
        role="switch"
        aria-checked={on}
        disabled={disabled || busy}
        onClick={() => onChange(!on)}
        className={`group relative h-5 w-10 shrink-0 rounded-full border transition-colors ${ease} disabled:opacity-45 ${busy ? 'animate-pulse' : ''} ${on ? 'border-accent bg-accent' : 'border-hover/55 bg-hover/[0.04] hover:bg-hover/[0.08]'}`}
      >
        <span
          className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-all ${ease} group-hover:h-[14px] group-hover:w-[14px] group-active:w-[17px] ${
            on ? 'left-[23px] bg-onaccent group-hover:left-[22px] group-active:left-[19px]' : 'left-[4px] bg-soft group-hover:left-[3px]'
          }`}
        />
      </button>
    </div>
  )
}

export function Pivot<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`relative h-9 rounded px-3 text-[14px] transition-colors duration-[83ms] hover:bg-hover/[0.06] ${value === o.value ? 'text-fg' : 'text-mute hover:text-fg'}`}
        >
          {o.label}
          {value === o.value && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex shrink-0 items-end justify-between gap-6">
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-9">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[720px] text-[14px] leading-5 text-mute">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
    </div>
  )
}

export function Empty({ title, hint, icon = 'thumb-up' }: { title: string; hint?: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center fade-up">
      <Icon name={icon} size={64} className="mb-3 text-mute" />
      <div className="text-[16px] font-semibold">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-[14px] text-mute">{hint}</div>}
    </div>
  )
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-accent fade-in">
      <ProgressRing size={40} />
      {label && <div className="text-[14px] text-mute">{label}</div>}
    </div>
  )
}

export function Modal({ open, title, children, onClose, actions, wide }: { open: boolean; title: string; children: ReactNode; onClose: () => void; actions?: ReactNode; wide?: boolean }) {
  const { mounted, closing } = usePresence(open, 167)
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!mounted) return null
  return createPortal(
    <div className={`fixed inset-0 z-[70] flex items-center justify-center bg-black/40 ${closing ? 'fade-out' : 'fade-in'}`} onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className={`flex max-h-[80vh] flex-col overflow-hidden rounded-lg bg-panel shadow-dialog ${closing ? 'pop-out' : 'pop-in'} ${wide ? 'w-[760px]' : 'w-[460px]'}`}>
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <h2 className="text-[20px] font-semibold leading-7">{title}</h2>
          <div className="mt-3 text-[14px] leading-5 text-soft">{children}</div>
        </div>
        {actions && <div className="flex shrink-0 gap-2 border-t border-line bg-bg px-6 py-5 [&>*]:flex-1">{actions}</div>}
      </div>
    </div>,
    document.body
  )
}

export function ProgressBar({ value, height = 4 }: { value: number | null; height?: number }) {
  return (
    <div className="relative overflow-hidden rounded-full bg-hover/[0.14]" style={{ height }} role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {value === null ? (
        <><div className="progress-ind-a absolute inset-y-0 rounded-full bg-accent" /><div className="progress-ind-b absolute inset-y-0 rounded-full bg-accent" /></>
      ) : (
        <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      )}
    </div>
  )
}

export function ScanBar({ active }: { active: boolean }) {
  return <div className={`h-[3px] overflow-hidden transition-opacity duration-300 ${active ? 'opacity-100' : 'opacity-0'}`}><ProgressBar value={null} height={3} /></div>
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-hover/10 bg-hover/[0.06] px-1.5 py-px font-sans text-[12px] text-mute">{children}</kbd>
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
          <div key={t.id} className="slide-up pointer-events-auto flex items-start gap-3 rounded-lg bg-panel px-4 py-3 text-[14px] shadow-pop">
            <Icon name={icon[t.kind]} size={20} className="mt-px" />
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
  const latest = useRef(0)
  const reload = useCallback(async () => {
    const mine = ++latest.current
    setLoading(true); setError(null)
    try {
      const result = await loader()
      if (mine === latest.current) setData(result)
    } catch (e: any) {
      if (mine === latest.current) setError(String(e?.message ?? e))
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }, deps)
  useEffect(() => { reload() }, [reload])
  return { data, loading, error, reload, setData }
}

export function Select<T extends string>({ value, options, onChange, className = '', disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null)
  const [hot, setHot] = useState(0)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const { mounted, closing } = usePresence(open, 120)
  const current = options.find((o) => o.value === value)

  const show = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const room = window.innerHeight - r.bottom
    const want = Math.min(options.length * 36 + 12, 320)
    setBox({ left: r.left, top: room < want + 8 && r.top > room ? r.top - 4 : r.bottom + 4, width: r.width, up: room < want + 8 && r.top > room })
    setHot(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const pick = (v: T) => { setOpen(false); if (v !== value) onChange(v); btn.current?.focus() }

  useEffect(() => {
    if (!open) return
    list.current?.querySelector('[data-hot="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, hot])
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setHot((h) => Math.min(options.length - 1, h + 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHot((h) => Math.max(0, h - 1)) }
      else if (e.key === 'Enter') { e.preventDefault(); pick(options[hot].value) }
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('mousedown', close, true); window.removeEventListener('blur', close); window.removeEventListener('keydown', key, true) }
  }, [open, hot, options])

  return (
    <>
      <button ref={btn} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? setOpen(false) : show())} className={`combo ${className}`}>
        <span className="flex-1 truncate text-left">{current?.label ?? ''}</span>
        <span aria-hidden className="shrink-0 text-mute" style={{ fontFamily: GLYPH_FONT, fontSize: 10 }}>{'\uE70D'}</span>
      </button>
      {mounted && box && createPortal(
        <div
          ref={list}
          role="listbox"
          style={{ position: 'fixed', left: box.left, minWidth: Math.max(box.width, 160), [box.up ? 'bottom' : 'top']: box.up ? window.innerHeight - box.top : box.top, zIndex: 95 }}
          className={`max-h-[320px] overflow-auto rounded-lg bg-panel2 p-1.5 shadow-pop ${closing ? 'fade-out' : 'drop-in'}`}
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              data-hot={i === hot}
              onMouseEnter={() => setHot(i)}
              onClick={() => pick(o.value)}
              className={`relative flex h-9 w-full items-center whitespace-nowrap rounded px-3 text-left text-[14px] ${i === hot ? 'bg-hover/[0.08]' : o.value === value ? 'bg-hover/[0.06]' : ''}`}
            >
              {o.value === value && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent" />}
              {o.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
