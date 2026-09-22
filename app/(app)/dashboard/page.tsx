'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { BarChart3, Settings } from 'lucide-react'
import { KpiBand } from '@/components/widgets/KpiBand'
import type { KpiBandItem } from '@/components/widgets/KpiBand'
import { FunnelChart, FunnelFilterPanel } from '@/components/widgets/FunnelChart'
import type { FunnelStage } from '@/components/widgets/FunnelChart'
import { StackedBar, StackedBarLegend } from '@/components/widgets/StackedBar'
import type { StackedBarSegment } from '@/components/widgets/StackedBar'
import { DataTable } from '@/components/widgets/DataTable'
import type { DataTableColumn } from '@/components/widgets/DataTable'
import { BarChart } from '@/components/widgets/BarChart'
import type { BarChartItem, BarChartSeries } from '@/components/widgets/BarChart'
import { useModules } from '@/components/ModulesProvider'
import { SkeletonKpiBand, SkeletonBlock } from '@/components/Skeleton'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Chip, ChipGroup } from '@/components/ui/Chip'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { SegmentedOption } from '@/components/ui/SegmentedControl'
import { timeAgo } from '@/lib/format'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = '30d' | '90d' | '180d' | '365d'

const PERIOD_LABELS: Record<Period, string> = {
  '30d':  'Este mês',
  '90d':  'Trimestre',
  '180d': '6 meses',
  '365d': 'Este ano',
}

const PERIOD_OPTIONS: SegmentedOption<Period>[] =
  (Object.keys(PERIOD_LABELS) as Period[]).map(p => ({ value: p, label: PERIOD_LABELS[p] }))

interface WaTotals { sent: number; delivered: number; read: number; failed: number; inbound: number }
interface WaRates  { entrega: number; leitura: number }
interface WaDay    { date: string; sent: number; delivered: number; read: number; failed: number; inbound: number }
interface WaBlock  { totals: WaTotals; rates: WaRates; daily: WaDay[] }

type Trend = 'up' | 'down' | 'flat'
type SessionStatus = 'respondeu' | 'aguardando' | 'fria'

interface SdrBiData {
  period: string
  kpis: { contatos: number; taxaResposta: number; reunioes: number; conversao: number }
  kpisChange?: {
    contatos?:     { pct: number; trend: Trend } | null
    taxaResposta?: { pp: number;  trend: Trend } | null
    reunioes?:     { pct: number; trend: Trend } | null
    conversao?:    { pp: number;  trend: Trend } | null
  }
  funnel: { stageKey: string; stageName: string; count: number; order: number }[]
  sentiment: { id: string; label: string; color: string; count: number }[]
  recent: { sessionId: string; source: string; lastContact: number | null; msgs: number; name: string | null; status: SessionStatus }[]
  sourceConfigured: boolean
  whatsapp?: WaBlock
  lastSyncAt: number | null
}

const WA_ZERO: WaBlock = {
  totals: { sent: 0, delivered: 0, read: 0, failed: 0, inbound: 0 },
  rates:  { entrega: 0, leitura: 0 },
  daily:  [],
}

// ─── Constantes de apresentação ───────────────────────────────────────────────

/** Como cada etapa é citada na taxa da etapa seguinte ("38% dos contatados"). */
const STAGE_RATIO_LABEL: Record<string, string> = {
  leads:     'dos leads',
  contacted: 'dos contatados',
  responses: 'das respostas',
  meetings:  'das reuniões',
  proposals: 'das propostas',
  closures:  'dos fechamentos',
}

/** Cor de cada sentimento conhecido — vence a `color` que a API manda.
 *  Por quê: a API (app/api/bi/sdr) devolve cores próprias, e o "Neutro" chega
 *  em âmbar, furando o princípio do design: dado na escala de tinta, sinal de
 *  status só em verde / vermelho / cinza. Para os ids que a API conhece, o
 *  token é a fonte da verdade (barra e legenda leem o mesmo `color`); a cor da
 *  API só entra para um id fora deste mapa.
 *  "Sem análise" (`unknown`) usa --gray2. O --line de antes sumia sobre o
 *  trilho --line-2 e o cartão branco: num tenant ainda sem análise (100%
 *  `unknown`) a barra parecia vazia. O --gray2 fica um degrau mais escuro que
 *  o --ink-dim do neutro — preço aceito para que "sem análise" seja legível
 *  como dado; segue cinza, fora das cores de status. */
