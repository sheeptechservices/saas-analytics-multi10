'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FunnelStage {
  id: string
  name: string
  color: string
  count: number
  avgDays?: number | null
}

// ─── FunnelFilterPanel ───────────────────────────────────────────────────────

export interface FunnelFilterPanelProps {
  allStages: FunnelStage[]
  visible: Set<string>
  onChange: (next: Set<string>) => void
  onClose: () => void
  top: number
  right: number
}

export function FunnelFilterPanel({
  allStages, visible, onChange, onClose, top, right,
}: FunnelFilterPanelProps) {
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

  return createPortal(
    <div ref={panelRef} style={{
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
          <button onClick={() => onChange(new Set(allStages.map(s => s.id)))}
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary-text)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Todas
          </button>
          <span style={{ color: 'var(--gray3)' }}>·</span>
          <button onClick={() => { const first = allStages[0]; if (first) onChange(new Set([first.id])) }}
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Limpar
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
        {allStages.map(s => {
          const active = visible.has(s.id)
          return (
            <button key={s.id} onClick={() => toggle(s.id)} style={{
              padding: '5px 11px', borderRadius: 99, fontSize: 11, fontWeight: 600,
              background: active ? `${s.color}18` : 'var(--bg)',
              border: `1.5px solid ${active ? s.color : 'var(--gray3)'}`,
              color: active ? s.color : 'var(--gray2)',
              cursor: 'pointer', transition: 'all .15s ease',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? s.color : 'var(--gray3)', flexShrink: 0, transition: 'background .15s' }} />
              {s.name}
              <span style={{ fontSize: 10, opacity: 0.7 }}>{s.count}</span>
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: 'var(--gray2)', fontWeight: 500 }}>
        {visible.size} de {allStages.length} etapas visíveis · ordenação padrão do Kommo
      </div>
    </div>,
    document.body
  )
}

// ─── FunnelChart (HorizontalFunnel) ──────────────────────────────────────────

const MIN_SEG_PX    = 72
const MIN_METRIC_PX = 160

export interface FunnelChartProps {
  allStages: FunnelStage[]
  stages: FunnelStage[]
  visible: Set<string>
  ready: boolean
  /** Singular unit shown in the tooltip (e.g. 'lead'). Pluralised automatically. */
  unit?: string
}

export function FunnelChart({ allStages, stages, visible, ready, unit = 'lead' }: FunnelChartProps) {
  const [hov, setHov] = useState<number | null>(null)

  const filteredStages = stages.filter(s => visible.has(s.id))
  if (!filteredStages.length) return null

  const N = filteredStages.length
  const H = 100
  const W = 1000
  const SEG_W = W / N
  const maxCount = Math.max(...filteredStages.map(s => s.count), 1)

  const segs = filteredStages.map((stage, i) => {
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
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 600 }}>
          {N} etapa{N !== 1 ? 's' : ''} exibida{N !== 1 ? 's' : ''}
          {hiddenCount > 0 && <span style={{ marginLeft: 6, color: '#7A5600', fontWeight: 700 }}>+{hiddenCount} oculta{hiddenCount !== 1 ? 's' : ''}</span>}
        </div>
      </div>

      <div style={{ overflowX: 'auto', overflowY: 'visible', marginLeft: -4, marginRight: -4, paddingBottom: 8 }}>
        <div style={{ minWidth: Math.max(400, N * MIN_METRIC_PX), paddingLeft: 4, paddingRight: 4 }}>

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
                  <linearGradient key={seg.id} id={`hf-${seg.id}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={seg.color} stopOpacity="0.92" />
                    <stop offset="100%" stopColor={seg.color} stopOpacity="0.70" />
                  </linearGradient>
                ))}
              </defs>
              {segs.map((seg, i) => {
                const gap = i > 0 ? 2 : 0
                return (
                  <polygon
                    key={seg.id}
                    points={`${seg.x + gap},${seg.lt} ${seg.x + SEG_W},${seg.rt} ${seg.x + SEG_W},${seg.rb} ${seg.x + gap},${seg.lb}`}
                    fill={`url(#hf-${seg.id})`}
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
                <div style={{ fontWeight: 700, marginBottom: 1, opacity: 0.7, fontSize: 10 }}>{segs[hov].name}</div>
                <div>{segs[hov].count} {unit}{segs[hov].count !== 1 ? 's' : ''}</div>
                {segs[hov].avgDays != null && (
                  <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.75, marginTop: 2 }}>
                    ⏱ {segs[hov].avgDays} dias médios
                  </div>
                )}
              </div>
            )}
          </div>

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
                  key={seg.id}
                  style={{
                    flex: 1, minWidth: MIN_METRIC_PX,
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '0 8px 0 4px',
                  }}
                  onMouseEnter={() => setHov(i)}
                  onMouseLeave={() => setHov(null)}
                >
                  <div title={seg.name} style={{
                    fontSize: 10, fontWeight: isHov ? 700 : 500,
                    color: isHov ? seg.color : 'var(--gray)',
                    transition: 'color 0.15s',
                    width: '100%', textAlign: 'center',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {seg.name}
                  </div>

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

                  {seg.avgDays != null && (
                    <div style={{
                      fontSize: 9, fontWeight: 600,
                      color: isHov ? 'var(--gray)' : 'var(--gray2)',
                      transition: 'color 0.15s',
                      marginTop: 1,
                      textAlign: 'center',
                    }}>
                      ⏱ {seg.avgDays}d
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

export default FunnelChart
