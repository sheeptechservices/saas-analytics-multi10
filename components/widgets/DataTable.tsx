'use client'
import { useState } from 'react'

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
}

// ─── DataTable ────────────────────────────────────────────────────────────────

export function DataTable({
  columns,
  rows,
  defaultSortKey,
  defaultSortDir = 'desc',
  onRowClick,
  emptyMessage = 'Nenhum dado disponível',
}: DataTableProps) {
  const [sortCol, setSortCol] = useState<string>(defaultSortKey ?? columns[0]?.key ?? '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir)

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

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
