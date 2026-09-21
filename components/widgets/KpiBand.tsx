import type { CSSProperties } from 'react'

/* Faixa de KPIs do dashboard Visão geral.

   Um objeto só, não N cartões: o container pinta a hairline (.kpi-band no
   globals.css) e cada célula cobre com a superfície. A primeira célula é a
   herói (o número-síntese da tela, 44px); as demais são secundárias (27px).

   Componente próprio, e não variante do KpiCard, de propósito: aqui não há
   count-up, hover-lift nem faixa colorida à esquerda. O KpiCard continua
   existindo para as telas que ainda o usam. */

export type KpiTrend = 'up' | 'down' | 'flat'

export interface KpiDelta {
  /** Variação contra o período anterior, já na unidade (14 = 14% ou 14 pp). */
  value: number
  unit: '%' | 'pp'
  /** Sentido da variação; quando ausente, deriva do sinal de `value`. */
  trend?: KpiTrend
}

export interface KpiBandItem {
  id: string
  label: string
  /** Valor já formatado (pt-BR). */
  value: string
  /** Linha de apoio. Omitida quando nula — nunca preencher com texto fixo. */
  sub?: string | null
  /** Variação vs. período anterior. Omitida quando nula (sem base de comparação). */
  delta?: KpiDelta | null
}

export interface KpiBandProps {
  hero: KpiBandItem
  items: KpiBandItem[]
  className?: string
}

// ─── Formatação ──────────────────────────────────────────────────────────────

const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/** "+14%", "−2,1 pp", "0 pp" — com o sinal de menos tipográfico (U+2212). */
export function formatDelta(delta: KpiDelta): string {
  const sign = delta.value > 0 ? '+' : delta.value < 0 ? '−' : ''
  const unit = delta.unit === 'pp' ? ' pp' : '%'
  return `${sign}${nf1.format(Math.abs(delta.value))}${unit}`
}

function deltaTrend(delta: KpiDelta): KpiTrend {
  if (delta.trend) return delta.trend
  return delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : 'flat'
}

const trendColor: Record<KpiTrend, string> = {
  up:   'var(--success)',
  down: 'var(--danger)',
  flat: 'var(--muted)',
}

// ─── KpiBand ─────────────────────────────────────────────────────────────────

export function KpiBand({ hero, items, className }: KpiBandProps) {
  return (
    <dl
      className={['kpi-band', className].filter(Boolean).join(' ')}
      style={{ '--kpi-count': Math.max(items.length, 1) } as CSSProperties}
    >
      <HeroCell item={hero} />
      {items.map(item => <Cell key={item.id} item={item} />)}
    </dl>
  )
}

function HeroCell({ item }: { item: KpiBandItem }) {
  return (
    <div className="kpi-band-cell kpi-band-cell--hero">
      <dt className="label-data">{item.label}</dt>
      <dd style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', columnGap: 10, rowGap: 4 }}>
        <span className="tabular-nums" style={{
          fontSize: 44, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1,
          color: 'var(--ink)',
        }}>
          {item.value}
        </span>
        {item.delta && (
          <span className="tabular-nums" style={{
            fontSize: 'var(--text-sm)', fontWeight: 700, paddingBottom: 6,
            color: trendColor[deltaTrend(item.delta)],
          }}>
            {formatDelta(item.delta)}
          </span>
        )}
      </dd>
      {item.sub && (
        <dd style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--muted)' }}>
          {item.sub}
        </dd>
      )}
    </div>
  )
}

function Cell({ item }: { item: KpiBandItem }) {
  return (
    <div className="kpi-band-cell">
      <dt className="label-data">{item.label}</dt>
      <dd className="tabular-nums" style={{
        fontSize: 27, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1,
        color: 'var(--ink)',
      }}>
        {item.value}
      </dd>
      {item.sub && (
        <dd style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--muted)' }}>
          {item.sub}
        </dd>
      )}
      {item.delta && (
        // margin-top:auto alinha as variações pela base mesmo quando uma
        // célula não tem linha de apoio (as células esticam à mesma altura).
        <dd className="tabular-nums" style={{
          marginTop: 'auto',
          fontSize: 'var(--text-xs)', fontWeight: 700,
          color: trendColor[deltaTrend(item.delta)],
        }}>
          {formatDelta(item.delta)} vs. anterior
        </dd>
      )}
    </div>
  )
}

export default KpiBand
