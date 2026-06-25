'use client'
import { useState, useCallback } from 'react'
import { ArrowLeft, RefreshCw, Download, RotateCcw } from 'lucide-react'
import { Skeleton } from '@/components/Skeleton'
import { Button } from '@/components/ui/Button'
import { useQuery } from '@tanstack/react-query'
import { useCanDispatch } from '@/lib/hooks/useCanDispatch'
import { toMs } from '@/lib/date'

// ─── Types ────────────────────────────────────────────────────────────────────

type CampaignKind = 'manual' | 'campanha'

interface Campaign {
  id:              string
  kind:            CampaignKind
  template:        string
  templateBody:    string | null
  totalSolicitado: number
  skipped:         number
  started:         number
  status:          'enviando' | 'concluido' | 'erro'
  createdAt:       string | number | null
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
  template:        string | null
  ycloudMessageId: string | null
  errorCode:       string | null
  errorReason:     string | null
  lastStatusAt:    string | number | null
}

interface DetailResponse {
  campaign:   Campaign
  recipients: Recipient[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | number | null): string {
  const ms = toMs(ts)
  if (ms == null) return '—'
  return new Date(ms).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function fmtDayShort(ts: string | number | null): string {
  const ms = toMs(ts)
  if (ms == null) return '—'
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function fmtPhone(phone: string): string {
  if (phone.startsWith('+55') && phone.length === 14) {
    const n = phone.slice(3)
    return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`
  }
  return phone
}

function csvField(s: string): string {
  return '"' + String(s ?? '').replace(/"/g, '""') + '"'
}

function rowTitle(c: Campaign): string {
  return c.kind === 'campanha'
    ? `Campanha SDR · ${fmtDayShort(c.createdAt)}`
    : c.template
}

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente', enviado: 'Enviado', entregue: 'Entregue', lido: 'Lido', falhou: 'Falhou',
}

const STATUS_COLOR: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  pendente: { dot: 'var(--gray3)',   text: 'var(--gray2)',        bg: 'var(--bg)',             border: 'var(--gray3)'          },
  enviado:  { dot: '#60a5fa',        text: '#1d4ed8',             bg: 'rgba(59,130,246,0.07)', border: 'rgba(59,130,246,0.25)' },
  entregue: { dot: 'var(--primary)', text: 'var(--primary-text)', bg: 'var(--primary-dim)',    border: 'var(--primary-mid)'    },
  lido:     { dot: 'var(--green)',   text: 'var(--green)',        bg: 'rgba(30,138,62,0.07)',  border: 'rgba(30,138,62,0.22)'  },
  falhou:   { dot: 'var(--red)',     text: 'var(--red)',          bg: 'rgba(217,48,37,0.07)',  border: 'rgba(217,48,37,0.20)'  },
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
    enviando:  { label: 'Em andamento', color: '#d97706'      },
    concluido: { label: 'Concluído',    color: 'var(--green)' },
    erro:      { label: 'Erro',         color: 'var(--red)'   },
  }
  const s = map[status] ?? { label: status, color: 'var(--gray2)' }
  return <span style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{s.label}</span>
}

function MetricPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 44 }}>
      <span style={{ fontSize: 15, fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{label}</span>
    </span>
  )
}

function PillBtn({
  onClick, icon, label, disabled,
}: { onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 100,
        border: '1px solid var(--gray3)', background: 'var(--white)',
        fontSize: 12, fontWeight: 700, color: disabled ? 'var(--gray3)' : 'var(--gray)',
        cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background .15s',
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg)' }}
      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--white)' }}
    >
      {icon} {label}
    </button>
  )
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: CampaignKind; onChange: (k: CampaignKind) => void }) {
  const tabs: { id: CampaignKind; label: string }[] = [
    { id: 'manual',   label: 'Manuais'      },
    { id: 'campanha', label: 'Campanha SDR' },
  ]
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--gray3)', marginBottom: 20 }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            background: 'none', border: 'none', borderBottom: `2px solid ${active === t.id ? 'var(--primary)' : 'transparent'}`,
            color: active === t.id ? 'var(--black)' : 'var(--gray)',
            transition: 'color .15s, border-color .15s', marginBottom: -1,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function DetailView({ campaignId, onBack }: { campaignId: string; onBack: () => void }) {
  const { canDispatch } = useCanDispatch()
  const [key, setKey] = useState(0)
  const { data, isLoading, isError, refetch } = useQuery<DetailResponse>({
    queryKey: ['blast-detail', campaignId, key],
    queryFn:  () => fetch(`/api/sdr/blast/campaigns/${campaignId}`).then(r => r.json()),
    staleTime: 0,
  })

  const [reenvioMode,   setReenvioMode]   = useState<'idle' | 'confirm' | 'sending' | 'done'>('idle')
  const [reenvioResult, setReenvioResult] = useState<{ ok: boolean; started?: number; error?: string } | null>(null)

  function refresh() { setKey(k => k + 1); setReenvioMode('idle'); setReenvioResult(null) }

  function exportCsv() {
    if (!data) return
    const { campaign: c, recipients } = data
    const isCampanha = c.kind === 'campanha'
    const headers = isCampanha
      ? ['Nome', 'Telefone', 'Template', 'Status', 'Motivo']
      : ['Nome', 'Telefone', 'Status', 'Motivo']
    const header = headers.map(csvField).join(';')
    const rows = recipients.map(r => {
      const tpl = r.template ?? (isCampanha ? '' : c.template)
      const base = [
        r.firstName,
        r.phone,
        ...(isCampanha ? [tpl] : []),
        STATUS_LABEL[r.status] ?? r.status,
        r.errorReason ?? (r.status === 'falhou' ? 'Erro desconhecido' : ''),
      ]
      return base.map(csvField).join(';')
    })
    const csv = '﻿' + [header, ...rows].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `disparo-${rowTitle(c).replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${campaignId.slice(0, 8)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function reenviar() {
    if (!data) return
    const { campaign: c, recipients } = data
    const failed = recipients.filter(r => r.status === 'falhou')
    if (failed.length === 0) return
    setReenvioMode('sending')
    try {
      const names: Record<string, string> = {}
      failed.forEach(r => { names[r.leadId] = r.firstName })
      const res  = await fetch('/api/sdr/leads/blast', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          leadIds:      failed.map(r => r.leadId),
          template:     c.template,
          templateBody: c.templateBody ?? undefined,
          names,
        }),
      })
      const body = await res.json() as { ok: boolean; started?: number; error?: string }
      setReenvioResult(body)
      setReenvioMode('done')
    } catch (e) {
      setReenvioResult({ ok: false, error: (e as Error).message })
      setReenvioMode('done')
    }
  }

  const c          = data?.campaign
  const recipients = data?.recipients ?? []
  const total      = recipients.length
  const bySt       = Object.fromEntries(
    (['pendente', 'enviado', 'entregue', 'lido', 'falhou'] as const).map(s => [
      s, recipients.filter(r => r.status === s).length,
    ]),
  )
  const failedCount = bySt.falhou ?? 0
  const showReenvio = canDispatch && failedCount > 0 && c?.kind === 'manual' && c != null
  const isCampanha  = c?.kind === 'campanha'

  return (
    <div>
      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray2)', fontSize: 13, fontWeight: 600, padding: 0 }}
        >
          <ArrowLeft size={14} /> Disparos
        </button>
        <span style={{ color: 'var(--gray3)', fontWeight: 300 }}>/</span>
        <span style={{ fontSize: 13, color: 'var(--gray)', fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isLoading ? '…' : (c ? rowTitle(c) : 'Campanha')}
        </span>
        <div style={{ flex: 1 }} />
        <PillBtn onClick={exportCsv} icon={<Download size={12} />} label="Exportar CSV" disabled={!c || recipients.length === 0} />
        {showReenvio && reenvioMode === 'idle' && (
          <PillBtn onClick={() => setReenvioMode('confirm')} icon={<RotateCcw size={12} />} label={`Reenviar falhas (${failedCount})`} />
        )}
        <PillBtn onClick={refresh} icon={<RefreshCw size={12} />} label="Atualizar" />
      </div>

      {isLoading && (
        <div className="animate-slide-up delay-2" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...Array(5)].map((_, i) => <Skeleton key={i} height={52} radius={10} />)}
        </div>
      )}

      {isError && (
        <div className="animate-slide-up delay-2" style={{ padding: 24, textAlign: 'center', color: 'var(--red)', fontSize: 13 }}>
          Erro ao carregar.{' '}
          <button onClick={() => refetch()} style={{ background: 'none', border: 'none', color: 'var(--primary-text)', fontWeight: 700, cursor: 'pointer' }}>
            Tentar novamente
          </button>
        </div>
      )}

      {c && (
        <>
          {/* Campaign summary */}
          <div className="animate-slide-up delay-2" style={{
            background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 14,
            padding: '16px 20px', marginBottom: 18,
            display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--black)', marginBottom: 4 }}>{rowTitle(c)}</div>
              <div style={{ fontSize: 12, color: 'var(--gray2)' }}>
                {fmtDate(c.createdAt)}{c.createdByName ? ` · por ${c.createdByName}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
              <MetricPill label="Total"    value={total}         color="var(--ink)"          />
              <MetricPill label="Enviado"  value={bySt.enviado}  color="#1d4ed8"              />
              <MetricPill label="Entregue" value={bySt.entregue} color="var(--primary-text)"  />
              <MetricPill label="Lido"     value={bySt.lido}     color="var(--green)"         />
              <MetricPill label="Falhou"   value={bySt.falhou}   color="var(--red)"           />
              {bySt.pendente > 0 && <MetricPill label="Pendente" value={bySt.pendente} color="var(--gray2)" />}
            </div>
            <CampaignStatusBadge status={c.status} />
          </div>

          {/* Re-send confirm panel (manual only) */}
          {showReenvio && reenvioMode !== 'idle' && (
            <div className="animate-slide-up" style={{
              marginBottom: 18, padding: '14px 18px', borderRadius: 12,
              background: reenvioMode === 'done' && reenvioResult?.ok
                ? 'rgba(34,197,94,0.06)'
                : reenvioMode === 'done'
                  ? 'rgba(239,68,68,0.06)'
                  : 'rgba(245,158,11,0.07)',
              border: `1px solid ${
                reenvioMode === 'done' && reenvioResult?.ok
                  ? 'rgba(34,197,94,0.25)'
                  : reenvioMode === 'done'
                    ? 'rgba(239,68,68,0.25)'
                    : 'rgba(245,158,11,0.30)'
              }`,
            }}>
              {reenvioMode === 'confirm' && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>
                    Reenviar para {failedCount} destinatário{failedCount !== 1 ? 's' : ''} que falharam?
                  </div>
                  <div style={{ fontSize: 12, color: '#78350f', marginBottom: 14, lineHeight: 1.55 }}>
                    Será criada uma nova campanha com o mesmo template <strong>{c.template}</strong>.
                    Envio real via WhatsApp — ação irreversível.
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Button variant="ghost" onClick={() => setReenvioMode('idle')}>Cancelar</Button>
                    <Button variant="primary" onClick={reenviar}>Confirmar reenvio</Button>
                  </div>
                </>
              )}
              {reenvioMode === 'sending' && (
                <div style={{ fontSize: 13, color: 'var(--gray2)' }}>Criando nova campanha…</div>
              )}
              {reenvioMode === 'done' && reenvioResult?.ok && (
                <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>
                  ✓ Nova campanha criada — {reenvioResult.started ?? failedCount} disparo{(reenvioResult.started ?? failedCount) !== 1 ? 's' : ''} iniciado{(reenvioResult.started ?? failedCount) !== 1 ? 's' : ''}.{' '}
                  <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--primary-text)', fontWeight: 700, cursor: 'pointer', fontSize: 13, padding: 0 }}>
                    Ver todos os disparos →
                  </button>
                </div>
              )}
              {reenvioMode === 'done' && !reenvioResult?.ok && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
                    Erro ao reenviar: {reenvioResult?.error ?? 'erro desconhecido'}
                  </span>
                  <Button variant="ghost" onClick={() => setReenvioMode('idle')}>Tentar novamente</Button>
                </div>
              )}
            </div>
          )}

          {/* Recipient table */}
          <div className="animate-slide-up delay-3" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 14, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['Nome', 'Telefone', ...(isCampanha ? ['Template'] : []), 'Status', 'Motivo / Detalhe'].map(h => (
                    <th key={h} style={{
                      padding: '9px 16px', textAlign: 'left', fontSize: 10,
                      fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase',
                      letterSpacing: '0.07em', borderBottom: '1px solid var(--gray3)', whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recipients.length === 0 ? (
                  <tr>
                    <td colSpan={isCampanha ? 5 : 4} style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
                      Nenhum destinatário
                    </td>
                  </tr>
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
                    {isCampanha && (
                      <td style={{ padding: '11px 16px', fontSize: 12, color: r.template ? 'var(--gray)' : 'var(--gray3)', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.template ?? '—'}
                      </td>
                    )}
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

// ─── List row ─────────────────────────────────────────────────────────────────

function CampaignRow({ c, onClick }: { c: Campaign; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '14px 16px', cursor: 'pointer',
        borderBottom: '1px solid var(--gray3)', transition: 'background .12s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {rowTitle(c)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{fmtDate(c.createdAt)}</span>
          {c.createdByName && <span>por {c.createdByName}</span>}
          <CampaignStatusBadge status={c.status} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexShrink: 0 }}>
        <MetricPill label="Total"    value={c.totalSolicitado} color="var(--ink)"         />
        <MetricPill label="Enviado"  value={c.enviado}         color="#1d4ed8"             />
        <MetricPill label="Entregue" value={c.entregue}        color="var(--primary-text)" />
        <MetricPill label="Lido"     value={c.lido}            color="var(--green)"        />
        <MetricPill label="Falhou"   value={c.falhou}          color="var(--red)"          />
      </div>
      <div style={{ fontSize: 12, color: 'var(--gray2)', flexShrink: 0 }}>›</div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DisparosPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeKind,  setActiveKind]  = useState<CampaignKind>('manual')
  const [listKey,     setListKey]     = useState(0)

  const { data, isLoading, isError, refetch } = useQuery<{ campaigns: Campaign[] }>({
    queryKey: ['blast-campaigns', activeKind, listKey],
    queryFn:  () => fetch(`/api/sdr/blast/campaigns?kind=${activeKind}`).then(r => r.json()),
    staleTime: 0,
  })

  const refresh = useCallback(() => setListKey(k => k + 1), [])

  // When switching tabs, clear campaign selection
  function handleKindChange(k: CampaignKind) {
    setActiveKind(k)
    setSelectedId(null)
    setListKey(n => n + 1)
  }

  if (selectedId) {
    return <DetailView campaignId={selectedId} onBack={() => setSelectedId(null)} />
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
        <PillBtn onClick={refresh} icon={<RefreshCw size={13} />} label="Atualizar" />
      </div>

      {/* Tabs */}
      <div className="animate-slide-up delay-1">
        <TabBar active={activeKind} onChange={handleKindChange} />
      </div>

      {/* List */}
      <div className="animate-slide-up delay-2" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 14, overflow: 'hidden' }}>
        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '14px 16px', borderBottom: i < 3 ? '1px solid var(--gray3)' : 'none' }}>
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
            Erro ao carregar.{' '}
            <button onClick={() => refetch()} style={{ background: 'none', border: 'none', color: 'var(--primary-text)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              Tentar novamente
            </button>
          </div>
        )}

        {!isLoading && !isError && campaigns.length === 0 && (
          <div style={{ padding: '48px 20px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
            {activeKind === 'campanha'
              ? 'Nenhum disparo da Campanha SDR registrado ainda.'
              : 'Nenhum disparo manual realizado ainda.'}
          </div>
        )}

        {!isLoading && !isError && campaigns.map(c => (
          <CampaignRow key={c.id} c={c} onClick={() => setSelectedId(c.id)} />
        ))}
      </div>
    </div>
  )
}
