import { ReactNode, useId } from 'react'

type Tone = 'accent' | 'ok' | 'warn' | 'bad'
const TONE_VAR: Record<Tone, [string, string]> = {
  accent: ['var(--accent)', 'var(--accent2)'],
  ok: ['var(--ok)', 'var(--accent2)'],
  warn: ['var(--warn)', 'var(--warn)'],
  bad: ['var(--bad)', 'var(--warn)']
}
const rgb = (v: string) => `rgb(${v})`

export function Ring({ value, size = 190, stroke = 12, tone = 'accent', children }: { value: number; size?: number; stroke?: number; tone?: Tone; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.min(100, Math.max(0, value))
  const id = useId()
  const [a, b] = TONE_VAR[tone]
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: rgb(a), transition: 'stop-color 0.6s' }} />
            <stop offset="100%" style={{ stopColor: rgb(b), transition: 'stop-color 0.6s' }} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--hover) / 0.08)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={`url(#${id})`} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(0.2, 0.8, 0.2, 1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

export function Sparkline({ data, color = 'var(--accent)', max = 100, height = 46 }: { data: number[]; color?: string; max?: number; height?: number }) {
  const w = 220
  const pts = data.length ? data : [0]
  const step = w / Math.max(1, pts.length - 1)
  const y = (v: number) => height - 3 - (Math.min(v, max) / max) * (height - 6)
  const xy = pts.map((v, i) => [i * step, y(v)] as const)
  const line = xy.map(([x, yy], i) => {
    if (i === 0) return `M${x.toFixed(1)},${yy.toFixed(1)}`
    const [px, py] = xy[i - 1]
    const cx = (px + x) / 2
    return `C${cx.toFixed(1)},${py.toFixed(1)} ${cx.toFixed(1)},${yy.toFixed(1)} ${x.toFixed(1)},${yy.toFixed(1)}`
  }).join(' ')
  const area = `${line} L${((pts.length - 1) * step).toFixed(1)},${height} L0,${height} Z`
  const id = useId()
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" preserveAspectRatio="none" height={height}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: rgb(color), stopOpacity: 0.32 }} />
          <stop offset="100%" style={{ stopColor: rgb(color), stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" style={{ stroke: rgb(color) }} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export interface TreeItem { name: string; path: string; size: number; isDir: boolean }
interface Rect { x: number; y: number; w: number; h: number; item: TreeItem }

function layoutTreemap(items: TreeItem[], W: number, H: number): Rect[] {
  const total = items.reduce((n, i) => n + i.size, 0)
  if (!total) return []
  const out: Rect[] = []
  let rest = [...items].sort((a, b) => b.size - a.size)
  let x = 0, y = 0, w = W, h = H
  let remaining = total
  const area = (s: number) => (s / remaining) * w * h
  const worst = (row: TreeItem[], side: number) => {
    const s = row.reduce((n, i) => n + area(i.size), 0)
    const max = Math.max(...row.map((i) => area(i.size))), min = Math.min(...row.map((i) => area(i.size)))
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min))
  }
  while (rest.length) {
    const side = Math.min(w, h)
    const row = [rest[0]]
    let i = 1
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++])
    const rowArea = row.reduce((n, it) => n + area(it.size), 0)
    const thick = rowArea / side
    let off = 0
    for (const it of row) {
      const len = area(it.size) / thick
      if (w >= h) out.push({ x, y: y + off, w: thick, h: len, item: it })
      else out.push({ x: x + off, y, w: len, h: thick, item: it })
      off += len
    }
    if (w >= h) { x += thick; w -= thick } else { y += thick; h -= thick }
    remaining -= row.reduce((n, it) => n + it.size, 0)
    rest = rest.slice(row.length)
  }
  return out
}

const PALETTE = ['#6f8fe8', '#5fb8b2', '#8d9bea', '#d9b070', '#d68ea4', '#79bf9d', '#a08fdc', '#6bb0dc']

export function Treemap({ items, width, height, onOpen, fmt }: { items: TreeItem[]; width: number; height: number; onOpen: (i: TreeItem) => void; fmt: (n: number) => string }) {
  const rects = layoutTreemap(items.slice(0, 60), width, height)
  return (
    <div className="relative overflow-hidden rounded-md" style={{ width, height }}>
      {rects.map((r, i) => (
        <button
          key={r.item.path}
          title={`${r.item.path}\n${fmt(r.item.size)}`}
          onClick={() => onOpen(r.item)}
          className="fade-in absolute overflow-hidden border border-bg p-1.5 text-left transition duration-150 hover:brightness-110"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: PALETTE[i % PALETTE.length], opacity: r.item.isDir ? 0.92 : 0.65, animationDelay: `${Math.min(i, 20) * 18}ms` }}
        >
          {r.w > 70 && r.h > 34 && (
            <>
              <div className="truncate text-[12px] font-semibold text-white drop-shadow-sm">{r.item.name}</div>
              <div className="text-[11px] text-white/85">{fmt(r.item.size)}</div>
            </>
          )}
        </button>
      ))}
    </div>
  )
}
