'use client'
import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Chip, ChipGroup } from '@/components/ui/Chip'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FunnelStage {
  id: string
  name: string
  count: number
  /** Legado: cor por etapa. O funil em escala de tinta não usa mais cor por
      etapa (as 6 cores antigas não tinham significado); mantido opcional só
      para não quebrar quem ainda passa. */
  color?: string
  avgDays?: number | null
  /** Como esta etapa é citada na taxa da etapa seguinte — "dos leads",
      "das respostas". Sem ele, cai em "de <nome da etapa>". */
  ratioLabel?: string
}

const nf = new Intl.NumberFormat('pt-BR')

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
    const t = setTimeout(() => { document.addEventListener('mousedown', h); window.addEventListener('keydown', k) }, 10)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k) }
  }, [onClose])

  // O painel vive num portal no fim do <body>: sem levar o foco até ele, quem
  // navega por teclado nunca o alcançaria pelo Tab.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('.chip')?.focus()
  }, [])

  const toggle = (id: string) => {
    const next = new Set(visible)
    if (next.has(id)) { if (next.size > 1) next.delete(id) } else next.add(id)
    onChange(next)
  }

  const textBtn: CSSProperties = {
    fontFamily: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 700,
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
  }

  return createPortal(
    // On phones the panel sits 16px from the right edge and never exceeds the screen width
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Etapas visíveis"
      className="max-w-[calc(100vw-32px)] max-md:right-4!"
      style={{
        position: 'fixed',
        top,
        right,
        zIndex: 9999,
        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-menu)', padding: 16,
        width: 360,
        animation: 'fadeIn .15s ease both',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 800, color: 'var(--ink)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Etapas visíveis
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => onChange(new Set(allStages.map(s => s.id)))}
            style={{ ...textBtn, color: 'var(--primary-text)' }}>
            Todas
          </button>
          <span aria-hidden style={{ color: 'var(--line)' }}>·</span>
          <button type="button" onClick={() => { const first = allStages[0]; if (first) onChange(new Set([first.id])) }}
            style={{ ...textBtn, color: 'var(--muted)' }}>
            Limpar
          </button>
        </div>
      </div>
      <ChipGroup label="Etapas do funil" style={{ maxHeight: 240, overflowY: 'auto' }}>
        {allStages.map(s => (
          <Chip key={s.id} active={visible.has(s.id)} onClick={() => toggle(s.id)}>
            {s.name}
            <span className="tabular-nums" style={{ fontSize: 'var(--text-2xs)', opacity: 0.7 }}>{nf.format(s.count)}</span>
          </Chip>
        ))}
      </ChipGroup>
      <div style={{ marginTop: 10, fontSize: 'var(--text-2xs)', color: 'var(--muted)', fontWeight: 500 }}>
        {visible.size} de {allStages.length} etapas visíveis · ordenação padrão do funil
      </div>
    </div>,
    document.body
  )
}

// ─── FunnelChart ─────────────────────────────────────────────────────────────
//
// Uma linha por etapa (nome · barra · contagem) e, abaixo de cada etapa a
// partir da segunda, a taxa sobre a etapa anterior visível ("38% dos
// contatados") — a conversão é a pergunta real, não só a contagem.
// Barra em tinta com opacidade decrescente (1 − i × 0,11), no lugar das cores
// por etapa. A largura cresce na entrada quando `ready` vira true (CSS
// .bar-grow-x, que respeita prefers-reduced-motion).

export interface FunnelChartProps {
  allStages: FunnelStage[]
  stages: FunnelStage[]
  visible: Set<string>
  ready: boolean
  /** Unidade no singular, para o texto acessível da contagem (ex.: 'lead'). */
  unit?: string
}

/** Piso de opacidade: um funil pode ter muito mais que 6 etapas. */
const MIN_OPACITY = 0.25

export function FunnelChart({ allStages, stages, visible, ready, unit = 'lead' }: FunnelChartProps) {
  const filteredStages = stages.filter(s => visible.has(s.id))

  if (!filteredStages.length) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 120, fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--muted)', textAlign: 'center',
      }}>
        Sem dados de funil no período
      </div>
    )
  }

  const maxCount = Math.max(...filteredStages.map(s => s.count), 1)
  const hiddenCount = allStages.filter(s => !visible.has(s.id)).length

  return (
    <div data-ready={ready}>
      <ol className="funnel-list">
        {filteredStages.map((stage, i) => {
          const prev = i > 0 ? filteredStages[i - 1] : null
          const pct = (stage.count / maxCount) * 100
          const growTo = stage.count > 0 ? `max(2px, ${pct.toFixed(2)}%)` : '0px'
          // Divisão por zero: sem base na etapa anterior, não há taxa a mostrar.
          const rate = prev && prev.count > 0 ? Math.round((stage.count / prev.count) * 100) : null
          const opacity = Math.max(1 - i * 0.11, MIN_OPACITY)
          return (
            <li key={stage.id}>
              <div className="funnel-row" style={{ padding: '5px 0' }}>
                <span title={stage.name} style={{
                  fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--ink-2)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {stage.name}
                </span>
                <div className="funnel-track" aria-hidden>
                  <div
                    className="funnel-bar bar-grow-x"
                    style={{ '--grow-to': growTo, opacity } as CSSProperties}
                  />
                </div>
                <span className="tabular-nums" style={{
                  textAlign: 'right', fontSize: 'var(--text-md)', fontWeight: 800, color: 'var(--ink)',
                }}>
                  {nf.format(stage.count)}
                  <span className="sr-only"> {stage.count === 1 ? unit : `${unit}s`}</span>
                </span>
              </div>
              {prev && rate !== null && (
                <div className="funnel-row">
                  <span style={{
                    gridColumn: 2, paddingLeft: 2,
                    fontSize: 'var(--text-2xs)', fontWeight: 700, letterSpacing: '0.02em', color: 'var(--muted)',
                  }}>
                    {rate}% {prev.ratioLabel ?? `de ${prev.name.toLocaleLowerCase('pt-BR')}`}
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {hiddenCount > 0 && (
        <div style={{ marginTop: 12, fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--muted)' }}>
          {hiddenCount} etapa{hiddenCount !== 1 ? 's' : ''} oculta{hiddenCount !== 1 ? 's' : ''} — ajuste em Etapas
        </div>
      )}
    </div>
  )
}

export default FunnelChart
