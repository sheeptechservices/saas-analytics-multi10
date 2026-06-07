'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import { KpiCard } from '@/components/widgets/KpiCard'
import { FunnelChart, FunnelFilterPanel } from '@/components/widgets/FunnelChart'
import type { FunnelStage } from '@/components/widgets/FunnelChart'
import { DonutChart } from '@/components/widgets/DonutChart'
import type { DonutSlice } from '@/components/widgets/DonutChart'
import { DataTable } from '@/components/widgets/DataTable'
import type { DataTableColumn } from '@/components/widgets/DataTable'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = '30d' | '90d' | '180d' | '365d'

const PERIOD_LABELS: Record<Period, string> = {
  '30d':  'Este mês',
  '90d':  'Trimestre',
  '180d': '6 meses',
  '365d': 'Este ano',
}

interface SdrBiData {
  period: string
  kpis: { contatos: number; taxaResposta: number; reunioes: number; conversao: number }
  funnel: { stageKey: string; stageName: string; count: number; order: number }[]
  sentiment: { id: string; label: string; color: string; count: number }[]
  recent: { sessionId: string; lastContact: number | null; msgs: number }[]
  lastSyncAt: number | null
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
      <span style={{ fontSize: 9 }}>✦</span> Analisar
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

// ─── Table columns ────────────────────────────────────────────────────────────

const TABLE_COLS: DataTableColumn[] = [
  {
    key: 'sessionLabel',
    label: 'Sessão',
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

function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '72px 32px', gap: 16, textAlign: 'center',
    }}>
      <div style={{ fontSize: 36, opacity: 0.4 }}>📡</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)' }}>Nenhum dado disponível</div>
      <div style={{ fontSize: 13, color: 'var(--gray2)', maxWidth: 340 }}>
        Configure e sincronize a integração Supabase / n8n para visualizar os dados reais do SDR IA.
      </div>
      <Link href="/settings/integrations/sdr-source" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 13, fontWeight: 700, color: 'var(--primary-text)',
        background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)',
        borderRadius: 99, padding: '8px 18px', textDecoration: 'none',
        transition: 'background .15s',
      }}>
        <Settings size={14} /> Configurar integração
      </Link>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SdrIaDashboardPage() {
  const [period, setPeriod]   = useState<Period>('30d')
  const [data, setData]       = useState<SdrBiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady]     = useState(false)

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
      .catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [period])

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

  // Derived table rows
  const tableRows = (data?.recent ?? []).map(r => ({
    sessionLabel: r.sessionId,
    msgs:         r.msgs,
    lastContact:  r.lastContact ?? 0,
  }))

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
            SDR IA
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
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
          Carregando...
        </div>
      )}

      {!loading && !hasData && <EmptyState />}

      {!loading && hasData && (
        <>
          {/* ── KPI Cards ──────────────────────────────────────────── */}
          <div className="animate-slide-up delay-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
            <KpiCard
              label="Contatos realizados"
              value={data!.kpis.contatos}
              accent="var(--primary-text)"
              sub={`de ${(data?.funnel.find(f => f.stageKey === 'leads')?.count ?? 0).toLocaleString('pt-BR')} leads recebidos`}
            />
            <KpiCard
              label="Taxa de resposta"
              value={data!.kpis.taxaResposta}
              format={v => `${v}%`}
              accent="#2563EB"
              sub="leads que responderam"
            />
            <KpiCard
              label="Reuniões agendadas"
              value={data!.kpis.reunioes}
              accent="var(--green)"
              sub="com closer neste período"
            />
            <KpiCard
              label="Conversão lead→reunião"
              value={data!.kpis.conversao}
              format={v => `${v}%`}
              accent="var(--green)"
              sub="do total de leads"
            />
          </div>

          {/* ── Funil + Sentiment ──────────────────────────────────── */}
          <div className="animate-slide-up delay-3" style={{ display: 'grid', gridTemplateColumns: sentimentSlices.length > 0 ? '3fr 2fr' : '1fr', gap: 16, marginBottom: 16 }}>

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
                  <AskAIButton question={`O funil de prospecção da SDR IA no período de ${PERIOD_LABELS[period]} mostra: ${allFunnelStages.map(s => `${s.name}: ${s.count}`).join(', ')}. Por que a conversão é essa? Como melhorar?`} />
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

            {/* Sentiment donut */}
            {sentimentSlices.length > 0 && (
              <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: '20px 24px' }}>
                <SectionTitle action={<AskAIButton question={`A distribuição de sentimento das interações SDR IA é: ${data!.sentiment.map(s => `${s.label}: ${s.count}`).join(', ')}. O que isso indica sobre a qualidade das conversas?`} />}>
                  Sentimento das interações
                </SectionTitle>
                <DonutChart slices={sentimentSlices} ready={ready} centerLabel="interações" />
              </div>
            )}
          </div>

          {/* ── Tabela de sessões recentes ─────────────────────────── */}
          {tableRows.length > 0 && (
            <div className="animate-slide-up delay-4" style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', overflow: 'hidden' }}>
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
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
