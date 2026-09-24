'use client'
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { DataTable } from '@/components/widgets/DataTable'
import type { DataTableColumn } from '@/components/widgets/DataTable'
import { SkeletonTable } from '@/components/Skeleton'
import { useEndpointAllowed } from '@/components/ModulesProvider'
import { ApiErrorState } from '@/components/ApiErrorState'
import { fetchJson, textoDaFalha, textoDeModuloDesligado } from '@/lib/api-error'
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
              padding: '2px 7px', borderRadius: 'var(--radius-pill)',
              background: 'rgba(37,211,102,0.08)',
              color: 'var(--success-text)',
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
  // O erro inteiro, não um booleano: a tela dizia "verifique se o módulo YCloud
  // está ativo" também quando o servidor caía (issue #98).
  const [error,   setError]   = useState<unknown>(null)
  const [page,    setPage]    = useState(1)
  const [q,       setQ]       = useState('')
  const [debQ,    setDebQ]    = useState('')
  const [recarga, setRecarga] = useState(0)

  // A rota /sdr-ia/contatos e /api/contacts pedem o mesmo módulo, então isto é
  // defesa em profundidade — o layout de (app) só barra quem chega pelo
  // servidor, e ele não é refeito na navegação do cliente (lib/hidden-route).
  const { permitido, moduleKey } = useEndpointAllowed('/api/contacts')

  // Debounce search input by 300 ms
  useEffect(() => {
    const t = setTimeout(() => setDebQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  // Reset to first page when search changes
  useEffect(() => { setPage(1) }, [debQ])

  // Fetch contacts
  useEffect(() => {
    if (!permitido) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
    if (debQ) params.set('q', debQ)

    fetchJson<ApiResponse>(`/api/contacts?${params}`)
      .then((d: ApiResponse) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e: unknown) => { if (!cancelled) { setError(e); setLoading(false) } })

    return () => { cancelled = true }
  }, [page, debQ, permitido, recarga])

  const total      = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))
  const falhou     = !permitido || error != null
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

        {/* On phones the search drops below the title at full width */}
        <div className="max-md:w-full" style={{ position: 'relative' }}>
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
            className="max-md:w-full"
            style={{
              paddingLeft: 34, paddingRight: 14, paddingTop: 9, paddingBottom: 9,
              fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
              border: '1px solid var(--gray3)', borderRadius: 'var(--radius-pill)',
              background: 'var(--white)', color: 'var(--black)',
              outline: 'none', transition: 'border-color .15s', minWidth: 220,
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
          />
        </div>
      </div>

      {/* ── Status line ─ echoes the search, which may be one unbroken word ── */}
      {!falhou && !loading && data && (
        <div className="max-lg:wrap-anywhere" style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500, marginBottom: 16 }}>
          {total.toLocaleString('pt-BR')} contato{total !== 1 ? 's' : ''}
          {debQ && ` para "${debQ}"`}
          {totalPages > 1 && ` — página ${page} de ${totalPages}`}
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────────── */}
      {!falhou && loading && (
        <SkeletonTable rows={8} colWidths={['28%', '18%', '18%', '18%', '12%']} />
      )}

      {/* ── Error ──────────────────────────────────────────────────── */}
      {!permitido && <ApiErrorState texto={textoDeModuloDesligado(moduleKey!)} />}

      {permitido && !loading && error != null && (
        <ApiErrorState
          texto={textoDaFalha(error, 'os contatos')}
          onRetry={() => { setError(null); setRecarga(n => n + 1) }}
        />
      )}

      {/* ── Table ──────────────────────────────────────────────────── */}
      {/* Below lg DataTable shows cards, whose empty state echoes the search
          too: there it may break anywhere. From lg (the table) nothing changes. */}
      {!falhou && !loading && (
        <div className="animate-slide-up delay-2 max-lg:wrap-anywhere" style={{
          background: 'var(--white)', borderRadius: 'var(--radius-lg)',
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
      {!falhou && !loading && totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 20 }}>
          <button
            onClick={() => setPage(p => p - 1)}
            disabled={!hasPrev}
            className="max-md:min-h-10"
            style={{
              padding: '8px 18px', borderRadius: 'var(--radius-pill)', fontFamily: 'inherit',
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
            className="max-md:min-h-10"
            style={{
              padding: '8px 18px', borderRadius: 'var(--radius-pill)', fontFamily: 'inherit',
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
