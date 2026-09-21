/* Barra empilhada horizontal + legenda com valores.

   Substitui o DonutChart no dashboard: lê melhor em coluna estreita, não
   precisa de SVG e mostra o número ao lado da cor. Cada segmento tem
   `flex` = valor; 2px de respiro entre eles; raio pill no conjunto.
   Cores chegam prontas (token CSS ou cor vinda da API) — este componente
   não escolhe cor nenhuma. */

export interface StackedBarSegment {
  id: string
  label: string
  value: number
  /** Cor CSS do segmento (ex.: 'var(--success)'). */
  color: string
}

interface StackedBarProps {
  segments: StackedBarSegment[]
  /** Altura em px. Padrão 10. */
  height?: number
  /** Nome acessível; por padrão, a lista "rótulo: valor". */
  label?: string
  className?: string
}

const nf = new Intl.NumberFormat('pt-BR')

export function StackedBar({ segments, height = 10, label, className }: StackedBarProps) {
  const visible = segments.filter(s => s.value > 0)
  const ariaLabel = label ?? segments.map(s => `${s.label}: ${nf.format(s.value)}`).join(', ')
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={['stacked-bar', className].filter(Boolean).join(' ')}
      style={{ height }}
    >
      {visible.map(s => (
        <span key={s.id} style={{ flex: s.value, background: s.color }} />
      ))}
    </div>
  )
}

interface StackedBarLegendProps {
  segments: StackedBarSegment[]
}

/** Legenda em lista: quadrado 8×8, rótulo, valor e percentual do total. */
export function StackedBarLegend({ segments }: StackedBarLegendProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  return (
    <ul style={{ display: 'flex', flexDirection: 'column', gap: 9, listStyle: 'none' }}>
      {segments.map(s => (
        <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--ink-2)' }}>
            {s.label}
          </span>
          <span className="tabular-nums" style={{ fontSize: 'var(--text-sm)', fontWeight: 800, color: 'var(--ink)' }}>
            {nf.format(s.value)}
          </span>
          <span className="tabular-nums" style={{ width: 34, textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
            {total > 0 ? `${Math.round((s.value / total) * 100)}%` : '—'}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default StackedBar
