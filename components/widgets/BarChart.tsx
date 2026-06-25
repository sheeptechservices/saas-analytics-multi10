'use client'
import { useState } from 'react'

export interface BarChartItem {
  label: string
  count: number
}

export interface BarChartProps {
  data: BarChartItem[]
  ready: boolean
  /** Singular unit shown in the tooltip (e.g. 'lead'). Pluralised automatically. */
  unit?: string
  /** Optional shared max value — set the same on sibling charts for a common Y scale. */
  maxValue?: number
}

export function BarChart({ data, ready, unit = 'item', maxValue }: BarChartProps) {
  const [hovBar, setHovBar] = useState<string | null>(null)
  const maxCount = maxValue ?? Math.max(...data.map(d => d.count), 1)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 120, position: 'relative' }}>
        {data.map(({ label, count }) => {
          const isHov = hovBar === label
          const finalH = count > 0 ? Math.max((count / maxCount) * 100, 8) : 5
          return (
            <div key={label} onMouseEnter={() => setHovBar(label)} onMouseLeave={() => setHovBar(null)}
              style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', position: 'relative', cursor: count > 0 ? 'pointer' : 'default' }}
            >
              {isHov && count > 0 && (
                <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: 'var(--black)', color: '#fff', borderRadius: 7, padding: '5px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none', animation: 'tooltip-in 0.15s ease both', lineHeight: 1.5, boxShadow: '0 4px 14px rgba(0,0,0,0.22)' }}>
                  <div style={{ color: 'var(--gray2)', fontSize: 10 }}>{label}</div>
                  <div style={{ color: 'var(--primary)', fontWeight: 800 }}>{count} {unit}{count !== 1 ? 's' : ''}</div>
                </div>
              )}
              <div style={{ width: '100%', borderRadius: '4px 4px 0 0', background: count > 0 ? (isHov ? 'var(--primary-mid)' : 'var(--primary)') : (isHov ? 'var(--gray2)' : 'var(--gray3)'), height: ready ? `${finalH}%` : '3%', transition: 'height 0.7s cubic-bezier(0.22, 1, 0.36, 1), background 0.15s ease' }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        {data.map(({ label }) => (
          <div key={label} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: hovBar === label ? 'var(--primary-text)' : 'var(--gray2)', fontWeight: hovBar === label ? 700 : 500, transition: 'color 0.15s' }}>
            {label.replace('Sem. passada', 'S. ant.').replace('Esta sem.', 'Esta')}
          </div>
        ))}
      </div>
    </div>
  )
}

export default BarChart
