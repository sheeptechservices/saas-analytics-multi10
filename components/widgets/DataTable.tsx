'use client'
import { useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DataTableColumn {
  key: string
  label: string
  /** Defaults to 'left'. */
  align?: 'left' | 'right'
  /** Ênfase visual do valor. 'positive' era implícito em align:'right'. */
  tone?: 'default' | 'positive' | 'negative' | 'muted'
  /** Peso 800 no valor. Era implícito em align:'right'. */
  strong?: boolean
  format?: (value: unknown) => React.ReactNode
  sortable?: boolean
  /** Largura fixa da coluna (px ou valor CSS). Quando alguma coluna define
      largura, a tabela passa a table-layout: fixed e as colunas sem largura
      dividem o restante — o que permite reticências na coluna fluida. */
  width?: number | string
}

export interface DataTableProps {
  columns: DataTableColumn[]
  rows: Record<string, unknown>[]
  defaultSortKey?: string
  defaultSortDir?: 'asc' | 'desc'
  onRowClick?: (row: Record<string, unknown>) => void
  emptyMessage?: string
  maxHeight?: number
  /** Mobile rendering strategy. Defaults to 'cards'. Only affects < 768px. */
  mobileMode?: 'cards' | 'scroll'
  /** Column key whose value uniquely identifies a row. Used to stabilise animation keys so re-sort doesn't re-trigger the cascade. */
  rowKey?: string
  /** 'default' = visual atual (cabeçalho --bg, hover com faixa da marca).
      'plain' = tabela dentro de um painel plano (dashboard Visão geral):
      cabeçalho --surface-2, divisórias --line-2, hover neutro sem faixa,
      calha de 12px entre colunas e 20px nas bordas; no mobile, linhas planas
      em vez de cartões com sombra. */
  variant?: 'default' | 'plain'
}

// ─── DataTable ────────────────────────────────────────────────────────────────

const toneColor: Record<string, string> = {
  default:  'var(--ink)',
  positive: 'var(--success-text)',
  negative: 'var(--danger-text)',
  muted:    'var(--muted)',
}

/** Largura mínima reservada a cada coluna fluida quando há colunas fixas. */
const FLUID_MIN_PX = 160

function cellPadding(variant: 'default' | 'plain', index: number, count: number, vertical: number): string {
  if (variant !== 'plain') return `${vertical}px 20px`
  const left  = index === 0 ? 20 : 6
  const right = index === count - 1 ? 20 : 6
  return `${vertical}px ${right}px ${vertical}px ${left}px`
}

/** Enter/Espaço acionam a linha clicável, como um botão. */
function rowKeyHandler(row: Record<string, unknown>, onClick?: (row: Record<string, unknown>) => void) {
  if (!onClick) return undefined
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick(row)
    }
  }
}

