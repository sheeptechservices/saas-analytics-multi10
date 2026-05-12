'use client'
import { useEffect, useRef, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = '30d' | '90d' | '180d' | '365d'
const PERIOD_LABELS: Record<Period, string> = {
  '30d':  'Este mês',
  '90d':  'Trimestre',
  '180d': '6 meses',
  '365d': 'Este ano',
}

type Canal = {
  name: string
  leads: number
  invest: number
  cpl: number
  roas: number
  stageDrop: number | null
  stageRef?: string
}

// ─── useCountUp ───────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 750, delay = 0): number {
  const [val, setVal] = useState(0)
  useEffect(() => {
    setVal(0)
    if (!target) return
    let raf: number
    const t = setTimeout(() => {
      let startTs = 0
      const tick = (ts: number) => {
        if (!startTs) startTs = ts
        const p = Math.min((ts - startTs) / duration, 1)
        setVal(Math.round((1 - Math.pow(1 - p, 3)) * target))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, delay)
    return () => { clearTimeout(t); cancelAnimationFrame(raf) }
  }, [target])
  return val
}

// ─── ChangeBadge ─────────────────────────────────────────────────────────────

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null
  const positive = value > 0
  const zero = value === 0
  const color = zero ? 'var(--gray2)' : positive ? 'var(--green)' : 'var(--red)'
  const bg    = zero ? 'rgba(170,170,170,0.10)' : positive ? 'rgba(30,138,62,0.08)' : 'rgba(217,48,37,0.08)'
  const arrow = zero ? '→' : positive ? '↑' : '↓'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 11, fontWeight: 700, color,
      background: bg, border: `1px solid ${color}30`,
      borderRadius: 100, padding: '2px 8px', marginTop: 8,
    }}>
      {arrow} {Math.abs(value)}% <span style={{ fontWeight: 500, opacity: 0.7 }}>vs ant.</span>
    </span>
  )
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, format, accent = 'var(--primary)', sub, delay = 0, change }: {
  label: string; value: number; format?: (v: number) => string
  accent?: string; sub?: string; delay?: number; change?: number | null
}) {
  const [hov, setHov] = useState(false)
  const counted = useCountUp(value, 750, delay)
  const display = format ? format(counted) : String(counted)

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: 'var(--white)', border: '1px solid var(--gray3)',
        borderLeft: `4px solid ${accent}`, borderRadius: 12, padding: '18px 20px',
        cursor: 'default',
        transition: 'transform 0.22s ease, box-shadow 0.22s ease',
        transform: hov ? 'translateY(-4px) scale(1.01)' : 'translateY(0) scale(1)',
        boxShadow: hov
          ? `0 10px 28px rgba(0,0,0,0.10), inset 0 0 0 1px ${accent}30`
          : 'var(--shadow)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{
        fontSize: display.length > 14 ? 20 : display.length > 10 ? 23 : 26,
        fontWeight: 800, color: accent, lineHeight: 1,
        transition: 'font-size 0.2s ease', letterSpacing: '-0.02em', wordBreak: 'break-all',
      }}>{display}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--gray2)', marginTop: 5, fontWeight: 500 }}>{sub}</div>}
      <ChangeBadge value={change ?? null} />
    </div>
  )
}

// ─── SectionTitle ─────────────────────────────────────────────────────────────

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

// ─── AskAIButton ──────────────────────────────────────────────────────────────

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

// ─── PeriodFilter ─────────────────────────────────────────────────────────────

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

// ─── StageDropSlot ───────────────────────────────────────────────────────────

