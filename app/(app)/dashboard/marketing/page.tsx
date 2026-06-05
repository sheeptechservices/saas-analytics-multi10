'use client'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d'
type Provider = '' | 'google_ads' | 'meta_ads' | 'tiktok_ads'

const PERIOD_LABELS: Record<Period, string> = { '7d': '7 dias', '30d': '30 dias', '90d': '90 dias' }
const PROVIDER_LABELS: Record<Provider, string> = {
  '': 'Todas',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  tiktok_ads: 'TikTok Ads',
}
const PROVIDER_COLORS: Record<string, string> = {
  google_ads: '#4285F4',
  meta_ads: '#1877F2',
  tiktok_ads: '#010101',
}
const PROVIDER_DISPLAY: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  tiktok_ads: 'TikTok Ads',
}

function periodDates(period: Period): { startDate: string; endDate: string } {
  const end = new Date()
  const start = new Date()
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  start.setDate(start.getDate() - days)
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

function fmtCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtPct(v: number) { return v.toFixed(2) + '%' }
function fmtNum(v: number) { return Math.round(v).toLocaleString('pt-BR') }

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
        setVal((1 - Math.pow(1 - p, 3)) * target)
        if (p < 1) raf = requestAnimationFrame(tick)
        else setVal(target)
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
  const bg = zero ? 'rgba(170,170,170,0.10)' : positive ? 'rgba(30,138,62,0.08)' : 'rgba(217,48,37,0.08)'
  const Arrow = zero ? ArrowRight : positive ? ArrowUp : ArrowDown
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 11, fontWeight: 700, color,
      background: bg, border: `1px solid ${color}30`,
      borderRadius: 100, padding: '2px 8px', marginTop: 8,
    }}>
      <Arrow size={11} /> {Math.abs(value)}% <span style={{ fontWeight: 500, opacity: 0.7 }}>vs ant.</span>
    </span>
  )
}

// ─── SummaryCard ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, format, accent = 'var(--primary)', sub, delay = 0, change }: {
  label: string
  value: number
  format?: (v: number) => string
  accent?: string
  sub?: string
  delay?: number
  change?: number | null
}) {
  const [hov, setHov] = useState(false)
  const counted = useCountUp(value, 750, delay)
  const display = format ? format(counted) : fmtNum(counted)

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: 'var(--white)',
        border: '1px solid var(--gray3)',
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        padding: '18px 20px',
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
        fontSize: display.length > 14 ? 18 : display.length > 10 ? 22 : 26,
        fontWeight: 800, color: accent, lineHeight: 1,
        letterSpacing: '-0.02em', wordBreak: 'break-all',
      }}>{display}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--gray2)', marginTop: 5, fontWeight: 500 }}>{sub}</div>}
      <ChangeBadge value={change ?? null} />
    </div>
  )
}

// ─── SectionTitle ─────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--gray)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>
      {children}
    </div>
  )
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

function FilterBar<T extends string>({ options, labels, value, onChange }: {
  options: T[]
  labels: Record<T, string>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            padding: '6px 14px', borderRadius: 8,
            border: `1px solid ${value === opt ? 'var(--primary)' : 'var(--gray3)'}`,
            background: value === opt ? 'var(--primary)' : 'var(--white)',
            color: value === opt ? 'var(--primary-contrast)' : 'var(--gray)',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  )
}

// ─── Custom recharts tooltips ─────────────────────────────────────────────────

function SpendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--white)', border: '1px solid var(--gray3)',
      borderRadius: 8, padding: '10px 14px', boxShadow: 'var(--shadow)', fontSize: 12,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color, marginBottom: 2 }}>
          {PROVIDER_DISPLAY[p.dataKey] ?? p.dataKey}: {fmtCurrency(p.value)}
        </div>
      ))}
    </div>
  )
}

function RoasTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div style={{
      background: 'var(--white)', border: '1px solid var(--gray3)',
      borderRadius: 8, padding: '10px 14px', boxShadow: 'var(--shadow)', fontSize: 12,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{PROVIDER_DISPLAY[d?.provider] ?? d?.provider}</div>
      <div>ROAS: {Number(d?.roas ?? 0).toFixed(2)}x</div>
      <div>Gasto: {fmtCurrency(d?.spend ?? 0)}</div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketingPage() {
  const [period, setPeriod] = useState<Period>('30d')
  const [provider, setProvider] = useState<Provider>('')

  const { startDate, endDate } = periodDates(period)
  const qs = new URLSearchParams({ startDate, endDate })
  if (provider) qs.set('provider', provider)

  const { data, isLoading } = useQuery({
    queryKey: ['ads-insights', startDate, endDate, provider],
    queryFn: () => fetch(`/api/ads/insights?${qs}`).then(r => r.json()),
    staleTime: 5 * 60_000,
  })

  const totals = data?.totals ?? {}
  const timeSeries: any[] = data?.timeSeries ?? []
  const byProvider: any[] = data?.byProvider ?? []
  const top10: any[] = data?.top10 ?? []
  const hasIntegrations: boolean = data?.hasIntegrations ?? true

  // Pivot timeSeries → { date, google_ads: n, meta_ads: n, tiktok_ads: n }
  const spendByDay = (() => {
    const map = new Map<string, Record<string, number>>()
    for (const row of timeSeries) {
      if (!map.has(row.date)) map.set(row.date, { date: row.date })
      map.get(row.date)![row.provider] = row.spend
    }
    return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  })()

  const providersInData = [...new Set(timeSeries.map(r => r.provider))]

  const roasData = byProvider.map(r => ({ ...r, label: PROVIDER_DISPLAY[r.provider] ?? r.provider }))

  if (!isLoading && data && !hasIntegrations) {
    return (
      <div style={{ padding: '48px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--gray)', marginBottom: 8 }}>
          Nenhuma integração de anúncios ativa
        </div>
        <div style={{ fontSize: 14, color: 'var(--gray2)' }}>
          Configure Google Ads, Meta Ads ou TikTok Ads em{' '}
          <a href="/settings?tab=integracoes" style={{ color: 'var(--primary)', fontWeight: 600 }}>Integrações</a>.
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '28px 24px', maxWidth: 1200, margin: '0 auto' }}>

      {/* ── Header + Filters ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>
            Marketing
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray2)', marginTop: 2 }}>
            Performance das campanhas de anúncios
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <FilterBar
            options={['7d', '30d', '90d'] as Period[]}
            labels={PERIOD_LABELS}
            value={period}
            onChange={setPeriod}
          />
          <FilterBar
            options={['', 'google_ads', 'meta_ads', 'tiktok_ads'] as Provider[]}
            labels={PROVIDER_LABELS}
            value={provider}
            onChange={setProvider}
          />
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="animate-slide-up" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 14,
        marginBottom: 28,
      }}>
        <SummaryCard label="Gasto Total" value={totals.totalSpend ?? 0} format={fmtCurrency} accent="var(--primary)" delay={0} />
        <SummaryCard label="Impressões" value={totals.totalImpressions ?? 0} format={fmtNum} accent="#4285F4" delay={60} />
        <SummaryCard label="Cliques" value={totals.totalClicks ?? 0} format={fmtNum} accent="#1877F2" delay={120} />
        <SummaryCard label="CTR Médio" value={totals.avgCtr ?? 0} format={fmtPct} accent="var(--primary-mid)" delay={180} />
        <SummaryCard label="ROAS Médio" value={totals.avgRoas ?? 0} format={v => v.toFixed(2) + 'x'} accent="var(--green)" delay={240} />
        <SummaryCard label="Conversões" value={totals.totalConversions ?? 0} format={fmtNum} accent="#EA4335" delay={300} />
      </div>

      {/* ── Charts ── */}
      <div className="animate-slide-up delay-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 28 }}>

        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 12, padding: '20px 16px', boxShadow: 'var(--shadow)' }}>
          <SectionTitle>Gasto Diário por Plataforma</SectionTitle>
          {isLoading ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray2)', fontSize: 13 }}>Carregando...</div>
          ) : spendByDay.length === 0 ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray2)', fontSize: 13 }}>Sem dados no período</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={spendByDay} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray3)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--gray2)' }} tickFormatter={d => String(d).slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--gray2)' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} width={48} />
                <Tooltip content={<SpendTooltip />} />
                <Legend formatter={(p: string) => PROVIDER_DISPLAY[p] ?? p} wrapperStyle={{ fontSize: 11 }} />
                {providersInData.map(p => (
                  <Line
                    key={p}
                    type="monotone"
                    dataKey={p}
                    stroke={PROVIDER_COLORS[p] ?? '#888'}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 12, padding: '20px 16px', boxShadow: 'var(--shadow)' }}>
          <SectionTitle>ROAS por Plataforma</SectionTitle>
          {isLoading ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray2)', fontSize: 13 }}>Carregando...</div>
          ) : roasData.length === 0 ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray2)', fontSize: 13 }}>Sem dados no período</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={roasData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray3)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--gray2)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--gray2)' }} tickFormatter={v => v.toFixed(1) + 'x'} width={40} />
                <Tooltip content={<RoasTooltip />} />
                <Bar dataKey="roas" radius={[6, 6, 0, 0]}>
                  {roasData.map((entry, idx) => (
                    <Cell key={idx} fill={PROVIDER_COLORS[entry.provider] ?? 'var(--primary)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Top 10 Campaigns ── */}
      <div className="animate-slide-up delay-5" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 12, padding: '20px 16px', boxShadow: 'var(--shadow)' }}>
        <SectionTitle>Top 10 Campanhas por Gasto</SectionTitle>
        {isLoading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--gray2)', fontSize: 13 }}>Carregando...</div>
        ) : top10.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--gray2)', fontSize: 13 }}>Sem dados no período</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--gray3)' }}>
                  {['Campanha', 'Plataforma', 'Gasto', 'Cliques', 'CTR', 'ROAS'].map(h => (
                    <th key={h} style={{
                      padding: '8px 12px',
                      textAlign: h === 'Campanha' ? 'left' : 'right',
                      fontWeight: 800, fontSize: 10, color: 'var(--gray2)',
                      textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {top10.map((row, i) => (
                  <tr
                    key={i}
                    style={{ borderBottom: '1px solid var(--gray3)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(0,0,0,0.025)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
                  >
                    <td style={{ padding: '10px 12px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {row.name}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 100,
                        background: `${PROVIDER_COLORS[row.provider] ?? '#888'}18`,
                        color: PROVIDER_COLORS[row.provider] ?? '#888',
                        fontWeight: 700, fontSize: 11,
                      }}>
                        {PROVIDER_DISPLAY[row.provider] ?? row.provider}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>{fmtCurrency(row.spend)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{fmtNum(row.clicks)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{fmtPct(row.ctr)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{Number(row.roas).toFixed(2)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
