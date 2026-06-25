'use client'
import { useState, useEffect } from 'react'
import { ACTION_LABELS, fmtDateTime, fmtDetail } from '@/lib/audit-format'

type TenantItem = { id: string; name: string }

type AuditLog = {
  id: string
  createdAt: string
  actorName: string | null
  actorEmail: string | null
  actorRole: string | null
  action: string
  entityType: string | null
  entityId: string | null
  metadata: Record<string, unknown>
  ip: string | null
  tenantId: string | null
  tenantName: string | null
}

const LIMIT = 50

// ── styles ────────────────────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  padding: '10px 16px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  color: '#888',
  letterSpacing: '0.06em',
  borderBottom: '1px solid #e3e4de',
  whiteSpace: 'nowrap',
  background: '#f8f8f6',
}

const TD: React.CSSProperties = {
  padding: '11px 16px',
  fontSize: 12,
  color: '#555',
  verticalAlign: 'top',
  borderBottom: '1px solid #f0f0ee',
}

const selectStyle: React.CSSProperties = {
  padding: '7px 12px',
  fontFamily: 'Manrope, sans-serif',
  fontSize: 12,
  fontWeight: 600,
  color: '#121316',
  background: '#fff',
  border: '1px solid #e3e4de',
  borderRadius: 8,
  outline: 'none',
  cursor: 'pointer',
  minWidth: 160,
}

// ── component ─────────────────────────────────────────────────────────────────

export function AuditExplorer({ tenants }: { tenants: TenantItem[] }) {
  const [tenantFilter, setTenantFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [logs, setLogs]     = useState<AuditLog[]>([])
  const [total, setTotal]   = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]   = useState('')

  async function load(newOffset: number, tFilter: string, aFilter: string, append: boolean) {
    if (newOffset === 0) setLoading(true); else setLoadingMore(true)
    setError('')
    try {
      const qs = new URLSearchParams({
        scope: 'all',
        limit: String(LIMIT),
        offset: String(newOffset),
        ...(tFilter ? { tenantId: tFilter } : {}),
        ...(aFilter ? { action: aFilter } : {}),
      })
      const res = await fetch(`/api/audit-logs?${qs}`)
      if (!res.ok) { setError('Erro ao carregar logs.'); return }
      const data = await res.json() as { logs: AuditLog[]; total: number }
      setLogs(prev => append ? [...prev, ...data.logs] : data.logs)
      setTotal(data.total)
      setOffset(newOffset)
    } catch { setError('Erro ao carregar logs.') }
    finally { setLoading(false); setLoadingMore(false) }
  }

  useEffect(() => {
    load(0, tenantFilter, actionFilter, false)
  }, [tenantFilter, actionFilter])

  const hasMore = logs.length < total

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={tenantFilter}
          onChange={e => { setTenantFilter(e.target.value); setOffset(0) }}
          style={selectStyle}
        >
          <option value="">Todos os tenants</option>
          {tenants.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        <select
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setOffset(0) }}
          style={selectStyle}
        >
          <option value="">Todas as ações</option>
          {Object.entries(ACTION_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        {total > 0 && !loading && (
          <span style={{ fontSize: 12, color: '#888', fontWeight: 500 }}>
            {total} registro{total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Table card */}
      <div style={{ background: '#fff', border: '1px solid #e3e4de', borderRadius: 12, overflow: 'hidden' }}>

        {/* Skeleton */}
        {loading && (
          <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} style={{ height: 34, borderRadius: 6, background: '#f0f0ee', animation: 'pulse 1.4s ease-in-out infinite' }} />
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{ padding: '24px 20px', fontSize: 13, color: '#d93025', fontWeight: 600 }}>{error}</div>
        )}

        {/* Empty */}
        {!loading && !error && logs.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 13, color: '#aaa' }}>
            Nenhum registro de auditoria encontrado.
          </div>
        )}

        {/* Table */}
        {!loading && !error && logs.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={TH}>Tenant</th>
                  <th style={TH}>Quando</th>
                  <th style={TH}>Quem</th>
                  <th style={TH}>Ação</th>
                  <th style={TH}>Detalhe</th>
                  <th style={TH}>IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td style={{ ...TD, fontWeight: 700, color: '#121316', whiteSpace: 'nowrap' }}>
                      {log.tenantName ?? log.tenantId ?? '—'}
                    </td>
                    <td style={{ ...TD, whiteSpace: 'nowrap', color: '#121316' }}>
                      {fmtDateTime(log.createdAt)}
                    </td>
                    <td style={{ ...TD, minWidth: 140 }}>
                      <div style={{ fontWeight: 700, color: '#121316', fontSize: 12 }}>{log.actorName ?? '—'}</div>
                      <div style={{ color: '#999', fontSize: 11 }}>{log.actorEmail ?? ''}</div>
                    </td>
                    <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        background: 'rgba(255,180,0,0.1)',
                        color: '#7A5600',
                      }}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td style={{ ...TD, maxWidth: 300, wordBreak: 'break-word' }}>
                      {fmtDetail(log.action, log.entityType, log.entityId, log.metadata)}
                    </td>
                    <td style={{ ...TD, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {log.ip ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Load more */}
        {!loading && !error && hasMore && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid #f0f0ee', textAlign: 'center' }}>
            <button
              onClick={() => load(offset + LIMIT, tenantFilter, actionFilter, true)}
              disabled={loadingMore}
              style={{
                padding: '7px 20px',
                fontFamily: 'Manrope, sans-serif',
                fontSize: 13,
                fontWeight: 700,
                background: loadingMore ? '#f0f0ee' : '#fff',
                color: loadingMore ? '#aaa' : '#121316',
                border: '1px solid #e3e4de',
                borderRadius: 100,
                cursor: loadingMore ? 'not-allowed' : 'pointer',
              }}
            >
              {loadingMore ? 'Carregando…' : `Carregar mais (${total - logs.length} restantes)`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
