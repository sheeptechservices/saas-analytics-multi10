'use client'
import { useState } from 'react'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DataTableColumn {
  key: string
  label: string
  /** Defaults to 'left'. */
  align?: 'left' | 'right'
  format?: (value: unknown) => React.ReactNode
  sortable?: boolean
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
}

// ─── DataTable ────────────────────────────────────────────────────────────────

export function DataTable({
  columns,
  rows,
  defaultSortKey,
  defaultSortDir = 'desc',
  onRowClick,
  emptyMessage = 'Nenhum dado disponível',
  maxHeight,
  mobileMode = 'cards',
}: DataTableProps) {
  const [sortCol, setSortCol] = useState<string>(defaultSortKey ?? columns[0]?.key ?? '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir)
  const isMobile = useIsMobile()

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

  // ── Shared table JSX (desktop + scroll-mode mobile) ───────────────────────

  const thead = (
    <thead>
      <tr style={{ background: 'var(--bg)' }}>
        {columns.map(col => {
          const active = sortCol === col.key
          const align = col.align ?? 'left'
          return (
            <th
              key={col.key}
              onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
              style={{
                padding: '9px 20px',
                textAlign: align,
                fontSize: 10, fontWeight: 800,
                color: active ? 'var(--primary-text)' : 'var(--gray2)',
                textTransform: 'uppercase', letterSpacing: '0.07em',
                borderBottom: '1px solid var(--gray3)',
                cursor: col.sortable !== false ? 'pointer' : 'default',
                userSelect: 'none', transition: 'color .15s',
                whiteSpace: 'nowrap',
                ...(maxHeight ? { position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 } : {}),
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
                {col.label}
                {col.sortable !== false && (
                  <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1, opacity: active ? 1 : 0.3, transition: 'opacity .15s' }}>
                    <span style={{ fontSize: 7, lineHeight: 1, color: active && sortDir === 'asc' ? 'var(--primary-text)' : 'currentColor' }}>▲</span>
                    <span style={{ fontSize: 7, lineHeight: 1, color: active && sortDir === 'desc' ? 'var(--primary-text)' : 'currentColor' }}>▼</span>
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
            key={i}
            row={row}
            columns={columns}
            index={i}
            isLast={i === sorted.length - 1}
            onClick={onRowClick}
          />
        ))
      )}
    </tbody>
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
            paddingBottom: 8, marginBottom: 12,
          }}>
            {sortableCols.map(col => {
              const active = sortCol === col.key
              return (
                <button
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    flexShrink: 0, padding: '5px 10px', borderRadius: 100,
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    whiteSpace: 'nowrap', transition: 'all .15s',
                    border: `1px solid ${active ? 'var(--primary)' : 'var(--gray3)'}`,
                    background: active ? 'var(--primary-dim)' : 'var(--white)',
                    color: active ? 'var(--primary-text)' : 'var(--gray)',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontFamily: 'inherit',
                  }}
                >
                  {col.label}
                  {active && <span style={{ fontSize: 9 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </button>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {sorted.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
            {emptyMessage}
          </div>
        ) : sorted.map((row, i) => {
          const firstVal = firstCol ? row[firstCol.key] : undefined
          const firstDisplay = firstCol?.format
            ? firstCol.format(firstVal)
            : String(firstVal ?? '—')

          return (
            <div
              key={i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{
                background: 'var(--white)', border: '1px solid #ECECE9',
                borderRadius: 12, padding: 14, marginBottom: 10,
                boxShadow: 'var(--shadow-md)',
                cursor: onRowClick ? 'pointer' : 'default',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--black)', marginBottom: restCols.length ? 10 : 0 }}>
                {firstDisplay}
              </div>

              {restCols.map(col => {
                const value = row[col.key]
                const display = col.format ? col.format(value) : String(value ?? '—')
                return (
                  <div
                    key={col.key}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--gray2)' }}>
                      {col.label}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: col.align === 'right' ? 800 : 600, color: col.align === 'right' ? 'var(--green)' : 'var(--black)' }}>
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
      ? <div style={{ maxHeight, overflowY: 'auto', borderRadius: 8 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>{thead}{tbody}</table></div>
      : <table style={{ width: '100%', borderCollapse: 'collapse' }}>{thead}{tbody}</table>
    return <div style={{ overflowX: 'auto' }}>{inner}</div>
  }

  // ── Desktop: original table ───────────────────────────────────────────────

  if (maxHeight) {
    return (
      <div style={{ maxHeight, overflowY: 'auto', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          {thead}
          {tbody}
        </table>
      </div>
    )
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      {thead}
      {tbody}
    </table>
  )
}

// ─── DataTableRow ─────────────────────────────────────────────────────────────

function DataTableRow({
  row, columns, index, isLast, onClick,
}: {
  row: Record<string, unknown>
  columns: DataTableColumn[]
  index: number
  isLast: boolean
  onClick?: (row: Record<string, unknown>) => void
}) {
  const [hov, setHov] = useState(false)

  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick ? () => onClick(row) : undefined}
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--gray3)',
        borderLeft: `3px solid ${hov ? 'var(--primary)' : 'transparent'}`,
        background: hov ? 'var(--primary-dim)' : 'transparent',
        transition: 'all .18s ease',
        cursor: onClick ? 'pointer' : 'default',
        animation: 'ai-step 0.3s ease both',
        animationDelay: `${index * 40}ms`,
      }}
    >
      {columns.map(col => {
        const value = row[col.key]
        const align = col.align ?? 'left'
        return (
          <td
            key={col.key}
            style={{
              padding: '13px 20px',
              textAlign: align,
              fontSize: 13, fontWeight: col.align === 'right' ? 800 : 600,
              color: col.align === 'right' ? 'var(--green)' : 'var(--black)',
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
