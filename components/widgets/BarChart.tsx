'use client'
import { useState } from 'react'
import type { CSSProperties } from 'react'

/* Gráfico de barras verticais, série única ou múltipla.

   Multi-série (prop `series`): cada ponto vira um grupo com uma barra por
   série, lado a lado, todas na MESMA escala Y — é o que torna "enviadas" e
   "recebidas" honestamente comparáveis num gráfico só (antes eram dois
   gráficos com maxValue compartilhado à mão).

   Série única (legado): `data[i].count`, pintada em tinta.

   Janela (prop `slots`): o eixo X tem `slots` posições e cada ponto ocupa
   uma, ancorado à direita (o mais recente na borda). Assim, com 1 dia num
   gráfico de 30, a barra tem a mesma largura fina de sempre em vez de
   esticar até ocupar o gráfico todo. Sem `slots`, os pontos preenchem a
   largura (comportamento antigo). Geometria em .bar-chart no globals.css.

   Cores só por token/variável CSS. A altura cresce na entrada quando `ready`
   vira true (.bar-grow-y no globals.css, que respeita prefers-reduced-motion). */

export interface BarChartItem {
  label: string
  /** Valor da série única (modo legado, sem `series`). */
  count?: number
  /** Valores por série, indexados por BarChartSeries.key (modo multi-série). */
  values?: Record<string, number>
}

export interface BarChartSeries {
  key: string
  label: string
  /** Cor CSS da série (ex.: 'var(--ink)'). */
  color: string
}

export interface BarChartProps {
  data: BarChartItem[]
  ready: boolean
  /** Unidade no singular para o tooltip da série única (ex.: 'lead'). Pluralizada automaticamente. */
  unit?: string
  /** Máximo da escala Y. Padrão: o maior valor entre todas as séries. */
  maxValue?: number
  /** Séries plotadas lado a lado com escala compartilhada. Sem ela, série única via `count`. */
  series?: BarChartSeries[]
  /** Título pequeno à esquerda do cabeçalho; a legenda (multi-série) vai à direita. */
  title?: string
  /** Altura da área de plotagem em px. Padrão 88. */
  height?: number
  /** Rótulos do eixo X: 'ends' = primeiro, meio e último; 'all' = um por barra. */
  axis?: 'ends' | 'all'
  /** Posições do eixo X (a janela, ex.: 30 dias). Com menos pontos, cada barra
   *  mantém a largura de uma posição e o conjunto fica à direita. Padrão:
   *  `data.length` — as barras ocupam toda a largura. */
  slots?: number
}

const SINGLE: BarChartSeries[] = [{ key: 'count', label: '', color: 'var(--ink)' }]
const nf = new Intl.NumberFormat('pt-BR')

function axisIndexes(n: number, mode: 'ends' | 'all'): number[] {
  if (n === 0) return []
  if (mode === 'all') return Array.from({ length: n }, (_, i) => i)
  return Array.from(new Set([0, Math.floor((n - 1) / 2), n - 1]))
}

