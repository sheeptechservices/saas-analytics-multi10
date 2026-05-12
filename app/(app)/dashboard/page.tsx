'use client'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatCurrency } from '@/lib/utils'

// ─── types ────────────────────────────────────────────────────────────────────

type Period = 'all' | '7d' | '30d' | '90d'

const PERIOD_LABELS: Record<Period, string> = {
  all: 'Todo período',
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
}

// ─── useCountUp ───────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 750, delay = 0): number {
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

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null
  const positive = value > 0
  const zero = value === 0
  const color = zero ? 'var(--gray2)' : positive ? 'var(--green)' : 'var(--red)'
  const bg    = zero ? 'rgba(170,170,170,0.10)' : positive ? 'rgba(30,138,62,0.08)' : 'rgba(217,48,37,0.08)'
  const arrow = zero ? '→' : positive ? '↑' : '↓'
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
      {arrow} {Math.abs(value)}% <span style={{ fontWeight: 500, opacity: 0.7 }}>vs ant.</span>
    </span>
  )
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, format, accent = 'var(--primary)', sub, delay = 0, change }: {
  label: string
  value: number
  format?: (v: number) => string
  accent?: string
  sub?: string
  delay?: number
  change?: number | null
}) {
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

// ─── DonutChart ───────────────────────────────────────────────────────────────

function DonutChart({ stages, ready }: { stages: any[]; ready: boolean }) {
  const [hov, setHov] = useState<string | null>(null)
  if (!stages.length) return null
  const total = stages.reduce((s: number, st: any) => s + st.count, 0)
  if (total === 0) return null

  const r = 38, circ = 2 * Math.PI * r
  const SW = 14, SW_HOV = 19
  const gapLen = stages.length > 1 ? 3 : 0
  let cum = 0
  const slices = stages.map((st: any) => {
    const len = (st.count / total) * circ
    const drawLen = Math.max(len - gapLen, 0.1)
    const offset = circ * 0.25 - cum
    cum += len
    return { ...st, drawLen, offset, pct: ((st.count / total) * 100).toFixed(1) }
  })
  const hovSlice = hov ? slices.find((s: any) => s.stageId === hov) : null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
      <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
        <svg width="130" height="130" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--gray3)" strokeWidth={SW} />
          {slices.map((s: any) => (
            <circle key={s.stageId} cx="50" cy="50" r={r} fill="none"
              stroke={s.color}
              strokeWidth={hov === s.stageId ? SW_HOV : SW}
              strokeDasharray={`${s.drawLen} ${circ - s.drawLen}`}
              strokeDashoffset={s.offset}
              style={{ transition: 'opacity 0.65s ease, stroke-width 0.2s ease', opacity: ready ? (hov && hov !== s.stageId ? 0.22 : 1) : 0, cursor: 'pointer' }}
              onMouseEnter={() => setHov(s.stageId)}
              onMouseLeave={() => setHov(null)}
            />
          ))}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          {hovSlice ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: hovSlice.color, lineHeight: 1 }}>{hovSlice.count}</div>
              <div style={{ fontSize: 10, color: hovSlice.color, fontWeight: 700, opacity: 0.75 }}>{hovSlice.pct}%</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--black)', lineHeight: 1 }}>{total}</div>
              <div style={{ fontSize: 9, color: 'var(--gray2)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>leads</div>
            </>
          )}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {slices.map((s: any) => (
          <div key={s.stageId}
            onMouseEnter={() => setHov(s.stageId)}
            onMouseLeave={() => setHov(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, opacity: hov && hov !== s.stageId ? 0.28 : 1, transition: 'opacity 0.2s', cursor: 'default' }}
          >
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0, transform: hov === s.stageId ? 'scale(1.5)' : 'scale(1)', transition: 'transform 0.15s ease' }} />
            <span style={{ fontSize: 12, color: 'var(--gray)', flex: 1, fontWeight: 500 }}>{s.stageName}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: s.color }}>{s.count}</span>
            <span style={{ fontSize: 11, color: 'var(--gray2)', minWidth: 38, textAlign: 'right', fontWeight: 600 }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── WeeklyBarChart ───────────────────────────────────────────────────────────

function WeeklyBarChart({ data, ready }: { data: { week: string; count: number }[]; ready: boolean }) {
  const [hovBar, setHovBar] = useState<string | null>(null)
  const maxCount = Math.max(...data.map(d => d.count), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 120, position: 'relative' }}>
        {data.map(({ week, count }) => {
          const isHov = hovBar === week
          const finalH = count > 0 ? Math.max((count / maxCount) * 100, 8) : 5
          return (
            <div key={week} onMouseEnter={() => setHovBar(week)} onMouseLeave={() => setHovBar(null)}
              style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', position: 'relative', cursor: count > 0 ? 'pointer' : 'default' }}
            >
              {isHov && count > 0 && (
                <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: 'var(--black)', color: '#fff', borderRadius: 7, padding: '5px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none', animation: 'tooltip-in 0.15s ease both', lineHeight: 1.5, boxShadow: '0 4px 14px rgba(0,0,0,0.22)' }}>
                  <div style={{ color: 'var(--gray2)', fontSize: 10 }}>{week}</div>
                  <div style={{ color: 'var(--primary)', fontWeight: 800 }}>{count} lead{count !== 1 ? 's' : ''}</div>
                </div>
              )}
              <div style={{ width: '100%', borderRadius: '4px 4px 0 0', background: count > 0 ? (isHov ? 'var(--primary-mid)' : 'var(--primary)') : (isHov ? 'var(--gray2)' : 'var(--gray3)'), height: ready ? `${finalH}%` : '3%', transition: 'height 0.7s cubic-bezier(0.22, 1, 0.36, 1), background 0.15s ease' }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        {data.map(({ week, count }) => (
          <div key={week} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: hovBar === week ? 'var(--primary-text)' : 'var(--gray2)', fontWeight: hovBar === week ? 700 : 500, transition: 'color 0.15s' }}>
            {week.replace('Sem. passada', 'S. ant.').replace('Esta sem.', 'Esta')}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── StageFilterPanel ─────────────────────────────────────────────────────────

const LS_KEY = 'funnel_visible_stages_v1'

function StageFilterPanel({
  allStages, visible, onChange, onClose, top, right,
}: {
  allStages: any[]
  visible: Set<string>
  onChange: (next: Set<string>) => void
  onClose: () => void
  top: number
  right: number
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    setTimeout(() => { document.addEventListener('mousedown', h); window.addEventListener('keydown', k) }, 10)
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k) }
  }, [onClose])

  const toggle = (id: string) => {
    const next = new Set(visible)
    if (next.has(id)) { if (next.size > 1) next.delete(id) } else next.add(id)
    onChange(next)
  }

  return createPortal(<div ref={panelRef} style={{
      position: 'fixed',
      top,
      right,
      zIndex: 9999,
      background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 14,
      boxShadow: '0 8px 40px rgba(0,0,0,0.16)', padding: 16, width: 360,
      animation: 'fadeIn .15s ease both',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--black)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Etapas visíveis
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onChange(new Set(allStages.map((s: any) => s.stageId)))}
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary-text)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Todas
          </button>
          <span style={{ color: 'var(--gray3)' }}>·</span>
          <button onClick={() => { const first = allStages[0]; if (first) onChange(new Set([first.stageId])) }}
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Limpar
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
        {allStages.map((s: any) => {
          const active = visible.has(s.stageId)
          return (
            <button key={s.stageId} onClick={() => toggle(s.stageId)} style={{
              padding: '5px 11px', borderRadius: 99, fontSize: 11, fontWeight: 600,
              background: active ? `${s.color}18` : 'var(--bg)',
              border: `1.5px solid ${active ? s.color : 'var(--gray3)'}`,
              color: active ? s.color : 'var(--gray2)',
              cursor: 'pointer', transition: 'all .15s ease',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? s.color : 'var(--gray3)', flexShrink: 0, transition: 'background .15s' }} />
              {s.stageName}
              <span style={{ fontSize: 10, opacity: 0.7 }}>{s.count}</span>
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: 'var(--gray2)', fontWeight: 500 }}>
        {visible.size} de {allStages.length} etapas visíveis · ordenação padrão do Kommo
      </div>
    </div>, document.body)
}

// ─── HorizontalFunnel ────────────────────────────────────────────────────────

const MIN_SEG_PX    = 72  // visual floor — minimum viable trapezoid width
const MIN_METRIC_PX = 160 // analytical floor — minimum readable metric block width

function HorizontalFunnel({
  allStages, stages, visible, ready,
}: {
  allStages: any[]
  stages: any[]
  visible: Set<string>
  ready: boolean
}) {
  const [hov, setHov] = useState<number | null>(null)

  const filteredStages = stages.filter(s => visible.has(s.stageId))
  if (!filteredStages.length) return null

  const N = filteredStages.length
  const H = 100
  const W = 1000
  const SEG_W = W / N
  const maxCount = Math.max(...filteredStages.map((s: any) => s.count), 1)

  const segs = filteredStages.map((stage: any, i: number) => {
    const lh = Math.max((stage.count / maxCount) * H, 4)
    const next = filteredStages[i + 1]
    const rh = next ? Math.max((next.count / maxCount) * H, 4) : lh
    const x = i * SEG_W
    const lt = (H - lh) / 2
    const lb = (H + lh) / 2
    const rt = (H - rh) / 2
    const rb = (H + rh) / 2
    const dropPct = next
      ? Math.round(((next.count - stage.count) / Math.max(stage.count, 1)) * 100)
      : null
    return { ...stage, i, x, lt, lb, rt, rb, dropPct }
  })

  const hiddenCount = allStages.length - visible.size

  return (
    <div>
      {/* Stage count label */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 600 }}>
          {N} etapa{N !== 1 ? 's' : ''} exibida{N !== 1 ? 's' : ''}
          {hiddenCount > 0 && <span style={{ marginLeft: 6, color: '#7A5600', fontWeight: 700 }}>+{hiddenCount} oculta{hiddenCount !== 1 ? 's' : ''}</span>}
        </div>
      </div>

      {/* Scrollable funnel container */}
      <div style={{ overflowX: 'auto', overflowY: 'visible', marginLeft: -4, marginRight: -4, paddingBottom: 8 }}>
        <div style={{ minWidth: Math.max(400, N * MIN_METRIC_PX), paddingLeft: 4, paddingRight: 4 }}>

          {/* SVG funnel */}
          <div style={{ position: 'relative' }}>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              style={{
                width: '100%', height: 80, display: 'block',
                opacity: ready ? 1 : 0,
                transform: ready ? 'scaleX(1)' : 'scaleX(0.94)',
                transformOrigin: 'left center',
                transition: 'opacity 0.65s ease, transform 0.75s cubic-bezier(0.22,1,0.36,1)',
              }}
            >
              <defs>
                {segs.map(seg => (
                  <linearGradient key={seg.stageId} id={`hf-${seg.stageId}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={seg.color} stopOpacity="0.92" />
                    <stop offset="100%" stopColor={seg.color} stopOpacity="0.70" />
                  </linearGradient>
                ))}
              </defs>
              {segs.map((seg, i) => {
                const gap = i > 0 ? 2 : 0
                return (
                  <polygon
                    key={seg.stageId}
                    points={`${seg.x + gap},${seg.lt} ${seg.x + SEG_W},${seg.rt} ${seg.x + SEG_W},${seg.rb} ${seg.x + gap},${seg.lb}`}
                    fill={`url(#hf-${seg.stageId})`}
                    style={{
                      opacity: hov !== null && hov !== i ? 0.28 : 1,
                      transition: 'opacity 0.18s ease',
                      cursor: 'default',
                      filter: hov === i ? `drop-shadow(0 2px 8px ${seg.color}66)` : 'none',
                    }}
                    onMouseEnter={() => setHov(i)}
                    onMouseLeave={() => setHov(null)}
                  />
                )
              })}
            </svg>

            {hov !== null && segs[hov] && (
              <div style={{
                position: 'absolute',
                left: `${((segs[hov].x + SEG_W / 2) / W) * 100}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'rgba(18,19,22,0.82)',
                color: '#fff',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 800,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                animation: 'fadeIn 0.12s ease both',
                zIndex: 10,
                backdropFilter: 'blur(4px)',
              }}>
                <div style={{ fontWeight: 700, marginBottom: 1, opacity: 0.7, fontSize: 10 }}>{segs[hov].stageName}</div>
                <div>{segs[hov].count} lead{segs[hov].count !== 1 ? 's' : ''}</div>
                {segs[hov].avgLeadTimeDays != null && (
                  <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.75, marginTop: 2 }}>
                    ⏱ {segs[hov].avgLeadTimeDays} dias médios
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Metric blocks — analytical layer owns geometry, funnel adapts */}
          <div style={{ display: 'flex', marginTop: 10 }}>
            {segs.map((seg, i) => {
              const dropColor = seg.dropPct === null ? 'var(--gray2)'
                : seg.dropPct < 0 ? 'var(--red)'
                : seg.dropPct > 0 ? 'var(--green)'
                : 'var(--gray2)'
              const dropArrow = seg.dropPct === null || seg.dropPct === 0 ? '→' : seg.dropPct > 0 ? '↑' : '↓'
              const badgeBg   = seg.dropPct === null ? 'transparent'
                : seg.dropPct < 0 ? 'rgba(217,48,37,0.08)'
                : seg.dropPct > 0 ? 'rgba(30,138,62,0.08)'
                : 'var(--bg)'
              const showPct = i < filteredStages.length - 1 && seg.dropPct !== null
              const isHov = hov === i
              return (
                <div
                  key={seg.stageId}
                  style={{
                    flex: 1, minWidth: MIN_METRIC_PX,
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '0 8px 0 4px',
                  }}
                  onMouseEnter={() => setHov(i)}
                  onMouseLeave={() => setHov(null)}
                >
                  {/* Nome da etapa */}
                  <div title={seg.stageName} style={{
                    fontSize: 10, fontWeight: isHov ? 700 : 500,
                    color: isHov ? seg.color : 'var(--gray)',
                    transition: 'color 0.15s',
                    width: '100%', textAlign: 'center',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {seg.stageName}
                  </div>

                  {/* Número + Badge na mesma linha */}
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 6,
                    marginTop: 2,
                  }}>
                    <span style={{
                      fontSize: 15, fontWeight: 800,
                      color: isHov ? seg.color : 'var(--black)',
                      transition: 'color 0.15s',
                    }}>
                      {seg.count}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 700,
                      color: dropColor,
                      background: badgeBg,
                      border: `1px solid ${dropColor}40`,
                      borderRadius: 100, padding: '1px 5px',
                      whiteSpace: 'nowrap',
                      opacity: showPct ? 1 : 0,
                      transition: 'opacity 0.2s ease',
                    }}>
                      {dropArrow} {Math.abs(seg.dropPct ?? 0)}%
                    </span>
                  </div>

                  {/* Timing */}
                  {seg.avgLeadTimeDays != null && (
                    <div style={{
                      fontSize: 9, fontWeight: 600,
                      color: isHov ? 'var(--gray)' : 'var(--gray2)',
                      transition: 'color 0.15s',
                      marginTop: 1,
                      textAlign: 'center',
                    }}>
                      ⏱ {seg.avgLeadTimeDays}d
                    </div>
                  )}

                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── SectionTitle ─────────────────────────────────────────────────────────────

function SectionTitle({ children, dot, action }: { children: React.ReactNode; dot?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, fontWeight: 800, color: 'var(--gray2)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {children}
      </div>
      {action}
    </div>
  )
}

// ─── AskAIButton ──────────────────────────────────────────────────────────────

function AskAIButton({ question }: { question: string }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('ai-ask', { detail: { question } }))}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title="Perguntar à IA sobre este gráfico"
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 10, fontWeight: 700,
        padding: '3px 9px', borderRadius: 100,
        border: `1px solid ${hov ? 'var(--primary)' : 'var(--primary-mid)'}`,
        cursor: 'pointer', fontFamily: 'inherit',
        background: hov ? 'var(--primary)' : 'var(--primary-dim)',
        color: hov ? 'var(--primary-contrast)' : 'var(--primary-text)',
        transform: hov ? 'scale(1.05)' : 'scale(1)',
        boxShadow: hov ? '0 2px 8px rgba(255,180,0,0.3)' : 'none',
        transition: 'all 0.18s cubic-bezier(0.34,1.4,0.64,1)',
      }}
    >
      <span style={{ fontSize: 9 }}>✦</span> Analisar
    </button>
  )
}

// ─── PeriodFilter ─────────────────────────────────────────────────────────────

function PeriodFilter({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const options: Period[] = ['all', '7d', '30d', '90d']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 100, padding: '3px 4px', boxShadow: 'var(--shadow)' }}>
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            padding: '5px 14px',
            borderRadius: 100,
            border: 'none',
            fontFamily: 'inherit',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all .18s ease',
            background: value === opt ? 'var(--primary)' : 'transparent',
            color: value === opt ? 'var(--primary-contrast)' : 'var(--gray)',
            boxShadow: value === opt ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
          }}
        >
          {PERIOD_LABELS[opt]}
        </button>
      ))}
    </div>
  )
}

// ─── RepStatusChart ───────────────────────────────────────────────────────────

interface RepStatus { name: string; won: number; active: number; lost: number; total: number }

function RepStatusChart({ data, ready }: { data: RepStatus[]; ready: boolean }) {
  const [hov, setHov] = useState<string | null>(null)

  if (data.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, fontSize: 13, color: 'var(--gray2)' }}>
        Nenhum dado no período
      </div>
    )
  }

  const max = data[0].total

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 4 }}>
        {[
          { label: 'Ganho',          color: 'var(--green)' },
          { label: 'Em negociação',  color: '#FFB400' },
          { label: 'Perdido',        color: 'var(--red)' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: l.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray2)' }}>{l.label}</span>
          </div>
        ))}
      </div>

      {data.map((rep, i) => {
        const isH    = hov === rep.name
        const total  = rep.total || 1
        const wonPct    = (rep.won    / total) * 100
        const activePct = (rep.active / total) * 100
        const lostPct   = (rep.lost   / total) * 100
        const trackW = (rep.total / max) * 100
        const firstName = rep.name.split(' ')[0]

        return (
          <div
            key={rep.name}
            onMouseEnter={() => setHov(rep.name)}
            onMouseLeave={() => setHov(null)}
            style={{ opacity: hov && !isH ? 0.3 : 1, transition: 'opacity 0.2s', cursor: 'default' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ fontSize: 12, fontWeight: isH ? 700 : 600, color: isH ? 'var(--black)' : 'var(--gray)', transition: 'color .15s', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {firstName}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {isH && (
                  <span style={{ fontSize: 10, color: 'var(--gray2)', animation: 'ai-step 0.15s ease both' }}>
                    <span style={{ color: 'var(--green)', fontWeight: 700 }}>{rep.won}G</span>
                    {' · '}
                    <span style={{ color: '#7A5600', fontWeight: 700 }}>{rep.active}N</span>
                    {' · '}
                    <span style={{ color: 'var(--red)', fontWeight: 700 }}>{rep.lost}P</span>
                  </span>
                )}
                <span style={{ fontSize: 11, fontWeight: 700, color: isH ? 'var(--black)' : 'var(--gray2)', transition: 'color .15s' }}>
                  {rep.total} leads
                </span>
              </div>
            </div>
            {/* track scaled to max */}
            <div style={{ height: isH ? 11 : 7, background: 'var(--gray3)', borderRadius: 100, overflow: 'hidden', transition: 'height 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
              <div style={{ display: 'flex', height: '100%', width: ready ? `${trackW}%` : '0%', transition: `width 0.55s cubic-bezier(0.4,0,0.2,1) ${i * 60}ms`, borderRadius: 100, overflow: 'hidden' }}>
                <div style={{ width: `${wonPct}%`,    background: 'var(--green)',   transition: 'width 0.4s ease' }} />
                <div style={{ width: `${activePct}%`, background: '#FFB400', transition: 'width 0.4s ease' }} />
                <div style={{ width: `${lostPct}%`,   background: 'var(--red)',     transition: 'width 0.4s ease' }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── LossReasonsChart ─────────────────────────────────────────────────────────

interface LossReason { reason: string; count: number; value: number; percentage: number }

function LossReasonsChart({ data, ready }: { data: LossReason[]; ready: boolean }) {
  const [hov, setHov] = useState<string | null>(null)

  if (data.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, fontSize: 13, color: 'var(--gray2)' }}>
        Nenhum lead perdido no período
      </div>
    )
  }
  const max = data[0].count

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.map((item, i) => {
        const isHov = hov === item.reason
        const barW  = (item.count / max) * 100
        const alpha = Math.max(1 - i * 0.15, 0.28)
        return (
          <div
            key={item.reason}
            onMouseEnter={() => setHov(item.reason)}
            onMouseLeave={() => setHov(null)}
            style={{ opacity: hov && !isHov ? 0.28 : 1, transition: 'opacity 0.22s', cursor: 'default' }}
          >
            {/* Label row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--primary)', opacity: alpha,
                  transform: isHov ? 'scale(1.7)' : 'scale(1)',
                  transition: 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1)',
                }} />
                <span style={{
                  fontSize: 13, fontWeight: isHov ? 700 : 600,
                  color: isHov ? 'var(--black)' : 'var(--gray)',
                  transition: 'color .15s',
                }}>{item.reason}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {isHov && (
                  <span style={{
                    fontSize: 11, color: 'var(--gray2)', fontWeight: 500,
                    animation: 'ai-step 0.15s ease both',
                  }}>
                    {formatCurrency(item.value)} em oportunidades
                  </span>
                )}
                <span style={{
                  fontSize: 11, fontWeight: 700, marginLeft: 4,
                  color: isHov ? 'var(--primary-text)' : 'var(--gray2)',
                  transition: 'color .15s',
                }}>
                  {item.count} lead{item.count !== 1 ? 's' : ''} · {item.percentage}%
                </span>
              </div>
            </div>

            {/* Bar track */}
            <div style={{
              position: 'relative',
              height: isHov ? 11 : 7,
              background: 'var(--gray3)', borderRadius: 100,
              overflow: 'hidden',
              transition: 'height 0.22s cubic-bezier(0.34,1.56,0.64,1)',
            }}>
              <div style={{
                height: '100%', borderRadius: 100,
                background: 'var(--primary)',
                opacity: isHov ? 1 : alpha,
                width: ready ? `${barW}%` : '0%',
                boxShadow: isHov ? '0 0 14px var(--primary)77' : 'none',
                transition: `width 0.55s cubic-bezier(0.4,0,0.2,1) ${i * 70}ms, opacity 0.2s, box-shadow 0.22s`,
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── LeadModal ────────────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<string, string> = { high: 'Alta', normal: 'Normal', low: 'Baixa' }
const PRIORITY_COLOR: Record<string, string> = { high: '#D93025', normal: '#FFB400', low: '#1DA462' }

function LeadModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => fetch(`/api/leads/${leadId}`).then(r => r.json()),
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const sk = (w: string | number, h: number, r = 6) => (
    <div className="shimmer-bar" style={{ width: w, height: h, borderRadius: r, background: 'var(--gray3)', flexShrink: 0 }} />
  )

  const priority = lead?.extras?.priority
  const tags: string[] = lead?.extras?.tags ?? []
  const notes: string = lead?.extras?.notes ?? ''
  const stageColor = lead?.stage?.color ?? 'var(--gray2)'

  return (
    <div
      onClick={(e) => { if (!cardRef.current?.contains(e.target as Node)) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.42)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        animation: 'fadeIn .18s ease both',
      }}
    >
      <div
        ref={cardRef}
        style={{
          background: 'var(--white)',
          borderRadius: 20,
          width: '100%', maxWidth: 520,
          boxShadow: '0 24px 60px rgba(0,0,0,0.22)',
          overflow: 'hidden',
          animation: 'modalSlideUp .22s cubic-bezier(0.34,1.56,0.64,1) both',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '20px 20px 16px',
          borderBottom: '1px solid var(--gray3)',
          background: 'var(--bg)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {isLoading ? sk('70%', 18, 6) : (
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)', lineHeight: 1.25 }}>
                {lead?.name}
              </div>
            )}
            {priority && !isLoading && (
              <span style={{
                display: 'inline-block', marginTop: 6,
                fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: PRIORITY_COLOR[priority],
                background: PRIORITY_COLOR[priority] + '18',
                border: `1px solid ${PRIORITY_COLOR[priority]}40`,
                borderRadius: 100, padding: '2px 8px',
              }}>
                {PRIORITY_LABEL[priority]}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: '50%', border: 'none',
              background: 'var(--gray3)', color: 'var(--gray)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700, flexShrink: 0,
              transition: 'background .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--gray2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--gray3)')}
          >×</button>
        </div>

        {/* Value highlight */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--gray3)', background: 'linear-gradient(135deg, rgba(29,164,98,0.06) 0%, transparent 60%)' }}>
          {isLoading ? sk(120, 32, 8) : (
            <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--green)', letterSpacing: '-0.02em' }}>
              {formatCurrency(lead?.price ?? 0)}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 600, marginTop: 2 }}>Valor do negócio</div>
        </div>

        {/* Info grid */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--gray3)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sk('80%', 13)}{sk('60%', 13)}{sk('70%', 13)}
            </div>
          ) : (
            <>
              <InfoRow label="Responsável" value={lead?.responsibleName ?? '—'} />
              <InfoRow label="Pipeline" value={lead?.pipeline?.name ?? '—'} />
              <InfoRow
                label="Etapa"
                value={lead?.stage?.name ?? '—'}
                dot={stageColor}
              />
              <InfoRow
                label="Criado em"
                value={lead?.createdAt ? new Date(lead.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
              />
              {lead?.updatedAt && (
                <InfoRow
                  label="Atualizado em"
                  value={new Date(lead.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                />
              )}
            </>
          )}
        </div>

        {/* Tags */}
        {!isLoading && tags.length > 0 && (
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray3)' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Tags</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--primary-text)',
                  background: 'var(--primary-dim)', border: '1px solid var(--primary)30',
                  borderRadius: 100, padding: '3px 10px',
                }}>{tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {!isLoading && notes && (
          <div style={{ padding: '14px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Notas</div>
            <p style={{ fontSize: 13, color: 'var(--black)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 96, fontSize: 11, fontWeight: 700, color: 'var(--gray2)', flexShrink: 0 }}>{label}</div>
      {dot && <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{value}</div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('all')
  const { data, isLoading } = useQuery({
    queryKey: ['bi', period],
    queryFn: () => fetch(`/api/bi?period=${period}`).then(r => r.json()),
  })

  const [ready, setReady] = useState(false)
  const [hovLead, setHovLead] = useState<string | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [leadSortCol, setLeadSortCol] = useState<'name' | 'responsibleName' | 'stageName' | 'price'>('price')
  const [leadSortDir, setLeadSortDir] = useState<'asc' | 'desc'>('desc')

  // Funnel filter state
  const [funnelVisible, setFunnelVisible] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null')
      if (Array.isArray(saved) && saved.length > 0) return new Set(saved)
    } catch {}
    return new Set()
  })
  const [showFunnelFilter, setShowFunnelFilter] = useState(false)
  const [funnelFilterPos, setFunnelFilterPos] = useState({ top: 0, right: 0 })
  const funnelFilterBtnRef = useRef<HTMLButtonElement>(null)
  const [funnelFilterBtnHov, setFunnelFilterBtnHov] = useState(false)

  function handleLeadSort(col: typeof leadSortCol) {
    if (leadSortCol === col) setLeadSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setLeadSortCol(col); setLeadSortDir(col === 'price' ? 'desc' : 'asc') }
  }
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: () => fetch('/api/me').then(r => r.json()) })
  const firstName = meData?.user?.name?.split(' ')[0] ?? ''

  useEffect(() => {
    if (!data) return
    setReady(false)
    const t = setTimeout(() => setReady(true), 80)
    return () => clearTimeout(t)
  }, [data])

  useEffect(() => {
    if (funnelVisible.size > 0) {
      try { localStorage.setItem(LS_KEY, JSON.stringify([...funnelVisible])) } catch {}
    }
  }, [funnelVisible])

  if (isLoading) {
    const sk = (w: string | number, h: number, r = 8) => (
      <div className="shimmer-bar" style={{ width: w, height: h, borderRadius: r, background: 'var(--gray3)', flexShrink: 0 }} />
    )
    return (
      <div style={{ animation: 'fadeIn .3s ease both' }}>
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sk(160, 14, 6)}{sk(220, 22, 6)}
          </div>
          {sk(200, 36, 100)}
        </div>
        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sk('60%', 11, 4)}{sk('75%', 28, 6)}{sk(80, 22, 100)}
            </div>
          ))}
        </div>
        {/* funnel */}
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 20, marginBottom: 24 }}>
          {sk(120, 11, 4)}
          <div style={{ marginTop: 16 }}>{sk('100%', 90, 8)}</div>
        </div>
        {/* charts row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          {[0,1].map(i => (
            <div key={i} style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sk(110, 11, 4)}{sk('100%', 160, 8)}
            </div>
          ))}
        </div>
        {/* top leads */}
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 20 }}>
          {sk(130, 11, 4)}
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {sk(32, 32, 100)}{sk('40%', 13, 4)}<div style={{ flex: 1 }} />{sk(70, 13, 4)}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const metrics = data ?? {}
  const changes = metrics.changes ?? {}
  const stages: any[] = metrics.leadsByStage ?? []
  const allStageIds = new Set(stages.map((s: any) => s.stageId))
  const effectiveFunnelVisible = funnelVisible.size === 0 || ![...funnelVisible].some(id => allStageIds.has(id))
    ? allStageIds
    : new Set([...funnelVisible].filter(id => allStageIds.has(id)))
  const statusSlices: any[] = (metrics.leadsByStatus ?? []).map((s: any) => ({
    stageId: s.key, stageName: s.label, color: s.color, count: s.count,
  }))
  const isFiltered = period !== 'all'

  return (
    <div>
      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>
            Seja bem-vindo{firstName ? `, ${firstName}` : ''}! 👋
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 4 }}>
            {isFiltered
              ? `Exibindo dados dos últimos ${period.replace('d', ' dias')}`
              : 'Aqui está o resumo do seu funil de vendas.'}
          </div>
        </div>
        <PeriodFilter value={period} onChange={p => { setPeriod(p); setReady(false) }} />
      </div>

      {/* KPI Cards */}
      <div className="animate-slide-up delay-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 28 }}>
        <SummaryCard
          label={isFiltered ? 'Leads no período' : 'Total de leads'}
          value={metrics.totalLeads ?? 0}
          sub={isFiltered ? `vs ${metrics.totalLeads ?? 0} no período ant.` : 'no pipeline atual'}
          accent="var(--primary)"
          delay={0}
          change={isFiltered ? changes.totalLeads : null}
        />
        <SummaryCard
          label={isFiltered ? 'Fechamentos' : 'Leads esta semana'}
          value={isFiltered ? (metrics.closedLeads ?? 0) : (metrics.leadsThisWeek ?? 0)}
          sub={isFiltered ? 'leads ganhos no período' : 'novos nos últimos 7 dias'}
          accent="var(--primary)"
          delay={60}
          change={isFiltered ? changes.closedLeads : changes.leadsThisWeek}
        />
        <SummaryCard
          label="Taxa de conversão"
          value={metrics.conversionRate ?? 0}
          format={n => `${n}%`}
          sub="leads fechados / total"
          accent="var(--primary)"
          delay={120}
          change={isFiltered ? changes.conversionRate : null}
        />
        <SummaryCard
          label="Ticket médio"
          value={metrics.averageTicket ?? 0}
          format={n => formatCurrency(n)}
          sub="negócios fechados"
          accent="var(--primary)"
          delay={180}
          change={isFiltered ? changes.averageTicket : null}
        />
        <SummaryCard
          label="Lead time médio"
          value={Math.round(metrics.avgLeadTimeDays ?? 0)}
          format={n => n > 0 ? `${n} dias` : '—'}
          sub="criação até fechamento"
          accent="var(--gray2)"
          delay={240}
        />
      </div>

      {/* Horizontal Funnel — full width */}
      {stages.length > 0 && (
        <div className="animate-slide-up delay-3" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: '20px 24px', boxShadow: 'var(--shadow)', marginBottom: 24 }}>
          <SectionTitle dot="var(--primary)" action={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                ref={funnelFilterBtnRef}
                onMouseEnter={() => setFunnelFilterBtnHov(true)}
                onMouseLeave={() => setFunnelFilterBtnHov(false)}
                onClick={() => {
                  if (showFunnelFilter) { setShowFunnelFilter(false); return }
                  const rect = funnelFilterBtnRef.current?.getBoundingClientRect()
                  if (rect) setFunnelFilterPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
                  setShowFunnelFilter(true)
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 10, fontWeight: 700,
                  padding: '3px 9px', borderRadius: 100,
                  border: `1px solid ${funnelFilterBtnHov ? 'var(--gray)' : 'var(--gray3)'}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: funnelFilterBtnHov ? 'var(--gray3)' : 'var(--bg)',
                  color: funnelFilterBtnHov ? 'var(--black)' : 'var(--gray2)',
                  transform: funnelFilterBtnHov ? 'scale(1.05)' : 'scale(1)',
                  boxShadow: funnelFilterBtnHov ? '0 2px 8px rgba(0,0,0,0.10)' : 'none',
                  transition: 'all 0.18s cubic-bezier(0.34,1.4,0.64,1)',
                }}
              >
                ⚙ Filtrar etapas
              </button>
              <AskAIButton question={`Analise meu funil de vendas${isFiltered ? ` (últimos ${period.replace('d', ' dias')})` : ''}. Distribuição por etapa: ${stages.map(s => `${s.stageName}: ${s.count} leads`).join(' → ')}. Total: ${metrics.totalLeads ?? 0} leads, taxa de conversão ${metrics.conversionRate ?? 0}%. Onde estão os principais gargalos e o que posso fazer para melhorar a conversão?`} />
            </div>
          }>Funil por etapa{isFiltered ? ` · ${period.replace('d', ' dias')}` : ''}</SectionTitle>
          <HorizontalFunnel allStages={stages} stages={stages} visible={effectiveFunnelVisible} ready={ready} />
          {showFunnelFilter && (
            <StageFilterPanel
              allStages={stages}
              visible={effectiveFunnelVisible}
              onChange={next => setFunnelVisible(next)}
              onClose={() => setShowFunnelFilter(false)}
              top={funnelFilterPos.top}
              right={funnelFilterPos.right}
            />
          )}
        </div>
      )}

      {/* Charts row */}
      <div className="animate-slide-up delay-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>

        {/* Donut: leads por status */}
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)' }}>
          <SectionTitle dot="var(--primary)" action={<AskAIButton question={`Analise a distribuição de status dos meus leads${isFiltered ? ` (últimos ${period.replace('d', ' dias')})` : ''}. Status: ${statusSlices.map(s => `${s.stageName}: ${s.count} leads`).join(', ')}. Total: ${metrics.totalLeads ?? 0} leads. O que isso indica sobre a saúde do meu pipeline e como posso melhorar?`} />}>Leads por status{isFiltered ? ` · ${period.replace('d', ' dias')}` : ''}</SectionTitle>
          {statusSlices.length === 0
            ? <div style={{ fontSize: 13, color: 'var(--gray2)', textAlign: 'center', padding: '40px 0' }}>Sem dados de pipeline</div>
            : <DonutChart stages={statusSlices} ready={ready} />}
        </div>

        {/* Weekly bars + horizontal stage bars */}
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)' }}>
          <SectionTitle dot="var(--gray2)" action={<AskAIButton question={`Analise minha geração de leads nas últimas 6 semanas. Dados: ${(metrics.leadsPerWeek ?? []).map((w: any) => `${w.week}: ${w.count}`).join(', ')}. Há tendência de crescimento, queda ou sazonalidade? O que eu deveria fazer com base nessa tendência?`} />}>Novos leads por semana</SectionTitle>
          <WeeklyBarChart data={metrics.leadsPerWeek ?? []} ready={ready} />

        </div>
      </div>

      {/* Loss reasons + Rep status — side by side */}
      <div className="animate-slide-up delay-5" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>

        {/* Motivos de perda */}
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)' }}>
          <SectionTitle
            dot={(metrics.lossReasons ?? []).length > 0 ? '#D93025' : 'var(--gray2)'}
            action={
              <AskAIButton question={`Analise os motivos de perda${isFiltered ? ` (últimos ${period.replace('d', ' dias')})` : ''}. Dados: ${(metrics.lossReasons ?? []).map((r: any) => `${r.reason}: ${r.count} leads (${r.percentage}%)`).join(', ')}. Quais ações práticas posso tomar para reduzir cada um desses motivos?`} />
            }
          >
            Motivos de perda{isFiltered ? ` · ${period.replace('d', ' dias')}` : ''}
          </SectionTitle>

          {(metrics.lossReasons ?? []).length > 0 && (() => {
            const totalLost  = (metrics.lossReasons as LossReason[]).reduce((s, r) => s + r.count, 0)
            const totalValue = (metrics.lossReasons as LossReason[]).reduce((s, r) => s + r.value, 0)
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--gray3)' }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--primary-text)', letterSpacing: '-0.02em', lineHeight: 1 }}>{totalLost}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 600, marginTop: 3 }}>leads perdidos</div>
                </div>
                <div style={{ width: 1, height: 36, background: 'var(--gray3)' }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--black)', lineHeight: 1 }}>{formatCurrency(totalValue)}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 600, marginTop: 3 }}>em oportunidades perdidas</div>
                </div>
              </div>
            )
          })()}

          <LossReasonsChart data={metrics.lossReasons ?? []} ready={ready} />
        </div>

        {/* Leads por responsável */}
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)' }}>
          <SectionTitle dot="var(--primary)" action={<AskAIButton question={`Analise a distribuição de leads por responsável${isFiltered ? ` (últimos ${period.replace('d', ' dias')})` : ''}. Dados: ${(metrics.leadsByResponsible ?? []).map((r: any) => `${r.name}: ${r.won} ganhos, ${r.active} em negociação, ${r.lost} perdidos`).join('; ')}. Quem está performando melhor? Quais ações posso tomar para melhorar os resultados da equipe?`} />}>
            Leads por responsável{isFiltered ? ` · ${period.replace('d', ' dias')}` : ''}
          </SectionTitle>
          <RepStatusChart data={metrics.leadsByResponsible ?? []} ready={ready} />
        </div>

      </div>

      {/* Top leads */}
      <div className="animate-slide-up delay-5">
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray3)', background: 'var(--bg)' }}>
            <SectionTitle action={<AskAIButton question={`Analise minhas maiores oportunidades${isFiltered ? ` (últimos ${period.replace('d', ' dias')})` : ''}. Top leads: ${(metrics.topLeads ?? []).map((l: any) => `${l.name} — ${formatCurrency(l.price)} (${l.stageName})`).join('; ')}. Quais estratégias você recomenda para fechar esses negócios? Há algum padrão ou prioridade que devo considerar?`} />}>Maiores oportunidades{isFiltered ? ` · ${period.replace('d', ' dias')}` : ''}</SectionTitle>
          </div>
          {(metrics.topLeads ?? []).length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>Nenhum lead no período selecionado</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {([
                    { label: 'Oportunidade', col: 'name'            },
                    { label: 'Responsável',  col: 'responsibleName' },
                    { label: 'Etapa',        col: 'stageName'       },
                    { label: 'Valor',        col: 'price'           },
                  ] as { label: string; col: typeof leadSortCol }[]).map(({ label, col }) => (
                    <th
                      key={col}
                      onClick={() => handleLeadSort(col)}
                      style={{
                        padding: '9px 20px', textAlign: col === 'price' ? 'right' : 'left',
                        fontSize: 10, fontWeight: 800,
                        color: leadSortCol === col ? 'var(--primary-text)' : 'var(--gray2)',
                        textTransform: 'uppercase', letterSpacing: '0.07em',
                        borderBottom: '1px solid var(--gray3)',
                        cursor: 'pointer', userSelect: 'none', transition: 'color .15s',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexDirection: col === 'price' ? 'row-reverse' : 'row' }}>
                        {label}
                        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1, opacity: leadSortCol === col ? 1 : 0.3, transition: 'opacity .15s' }}>
                          <span style={{ fontSize: 7, lineHeight: 1, color: leadSortCol === col && leadSortDir === 'asc' ? 'var(--primary-text)' : 'currentColor' }}>▲</span>
                          <span style={{ fontSize: 7, lineHeight: 1, color: leadSortCol === col && leadSortDir === 'desc' ? 'var(--primary-text)' : 'currentColor' }}>▼</span>
                        </span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...(metrics.topLeads ?? [])].sort((a: any, b: any) => {
                  const av = a[leadSortCol], bv = b[leadSortCol]
                  const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'pt-BR')
                  return leadSortDir === 'asc' ? cmp : -cmp
                }).map((lead: any, i: number) => {
                  const isHov = hovLead === lead.id
                  return (
                    <tr
                      key={lead.id}
                      onMouseEnter={() => setHovLead(lead.id)}
                      onMouseLeave={() => setHovLead(null)}
                      onClick={() => setSelectedLeadId(lead.id)}
                      style={{
                        borderBottom: '1px solid var(--gray3)',
                        borderLeft: `3px solid ${isHov ? 'var(--primary)' : 'transparent'}`,
                        background: isHov ? 'var(--primary-dim)' : 'transparent',
                        transition: 'all .18s ease', cursor: 'pointer',
                        animation: 'ai-step 0.3s ease both', animationDelay: `${i * 40}ms`,
                      }}
                    >
                      <td style={{ padding: '13px 20px', fontSize: 13, fontWeight: 700, color: 'var(--black)', maxWidth: 260 }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.name}</div>
                      </td>
                      <td style={{ padding: '13px 20px', fontSize: 12, color: 'var(--gray)', fontWeight: 500 }}>{lead.responsibleName}</td>
                      <td style={{ padding: '13px 20px', fontSize: 12, color: 'var(--gray)', fontWeight: 500 }}>{lead.stageName}</td>
                      <td style={{ padding: '13px 20px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                          {isHov && <span style={{ fontSize: 11, color: 'var(--primary-text)', fontWeight: 700, animation: 'ai-step 0.15s ease both' }}>+ Analisar</span>}
                          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--green)', flexShrink: 0 }}>{formatCurrency(lead.price)}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedLeadId && (
        <LeadModal leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
      )}
    </div>
  )
}
