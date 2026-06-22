'use client'
import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadItem {
  id:      string
  name:    string | null
  phone:   string | null
  company: string | null
  source:  string | null
  status:  string | null
  ativo:   boolean | null
}

interface ApiResponse {
  items: LeadItem[]
  page:  number
  limit: number
  total: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LIMIT = 50

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <span style={{ color: 'var(--gray3)', fontSize: 11 }}>—</span>
  const colors: Record<string, { bg: string; color: string }> = {
    ativo:     { bg: 'rgba(34,197,94,0.10)',  color: '#15803d' },
    inativo:   { bg: 'rgba(239,68,68,0.08)',  color: 'var(--red)' },
    qualificado: { bg: 'rgba(37,99,235,0.10)', color: '#1d4ed8' },
  }
  const style = colors[value.toLowerCase()] ?? { bg: 'rgba(0,0,0,0.05)', color: 'var(--gray)' }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: style.bg, color: style.color,
      border: `1px solid ${style.color}30`,
    }}>
      {value}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const [data,      setData]      = useState<ApiResponse | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [page,      setPage]      = useState(1)
  const [q,         setQ]         = useState('')
  const [debQ,      setDebQ]      = useState('')
  const [selected,  setSelected]  = useState<Set<string>>(new Set())
  const [enrolling, setEnrolling] = useState(false)
  const [enrollResult, setEnrollResult] = useState<{ ok: boolean; enrolled?: number; error?: string } | null>(null)

  const masterRef = useRef<HTMLInputElement>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebQ(q), 350)
    return () => clearTimeout(t)
  }, [q])

  // Reset page on search change
  useEffect(() => { setPage(1) }, [debQ])

  // Clear enroll feedback when page/search changes
  useEffect(() => { setEnrollResult(null) }, [page, debQ])

  // Fetch leads
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
    if (debQ) params.set('q', debQ)

    fetch(`/api/sdr/leads?${params}`)
      .then(r => r.ok ? r.json() : r.json().then((d: { error?: string }) => Promise.reject(d.error ?? r.status)))
      .then((d: ApiResponse) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e: unknown) => { if (!cancelled) { setError(String(e)); setLoading(false) } })

    return () => { cancelled = true }
  }, [page, debQ])

  // Keep master checkbox indeterminate state in sync
  const pageIds  = data?.items.map(i => i.id) ?? []
  const selCount = pageIds.filter(id => selected.has(id)).length
  const allOnPage = pageIds.length > 0 && selCount === pageIds.length
  const someOnPage = selCount > 0 && selCount < pageIds.length

  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someOnPage
  }, [someOnPage])

  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allOnPage) { pageIds.forEach(id => next.delete(id)) }
      else            { pageIds.forEach(id => next.add(id)) }
      return next
    })
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function enroll() {
    const leadIds = Array.from(selected)
    if (leadIds.length === 0) return
    setEnrolling(true)
    setEnrollResult(null)
    try {
      const res = await fetch('/api/sdr/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds }),
      })
      const data = await res.json() as { ok: boolean; enrolled?: number; status?: number; error?: string }
      if (res.ok && data.ok) {
        setEnrollResult({ ok: true, enrolled: data.enrolled ?? leadIds.length })
        setSelected(new Set())
      } else {
        setEnrollResult({ ok: false, error: data.error ?? `HTTP ${data.status ?? res.status}` })
      }
    } catch (e) {
      setEnrollResult({ ok: false, error: (e as Error).message })
    } finally {
      setEnrolling(false)
    }
  }

  const total      = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))
  const hasPrev    = page > 1
  const hasNext    = page < totalPages

  return (
    <div>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, marginBottom: 24,
      }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            Leads
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)' }}>
            Selecione leads para adicioná-los à campanha de disparo.
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--gray2)', pointerEvents: 'none',
          }} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Nome, telefone ou empresa..."
            style={{
              paddingLeft: 34, paddingRight: 14, paddingTop: 9, paddingBottom: 9,
              fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
              border: '1px solid var(--gray3)', borderRadius: 99,
              background: 'var(--white)', color: 'var(--black)',
              outline: 'none', transition: 'border-color .15s', minWidth: 240,
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
          />
        </div>
      </div>

      {/* ── Enroll bar ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        marginBottom: 16, flexWrap: 'wrap' as const,
      }}>
        <button
          onClick={enroll}
          disabled={enrolling || selected.size === 0}
          style={{
            padding: '9px 22px', borderRadius: 99, fontFamily: 'inherit',
            fontSize: 13, fontWeight: 800,
            cursor: (enrolling || selected.size === 0) ? 'not-allowed' : 'pointer',
            background: (enrolling || selected.size === 0) ? 'var(--gray3)' : 'var(--primary)',
            color: (enrolling || selected.size === 0) ? 'var(--gray2)' : 'var(--primary-contrast)',
            border: 'none', transition: 'all .18s',
            opacity: (enrolling || selected.size === 0) ? 0.65 : 1,
          }}
        >
          {enrolling ? 'Adicionando...' : `Adicionar à campanha${selected.size > 0 ? ` (${selected.size})` : ''}`}
        </button>

        {enrollResult?.ok && (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
            ✓ {enrollResult.enrolled ?? selected.size} leads adicionados
          </span>
        )}
        {enrollResult && !enrollResult.ok && (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>
            ✗ {enrollResult.error}
          </span>
        )}

        {!enrollResult && (
          <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>
            Os leads selecionados entram na fila de disparo (Template 1).
          </span>
        )}
      </div>

      {/* ── Status line ────────────────────────────────────────────── */}
      {!loading && !error && data && (
        <div style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500, marginBottom: 12 }}>
          {total.toLocaleString('pt-BR')} lead{total !== 1 ? 's' : ''}
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
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)', marginBottom: 8 }}>
            Falha ao carregar leads
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray2)' }}>
            {error === 'fonte_sdr_nao_configurada'
              ? 'Configure a fonte de dados SDR (Supabase / n8n) primeiro.'
              : error}
          </div>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────── */}
      {!loading && !error && (
        <div style={{
          background: 'var(--white)', borderRadius: 16,
          border: '1px solid var(--gray3)', overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th style={{ padding: '9px 16px', borderBottom: '1px solid var(--gray3)', width: 40 }}>
                  <input
                    ref={masterRef}
                    type="checkbox"
                    checked={allOnPage}
                    onChange={toggleAll}
                    disabled={pageIds.length === 0}
                    style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
                  />
                </th>
                {(['Nome', 'Telefone', 'Empresa', 'Origem', 'Status'] as const).map(col => (
                  <th key={col} style={{
                    padding: '9px 16px', textAlign: 'left',
                    fontSize: 10, fontWeight: 800, color: 'var(--gray2)',
                    textTransform: 'uppercase', letterSpacing: '0.07em',
                    borderBottom: '1px solid var(--gray3)', whiteSpace: 'nowrap',
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
                    {debQ ? `Nenhum lead encontrado para "${debQ}"` : 'Nenhum lead encontrado'}
                  </td>
                </tr>
              ) : (data?.items ?? []).map((lead, i) => {
                const checked = selected.has(lead.id)
                const isLast = i === (data?.items.length ?? 0) - 1
                return (
                  <tr
                    key={lead.id}
                    onClick={() => toggleOne(lead.id)}
                    style={{
                      borderBottom: isLast ? 'none' : '1px solid var(--gray3)',
                      background: checked ? 'var(--primary-dim)' : 'transparent',
                      borderLeft: `3px solid ${checked ? 'var(--primary)' : 'transparent'}`,
                      cursor: 'pointer', transition: 'background .12s, border-color .12s',
                    }}
                  >
                    <td style={{ padding: '11px 16px' }} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(lead.id)}
                        style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
                      />
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>
                      {lead.name || '—'}
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--gray)' }}>
                        {lead.phone || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--gray)', fontWeight: 500 }}>
                      {lead.company || '—'}
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>
                      {lead.source || '—'}
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <StatusBadge value={lead.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
            }}
          >
            Próxima →
          </button>
        </div>
      )}
    </div>
  )
}
