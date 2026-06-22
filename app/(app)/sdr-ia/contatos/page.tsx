'use client'
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { DataTable } from '@/components/widgets/DataTable'
import type { DataTableColumn } from '@/components/widgets/DataTable'
import { timeAgo } from '@/lib/format'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactItem {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  tags: string[]
  lastInteractionAt: number | null
  createdAt: number | null
}

interface ApiResponse {
  items: ContactItem[]
  total: number
  page: number
  limit: number
}

// ─── Table columns ────────────────────────────────────────────────────────────

const LIMIT = 50

const COLS: DataTableColumn[] = [
  {
    key: 'name',
    label: 'Nome',
    sortable: false,
    format: (v) => (
      <span style={{ fontWeight: 700, color: 'var(--black)' }}>
        {(v as string | null) || '—'}
      </span>
    ),
  },
  {
    key: 'phone',
    label: 'Telefone',
    sortable: false,
    format: (v) => (
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--gray)' }}>
        {(v as string | null) || '—'}
      </span>
    ),
  },
  {
    key: 'lastInteractionAt',
    label: 'Última interação',
    sortable: true,
    format: (v) => (
      <span style={{ color: 'var(--gray)', fontSize: 12, fontWeight: 500 }}>
        {timeAgo(v as number | null)}
      </span>
    ),
  },
  {
    key: 'tags',
    label: 'Tags',
    sortable: false,
    format: (v) => {
      const tags = v as string[]
      if (!tags?.length) return <span style={{ color: 'var(--gray3)', fontSize: 11 }}>—</span>
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {tags.map(tag => (
            <span key={tag} style={{
              fontSize: 10, fontWeight: 700,
              padding: '2px 7px', borderRadius: 99,
              background: 'rgba(37,211,102,0.08)',
              color: '#15803d',
              border: '1px solid rgba(37,211,102,0.20)',
            }}>
              {tag}
            </span>
          ))}
        </div>
      )
    },
  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContatosPage() {
  const [data,    setData]    = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
  const [page,    setPage]    = useState(1)
  const [q,       setQ]       = useState('')
  const [debQ,    setDebQ]    = useState('')

  // Debounce search input by 300 ms
  useEffect(() => {
    const t = setTimeout(() => setDebQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  // Reset to first page when search changes
  useEffect(() => { setPage(1) }, [debQ])

  // Fetch contacts
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)

    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
    if (debQ) params.set('q', debQ)

    fetch(`/api/contacts?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: ApiResponse) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })

    return () => { cancelled = true }
  }, [page, debQ])

  const total      = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))
  const hasPrev    = page > 1
  const hasNext    = page < totalPages

  const tableRows = (data?.items ?? []).map(c => ({
    id:                c.id,
    name:              c.name,
    phone:             c.phone,
    tags:              c.tags,
    lastInteractionAt: c.lastInteractionAt ?? 0,
  }))

  return (
    <div>

      {/* ── Header + search ────────────────────────────────────────── */}
      <div className="animate-slide-up delay-1" style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, marginBottom: 24,
      }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            Contatos WhatsApp
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)' }}>
            Contatos sincronizados via YCloud — REST backfill e webhooks.
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            style={{
              position: 'absolute', left: 12, top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--gray2)', pointerEvents: 'none',
            }}
          />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Nome ou telefone..."
            style={{
              paddingLeft: 34, paddingRight: 14, paddingTop: 9, paddingBottom: 9,
              fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
              border: '1px solid var(--gray3)', borderRadius: 99,
              background: 'var(--white)', color: 'var(--black)',
              outline: 'none', transition: 'border-color .15s', minWidth: 220,
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
          />
        </div>
      </div>

      {/* ── Status line ────────────────────────────────────────────── */}
      {!loading && !error && data && (
        <div style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500, marginBottom: 16 }}>
          {total.toLocaleString('pt-BR')} contato{total !== 1 ? 's' : ''}
          {debQ && ` para "${debQ}"`}
          {totalPages > 1 && ` — página ${page} de ${totalPages}`}
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
          Carregando...
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────── */}
      {!loading && error && (
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#D93025', marginBottom: 8 }}>
            Falha ao carregar contatos
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray2)' }}>
            Verifique se o módulo YCloud está ativo e tente novamente.
          </div>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────── */}
      {!loading && !error && (
        <div className="animate-slide-up delay-2" style={{
          background: 'var(--white)', borderRadius: 16,
          border: '1px solid var(--gray3)', overflow: 'hidden',
        }}>
          <DataTable
            columns={COLS}
            rows={tableRows}
            defaultSortKey="lastInteractionAt"
            defaultSortDir="desc"
            emptyMessage={
              debQ
                ? `Nenhum contato encontrado para "${debQ}"`
                : 'Nenhum contato sincronizado ainda'
            }
          />
        </div>
      )}

      {/* ── Pagination ─────────────────────────────────────────────── */}
      {!loading && !error && totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 20 }}>
          <button
            onClick={() => setPage(p => p - 1)}
            disabled={!hasPrev}
            style={{
              padding: '8px 18px', borderRadius: 99, fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
              cursor: hasPrev ? 'pointer' : 'not-allowed',
              border: '1px solid var(--gray3)', background: 'var(--white)',
              color: hasPrev ? 'var(--black)' : 'var(--gray3)',
              transition: 'all .15s',
            }}
          >
            ← Anterior
          </button>
          <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={!hasNext}
            style={{
              padding: '8px 18px', borderRadius: 99, fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
              cursor: hasNext ? 'pointer' : 'not-allowed',
              border: '1px solid var(--gray3)', background: 'var(--white)',
              color: hasNext ? 'var(--black)' : 'var(--gray3)',
              transition: 'all .15s',
            }}
          >
            Próxima →
          </button>
        </div>
      )}
    </div>
  )
}