export function BarChart({
  data, ready, unit = 'item', maxValue, series, title, height = 88, axis = 'ends', slots,
}: BarChartProps) {
  const [hov, setHov] = useState<number | null>(null)
  const multi = !!series && series.length > 0
  const activeSeries = multi ? series! : SINGLE

  // Posições do eixo: nunca menos que os pontos (mais pontos que a janela = preenche).
  const n = data.length
  const totalSlots = Math.max(slots ?? n, n, 1)
  const geometry = { '--bar-slots': totalSlots, '--bar-n': Math.max(n, 1) } as CSSProperties

  const valueOf = (d: BarChartItem, key: string): number =>
    multi ? (d.values?.[key] ?? 0) : (d.count ?? 0)

  const maxCount = Math.max(
    maxValue ?? 0,
    ...data.flatMap(d => activeSeries.map(s => valueOf(d, s.key))),
    1,
  )

  const axisIdx = axisIndexes(n, axis)
  const singleFill = n === 1 && totalSlots === 1
  const axisPos = (i: number): 'first' | 'mid' | 'last' | undefined =>
    axis !== 'ends' || singleFill ? undefined : i === n - 1 ? 'last' : i === 0 ? 'first' : 'mid'
  const first = data[0]?.label
  const last = data[data.length - 1]?.label
  const ariaLabel = [
    title,
    multi ? activeSeries.map(s => s.label).join(' e ') : null,
    data.length > 0 ? `${data.length} ponto${data.length !== 1 ? 's' : ''}${first && last && first !== last ? `, de ${first} a ${last}` : ''}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="bar-chart" style={geometry}>
      {(title || multi) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          {title && (
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--ink-2)' }}>{title}</div>
          )}
          {multi && (
            <div aria-hidden style={{ display: 'flex', gap: 12, fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--muted)' }}>
              {activeSeries.map(s => (
                <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bar-plot" data-ready={ready} data-fill={n >= totalSlots} role="img" aria-label={ariaLabel} style={{ height }}>
        {data.map((d, i) => {
          const isHov = hov === i
          const total = activeSeries.reduce((sum, s) => sum + valueOf(d, s.key), 0)
          // Tooltip preso à borda nas primeiras/últimas posições do eixo, para não
          // vazar do cartão. A posição conta a janela: com as barras à direita,
          // o 1º ponto de uma série curta não está na borda esquerda.
          const slot = totalSlots - n + i
          const edge = slot < 3 ? 'start' : i > n - 4 ? 'end' : 'center'
          const tipPos: CSSProperties = edge === 'start'
            ? { left: 0 }
            : edge === 'end'
              ? { right: 0 }
              : { left: '50%', transform: 'translateX(-50%)' }
          return (
            <div
              key={`${d.label}-${i}`}
              className="bar-group"
              onMouseEnter={() => setHov(i)}
              onMouseLeave={() => setHov(null)}
            >
              {isHov && total > 0 && (
                <div className="chart-tooltip" style={tipPos}>
                  <div style={{ color: 'var(--gray2)', fontSize: 'var(--text-2xs)' }}>{d.label}</div>
                  {multi ? activeSeries.map(s => (
                    <div key={s.key} className="tabular-nums" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, boxShadow: '0 0 0 1px var(--inverse-text-3)' }} />
                      {s.label}: {nf.format(valueOf(d, s.key))}
                    </div>
                  )) : (
                    <div className="tabular-nums" style={{ fontWeight: 800 }}>
                      {nf.format(total)} {unit}{total !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              )}
              {activeSeries.map(s => {
                const v = valueOf(d, s.key)
                const growTo = v > 0 ? `max(2px, ${((v / maxCount) * 100).toFixed(2)}%)` : '0px'
                return (
                  <span
                    key={s.key}
                    className="bar-col bar-grow-y"
                    style={{ background: s.color, '--grow-to': growTo } as CSSProperties}
                  />
                )
              })}
            </div>
          )
        })}
      </div>

      {axisIdx.length > 0 && (
        // .bar-axis tem a largura das barras desenhadas e, no modo 'ends', põe
        // os rótulos pelas margens de `data-pos` (a container query esconde os
        // que colidiriam — globals.css). Exceção: uma barra ocupando o gráfico
        // todo (sem janela) mantém o rótulo centrado, como antes.
        <div aria-hidden className="bar-axis font-mono tabular-nums" style={{
          justifyContent: singleFill ? 'center' : axis === 'all' && axisIdx.length > 1 ? 'space-between' : 'flex-end',
          marginTop: 7, fontSize: 'var(--text-2xs)', color: 'var(--muted)',
        }}>
          {axisIdx.map(i => (
            <span key={i} data-pos={axisPos(i)}>{data[i].label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export default BarChart
