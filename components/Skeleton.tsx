import type { CSSProperties } from 'react'

interface SkeletonProps {
  width?:   number | string
  height?:  number | string
  radius?:  number | string
  circle?:  boolean
  style?:   CSSProperties
}

export function Skeleton({ width = '100%', height = 14, radius = 6, circle, style }: SkeletonProps) {
  return (
    <div
      className="shimmer-bar"
      style={{
        width,
        height,
        borderRadius: circle ? '50%' : radius,
        background: 'var(--gray3)',
        flexShrink: 0,
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

// Table skeleton: white card with N rows × cols widths
interface SkeletonTableProps {
  rows?:     number
  colWidths?: (number | string)[]
}
export function SkeletonTable({ rows = 7, colWidths = ['30%', '20%', '20%', '15%', '10%'] }: SkeletonTableProps) {
  return (
    <div style={{
      background: 'var(--white)', borderRadius: 16,
      border: '1px solid var(--gray3)', overflow: 'hidden',
    }}>
      {/* header ghost */}
      <div style={{
        background: 'var(--bg)', padding: '10px 16px',
        borderBottom: '1px solid var(--gray3)',
        display: 'flex', gap: 16, alignItems: 'center',
      }}>
        <Skeleton width={14} height={14} radius={3} />
        {colWidths.map((w, i) => <Skeleton key={i} width={w} height={10} />)}
      </div>
      {/* rows */}
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          style={{
            padding: '13px 16px',
            borderBottom: r < rows - 1 ? '1px solid var(--gray3)' : 'none',
            display: 'flex', gap: 16, alignItems: 'center',
          }}
        >
          <Skeleton width={14} height={14} radius={3} />
          {colWidths.map((w, i) => <Skeleton key={i} width={w} height={13} />)}
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
            padding: '10px 12px', borderBottom: '1px solid var(--gray3)',
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

// KPI card skeletons for dashboard
export function SkeletonKpiCards({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, gap: 14, marginBottom: 24 }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{
          background: 'var(--white)', borderRadius: 16,
          border: '1px solid var(--gray3)', padding: '20px 22px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <Skeleton width="55%" height={11} />
          <Skeleton width="45%" height={28} radius={6} />
          <Skeleton width="70%" height={10} />
        </div>
      ))}
    </div>
  )
}

// Generic block placeholder (for charts / wide cards)
export function SkeletonBlock({ height = 180, style }: { height?: number; style?: CSSProperties }) {
  return (
    <Skeleton
      width="100%"
      height={height}
      radius={16}
      style={{ background: 'var(--gray3)', ...style }}
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