function StageDropSlot({ value, stageRef }: { value: number | null; stageRef?: string }) {
  let arrow = '↓', color = 'var(--red)', absVal = '0.0'
  const hasValue = value !== null
  if (value !== null) {
    absVal = Math.abs(value).toFixed(1)
    if (value > 0)      { arrow = '↑'; color = 'var(--green)' }
    else if (value === 0) { arrow = '→'; color = 'var(--gray2)' }
  }
  return (
    <div style={{ minHeight: 18, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
      <span style={{
        fontSize: 11, fontWeight: 700,
        color: hasValue ? color : 'var(--red)',
        opacity: hasValue ? 1 : 0,
        transition: 'opacity 0.25s ease',
        whiteSpace: 'nowrap',
      }}>
        {arrow} {absVal}%
      </span>
      {stageRef !== undefined && (
        <span style={{
          fontSize: 9, fontWeight: 500, color: 'var(--gray2)',
          opacity: hasValue ? 0.7 : 0,
          transition: 'opacity 0.25s ease',
          whiteSpace: 'nowrap',
        }}>
          {stageRef}
        </span>
      )}
    </div>
  )
}

// ─── ChannelBars ─────────────────────────────────────────────────────────────

function ChannelBars({ data, ready }: { data: Canal[]; ready: boolean }) {
  const [hov, setHov] = useState<string | null>(null)
  const max = Math.max(...data.map(c => c.leads))

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 560 }}>
        {data.map((c, i) => {
          const isHov = hov === c.name
          const barW  = c.leads / max
          const alpha = Math.max(1 - i * 0.15, 0.28)
          return (
            <div
              key={c.name}
              onMouseEnter={() => setHov(c.name)}
              onMouseLeave={() => setHov(null)}
              style={{ opacity: hov && !isHov ? 0.28 : 1, transition: 'opacity 0.22s', isolation: 'isolate', cursor: 'default' }}
            >
              {/* HeaderGrid: LabelRegion shrinks, PercentageRegion owns fixed 56px */}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 56px', alignItems: 'center', gap: 8, marginBottom: 6 }}>

                {/* LabelRegion — absorbs all compression, never invades percentage */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--primary)', opacity: alpha,
                    transform: isHov ? 'scale(1.7)' : 'scale(1)',
                    transition: 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1)',
                  }} />
                  <span style={{
                    fontSize: 13, fontWeight: isHov ? 700 : 600,
                    color: isHov ? 'var(--black)' : 'var(--gray)',
                    transition: 'color .15s',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{c.name}</span>
                </div>

                {/* PercentageRegion — 56px fixed, structurally reserved, no width negotiation */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <StageDropSlot value={c.stageDrop} stageRef={c.stageRef} />
                </div>

              </div>

              {/* Value + Timing — below header, indented past dot */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, paddingLeft: 15 }}>
                <span style={{
                  fontSize: 12, fontWeight: 800,
                  color: isHov ? 'var(--primary-text)' : 'var(--gray2)',
                  transition: 'color .15s', whiteSpace: 'nowrap',
                }}>{c.leads} leads</span>
                {c.invest > 0 ? (
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--gray2)', whiteSpace: 'nowrap' }}>
                    R$ {c.invest.toLocaleString('pt-BR')} · CPL R$ {c.cpl.toFixed(0)} · ROAS {c.roas}×
                  </span>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--gray2)' }}>orgânico</span>
                )}
              </div>

              {/* Bar — scaleX transform, zero reflow */}
              <div style={{ position: 'relative', height: 7, background: 'var(--gray3)', borderRadius: 100, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: '100%', borderRadius: 100,
                  background: 'var(--primary)',
                  opacity: isHov ? 1 : alpha,
                  transform: ready ? `scaleX(${barW})` : 'scaleX(0)',
                  transformOrigin: 'left center',
                  boxShadow: isHov ? '0 0 14px var(--primary)77' : 'none',
                  transition: `transform 0.55s cubic-bezier(0.4,0,0.2,1) ${i * 70}ms, opacity 0.2s, box-shadow 0.22s`,
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── WeeklyLeadsChart ─────────────────────────────────────────────────────────

function WeeklyLeadsChart({ data, ready }: { data: typeof WEEKS; ready: boolean }) {
  const [hovBar, setHovBar] = useState<string | null>(null)
  const maxCount = Math.max(...data.map(d => d.leads), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 120, position: 'relative' }}>
        {data.map(({ label, leads }) => {
          const isHov = hovBar === label
          const finalH = leads > 0 ? Math.max((leads / maxCount) * 100, 8) : 5
          return (
            <div key={label} onMouseEnter={() => setHovBar(label)} onMouseLeave={() => setHovBar(null)}
              style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', position: 'relative', cursor: leads > 0 ? 'pointer' : 'default' }}
            >
              {isHov && leads > 0 && (
                <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: 'var(--black)', color: '#fff', borderRadius: 7, padding: '5px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none', lineHeight: 1.5, boxShadow: '0 4px 14px rgba(0,0,0,0.22)' }}>
                  <div style={{ color: 'var(--gray2)', fontSize: 10 }}>{label}</div>
                  <div style={{ color: 'var(--primary)', fontWeight: 800 }}>{leads} lead{leads !== 1 ? 's' : ''}</div>
                </div>
              )}
              <div style={{ width: '100%', borderRadius: '4px 4px 0 0', background: leads > 0 ? (isHov ? 'var(--primary-mid)' : 'var(--primary)') : (isHov ? 'var(--gray2)' : 'var(--gray3)'), height: ready ? `${finalH}%` : '3%', transition: 'height 0.7s cubic-bezier(0.22, 1, 0.36, 1), background 0.15s ease' }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        {data.map(({ label }) => (
          <div key={label} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: hovBar === label ? 'var(--primary-text)' : 'var(--gray2)', fontWeight: hovBar === label ? 700 : 500, transition: 'color 0.15s' }}>
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── RoasChart ────────────────────────────────────────────────────────────────

function RoasChart({ data, ready }: { data: typeof CANAIS; ready: boolean }) {
  const [hov, setHov] = useState<string | null>(null)
  const BENCHMARK = 3
  const maxRoas = Math.max(...data.map(c => c.roas), BENCHMARK + 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.map((c) => {
        const isHov = hov === c.name
        const pct   = (c.roas / maxRoas) * 100
        const good  = c.roas >= BENCHMARK
        return (
          <div key={c.name} onMouseEnter={() => setHov(c.name)} onMouseLeave={() => setHov(null)}
            style={{ opacity: hov && hov !== c.name ? 0.35 : 1, transition: 'opacity 0.2s', cursor: 'default' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
              <span style={{ fontSize: 12, fontWeight: isHov ? 700 : 600, color: isHov ? 'var(--black)' : 'var(--gray)', transition: 'color .15s' }}>{c.name}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: good ? 'var(--green)' : 'var(--red)' }}>{c.roas}×</span>
            </div>
            <div style={{ position: 'relative', height: 7, background: 'var(--gray3)', borderRadius: 100, overflow: 'visible' }}>
              <div style={{ height: '100%', borderRadius: 100, background: good ? 'var(--green)' : 'var(--red)', width: ready ? `${pct}%` : '0%', transition: 'width 0.55s cubic-bezier(0.4,0,0.2,1)' }} />
              <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${(BENCHMARK / maxRoas) * 100}%`, width: 2, background: 'var(--gray2)', borderRadius: 2, pointerEvents: 'none' }} />
            </div>
            {isHov && (
              <div style={{ fontSize: 10, color: 'var(--gray2)', fontWeight: 500, marginTop: 3, animation: 'ai-step 0.15s ease both' }}>
                Benchmark: {BENCHMARK}× · {good ? `+${(c.roas - BENCHMARK).toFixed(1)}× acima` : `${(BENCHMARK - c.roas).toFixed(1)}× abaixo`}
              </div>
            )}
          </div>
        )
      })}
      <div style={{ fontSize: 10, color: 'var(--gray2)', fontWeight: 500, marginTop: 4 }}>
        Linha vertical = benchmark de mercado (3×)
      </div>
    </div>
  )
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const CANAIS: Canal[] = [
  { name: 'Meta Ads',   leads: 162, invest: 5200, cpl: 32.1, roas: 4.2, stageDrop: null },
  { name: 'Google Ads', leads: 98,  invest: 4100, cpl: 41.8, roas: 3.6, stageDrop: null },
  { name: 'Orgânico',   leads: 54,  invest: 0,    cpl: 0,    roas: 0,   stageDrop: null },
  { name: 'E-mail',     leads: 22,  invest: 700,  cpl: 31.8, roas: 5.6, stageDrop: null },
  { name: 'TikTok Ads', leads: 10,  invest: 2000, cpl: 200,  roas: 0.8, stageDrop: null },
]

const WEEKS = [
  { label: 'S1', leads: 38 },
  { label: 'S2', leads: 52 },
  { label: 'S3', leads: 47 },
  { label: 'S4', leads: 61 },
  { label: 'S5', leads: 58 },
  { label: 'S6', leads: 90 },
]

type Campanha = {
  name: string; canal: string; invest: number; leads: number
  cpl: number; roas: number; status: string
  objetivo: string; publico: string; periodo: string
  orcamentoDiario: number; impressoes: number; cliques: number; ctr: number
  formato: string; headline: string; copy: string
  criativos: { bg: string; label: string; tipo: 'imagem' | 'video' | 'email' | 'performance' }[]
}

const CAMPANHAS: Campanha[] = [
  {
    name: 'Remarketing Fundo', canal: 'Meta Ads', invest: 2100, leads: 74, cpl: 28.4, roas: 4.1, status: 'Ativo',
    objetivo: 'Conversão', publico: 'Visitantes do site nos últimos 30 dias · 25–45 anos · BR',
    periodo: '01/03 – 31/03/2025', orcamentoDiario: 70, impressoes: 184200, cliques: 3210, ctr: 1.74,
    formato: 'Carrossel',
    headline: 'Volte e feche negócio hoje.',
    copy: 'Você já conhece a gente. Que tal dar o próximo passo? Condições especiais para quem volta e fecha ainda esse mês.',
    criativos: [
      { bg: 'linear-gradient(135deg,#1877F2 0%,#0a4fa8 100%)', label: 'Slide 1 — Oferta principal', tipo: 'imagem' },
      { bg: 'linear-gradient(135deg,#2d9cdb 0%,#1877F2 100%)', label: 'Slide 2 — Benefícios', tipo: 'imagem' },
      { bg: 'linear-gradient(135deg,#0a4fa8 0%,#051f5e 100%)', label: 'Slide 3 — CTA final', tipo: 'imagem' },
    ],
  },
  {
    name: 'Brand Keywords', canal: 'Google Ads', invest: 1800, leads: 51, cpl: 35.3, roas: 3.8, status: 'Ativo',
    objetivo: 'Tráfego qualificado', publico: 'Intenção de compra — busca por nome da marca · todas as idades',
    periodo: '01/03 – 31/03/2025', orcamentoDiario: 60, impressoes: 42100, cliques: 1890, ctr: 4.49,
    formato: 'Pesquisa (texto)',
    headline: 'Multi10 BI — Gestão de leads com Kommo',
    copy: 'Visualize seu funil de vendas em tempo real. Conecte seu Kommo e tome decisões com dados. Teste grátis por 14 dias.',
    criativos: [
      { bg: 'linear-gradient(135deg,#4285F4 0%,#0d47a1 100%)', label: 'Anúncio de texto A', tipo: 'performance' },
      { bg: 'linear-gradient(135deg,#34A853 0%,#4285F4 100%)', label: 'Anúncio de texto B', tipo: 'performance' },
    ],
  },
  {
    name: 'Topo de Funil V2', canal: 'Meta Ads', invest: 3100, leads: 88, cpl: 35.2, roas: 2.9, status: 'Ativo',
    objetivo: 'Geração de leads', publico: 'Lookalike 1% de clientes · diretores e gerentes · 28–50 anos',
    periodo: '15/02 – 31/03/2025', orcamentoDiario: 103, impressoes: 312400, cliques: 5670, ctr: 1.81,
    formato: 'Vídeo (15s)',
    headline: 'Seu time de vendas merece dados de verdade.',
    copy: 'Chega de planilha. O Multi10 BI conecta seu CRM Kommo e mostra exatamente onde cada lead está no funil. Resultado: mais fechamentos, menos esforço.',
    criativos: [
      { bg: 'linear-gradient(135deg,#FF6B35 0%,#F7931E 100%)', label: 'Vídeo 15s — Problema', tipo: 'video' },
      { bg: 'linear-gradient(135deg,#F7931E 0%,#FFD700 100%)', label: 'Vídeo 15s — Solução', tipo: 'video' },
    ],
  },
  {
    name: 'Performance Max', canal: 'Google Ads', invest: 2300, leads: 47, cpl: 48.9, roas: 3.2, status: 'Pausado',
    objetivo: 'Maximizar conversões', publico: 'Automático — Google otimiza por sinal de conversão',
    periodo: '01/02 – 28/02/2025', orcamentoDiario: 82, impressoes: 198700, cliques: 2140, ctr: 1.08,
    formato: 'Performance Max (multi-formato)',
    headline: 'Inteligência comercial para times de vendas',
    copy: 'Dashboard de BI conectado ao seu Kommo CRM. Ranking de vendedores, funil ao vivo e análise de perdas. Para equipes que vendem mais com dados.',
    criativos: [
      { bg: 'linear-gradient(135deg,#EA4335 0%,#FBBC05 100%)', label: 'Asset — Display', tipo: 'imagem' },
      { bg: 'linear-gradient(135deg,#4285F4 0%,#34A853 100%)', label: 'Asset — YouTube', tipo: 'video' },
      { bg: 'linear-gradient(135deg,#FBBC05 0%,#EA4335 100%)', label: 'Asset — Gmail', tipo: 'email' },
    ],
  },
  {
    name: 'Fluxo de Nutrição', canal: 'E-mail', invest: 700, leads: 22, cpl: 31.8, roas: 5.6, status: 'Ativo',
    objetivo: 'Nutrição e reativação', publico: 'Leads frios da base (sem interação há 60+ dias) · 3.400 contatos',
    periodo: '01/03 – 31/03/2025', orcamentoDiario: 23, impressoes: 3400, cliques: 238, ctr: 7.0,
    formato: 'E-mail (sequência de 5)',
    headline: 'Ainda pensando em melhorar seu funil?',
    copy: 'Oi, {nome}! Vi que você conheceu o Multi10 mas ainda não ativou. Que tal a gente conversar 20 minutos sobre como seu time pode usar dados para vender mais? Escolha um horário abaixo.',
    criativos: [
      { bg: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)', label: 'E-mail 1 — Reengajamento', tipo: 'email' },
      { bg: 'linear-gradient(135deg,#8b5cf6 0%,#a78bfa 100%)', label: 'E-mail 3 — Caso de sucesso', tipo: 'email' },
      { bg: 'linear-gradient(135deg,#a78bfa 0%,#6366f1 100%)', label: 'E-mail 5 — Última chance', tipo: 'email' },
    ],
  },
  {
    name: 'Awareness TikTok', canal: 'TikTok Ads', invest: 2000, leads: 10, cpl: 200, roas: 0.8, status: 'Encerrado',
    objetivo: 'Reconhecimento de marca', publico: 'Profissionais de vendas · 22–38 anos · TikTok For Business',
    periodo: '01/01 – 31/01/2025', orcamentoDiario: 65, impressoes: 521000, cliques: 1820, ctr: 0.35,
    formato: 'Vídeo In-Feed (30s)',
    headline: 'Seu CRM tem dados. Você usa?',
    copy: 'A maioria dos times de vendas tem CRM mas não sabe o que está acontecendo no funil. O Multi10 BI muda isso em minutos. Conecte seu Kommo e veja a diferença.',
    criativos: [
      { bg: 'linear-gradient(135deg,#010101 0%,#2d2d2d 100%)', label: 'Vídeo 30s — UGC estilo', tipo: 'video' },
      { bg: 'linear-gradient(135deg,#2d2d2d 0%,#010101 100%)', label: 'Vídeo 30s — Talking head', tipo: 'video' },
    ],
  },
]

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Ativo:     { bg: 'rgba(34,197,94,0.12)',  color: '#15803d' },
  Pausado:   { bg: 'var(--gray3)',          color: 'var(--gray2)' },
  Encerrado: { bg: 'rgba(220,50,50,0.10)', color: '#b91c1c' },
}

// ─── CampanhaModal ────────────────────────────────────────────────────────────

const TIPO_ICON: Record<string, React.ReactNode> = {
  imagem:      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="2" width="14" height="12" rx="2"/><path d="M1 10l3.5-3.5 2.5 2.5 2-2 5 5"/><circle cx="5" cy="6" r="1.2"/></svg>,
  video:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="2" width="10" height="12" rx="2"/><path d="M11 6l4-2v8l-4-2V6z"/></svg>,
  email:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="3" width="14" height="10" rx="2"/><path d="M1 5l7 5 7-5"/></svg>,
  performance: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="3" width="14" height="10" rx="1.5"/><path d="M4 8h2m2 0h4"/><path d="M4 6h8M4 10h5"/></svg>,
}

function CampanhaModal({ campanha: c, onClose }: { campanha: Campanha; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [hovCreativo, setHovCreativo] = useState<number | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const st = STATUS_STYLE[c.status] ?? STATUS_STYLE['Pausado']
  const roasColor = c.roas >= 3 ? 'var(--green)' : c.roas >= 1 ? 'var(--black)' : 'var(--red)'

  return (
    <div
      onClick={e => { if (!cardRef.current?.contains(e.target as Node)) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(18,19,22,0.45)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, animation: 'fadeIn .18s ease both',
      }}
    >
      <div
        ref={cardRef}
        style={{
          background: 'var(--white)', borderRadius: 20,
          width: '100%', maxWidth: 680,
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 24px 60px rgba(0,0,0,0.22)',
          animation: 'modalSlideUp .22s cubic-bezier(0.34,1.56,0.64,1) both',
        }}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '20px 20px 16px',
          borderBottom: '1px solid var(--gray3)',
          background: 'var(--bg)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--black)', lineHeight: 1.25, marginBottom: 8 }}>
              {c.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 100, ...st }}>{c.status}</span>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 100,
                background: 'var(--primary-dim)', color: 'var(--primary-text)',
                border: '1px solid var(--primary-mid)',
              }}>{c.canal}</span>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 100,
                background: 'var(--gray3)', color: 'var(--gray)',
              }}>{c.formato}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: '50%', border: 'none',
              background: 'var(--gray3)', color: 'var(--gray)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700, flexShrink: 0,
              transition: 'background .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--gray2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--gray3)')}
          >×</button>
        </div>

        {/* ── KPI strip ────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', borderBottom: '1px solid var(--gray3)' }}>
          {[
            { label: 'Investimento', val: `R$ ${c.invest.toLocaleString('pt-BR')}`, color: 'var(--black)' },
            { label: 'Leads gerados', val: String(c.leads), color: 'var(--primary-text)' },
            { label: 'CPL', val: `R$ ${c.cpl.toFixed(0)}`, color: 'var(--black)' },
            { label: 'ROAS', val: `${c.roas}×`, color: roasColor },
            { label: 'Impressões', val: c.impressoes.toLocaleString('pt-BR'), color: 'var(--black)' },
            { label: 'CTR', val: `${c.ctr}%`, color: 'var(--black)' },
          ].map((kpi, idx) => (
            <div key={kpi.label} style={{
              padding: '14px 18px',
              borderRight: (idx + 1) % 3 !== 0 ? '1px solid var(--gray3)' : 'none',
              borderBottom: idx < 3 ? '1px solid var(--gray3)' : 'none',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{kpi.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: kpi.color, letterSpacing: '-0.02em', lineHeight: 1 }}>{kpi.val}</div>
            </div>
          ))}
        </div>

        {/* ── Criativos ────────────────────────────────────────── */}
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Criativos</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {c.criativos.map((cr, idx) => (
              <div
                key={idx}
                onMouseEnter={() => setHovCreativo(idx)}
                onMouseLeave={() => setHovCreativo(null)}
                style={{
                  flex: 1, borderRadius: 12, overflow: 'hidden', cursor: 'default',
                  transform: hovCreativo === idx ? 'scale(1.03)' : 'scale(1)',
                  boxShadow: hovCreativo === idx ? '0 8px 24px rgba(0,0,0,0.18)' : '0 2px 8px rgba(0,0,0,0.08)',
                  transition: 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.22s ease',
                  border: '1px solid rgba(0,0,0,0.06)',
                }}
              >
                {/* Placeholder criativo */}
                <div style={{ background: cr.bg, aspectRatio: '4/3', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
                  <div style={{ color: 'rgba(255,255,255,0.7)', display: 'flex' }}>
                    {TIPO_ICON[cr.tipo]}
                  </div>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.9)',
                    textAlign: 'center', lineHeight: 1.4, letterSpacing: '0.02em',
                  }}>
                    {cr.tipo === 'video' ? '▶ Vídeo' : cr.tipo === 'email' ? '✉ E-mail' : cr.tipo === 'performance' ? '⚡ Texto' : '🖼 Imagem'}
                  </div>
                </div>
                {/* Label abaixo */}
                <div style={{
                  padding: '8px 10px', background: 'var(--bg)',
                  borderTop: '1px solid rgba(0,0,0,0.06)',
                  fontSize: 10, fontWeight: 600, color: 'var(--gray)',
                  lineHeight: 1.3, textAlign: 'center',
                }}>
                  {cr.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Copy do anúncio ──────────────────────────────────── */}
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Copy do anúncio</div>
          <div style={{ background: 'var(--bg)', borderRadius: 12, padding: '16px 18px', border: '1px solid var(--gray3)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--black)', marginBottom: 8, lineHeight: 1.35 }}>
              {c.headline}
            </div>
            <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.65, fontWeight: 500 }}>
              {c.copy}
            </div>
          </div>
        </div>

        {/* ── Detalhes ─────────────────────────────────────────── */}
        <div style={{ padding: '20px' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Detalhes da campanha</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: '1px solid var(--gray3)', borderRadius: 12, overflow: 'hidden' }}>
            {[
              { label: 'Objetivo',         val: c.objetivo },
              { label: 'Período',          val: c.periodo },
              { label: 'Orçamento diário', val: `R$ ${c.orcamentoDiario}/dia` },
              { label: 'Cliques',          val: c.cliques.toLocaleString('pt-BR') },
              { label: 'Formato',          val: c.formato },
              { label: 'Público-alvo',     val: c.publico },
            ].map((row, idx) => (
              <div key={row.label} style={{
                padding: '11px 16px',
                borderRight: idx % 2 === 0 ? '1px solid var(--gray3)' : 'none',
                borderBottom: idx < 4 ? '1px solid var(--gray3)' : 'none',
                background: idx % 4 < 2 ? 'var(--bg)' : 'var(--white)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{row.label}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--black)', lineHeight: 1.4 }}>{row.val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type SortCol = 'name' | 'canal' | 'invest' | 'leads' | 'cpl' | 'roas' | 'status'

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol | null; sortDir: 'asc' | 'desc' }) {
  const active = sortCol === col
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1, marginLeft: 4, opacity: active ? 1 : 0.3, transition: 'opacity .15s' }}>
      <span style={{ fontSize: 7, lineHeight: 1, color: active && sortDir === 'asc' ? 'var(--primary-text)' : 'currentColor' }}>▲</span>
      <span style={{ fontSize: 7, lineHeight: 1, color: active && sortDir === 'desc' ? 'var(--primary-text)' : 'currentColor' }}>▼</span>
    </span>
  )
}

export default function MarketingPage() {
  const [period, setPeriod]         = useState<Period>('30d')
  const [ready,  setReady]          = useState(false)
  const [hovRow, setHovRow]         = useState<number | null>(null)
  const [selected, setSelected]     = useState<Campanha | null>(null)
  const [sortCol, setSortCol]       = useState<SortCol | null>('leads')
  const [sortDir, setSortDir]       = useState<'asc' | 'desc'>('desc')

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  useEffect(() => {
    setReady(false)
    const t = setTimeout(() => setReady(true), 80)
    return () => clearTimeout(t)
  }, [period])

  const periodLabel = PERIOD_LABELS[period]
  const totalLeads  = CANAIS.reduce((s, c) => s + c.leads, 0)
  const totalInvest = CANAIS.reduce((s, c) => s + c.invest, 0)
  const cplMedio    = Math.round(totalInvest / (totalLeads - 54))
  const roasMedio   = parseFloat(
    (CANAIS.filter(c => c.invest > 0).reduce((s, c) => s + c.roas, 0) /
     CANAIS.filter(c => c.invest > 0).length).toFixed(1)
  )

  const aiContextCanais = CANAIS.map(c => `${c.name}: ${c.leads} leads${c.invest > 0 ? `, R$${c.invest}, CPL R$${c.cpl.toFixed(0)}, ROAS ${c.roas}x` : ' (orgânico)'}`).join('; ')
  const aiContextWeeks  = WEEKS.map(w => `${w.label}: ${w.leads} leads`).join(', ')
  const aiContextCamp   = CAMPANHAS.map(c => `${c.name} (${c.canal}): ${c.leads} leads, R$${c.invest}, ROAS ${c.roas}x, ${c.status}`).join('; ')

  const sortedCampanhas = [...CAMPANHAS].sort((a, b) => {
    if (!sortCol) return 0
    const av = a[sortCol as keyof Campanha]
    const bv = b[sortCol as keyof Campanha]
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), 'pt-BR')
    return sortDir === 'asc' ? cmp : -cmp
  })

  return (
    <div>
      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>Marketing</div>
          <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 4 }}>
            Visão consolidada dos seus canais de aquisição · {periodLabel}
          </div>
        </div>
        <PeriodFilter value={period} onChange={p => setPeriod(p)} />
      </div>

      {/* KPI Cards */}
      <div className="animate-slide-up delay-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 28 }}>
        <SummaryCard label="Investimento total" value={totalInvest} format={n => `R$ ${n.toLocaleString('pt-BR')}`} sub={`no ${periodLabel.toLowerCase()}`} accent="var(--primary)" delay={0} change={-8} />
        <SummaryCard label="Leads gerados" value={totalLeads} sub="canais pagos e orgânicos" accent="var(--primary)" delay={60} change={14} />
        <SummaryCard label="CPL médio" value={cplMedio} format={n => `R$ ${n}`} sub="custo por lead" accent="var(--primary)" delay={120} change={-5} />
        <SummaryCard label="ROAS médio" value={roasMedio * 10} format={n => `${(n / 10).toFixed(1)}×`} sub="retorno sobre investimento" accent="var(--primary)" delay={180} change={7} />
        <SummaryCard label="Conversão Mktg→CRM" value={31} format={n => `${n}%`} sub="leads que viraram oportunidades" accent="var(--gray2)" delay={240} change={3} />
      </div>

      {/* Canal breakdown */}
      <div className="animate-slide-up delay-3" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: '20px 24px', boxShadow: 'var(--shadow)', marginBottom: 24 }}>
        <SectionTitle action={<AskAIButton question={`Analise o desempenho dos meus canais de marketing (${periodLabel}). Dados: ${aiContextCanais}. Total de ${totalLeads} leads gerados, investimento de R$${totalInvest.toLocaleString('pt-BR')}, CPL médio de R$${cplMedio}. Quais canais estão com melhor ROI? Como devo redistribuir o orçamento?`} />}>
          Leads por canal · {periodLabel}
        </SectionTitle>
        <ChannelBars data={CANAIS} ready={ready} />
      </div>

      {/* Charts row */}
      <div className="animate-slide-up delay-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)' }}>
          <SectionTitle action={<AskAIButton question={`Analise a geração de leads nas últimas 6 semanas (${periodLabel}). Dados: ${aiContextWeeks}. Há tendência de crescimento, queda ou sazonalidade?`} />}>
            Novos leads por semana
          </SectionTitle>
          <WeeklyLeadsChart data={WEEKS} ready={ready} />
        </div>
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)' }}>
          <SectionTitle action={<AskAIButton question={`Analise o ROAS de cada canal (${periodLabel}). Dados: ${CANAIS.filter(c => c.invest > 0).map(c => `${c.name}: ROAS ${c.roas}x`).join(', ')}. O benchmark de mercado é 3×.`} />}>
            ROAS por canal
          </SectionTitle>
          <RoasChart data={CANAIS.filter(c => c.invest > 0)} ready={ready} />
        </div>
      </div>

      {/* Campaign table */}
      <div className="animate-slide-up delay-5" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow)', marginBottom: 24 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray3)', background: 'var(--bg)' }}>
          <SectionTitle action={<AskAIButton question={`Analise o desempenho das campanhas (${periodLabel}). Dados: ${aiContextCamp}. Quais têm melhor custo-benefício? Recomende ajustes de orçamento.`} />}>
            Campanhas · {periodLabel}
          </SectionTitle>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg)' }}>
              {([
                { label: 'Campanha',     col: 'name'   },
                { label: 'Canal',        col: 'canal'  },
                { label: 'Investimento', col: 'invest' },
                { label: 'Leads',        col: 'leads'  },
                { label: 'CPL',          col: 'cpl'    },
                { label: 'ROAS',         col: 'roas'   },
                { label: 'Status',       col: 'status' },
              ] as { label: string; col: SortCol }[]).map(({ label, col }) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  style={{
                    padding: '9px 16px', textAlign: 'left',
                    fontSize: 10, fontWeight: 800,
                    color: sortCol === col ? 'var(--primary-text)' : 'var(--gray2)',
                    textTransform: 'uppercase', letterSpacing: '0.07em',
                    borderBottom: '1px solid var(--gray3)',
                    cursor: 'pointer', userSelect: 'none',
                    transition: 'color .15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {label}
                    <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedCampanhas.map((c, i) => {
              const isHov = hovRow === i
              const st = STATUS_STYLE[c.status] ?? STATUS_STYLE['Pausado']
              return (
                <tr
                  key={i}
                  onMouseEnter={() => setHovRow(i)}
                  onMouseLeave={() => setHovRow(null)}
                  onClick={() => setSelected(c)}
                  style={{
                    borderBottom: i < CAMPANHAS.length - 1 ? '1px solid var(--gray3)' : 'none',
                    borderLeft: `3px solid ${isHov ? 'var(--primary)' : 'transparent'}`,
                    background: isHov ? 'var(--primary-dim)' : 'transparent',
                    transition: 'all .18s ease', cursor: 'pointer',
                    animation: 'ai-step 0.3s ease both',
                    animationDelay: `${i * 40}ms`,
                  }}
                >
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {c.name}
                      {isHov && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary-text)', animation: 'ai-step 0.15s ease both' }}>Ver detalhes →</span>}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--gray)', fontWeight: 600 }}>{c.canal}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, fontWeight: 700, color: 'var(--black)' }}>{c.invest > 0 ? `R$ ${c.invest.toLocaleString('pt-BR')}` : '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 800, color: 'var(--primary-text)' }}>{c.leads}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--gray)', fontWeight: 600 }}>{c.invest > 0 ? `R$ ${c.cpl.toFixed(0)}` : '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 800, color: c.roas >= 3 ? 'var(--green)' : c.roas >= 1 ? 'var(--black)' : 'var(--red)' }}>{c.roas}×</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 100, ...st }}>{c.status}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Connect platforms banner */}
      <div className="animate-slide-up delay-5" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderLeft: '4px solid var(--primary)', borderRadius: 16, padding: '18px 24px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--primary-text)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="4" cy="8" r="2"/><circle cx="12" cy="3" r="2"/><circle cx="12" cy="13" r="2"/>
            <path d="M6 7l4-3M6 9l4 3"/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--black)' }}>Conecte suas plataformas de anúncios</div>
          <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500, marginTop: 2 }}>
            Em breve: integração direta com Meta Ads, Google Ads, TikTok Ads e mais — dados em tempo real sem planilhas.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div title="Meta Ads" style={{ width: 32, height: 32, borderRadius: 8, background: '#1877F2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02Z"/></svg>
          </div>
          <div title="Google Ads" style={{ width: 32, height: 32, borderRadius: 8, background: '#fff', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62Z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z" fill="#EA4335"/></svg>
          </div>
          <div title="TikTok Ads" style={{ width: 32, height: 32, borderRadius: 8, background: '#010101', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07Z"/></svg>
          </div>
        </div>
      </div>

      {/* Modal */}
      {selected && <CampanhaModal campanha={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
