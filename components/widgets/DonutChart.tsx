'use client'
import { useState } from 'react'

export interface DonutSlice {
  id: string
  label: string
  color: string
  count: number
}

export interface DonutChartProps {
  slices: DonutSlice[]
  ready: boolean
  centerLabel?: string
}

export function DonutChart({ slices, ready, centerLabel = 'leads' }: DonutChartProps) {
  const [hov, setHov] = useState<string | null>(null)
  if (!slices.length) return null
  const total = slices.reduce((s, sl) => s + sl.count, 0)
  if (total === 0) return null

  const r = 38, circ = 2 * Math.PI * r
  const SW = 14, SW_HOV = 19
  const gapLen = slices.length > 1 ? 3 : 0
  let cum = 0
  const segments = slices.map(sl => {
    const len = (sl.count / total) * circ
    const drawLen = Math.max(len - gapLen, 0.1)
    const offset = circ * 0.25 - cum
    cum += len
    return { ...sl, drawLen, offset, pct: ((sl.count / total) * 100).toFixed(1) }
  })
  const hovSeg = hov ? segments.find(s => s.id === hov) : null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
      <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
        <svg width="130" height="130" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--gray3)" strokeWidth={SW} />
          {segments.map(s => (
            <circle key={s.id} cx="50" cy="50" r={r} fill="none"
              stroke={s.color}
              strokeWidth={hov === s.id ? SW_HOV : SW}
              strokeDasharray={`${s.drawLen} ${circ - s.drawLen}`}
              strokeDashoffset={s.offset}
              style={{ transition: 'opacity 0.65s ease, stroke-width 0.2s ease', opacity: ready ? (hov && hov !== s.id ? 0.22 : 1) : 0, cursor: 'pointer' }}
              onMouseEnter={() => setHov(s.id)}
              onMouseLeave={() => setHov(null)}
            />
          ))}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          {hovSeg ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: hovSeg.color, lineHeight: 1 }}>{hovSeg.count}</div>
              <div style={{ fontSize: 10, color: hovSeg.color, fontWeight: 700, opacity: 0.75 }}>{hovSeg.pct}%</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--black)', lineHeight: 1 }}>{total}</div>
              {centerLabel && (
                <div style={{ fontSize: 9, color: 'var(--gray2)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{centerLabel}</div>
              )}
            </>
          )}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {segments.map(s => (
          <div key={s.id}
            onMouseEnter={() => setHov(s.id)}
            onMouseLeave={() => setHov(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, opacity: hov && hov !== s.id ? 0.28 : 1, transition: 'opacity 0.2s', cursor: 'default' }}
          >
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0, transform: hov === s.id ? 'scale(1.5)' : 'scale(1)', transition: 'transform 0.15s ease' }} />
            <span style={{ fontSize: 12, color: 'var(--gray)', flex: 1, fontWeight: 500 }}>{s.label}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: s.color }}>{s.count}</span>
            <span style={{ fontSize: 11, color: 'var(--gray2)', minWidth: 38, textAlign: 'right', fontWeight: 600 }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default DonutChart