const SENTIMENT_TOKEN_COLOR = new Map<string, string>([
  ['positive', 'var(--success)'],
  ['neutral',  'var(--ink-dim)'],
  ['negative', 'var(--danger)'],
  ['unknown',  'var(--gray2)'],
])

/** Janela do "Volume diário": os últimos 30 pontos, e o eixo do gráfico sempre
 *  com 30 posições — com menos dias a barra não estica (ver BarChart `slots`). */
const DAILY_POINTS = 30

const WA_SERIES: BarChartSeries[] = [
  { key: 'sent',    label: 'Enviadas',  color: 'var(--ink)' },
  { key: 'inbound', label: 'Recebidas', color: 'var(--ink-dim)' },
]

type StatusFilter = 'todas' | 'aguardando' | 'fria'

const STATUS_FILTERS: { value: StatusFilter; label: string; empty: string }[] = [
  { value: 'todas',      label: 'Todas',      empty: 'Nenhuma sessão encontrada no período' },
  { value: 'aguardando', label: 'Aguardando', empty: 'Nenhuma sessão aguardando resposta no período' },
  { value: 'fria',       label: 'Frias',      empty: 'Nenhuma sessão fria no período' },
]

const STATUS_BADGE: Record<SessionStatus, { label: string; variant: 'success' | 'warn' | 'neutral' }> = {
  respondeu:  { label: 'Respondeu',  variant: 'success' },
  aguardando: { label: 'Aguardando', variant: 'warn' },
  fria:       { label: 'Fria',       variant: 'neutral' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const nf  = new Intl.NumberFormat('pt-BR')
const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

const fmtInt = (n: number) => nf.format(n)
/** Percentual já em 0–100 → "7,5%". */
const fmtPct = (n: number) => `${nf1.format(n)}%`
/** Taxa em 0–1 → "97,3%". */
const fmtRate = (r: number) => `${nf1.format(Math.round(r * 1000) / 10)}%`

/** "1 reunião" / "96 reuniões" — número em pt-BR + forma certa. */
function countLabel(n: number, singular: string, plural: string): string {
  return `${fmtInt(n)} ${n === 1 ? singular : plural}`
}

function fmtDay(date: string): string {
  const parts = date.split('-')
  return `${parts[2]}/${parts[1]}`
}

function syncLabel(ms: number): string {
  const ago = timeAgo(ms)
  return ago === 'agora' ? 'atualizado agora' : `atualizado há ${ago}`
}

// ─── Table columns ────────────────────────────────────────────────────────────

const TABLE_COLS: DataTableColumn[] = [
  {
    key: 'name',
    label: 'Nome',
    sortable: true,
    format: (v) => (
      <span title={v as string} className="block truncate" style={{ fontWeight: 700, color: 'var(--ink)' }}>
        {v as string}
      </span>
    ),
  },
  {
    key: 'source',
    label: 'Origem',
    sortable: false,
    width: 108,
    format: (v) => (
      v === 'ycloud-whatsapp'
        ? <Badge variant="success" dot={false}>WhatsApp</Badge>
        : <Badge variant="info" dot={false}>SDR</Badge>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    width: 122,
    format: (v) => {
      const cfg = STATUS_BADGE[v as SessionStatus] ?? STATUS_BADGE.fria
      return <Badge variant={cfg.variant} dot={false}>{cfg.label}</Badge>
    },
  },
  {
    key: 'sessionLabel',
    label: 'Telefone',
    sortable: false,
    width: 162,
    format: (v) => (
      <span title={v as string} className="block truncate font-mono tabular-nums" style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--muted)' }}>
        {v as string}
      </span>
    ),
  },
  {
    key: 'msgs',
    label: 'Mensagens',
    sortable: true,
    align: 'right',
    width: 108,
    format: (v) => <span style={{ fontWeight: 700 }}>{fmtInt(v as number)}</span>,
  },
  {
    key: 'lastContact',
    label: 'Última interação',
    sortable: true,
    align: 'right',
    width: 160,
    tone: 'muted',
    format: (v) => <span style={{ fontSize: 'var(--text-sm)' }}>{timeAgo((v as number) || null)}</span>,
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

// ─── Painel de entrega WhatsApp ───────────────────────────────────────────────
// Um painel só no lugar dos 7 KpiCards e dos 2 gráficos diários: três taxas,
// a barra de destino das mensagens, os totais em linha e um gráfico diário
// com as duas séries na mesma escala.

function WhatsAppPanel({ wa, ready }: { wa: WaBlock; ready: boolean }) {
  const { sent, delivered, read, failed, inbound } = wa.totals
  const daily = wa.daily.slice(-DAILY_POINTS)   // últimos 30 pontos, pela legibilidade das barras
  const isEmpty = daily.length === 0 && sent === 0 && delivered === 0 && failed === 0 && inbound === 0

  // Sem denominador a taxa não existe: "—" em vez de um 0% enganoso.
  const rates = [
    { id: 'entrega', label: 'Entrega', value: sent > 0      ? fmtRate(wa.rates.entrega) : null, color: 'var(--ink)' },
    { id: 'leitura', label: 'Leitura', value: delivered > 0 ? fmtRate(wa.rates.leitura) : null, color: 'var(--ink)' },
    { id: 'falhas',  label: 'Falhas',  value: sent > 0      ? fmtRate(failed / sent)    : null, color: 'var(--danger)' },
  ]

  const destination: StackedBarSegment[] = [
    { id: 'read',      label: 'Lidas',               value: read,                           color: 'var(--ink)' },
    { id: 'delivered', label: 'Entregues não lidas', value: Math.max(delivered - read, 0), color: 'var(--ink-dim)' },
    { id: 'failed',    label: 'Falhas',              value: failed,                         color: 'var(--danger)' },
  ]

  const chartData: BarChartItem[] = daily.map(d => ({
    label:  fmtDay(d.date),
    values: { sent: d.sent, inbound: d.inbound },
  }))

  return (
    <Card variant="flat" className="animate-slide-up delay-4">
      <h2 className="label-data" style={{ marginBottom: 20 }}>Entrega WhatsApp · YCloud</h2>

      {isEmpty ? (
        <p style={{ fontSize: 'var(--text-md)', fontWeight: 500, color: 'var(--muted)', textAlign: 'center', padding: '8px 0' }}>
          Nenhuma mensagem WhatsApp no período. Os dados aparecem aqui assim que o primeiro webhook for recebido ou o backfill concluir.
        </p>
      ) : (
        <div className="dash-wa-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <dl style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 24 }}>
              {rates.map(r => (
                <div key={r.id}>
                  <dt className="label-data" style={{ marginBottom: 5 }}>{r.label}</dt>
                  <dd className="tabular-nums" style={{
                    fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1,
                    color: r.value === null ? 'var(--muted)' : r.color,
                  }}>
                    {r.value ?? '—'}
                  </dd>
                </div>
              ))}
            </dl>

            <StackedBar
              segments={destination}
              height={8}
              label={`Destino das mensagens enviadas: ${destination.map(s => `${s.label.toLocaleLowerCase('pt-BR')} ${fmtInt(s.value)}`).join(', ')}`}
            />

            <p className="tabular-nums" style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--muted)', lineHeight: 1.6 }}>
              {countLabel(sent, 'enviada', 'enviadas')} · {countLabel(delivered, 'entregue', 'entregues')} · {countLabel(read, 'lida', 'lidas')} · {countLabel(failed, 'falha', 'falhas')}
              <br />
              {countLabel(inbound, 'mensagem recebida', 'mensagens recebidas')} no período
            </p>
          </div>

          {chartData.length > 0 ? (
            <BarChart
              title="Volume diário"
              data={chartData}
              series={WA_SERIES}
              ready={ready}
              unit="mensagem"
              height={88}
              axis="ends"
              slots={DAILY_POINTS}
            />
          ) : (
            <div>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--ink-2)', marginBottom: 10 }}>Volume diário</div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--muted)' }}>Sem série diária no período.</div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [period,       setPeriod]       = useState<Period>('30d')
  const [data,         setData]         = useState<SdrBiData | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [ready,        setReady]        = useState(false)
  const [fetchEpoch,   setFetchEpoch]   = useState(0)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todas')

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

  // ── Funil ──────────────────────────────────────────────────────────────────
  const funnel = data?.funnel ?? []
  const allFunnelStages: FunnelStage[] = [...funnel]
    .sort((a, b) => a.order - b.order)
    .map(f => ({
      id:         f.stageKey,
      name:       f.stageName,
      count:      f.count,
      ratioLabel: STAGE_RATIO_LABEL[f.stageKey],
    }))

  const effectiveVisible: Set<string> = visibleStageIds.size > 0
    ? visibleStageIds
    : new Set(allFunnelStages.map(s => s.id))

  const visibleFunnelStages = allFunnelStages.filter(s => effectiveVisible.has(s.id))

  // ── KPIs — tudo derivado da resposta; o que não dá para derivar fica de fora
  const stageCount = (key: string) => funnel.find(f => f.stageKey === key)?.count
  const leadsCount     = stageCount('leads')
  const responsesCount = stageCount('responses')
  const kpis   = data?.kpis
  const change = data?.kpisChange

  const heroKpi: KpiBandItem | null = kpis ? {
    id:    'conversao',
    label: 'Conversão lead → reunião',
    value: fmtPct(kpis.conversao),
    sub:   leadsCount !== undefined
      ? `${countLabel(kpis.reunioes, 'reunião', 'reuniões')} de ${countLabel(leadsCount, 'lead recebido', 'leads recebidos')}`
      : null,
    delta: change?.conversao ? { value: change.conversao.pp, unit: 'pp', trend: change.conversao.trend } : null,
  } : null

  const kpiItems: KpiBandItem[] = kpis ? [
    {
      id:    'contatos',
      label: 'Contatos realizados',
      value: fmtInt(kpis.contatos),
      sub:   leadsCount ? `${fmtPct(Math.round((kpis.contatos / leadsCount) * 100))} dos leads recebidos` : null,
      delta: change?.contatos ? { value: change.contatos.pct, unit: '%', trend: change.contatos.trend } : null,
    },
    {
      id:    'taxaResposta',
      label: 'Taxa de resposta',
      value: fmtPct(kpis.taxaResposta),
      sub:   responsesCount !== undefined ? countLabel(responsesCount, 'lead respondeu', 'leads responderam') : null,
      delta: change?.taxaResposta ? { value: change.taxaResposta.pp, unit: 'pp', trend: change.taxaResposta.trend } : null,
    },
    {
      id:    'reunioes',
      label: 'Reuniões agendadas',
      value: fmtInt(kpis.reunioes),
      delta: change?.reunioes ? { value: change.reunioes.pct, unit: '%', trend: change.reunioes.trend } : null,
    },
  ] : []

  // ── Sentimento ─────────────────────────────────────────────────────────────
  const sentimentSegments: StackedBarSegment[] = (data?.sentiment ?? [])
    .filter(s => s.count > 0)
    .map(s => ({
      id:    s.id,
      label: s.label,
      value: s.count,
      // Token primeiro (ids conhecidos); id novo cai na cor da API e, sem ela, num cinza neutro.
      color: SENTIMENT_TOKEN_COLOR.get(s.id) ?? (s.color || 'var(--gray2)'),
    }))

  // ── Sessões — telefone como nome quando não há contato associado ───────────
  const allRows = (data?.recent ?? []).map(r => ({
    name:         r.name ?? r.sessionId,
    source:       r.source,
    sessionLabel: r.sessionId,
    sessionId:    r.sessionId,
    msgs:         r.msgs,
    lastContact:  r.lastContact ?? 0,
    status:       r.status,
  }))
  const tableRows = statusFilter === 'todas' ? allRows : allRows.filter(r => r.status === statusFilter)
  const activeFilter = STATUS_FILTERS.find(f => f.value === statusFilter) ?? STATUS_FILTERS[0]

  // WhatsApp derived data — fallback to zeros so section never crashes
  const wa: WaBlock = data?.whatsapp ?? WA_ZERO

  const hasData = (data?.funnel.length ?? 0) > 0 || (data?.recent.length ?? 0) > 0

  function openFilter() {
    if (!filterBtnRef.current) return
    const rect = filterBtnRef.current.getBoundingClientRect()
    setPanelPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
    setFilterOpen(true)
  }

  // Fechar devolve o foco ao botão "Etapas" (o painel vive num portal).
  const closeFilter = useCallback(() => {
    setFilterOpen(false)
    filterBtnRef.current?.focus()
  }, [])

  function askAboutFunnel() {
    const question = `O funil de prospecção no período de ${PERIOD_LABELS[period]} mostra: ${allFunnelStages.map(s => `${s.name}: ${s.count}`).join(', ')}. Por que a conversão é essa? Como melhorar?`
    window.dispatchEvent(new CustomEvent('ai-ask', { detail: { question } }))
  }

  return (
    <div className="dash">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="dash-header animate-slide-up delay-1">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.25, color: 'var(--ink)' }}>
            Visão geral
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 10, rowGap: 4, marginTop: 4 }}>
            <p style={{ fontSize: 'var(--text-md)', color: 'var(--gray)' }}>
              Prospecção ativa com IA, do primeiro contato até a reunião com o closer.
            </p>
            {data?.lastSyncAt && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--muted)',
              }}>
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
                {syncLabel(data.lastSyncAt)}
              </span>
            )}
          </div>
        </div>
        <SegmentedControl label="Período" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
      </header>

      {loading && (
        <>
          <span className="sr-only" role="status">Carregando os dados do período…</span>
          <SkeletonKpiBand count={4} />
          <div className="dash-grid" aria-hidden>
            <SkeletonBlock height={280} radius="var(--radius-md)" />
            <SkeletonBlock height={280} radius="var(--radius-md)" />
          </div>
          <SkeletonBlock height={300} radius="var(--radius-md)" />
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

      {!loading && !error && hasData && heroKpi && (
        <>
          {/* ── Faixa de KPIs ──────────────────────────────────────── */}
          <KpiBand className="animate-slide-up delay-2" hero={heroKpi} items={kpiItems} />

          {/* ── Funil + Sentimento ─────────────────────────────────── */}
          <div className="dash-grid animate-slide-up delay-3">

            <Card variant="flat">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
                <h2 className="label-data">Funil de prospecção</h2>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button
                    ref={filterBtnRef}
                    variant="secondary" size="sm" shape="pill"
                    onClick={openFilter}
                    disabled={allFunnelStages.length === 0}
                    aria-haspopup="dialog"
                    aria-expanded={filterOpen}
                  >
                    Etapas
                  </Button>
                  <Button
                    variant="primary" size="sm" shape="pill"
                    onClick={askAboutFunnel}
                    disabled={allFunnelStages.length === 0}
                    title="Perguntar à IA sobre este funil"
                  >
                    Analisar
                  </Button>
                </div>
              </div>
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
                  onChange={next => { setVisibleStageIds(new Set(next)); closeFilter() }}
                  onClose={closeFilter}
                  top={panelPos.top}
                  right={panelPos.right}
                />
              )}
            </Card>

            <Card variant="flat">
              <h2 className="label-data" style={{ marginBottom: 16 }}>Sentimento das interações</h2>
              {sentimentSegments.length > 0 ? (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <StackedBar segments={sentimentSegments} height={10} />
                  </div>
                  <StackedBarLegend segments={sentimentSegments} />
                </>
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minHeight: 120, fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--muted)', textAlign: 'center',
                }}>
                  Sem dados de sentimento no período
                </div>
              )}
            </Card>
          </div>

          {/* ── WhatsApp (YCloud) — condicional ao módulo ──────────── */}
          {hasYCloud && <WhatsAppPanel wa={wa} ready={ready} />}

          {/* ── Sessões recentes ───────────────────────────────────── */}
          {allRows.length > 0 && (
            <Card variant="flat" padded={false} className="overflow-hidden animate-slide-up delay-5">
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                padding: '13px 20px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)',
              }}>
                <h2 className="label-data tabular-nums">
                  Sessões recentes · {tableRows.length} {tableRows.length === 1 ? 'conversa' : 'conversas'}
                </h2>
                <ChipGroup label="Filtrar sessões por status">
                  {STATUS_FILTERS.map(f => (
                    <Chip key={f.value} active={statusFilter === f.value} onClick={() => setStatusFilter(f.value)}>
                      {f.label}
                    </Chip>
                  ))}
                </ChipGroup>
              </div>
              <DataTable
                variant="plain"
                columns={TABLE_COLS}
                rows={tableRows}
                defaultSortKey="lastContact"
                defaultSortDir="desc"
                emptyMessage={activeFilter.empty}
                rowKey="sessionId"
                onRowClick={row => router.push(`/sdr-ia/conversas?session=${encodeURIComponent(String(row.sessionId ?? ''))}`)}
              />
            </Card>
          )}
        </>
      )}
    </div>
  )
}
