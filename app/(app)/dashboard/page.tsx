'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { BarChart3, Settings } from 'lucide-react'
import { SparkleIcon } from '@/components/icons/SparkleIcon'
import { KpiCard } from '@/components/widgets/KpiCard'
import { FunnelChart, FunnelFilterPanel } from '@/components/widgets/FunnelChart'
import type { FunnelStage } from '@/components/widgets/FunnelChart'
import { DonutChart } from '@/components/widgets/DonutChart'
import type { DonutSlice } from '@/components/widgets/DonutChart'
import { DataTable } from '@/components/widgets/DataTable'
import type { DataTableColumn } from '@/components/widgets/DataTable'
import { BarChart } from '@/components/widgets/BarChart'
import type { BarChartItem } from '@/components/widgets/BarChart'
import { useModules } from '@/components/ModulesProvider'
import { SkeletonKpiCards, SkeletonBlock } from '@/components/Skeleton'
import { Button } from '@/components/ui/Button'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = '30d' | '90d' | '180d' | '365d'

const PERIOD_LABELS: Record<Period, string> = {
  '30d':  'Este mês',
  '90d':  'Trimestre',
  '180d': '6 meses',
  '365d': 'Este ano',
}

interface WaTotals { sent: number; delivered: number; read: number; failed: number; inbound: number }
interface WaRates  { entrega: number; leitura: number }
interface WaDay    { date: string; sent: number; delivered: number; read: number; failed: number; inbound: number }
interface WaBlock  { totals: WaTotals; rates: WaRates; daily: WaDay[] }

interface SdrBiData {
  period: string
  kpis: { contatos: number; taxaResposta: number; reunioes: number; conversao: number }
  funnel: { stageKey: string; stageName: string; count: number; order: number }[]
  sentiment: { id: string; label: string; color: string; count: number }[]
  recent: { sessionId: string; source: string; lastContact: number | null; msgs: number; name: string | null }[]
  sourceConfigured: boolean
  whatsapp?: WaBlock
  lastSyncAt: number | null
}

const WA_ZERO: WaBlock = {
  totals: { sent: 0, delivered: 0, read: 0, failed: 0, inbound: 0 },
  rates:  { entrega: 0, leitura: 0 },
  daily:  [],
}

// ─── Stage colors ─────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  leads:      '#AAAAAA',
  contacted:  '#7A5600',
  responses:  '#2563EB',
  meetings:   '#1E8A3E',
  proposals:  '#7C3AED',
  closures:   '#0891B2',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ms: number | null): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'agora'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

function fmtDay(date: string): string {
  const parts = date.split('-')
  return `${parts[2]}/${parts[1]}`
}

// ─── Local components ─────────────────────────────────────────────────────────

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, fontWeight: 800, color: 'var(--gray2)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {children}
      </div>
      {action}
    </div>
  )
}

function AskAIButton({ question }: { question: string }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('ai-ask', { detail: { question } }))}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title="Perguntar à IA sobre este gráfico"
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 100,
        border: `1px solid ${hov ? 'var(--primary)' : 'var(--primary-mid)'}`,
        cursor: 'pointer', fontFamily: 'inherit',
        background: hov ? 'var(--primary)' : 'var(--primary-dim)',
        color: hov ? 'var(--primary-contrast)' : 'var(--primary-text)',
        transform: hov ? 'scale(1.05)' : 'scale(1)',
        boxShadow: hov ? '0 2px 8px rgba(255,180,0,0.3)' : 'none',
        transition: 'all 0.18s cubic-bezier(0.34,1.4,0.64,1)',
      }}
    >
      <SparkleIcon size={9} /> Analisar
    </button>
  )
}