export function DataTable({
  columns,
  rows,
  defaultSortKey,
  defaultSortDir = 'desc',
  onRowClick,
  emptyMessage = 'Nenhum dado disponível',
  maxHeight,
  mobileMode = 'cards',
  rowKey,
  variant = 'default',
}: DataTableProps) {
  const [sortCol, setSortCol] = useState<string>(defaultSortKey ?? columns[0]?.key ?? '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir)
  const isMobile = useIsMobile()
  const plain = variant === 'plain'
  const headerBg = plain ? 'var(--surface-2)' : 'var(--bg)'

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else {
      setSortCol(col)
      setSortDir(defaultSortDir)
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortCol]
    const bv = b[sortCol]
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av ?? '').localeCompare(String(bv ?? ''), 'pt-BR')
    return sortDir === 'asc' ? cmp : -cmp
  })

  // ── Larguras fixas (opcional) ─────────────────────────────────────────────

  const hasWidths = columns.some(c => c.width != null)
  const fixedPx = columns.reduce((sum, c) => sum + (typeof c.width === 'number' ? c.width : 0), 0)
  const fluidCount = columns.filter(c => c.width == null).length
  const tableStyle: CSSProperties = hasWidths
    ? { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: fixedPx + fluidCount * FLUID_MIN_PX }
    : { width: '100%', borderCollapse: 'collapse' }
  const colgroup = hasWidths ? (
    <colgroup>
      {columns.map(col => <col key={col.key} style={col.width != null ? { width: col.width } : undefined} />)}
    </colgroup>
  ) : null

  // ── Shared table JSX (desktop + scroll-mode mobile) ───────────────────────

  const thead = (
    <thead>
      <tr style={{ background: headerBg }}>
        {columns.map((col, i) => {
          const active = sortCol === col.key
          const align = col.align ?? 'left'
          return (
            <th
              key={col.key}
              className="label-data"
              onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
              aria-sort={col.sortable !== false && active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
              style={{
                padding: cellPadding(variant, i, columns.length, plain ? 10 : 9),
                textAlign: align,
                color: active ? 'var(--primary-text)' : undefined,
                borderBottom: '1px solid var(--gray3)',
                cursor: col.sortable !== false ? 'pointer' : 'default',
                userSelect: 'none', transition: 'color .15s',
                whiteSpace: 'nowrap',
                ...(hasWidths ? { overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
                ...(maxHeight ? { position: 'sticky', top: 0, background: headerBg, zIndex: 1 } : {}),
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
                {col.label}
                {col.sortable !== false && (
                  <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 0, opacity: active ? 1 : 0.3, transition: 'opacity .15s' }}>
                    <ChevronUp size={9} style={{ display: 'block', color: active && sortDir === 'asc' ? 'var(--primary-text)' : 'currentColor' }} />
                    <ChevronDown size={9} style={{ display: 'block', color: active && sortDir === 'desc' ? 'var(--primary-text)' : 'currentColor' }} />
                  </span>
                )}
              </span>
            </th>
          )
        })}
      </tr>
    </thead>
  )

  const tbody = (
    <tbody>
      {sorted.length === 0 ? (
        <tr>
          <td colSpan={columns.length} style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
            {emptyMessage}
          </td>
        </tr>
      ) : (
        sorted.map((row, i) => (
          <DataTableRow
            key={rowKey ? String(row[rowKey]) : i}
            row={row}
            columns={columns}
            index={i}
            isLast={i === sorted.length - 1}
            onClick={onRowClick}
            variant={variant}
          />
        ))
      )}
    </tbody>
  )

  const table = (
    <table style={tableStyle}>
      {colgroup}
      {thead}
      {tbody}
    </table>
  )

  // ── Mobile: cards ─────────────────────────────────────────────────────────

  if (isMobile && mobileMode === 'cards') {
    const sortableCols = columns.filter(c => c.sortable !== false)
    const firstCol = columns[0]
    const restCols = columns.slice(1)

    return (
      <div>
        {/* Sort chips */}
        {sortableCols.length > 0 && (
          <div style={{
            display: 'flex', gap: 6, overflowX: 'auto',
            ...(plain
              ? { padding: '12px 16px 10px' }
              : { paddingBottom: 8, marginBottom: 12 }),
          }}>
            {sortableCols.map(col => {
              const active = sortCol === col.key
              return (
                <button
                  key={col.key}
                  type="button"
                  className="touch-target"
                  aria-pressed={active}
                  onClick={() => handleSort(col.key)}
                  style={{
                    flexShrink: 0, padding: '5px 10px', borderRadius: 100,
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    whiteSpace: 'nowrap', transition: 'all .15s',
                    border: `1px solid ${active ? 'var(--primary)' : 'var(--gray3)'}`,
                    background: active ? 'var(--primary-dim)' : 'var(--white)',
                    color: active ? 'var(--primary-text)' : 'var(--gray)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    fontFamily: 'inherit',
                  }}
                >
                  {col.label}
                  {active && (sortDir === 'asc' ? <ChevronUp size={9} /> : <ChevronDown size={9} />)}
                </button>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {sorted.length === 0 ? (
          <div style={{ padding: plain ? '32px 16px' : '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
            {emptyMessage}
          </div>
        ) : sorted.map((row, i) => {
          const firstVal = firstCol ? row[firstCol.key] : undefined
          const firstDisplay = firstCol?.format
            ? firstCol.format(firstVal)
            : String(firstVal ?? '—')

          return (
            <div
              key={rowKey ? String(row[rowKey]) : i}
              className={cn('row-cascade', onRowClick && 'dt-row', plain && 'dt-row--plain')}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={rowKeyHandler(row, onRowClick)}
              style={plain
                ? {
                    '--row-delay': `${Math.min(i, 9) * 40}ms`,
                    padding: '14px 16px',
                    borderTop: '1px solid var(--line-2)',
                    cursor: onRowClick ? 'pointer' : 'default',
                  } as CSSProperties
                : {
                    '--row-delay': `${Math.min(i, 9) * 40}ms`,
                    background: 'var(--white)', border: '1px solid var(--line)',
                    borderRadius: 12, padding: 14, marginBottom: 10,
                    boxShadow: 'var(--shadow-md)',
                    cursor: onRowClick ? 'pointer' : 'default',
                  } as CSSProperties}
            >
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--black)', marginBottom: restCols.length ? 10 : 0, minWidth: 0 }}>
                {firstDisplay}
              </div>

              {restCols.map(col => {
                const value = row[col.key]
                const display = col.format ? col.format(value) : String(value ?? '—')
                return (
                  <div
                    key={col.key}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 6 }}
                  >
                    <span className="label-data">
                      {col.label}
                    </span>
                    <span style={{ fontSize: 'var(--text-md)', fontWeight: col.strong ? 800 : 600, color: toneColor[col.tone ?? 'default'], fontVariantNumeric: (col.align ?? 'left') === 'right' ? 'tabular-nums' : undefined }}>
                      {display}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Mobile: scroll ────────────────────────────────────────────────────────

  if (isMobile && mobileMode === 'scroll') {
    const inner = maxHeight
      ? <div style={{ maxHeight, overflowY: 'auto', borderRadius: 8 }}>{table}</div>
      : table
    return <div style={{ overflowX: 'auto' }}>{inner}</div>
  }

  // ── Desktop: original table ───────────────────────────────────────────────

  if (maxHeight) {
    return (
      <div style={{ maxHeight, overflowY: 'auto', borderRadius: 8, ...(hasWidths ? { overflowX: 'auto' } : {}) }}>
        {table}
      </div>
    )
  }

  // Com larguras fixas a tabela tem largura mínima; a rolagem horizontal fica
  // contida aqui em vez de empurrar a página.
  return hasWidths ? <div style={{ overflowX: 'auto' }}>{table}</div> : table
}

// ─── DataTableRow ─────────────────────────────────────────────────────────────

function DataTableRow({
  row, columns, index, isLast, onClick, variant,
}: {
  row: Record<string, unknown>
  columns: DataTableColumn[]
  index: number
  isLast: boolean
  onClick?: (row: Record<string, unknown>) => void
  variant: 'default' | 'plain'
}) {
  const [hov, setHov] = useState(false)
  const plain = variant === 'plain'

  return (
    <tr
      className={cn('row-cascade dt-row', plain && 'dt-row--plain')}
      onMouseEnter={plain ? undefined : () => setHov(true)}
      onMouseLeave={plain ? undefined : () => setHov(false)}
      onClick={onClick ? () => onClick(row) : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={rowKeyHandler(row, onClick)}
      style={plain
        ? {
            // Hover e foco vêm de .dt-row--plain (globals.css), sem estado JS.
            '--row-delay': `${Math.min(index, 9) * 40}ms`,
            borderBottom: isLast ? 'none' : '1px solid var(--line-2)',
            cursor: onClick ? 'pointer' : 'default',
          } as CSSProperties
        : {
            '--row-delay': `${Math.min(index, 9) * 40}ms`,
            borderBottom: isLast ? 'none' : '1px solid var(--gray3)',
            borderLeft: `var(--rail) solid ${hov ? 'var(--primary)' : 'transparent'}`,
            background: hov ? 'var(--primary-dim)' : 'transparent',
            transition: 'background .18s ease, border-color .18s ease',
            cursor: onClick ? 'pointer' : 'default',
          } as CSSProperties}
    >
      {columns.map((col, i) => {
        const value = row[col.key]
        const align = col.align ?? 'left'
        return (
          <td
            key={col.key}
            style={{
              padding: cellPadding(variant, i, columns.length, 13),
              textAlign: align,
              fontSize: 'var(--text-md)', fontWeight: col.strong ? 800 : 600,
              color: toneColor[col.tone ?? 'default'],
              fontVariantNumeric: align === 'right' ? 'tabular-nums' : undefined,
            }}
          >
            {col.format ? col.format(value) : String(value ?? '—')}
          </td>
        )
      })}
    </tr>
  )
}

export default DataTable
