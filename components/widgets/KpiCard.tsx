'use client'
import { useEffect, useState } from 'react'
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react'

// ─── useCountUp ───────────────────────────────────────────────────────────────

export function useCountUp(target: number, duration = 750, delay = 0): number {
  const [val, setVal] = useState(0)
  useEffect(() => {
    setVal(0)
    if (!target) return
    if (typeof document !== 'undefined' && document.hidden) {
      const t = setTimeout(() => setVal(target), delay)
      return () => clearTimeout(t)
    }
    let raf: number
    const t = setTimeout(() => {
      let startTs = 0
      const tick = (ts: number) => {
        if (!startTs) startTs = ts
        const p = Math.min((ts - startTs) / duration, 1)
        setVal(Math.round((1 - Math.pow(1 - p, 3)) * target))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, delay)
    return () => { clearTimeout(t); cancelAnimationFrame(raf) }
  }, [target])
  return val
}

// ─── ChangeBadge ─────────────────────────────────────────────────────────────

export function ChangeBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null
  const positive = value > 0
  const zero = value === 0
  const color = zero ? 'var(--gray2)' : positive ? 'var(--green)' : 'var(--red)'
  const bg    = zero ? 'rgba(170,170,170,0.10)' : positive ? 'rgba(30,138,62,0.08)' : 'rgba(217,48,37,0.08)'
  const Arrow = zero ? ArrowRight : positive ? ArrowUp : ArrowDown
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 11, fontWeight: 700, color,
      background: bg,
      border: `1px solid ${color}30`,
      borderRadius: 100,
      padding: '2px 8px',
      marginTop: 8,
    }}>
      <Arrow size={11} /> {Math.abs(value)}% <span style={{ fontWeight: 500, opacity: 0.7 }}>vs ant.</span>
    </span>
  )
}

// ─── KpiCard ─────────────────────────────────────────────────────────────────

export interface KpiCardProps {
  label: string
  value: number
  format?: (v: number) => string
  accent?: string
  sub?: string
  delay?: number
  change?: number | null
}

export function KpiCard({
  label, value, format, accent = 'var(--primary)', sub, delay = 0, change,
}: KpiCardProps) {
  const [hov, setHov] = useState(false)
  const counted = useCountUp(value, 750, delay)
  const display = format ? format(counted) : String(counted)

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: 'var(--white)',
        border: '1px solid var(--gray3)',
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        padding: '18px 20px',
        cursor: 'default',
        transition: 'transform 0.22s ease, box-shadow 0.22s ease',
        transform: hov ? 'translateY(-4px) scale(1.01)' : 'translateY(0) scale(1)',
        boxShadow: hov
          ? `0 10px 28px rgba(0,0,0,0.10), inset 0 0 0 1px ${accent}30`
          : 'var(--shadow)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{
        fontSize: display.length > 14 ? 20 : display.length > 10 ? 23 : 26,
        fontWeight: 800, color: accent, lineHeight: 1,
        transition: 'font-size 0.2s ease',
        letterSpacing: '-0.02em',
        wordBreak: 'break-all',
      }}>{display}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--gray2)', marginTop: 5, fontWeight: 500 }}>{sub}</div>}
      <ChangeBadge value={change ?? null} />
    </div>
  )
}

export default KpiCard