function PeriodFilter({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const options: Period[] = ['30d', '90d', '180d', '365d']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 100, padding: '3px 4px', boxShadow: 'var(--shadow)' }}>
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          padding: '5px 14px', borderRadius: 100, border: 'none',
          fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          transition: 'all .18s ease',
          background: value === opt ? 'var(--primary)' : 'transparent',
          color: value === opt ? 'var(--primary-contrast)' : 'var(--gray)',
          boxShadow: value === opt ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
        }}>
          {PERIOD_LABELS[opt]}
        </button>
      ))}
    </div>
  )
}

function SourceBadge({ source }: { source: string }) {
  const isWa = source === 'ycloud-whatsapp'
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10, fontWeight: 700,
      padding: '2px 8px', borderRadius: 100,
      background: isWa ? 'rgba(37,211,102,0.10)' : 'rgba(37,99,235,0.08)',
      color:      isWa ? '#15803d'              : '#1d4ed8',
      border: `1px solid ${isWa ? 'rgba(37,211,102,0.25)' : 'rgba(37,99,235,0.20)'}`,
    }}>
      {isWa ? 'WhatsApp' : 'SDR'}
    </span>
  )
}

// ─── Table columns ────────────────────────────────────────────────────────────

const TABLE_COLS: DataTableColumn[] = [
  {
    key: 'name',
    label: 'Nome',
    sortable: true,
    format: (v) => (
      <span style={{ fontWeight: 700, color: 'var(--black)' }}>
        {v as string}
      </span>
    ),
  },
  {
    key: 'source',
    label: 'Origem',
    sortable: false,
    format: (v) => <SourceBadge source={v as string} />,
  },
  {
    key: 'sessionLabel',
    label: 'Telefone',
    sortable: false,
    format: (v) => (
      <span title={v as string} style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--gray2)' }}>
        {(v as string).slice(0, 20)}
      </span>
    ),
  },
  { key: 'msgs', label: 'Mensagens', sortable: true },
  {
    key: 'lastContact',
    label: 'Última interação',
    sortable: true,
    format: (v) => timeAgo(v as number | null),
  },
]

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ configured, onSync }: { configured: boolean; onSync: () => void }) {
  const [syncing,   setSyncing]   = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  async function handleSync() {
    if (syncing) return
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await fetch('/api/sdr/sync', { method: 'POST' })
      if (!res.ok) throw new Error()
      onSync()
    } catch {
      setSyncError('Falha ao sincronizar — tente novamente.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', padding: '0 32px', gap: 16, textAlign: 'center',
    }}>
      <BarChart3 size={40} color="var(--gray2)" opacity={0.45} />
      {configured ? (
        <>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)' }}>Nenhum dado ainda</div>
          <div style={{ fontSize: 13, color: 'var(--gray2)', maxWidth: 340 }}>
            Os dados de prospecção vão aparecer aqui conforme as conversas e métricas forem registradas.
          </div>
          {syncError && (
            <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>{syncError}</div>
          )}
          <Button variant="primary" disabled={syncing} onClick={() => { void handleSync() }}>
            {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
          </Button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)' }}>Nenhum dado disponível</div>
          <div style={{ fontSize: 13, color: 'var(--gray2)', maxWidth: 340 }}>
            Configure e sincronize a fonte de dados de prospecção para visualizar os dados reais.
          </div>
          <Link href="/settings/integrations/sdr-source" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 13, fontWeight: 600,
            color: 'var(--ink-2)',
            background: 'var(--white)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 16px',
            textDecoration: 'none',
            transition: 'background 0.2s ease',
            fontFamily: 'inherit',
          }}>
            <Settings size={14} /> Configurar integração
          </Link>
        </>
      )}
    </div>
  )
}

// ─── WhatsApp section header ──────────────────────────────────────────────────

function WaSectionHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, marginTop: 8 }}>
      <div style={{ width: 3, height: 18, borderRadius: 2, background: '#25D366' }} />
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        WhatsApp (YCloud)
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [period,     setPeriod]     = useState<Period>('30d')
  const [data,       setData]       = useState<SdrBiData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(false)
  const [ready,      setReady]      = useState(false)
  const [fetchEpoch, setFetchEpoch] = useState(0)

  const router    = useRouter()
  const modules   = useModules()
  const hasYCloud = modules.includes('integration.ycloud-whatsapp')

  // Funnel visibility
  const [visibleStageIds, setVisibleStageIds] = useState<Set<string>>(new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null)
  const filterBtnRef = useRef<HTMLButtonElement>(null)

  // Reset visible stages when period changes
  useEffect(() => { setVisibleStageIds(new Set()) }, [period])

  // Fetch data
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setReady(false)
    setFilterOpen(false)

    fetch(`/api/bi/sdr?period=${period}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: SdrBiData) => {
        if (cancelled) return
        setData(d)
        setLoading(false)
        setTimeout(() => { if (!cancelled) setReady(true) }, 80)
      })
      .catch(() => { if (!cancelled) { setLoading(false); setError(true) } })

    return () => { cancelled = true }
  }, [period, fetchEpoch])

  // Derived funnel data
  const allFunnelStages: FunnelStage[] = (data?.funnel ?? []).map(f => ({
    id:    f.stageKey,
    name:  f.stageName,
    color: STAGE_COLORS[f.stageKey] ?? '#AAAAAA',
    count: f.count,
  }))

  const effectiveVisible: Set<string> = visibleStageIds.size > 0
    ? visibleStageIds
    : new Set(allFunnelStages.map(s => s.id))

  const visibleFunnelStages = allFunnelStages.filter(s => effectiveVisible.has(s.id))

  // Derived sentiment slices
  const sentimentSlices: DonutSlice[] = (data?.sentiment ?? []).map(s => ({
    id: s.id, label: s.label, color: s.color, count: s.count,
  }))

  // Derived table rows — use phone as name fallback when no name available
  const tableRows = (data?.recent ?? []).map(r => ({
    name:         r.name ?? r.sessionId,
    source:       r.source,
    sessionLabel: r.sessionId,
    sessionId:    r.sessionId,
    msgs:         r.msgs,
    lastContact:  r.lastContact ?? 0,
  }))

  // WhatsApp derived data — fallback to zeros so section never crashes
  const wa: WaBlock = data?.whatsapp ?? WA_ZERO

  // Daily chart capped at last 30 data points for bar readability
  const waDailyChart = wa.daily.slice(-30)
  const waDailyInbound: BarChartItem[] = waDailyChart.map(d => ({ label: fmtDay(d.date), count: d.inbound }))
  const waDailySent:    BarChartItem[] = waDailyChart.map(d => ({ label: fmtDay(d.date), count: d.sent    }))
  // Shared Y-scale so the two daily charts are honestly comparable
  const waChartMax = Math.max(...waDailyInbound.map(d => d.count), ...waDailySent.map(d => d.count), 1)

  const hasData = (data?.funnel.length ?? 0) > 0 || (data?.recent.length ?? 0) > 0

  function openFilter() {
    if (!filterBtnRef.current) return
    const rect = filterBtnRef.current.getBoundingClientRect()
    setPanelPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
    setFilterOpen(true)
  }

  return (
    <div>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="animate-slide-up delay-1" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            Visão geral
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--gray)' }}>
              Prospecção ativa com IA — do primeiro contato até a reunião com o closer.
            </div>
            {data?.lastSyncAt && (
              <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, flexShrink: 0 }}>
                atualizado há {timeAgo(data.lastSyncAt)}
              </div>
            )}
          </div>
        </div>
        <PeriodFilter value={period} onChange={p => setPeriod(p)} />
      </div>

      {loading && (
        <>
          <SkeletonKpiCards count={4} />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 16, marginBottom: 16 }}>
            <SkeletonBlock height={200} />
            <SkeletonBlock height={200} />
          </div>
          <SkeletonBlock height={180} />
        </>
      )}

      {!loading && error && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '40vh', gap: 16, textAlign: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--black)' }}>Não foi possível carregar os dados</div>
          <div style={{ fontSize: 13, color: 'var(--gray2)', maxWidth: 320 }}>
            Verifique a conexão e tente novamente.
          </div>
          <Button variant="primary" onClick={() => { setError(false); setFetchEpoch(e => e + 1) }}>
            Tentar de novo
          </Button>
        </div>
      )}

      {!loading && !error && !hasData && (
        <EmptyState
          configured={data?.sourceConfigured ?? false}
          onSync={() => setFetchEpoch(e => e + 1)}
        />
      )}

      {!loading && !error && hasData && (
        <>
          {/* ── KPI Cards (SDR) ────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
            <KpiCard
              className="animate-slide-up delay-2"
              label="Contatos realizados"
              value={data!.kpis.contatos}
              accent="var(--primary-text)"
              sub={`de ${(data?.funnel.find(f => f.stageKey === 'leads')?.count ?? 0).toLocaleString('pt-BR')} leads recebidos`}
            />
            <KpiCard
              className="animate-slide-up delay-3"
              label="Taxa de resposta"
              value={data!.kpis.taxaResposta}
              format={v => `${v}%`}
              accent="#2563EB"
              sub="leads que responderam"
            />
            <KpiCard
              className="animate-slide-up delay-4"
              label="Reuniões agendadas"
              value={data!.kpis.reunioes}
              accent="var(--green)"
              sub="com closer neste período"
            />
            <KpiCard
              className="animate-slide-up delay-5"
              label="Conversão lead→reunião"
              value={data!.kpis.conversao}
              format={v => `${v}%`}
              accent="var(--green)"
              sub="do total de leads"
            />
          </div>

          {/* ── Funil + Sentiment ──────────────────────────────────── */}
          <div className="animate-slide-up delay-3" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 16, marginBottom: 16 }}>

            {/* Funil horizontal */}
            <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: '20px 24px' }}>
              <SectionTitle action={
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    ref={filterBtnRef}
                    onClick={openFilter}
                    style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 100,
                      border: '1px solid var(--gray3)', cursor: 'pointer', fontFamily: 'inherit',
                      background: 'var(--bg)', color: 'var(--gray2)', transition: 'all .15s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--gray2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--black)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--gray3)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--gray2)' }}
                  >
                    Filtrar etapas
                  </button>
                  <AskAIButton question={`O funil de prospecção no período de ${PERIOD_LABELS[period]} mostra: ${allFunnelStages.map(s => `${s.name}: ${s.count}`).join(', ')}. Por que a conversão é essa? Como melhorar?`} />
                </div>
              }>
                Funil de prospecção
              </SectionTitle>
              <FunnelChart
                allStages={allFunnelStages}
                stages={visibleFunnelStages}
                visible={effectiveVisible}
                ready={ready}
                unit="lead"
              />
              {filterOpen && panelPos && (
                <FunnelFilterPanel
                  allStages={allFunnelStages}
                  visible={effectiveVisible}
                  onChange={next => { setVisibleStageIds(new Set(next)); setFilterOpen(false) }}
                  onClose={() => setFilterOpen(false)}
                  top={panelPos.top}
                  right={panelPos.right}
                />
              )}
            </div>

            {/* Sentiment donut — always rendered; empty state when no data */}
            <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: '20px 24px' }}>
              <SectionTitle action={sentimentSlices.length > 0 ? <AskAIButton question={`A distribuição de sentimento das interações de prospecção é: ${data!.sentiment.map(s => `${s.label}: ${s.count}`).join(', ')}. O que isso indica sobre a qualidade das conversas?`} /> : undefined}>
                Sentimento das interações
              </SectionTitle>
              {sentimentSlices.length > 0 ? (
                <DonutChart slices={sentimentSlices} ready={ready} centerLabel="interações" />
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minHeight: 120, fontSize: 12, color: 'var(--gray2)', fontWeight: 500, textAlign: 'center',
                }}>
                  Sem dados de sentimento no período
                </div>
              )}
            </div>
          </div>

          {/* ── WhatsApp (YCloud) section — conditional on module ──── */}
          {hasYCloud && (
            <div className="animate-slide-up delay-4">
              <WaSectionHeader />

              {/* 4 volume cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 14 }}>
                <KpiCard label="Recebidas"  value={wa.totals.inbound}   accent="#0891B2" sub="mensagens inbound" />
                <KpiCard label="Enviadas"   value={wa.totals.sent}      accent="#64748B" sub="mensagens outbound" />
                <KpiCard label="Entregues"  value={wa.totals.delivered} accent="#2563EB" />
                <KpiCard label="Lidas"      value={wa.totals.read}      accent="#1E8A3E" />
              </div>

              {/* 3 rate / failure cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
                <KpiCard
                  label="Taxa de entrega"
                  value={Math.round(wa.rates.entrega * 100)}
                  format={v => `${v}%`}
                  accent="#2563EB"
                  sub={`${wa.totals.delivered.toLocaleString('pt-BR')} de ${wa.totals.sent.toLocaleString('pt-BR')} enviadas`}
                />
                <KpiCard
                  label="Taxa de leitura"
                  value={Math.round(wa.rates.leitura * 100)}
                  format={v => `${v}%`}
                  accent="#1E8A3E"
                  sub={`${wa.totals.read.toLocaleString('pt-BR')} de ${wa.totals.delivered.toLocaleString('pt-BR')} entregues`}
                />
                <KpiCard label="Falhas" value={wa.totals.failed} accent="#D93025" sub="mensagens não entregues" />
              </div>

              {/* Daily charts — only when there are data points */}
              {waDailyChart.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, marginBottom: 20 }}>
                  <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: '20px 24px' }}>
                    <SectionTitle>Recebidas por dia</SectionTitle>
                    <BarChart data={waDailyInbound} ready={ready} unit="mensagem" maxValue={waChartMax} />
                  </div>
                  <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: '20px 24px' }}>
                    <SectionTitle>Enviadas por dia</SectionTitle>
                    <BarChart data={waDailySent} ready={ready} unit="mensagem" maxValue={waChartMax} />
                  </div>
                </div>
              )}

              {/* Empty state for when module is enabled but no data yet */}
              {waDailyChart.length === 0 && wa.totals.inbound === 0 && wa.totals.sent === 0 && (
                <div style={{
                  padding: '20px 24px', marginBottom: 20,
                  background: 'var(--bg)', border: '1px solid var(--gray3)',
                  borderRadius: 16, textAlign: 'center',
                  fontSize: 13, color: 'var(--gray2)', fontWeight: 500,
                }}>
                  Nenhuma mensagem WhatsApp no período. Os dados aparecem aqui assim que o primeiro webhook for recebido ou o backfill concluir.
                </div>
              )}
            </div>
          )}

          {/* ── Tabela de sessões recentes ─────────────────────────── */}
          {tableRows.length > 0 && (
            <div className="animate-slide-up delay-5" style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--gray3)', background: 'var(--bg)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Sessões recentes — {tableRows.length} conversas
                </div>
                <AskAIButton question={`Há ${tableRows.length} sessões de conversa SDR IA no período. A mais ativa tem ${Math.max(...tableRows.map(r => r.msgs))} mensagens. Como interpretar a atividade dessas conversas?`} />
              </div>
              <DataTable
                columns={TABLE_COLS}
                rows={tableRows}
                defaultSortKey="lastContact"
                defaultSortDir="desc"
                emptyMessage="Nenhuma sessão encontrada no período"
                rowKey="sessionId"
                onRowClick={row => router.push(`/sdr-ia/conversas?session=${encodeURIComponent(String(row.sessionId ?? ''))}`)}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
