'use client'
import { useState, useCallback } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Skeleton } from '@/components/Skeleton'
import { useQuery } from '@tanstack/react-query'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  id:              string
  template:        string
  totalSolicitado: number
  skipped:         number
  started:         number
  status:          'enviando' | 'concluido' | 'erro'
  createdAt:       number | null
  createdByName:   string | null
  pendente:        number
  enviado:         number
  entregue:        number
  lido:            number
  falhou:          number
}

interface Recipient {
  id:              string
  leadId:          string
  phone:           string
  firstName:       string
  status:          'pendente' | 'enviado' | 'entregue' | 'lido' | 'falhou'
  ycloudMessageId: string | null
  errorCode:       string | null
  errorReason:     string | null
  lastStatusAt:    number | null
}

interface DetailResponse {
  campaign:    Campaign
  recipients:  Recipient[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtPhone(phone: string): string {
  if (phone.startsWith('+55') && phone.length === 14) {
    const n = phone.slice(3)
    return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`
  }
  return phone
}

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente', enviado: 'Enviado', entregue: 'Entregue', lido: 'Lido', falhou: 'Falhou',
}
const STATUS_COLOR: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  pendente: { dot: 'var(--gray3)',  text: 'var(--gray2)',   bg: 'var(--bg)',             border: 'var(--gray3)'                },
  enviado:  { dot: '#60a5fa',       text: '#1d4ed8',        bg: 'rgba(59,130,246,0.07)', border: 'rgba(59,130,246,0.25)'       },
  entregue: { dot: 'var(--primary)', text: 'var(--primary-text)', bg: 'var(--primary-dim)', border: 'var(--primary-mid)'       },
  lido:     { dot: 'var(--green)',  text: 'var(--green)',   bg: 'rgba(30,138,62,0.07)',  border: 'rgba(30,138,62,0.22)'        },
  falhou:   { dot: 'var(--red)',    text: 'var(--red)',     bg: 'rgba(217,48,37,0.07)',  border: 'rgba(217,48,37,0.20)'        },
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? STATUS_COLOR.pendente
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function CampaignStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    enviando: { label: 'Em andamento', color: '#d97706' },
    concluido: { label: 'Concluído',   color: 'var(--green)' },
    erro:      { label: 'Erro',        color: 'var(--red)' },
  }
  const s = map[status] ?? { label: status, color: 'var(--gray2)' }
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: s.color }}>
      {s.label}
    </span>
  )
}

function MetricPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 44 }}>
      <span style={{ fontSize: 15, fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{label}</span>
    </span>
  )
}

// ─── List view ────────────────────────────────────────────────────────────────

function CampaignRow({ c, onClick }: { c: Campaign; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '14px 16px', cursor: 'pointer',
        borderBottom: '1px solid var(--gray3)',
        transition: 'background .12s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Left: template + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.template}
        </div>
        <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{fmtDate(c.createdAt)}</span>
          {c.createdByName && <span>por {c.createdByName}</span>}
          <CampaignStatusBadge status={c.status} />
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexShrink: 0 }}>
        <MetricPill label="Total"    value={c.totalSolicitado} color="var(--ink)"     />
        <MetricPill label="Enviado"  value={c.enviado}         color="#1d4ed8"         />
        <MetricPill label="Entregue" value={c.entregue}        color="var(--primary-text)" />
        <MetricPill label="Lido"     value={c.lido}            color="var(--green)"    />
        <MetricPill label="Falhou"   value={c.falhou}          color="var(--red)"      />
      </div>

      <div style={{ fontSize: 12, color: 'var(--gray2)', flexShrink: 0 }}>›</div>
    </div>
  )
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function DetailView({ campaignId, onBack, onRefresh }: { campaignId: string; onBack: () => void; onRefresh: () => void }) {
  const [key, setKey] = useState(0)
  const { data, isLoading, isError, refetch } = useQuery<DetailResponse>({
    queryKey: ['blast-detail', campaignId, key],
    queryFn: () => fetch(`/api/sdr/blast/campaigns/${campaignId}`).then(r => r.json()),
    staleTime: 0,
  })

  function refresh() { setKey(k => k + 1); onRefresh() }

  const c = data?.campaign
  const recipients = data?.recipients ?? []
  const total = recipients.length
  const bySt = Object.fromEntries(
    (['pendente','enviado','entregue','lido','falhou'] as const).map(s => [s, recipients.filter(r => r.status === s).length])
  )

  return (
    <div>
      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray2)', fontSize: 13, fontWeight: 600, padding: 0 }}
        >
          <ArrowLeft size={14} /> Disparos
        </button>
        <span style={{ color: 'var(--gray3)', fontWeight: 300 }}>/</span>
        <span style={{ fontSize: 13, color: 'var(--gray)', fontWeight: 600, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isLoading ? '…' : (c?.template ?? 'Campanha')}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={refresh}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 100, border: '1px solid var(--gray3)', background: 'var(--white)', fontSize: 12, fontWeight: 700, color: 'var(--gray)', cursor: 'pointer', transition: 'background .15s' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--white)')}
        >
          <RefreshCw size={12} /> Atualizar
        </button>
      </div>

      {isLoading && (
        <div className="animate-slide-up delay-2" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...Array(5)].map((_, i) => <Skeleton key={i} height={52} radius={10} />)}
        </div>
      )}

      {isError && (
        <div className="animate-slide-up delay-2" style={{ padding: 24, textAlign: 'center', color: 'var(--red)', fontSize: 13 }}>
          Erro ao carregar. <button onClick={() => refetch()} style={{ background: 'none', border: 'none', color: 'var(--primary-text)', fontWeight: 700, cursor: 'pointer' }}>Tentar novamente</button>
        </div>
      )}

      {c && (
        <>
          {/* Campaign summary */}
          <div className="animate-slide-up delay-2" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 14, padding: '16px 20px', marginBottom: 18, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--black)', marginBottom: 4 }}>{c.template}</div>
              <div style={{ fontSize: 12, color: 'var(--gray2)' }}>{fmtDate(c.createdAt)}{c.createdByName ? ` · por ${c.createdByName}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
              <MetricPill label="Total"    value={total}           color="var(--ink)"         />
              <MetricPill label="Enviado"  value={bySt.enviado}    color="#1d4ed8"             />
              <MetricPill label="Entregue" value={bySt.entregue}   color="var(--primary-text)" />
              <MetricPill label="Lido"     value={bySt.lido}       color="var(--green)"        />
              <MetricPill label="Falhou"   value={bySt.falhou}     color="var(--red)"          />
              {bySt.pendente > 0 && <MetricPill label="Pendente" value={bySt.pendente} color="var(--gray2)" />}
            </div>
            <CampaignStatusBadge status={c.status} />
          </div>

          {/* Recipient table */}
          <div className="animate-slide-up delay-3" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 14, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['Nome', 'Telefone', 'Status', 'Motivo / Detalhe'].map(h => (
                    <th key={h} style={{ padding: '9px 16px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid var(--gray3)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recipients.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>Nenhum destinatário</td></tr>
                ) : recipients.map((r, i) => (
                  <tr
                    key={r.id}
                    className="row-cascade"
                    style={{
                      '--row-delay': `${Math.min(i, 9) * 35}ms`,
                      borderBottom: i < recipients.length - 1 ? '1px solid var(--gray3)' : 'none',
                    } as React.CSSProperties}
                  >
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{r.firstName}</td>
                    <td style={{ padding: '11px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--gray)' }}>{fmtPhone(r.phone)}</td>
                    <td style={{ padding: '11px 16px' }}><StatusBadge status={r.status} /></td>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: r.errorReason ? 'var(--red)' : 'var(--gray2)', fontWeight: r.errorReason ? 600 : 400 }}>
                      {r.errorReason ?? (r.status === 'falhou' ? 'Erro desconhecido' : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DisparosPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listKey, setListKey] = useState(0)

  const { data, isLoading, isError, refetch } = useQuery<{ campaigns: Campaign[] }>({
    queryKey: ['blast-campaigns', listKey],
    queryFn: () => fetch('/api/sdr/blast/campaigns').then(r => r.json()),
    staleTime: 0,
  })

  const refresh = useCallback(() => setListKey(k => k + 1), [])

  if (selectedId) {
    return <DetailView campaignId={selectedId} onBack={() => setSelectedId(null)} onRefresh={() => {}} />
  }

  const campaigns = data?.campaigns ?? []

  return (
    <div>
      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            Disparos
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)' }}>
            Histórico de campanhas enviadas e status de entrega.
          </div>
        </div>
        <button
          onClick={refresh}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 100, border: '1px solid var(--gray3)', background: 'var(--white)', fontSize: 12, fontWeight: 700, color: 'var(--gray)', cursor: 'pointer', transition: 'background .15s' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--white)')}
        >
          <RefreshCw size={13} /> Atualizar
        </button>
      </div>

      {/* List */}
      <div className="animate-slide-up delay-2" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '14px 16px', borderBottom: i < 4 ? '1px solid var(--gray3)' : 'none' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton width="30%" height={13} />
                  <Skeleton width="20%" height={10} />
                </div>
                <div style={{ display: 'flex', gap: 20 }}>
                  {[...Array(5)].map((_, j) => <Skeleton key={j} width={36} height={36} radius={8} />)}
                </div>
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--red)' }}>
            Erro ao carregar campanhas.{' '}
            <button onClick={() => refetch()} style={{ background: 'none', border: 'none', color: 'var(--primary-text)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              Tentar novamente
            </button>
          </div>
        )}

        {!isLoading && !isError && campaigns.length === 0 && (
          <div style={{ padding: '48px 20px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
            Nenhum disparo realizado ainda.
          </div>
        )}

        {!isLoading && !isError && campaigns.map(c => (
          <CampaignRow key={c.id} c={c} onClick={() => setSelectedId(c.id)} />
        ))}
      </div>
    </div>
  )
}
