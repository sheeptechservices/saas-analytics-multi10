import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

interface SkeletonProps {
  width?:   number | string
  height?:  number | string
  radius?:  number | string
  circle?:  boolean
  style?:   CSSProperties
  /** Extra classes — e.g. a responsive flex-shrink. The default no-shrink is a
   *  class (shrink-0), not inline, so a responsive class can override it. */
  className?: string
}

export function Skeleton({ width = '100%', height = 14, radius = 6, circle, style, className }: SkeletonProps) {
  return (
    <div
      className={cn('shimmer-bar shrink-0', className)}
      style={{
        width,
        height,
        borderRadius: circle ? '50%' : radius,
        background: 'var(--line)',
        ...style,
      }}
    />
  )
}

// N stacked text-line bars
export function SkeletonText({ lines = 2, gap = 8 }: { lines?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? '65%' : '100%'} height={13} />
      ))}
    </div>
  )
}

// Table skeleton: white card with N rows × cols widths.
// The percent widths plus the fixed 16px gaps add up to more than the row, so
// the last bar runs past the card edge. Below md the bars shrink to fit the
// card, and below sm only the first three columns stay. From md up, unchanged.
function colClass(i: number): string {
  return cn('max-md:shrink', i >= 3 && 'max-sm:hidden')
}

interface SkeletonTableProps {
  rows?:     number
  colWidths?: (number | string)[]
}
export function SkeletonTable({ rows = 7, colWidths = ['30%', '20%', '20%', '15%', '10%'] }: SkeletonTableProps) {
  return (
    <div style={{
      background: 'var(--white)', borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--line)', overflow: 'hidden',
    }}>
      {/* header ghost */}
      <div style={{
        background: 'var(--bg)', padding: '10px 16px',
        borderBottom: '1px solid var(--line)',
        display: 'flex', gap: 16, alignItems: 'center',
      }}>
        <Skeleton width={14} height={14} radius={3} />
        {colWidths.map((w, i) => <Skeleton key={i} width={w} height={10} className={colClass(i)} />)}
      </div>
      {/* rows */}
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          style={{
            padding: '13px 16px',
            borderBottom: r < rows - 1 ? '1px solid var(--line)' : 'none',
            display: 'flex', gap: 16, alignItems: 'center',
          }}
        >
          <Skeleton width={14} height={14} radius={3} />
          {colWidths.map((w, i) => <Skeleton key={i} width={w} height={13} className={colClass(i)} />)}
        </div>
      ))}
    </div>
  )
}

// Session list skeleton for conversas sidebar
export function SkeletonSessionList({ items = 6 }: { items?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {Array.from({ length: items }, (_, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 9,
            padding: '10px 12px', borderBottom: '1px solid var(--line)',
          }}
        >
          <Skeleton circle width={30} height={30} style={{ marginTop: 1 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton width="60%" height={12} />
            <Skeleton width="85%" height={10} />
          </div>
        </div>
      ))}
    </div>
  )
}

// KPI card skeletons for dashboard. Columns come from static classes (Tailwind
// only generates what is spelled out in the code): 1 on phones, 2 from sm to lg,
// `count` on desktop.
const KPI_COLS_LG: Record<number, string> = {
  1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6',
}

export function SkeletonKpiCards({ count = 4 }: { count?: number }) {
  return (
    <div
      className={cn('grid grid-cols-1', count > 1 && 'sm:grid-cols-2', KPI_COLS_LG[count] ?? 'lg:grid-cols-4')}
      style={{ gap: 14, marginBottom: 24 }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--line)',
          borderLeft: 'var(--rail) solid var(--line)',
          boxShadow: 'var(--shadow-md)',
          padding: '18px 20px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <Skeleton width="55%" height={10} />
          <Skeleton width="45%" height={26} radius="var(--radius-xs)" />
          <Skeleton width="70%" height={11} />
        </div>
      ))}
    </div>
  )
}

// KPI band skeleton for the dashboard Visão geral: um objeto só (não N
// cartões), com as mesmas células em hairline da KpiBand — inclusive o
// 2×2 abaixo de 900px e a coluna única abaixo de 640px, porque reaproveita
// as classes .kpi-band.
export function SkeletonKpiBand({ count = 4 }: { count?: number }) {
  const cells = Math.max(count, 2)
  return (
    <div className="kpi-band" aria-hidden style={{ '--kpi-count': cells - 1 } as CSSProperties}>
      {Array.from({ length: cells }, (_, i) => (
        <div key={i} className="kpi-band-cell">
          <Skeleton width="55%" height={10} />
          <Skeleton width={i === 0 ? '45%' : '40%'} height={i === 0 ? 44 : 27} radius="var(--radius-xs)" />
          <Skeleton width="70%" height={11} />
        </div>
      ))}
    </div>
  )
}

// Generic block placeholder (for charts / wide cards)
export function SkeletonBlock({ height = 180, radius = 'var(--radius-lg)', style }: {
  height?: number
  /** Raio do bloco. Padrão --radius-lg (cartão de seção); use --radius-md para painéis planos. */
  radius?: number | string
  style?: CSSProperties
}) {
  return (
    <Skeleton
      width="100%"
      height={height}
      radius={radius}
      style={{ background: 'var(--line)', ...style }}
    />
  )
}

// Form skeleton: label + input rows
export function SkeletonForm({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Skeleton width="30%" height={11} />
          <Skeleton width="100%" height={38} radius={10} />
        </div>
      ))}
    </div>
  )
}
