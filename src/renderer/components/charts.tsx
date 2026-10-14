export function Sparkline({ data, max = 100, height = 46 }: { data: number[]; max?: number; height?: number }) {
  const w = 220
  const pts = data.length ? data : [0]
  const step = w / Math.max(1, pts.length - 1)
  const y = (v: number) => height - 2 - (Math.min(v, max) / max) * (height - 4)
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${((pts.length - 1) * step).toFixed(1)},${height} L0,${height} Z`
  return (
    <svg key={data.length > 0 ? 'live' : 'idle'} viewBox={`0 0 ${w} ${height}`} className={`w-full ${data.length > 0 ? 'reveal' : 'opacity-0'}`} preserveAspectRatio="none" height={height}>
      <path d={area} style={{ fill: 'rgb(var(--accent) / 0.14)' }} />
      <path d={line} fill="none" style={{ stroke: 'rgb(var(--accent))' }} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
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

const PALETTE = ['#0078d4', '#038387', '#8764b8', '#ca5010', '#107c10', '#c239b3', '#986f0b', '#5d5a58', '#0063b1', '#498205']

export function Treemap({ items, width, height, onOpen, fmt }: { items: TreeItem[]; width: number; height: number; onOpen: (i: TreeItem) => void; fmt: (n: number) => string }) {
  const rects = layoutTreemap(items.slice(0, 60), width, height)
  return (
    <div className="relative overflow-hidden rounded" style={{ width, height }}>
      {rects.map((r, i) => (
        <button
          key={r.item.path}
          title={`${r.item.path}\n${fmt(r.item.size)}`}
          onClick={() => onOpen(r.item)}
          className="fade-in absolute overflow-hidden border border-panel p-2 text-left transition-[filter] duration-100 hover:brightness-110"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: PALETTE[i % PALETTE.length], opacity: r.item.isDir ? 1 : 0.72, animationDelay: `${Math.min(i, 20) * 18}ms` }}
        >
          {r.w > 70 && r.h > 34 && (
            <>
              <div className="truncate text-[12px] font-semibold text-white">{r.item.name}</div>
              <div className="text-[12px] text-white/80">{fmt(r.item.size)}</div>
            </>
          )}
        </button>
      ))}
    </div>
  )
}
