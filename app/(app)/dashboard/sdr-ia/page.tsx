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

// ─── SummaryCard ─────────────────────────────────────────────────────────────

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
        transition: 'font-size 0.2s ease', letterSpacing: '-0.02em',
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

// ─── AskAIButton ─────────────────────────────────────────────────────────────

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

// ─── SortIcon ─────────────────────────────────────────────────────────────────

function SortIcon({ col, active, dir }: { col: string; active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', marginLeft: 4, gap: 1, verticalAlign: 'middle' }}>
      <span style={{ fontSize: 7, lineHeight: 1, color: active && dir === 'asc' ? 'var(--primary-text)' : 'var(--gray3)', opacity: active && dir === 'asc' ? 1 : 0.5 }}>▲</span>
      <span style={{ fontSize: 7, lineHeight: 1, color: active && dir === 'desc' ? 'var(--primary-text)' : 'var(--gray3)', opacity: active && dir === 'desc' ? 1 : 0.5 }}>▼</span>
    </span>
  )
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const FUNNEL_DATA = [
  { label: 'Leads recebidos', count: 847, color: 'var(--gray2)', icon: '📥' },
  { label: 'Contatados pela IA', count: 684, color: 'var(--primary-text)', icon: '🤖' },
  { label: 'Responderam', count: 312, color: '#2563EB', icon: '💬' },
  { label: 'Reunião agendada', count: 94, color: 'var(--green)', icon: '📅' },
]

const CANAIS_CONTATO = [
  { name: 'WhatsApp', contatos: 421, respostas: 160, reunioes: 48, cor: '#25D366' },
  { name: 'E-mail',   contatos: 198, respostas: 78,  reunioes: 22, cor: '#EA4335' },
  { name: 'LinkedIn', contatos: 65,  respostas: 74,  reunioes: 24, cor: '#0A66C2' },
]

const SEMANAS = [
  { label: 'S-5', contatos: 120, reunioes: 12 },
  { label: 'S-4', contatos: 145, reunioes: 15 },
  { label: 'S-3', contatos: 132, reunioes: 14 },
  { label: 'S-2', contatos: 168, reunioes: 21 },
  { label: 'S-1', contatos: 155, reunioes: 18 },
  { label: 'Esta', contatos: 127, reunioes: 14 },
]

const OBJECOES = [
  { motivo: 'Sem interesse no momento', count: 89 },
  { motivo: 'Já possui fornecedor',     count: 64 },
  { motivo: 'Preço alto / orçamento',   count: 47 },
  { motivo: 'Sem tempo',                count: 38 },
  { motivo: 'Não é o decisor',          count: 22 },
]

const STATUS_BREAKDOWN = [
  { label: 'Reunião agendada',  count: 94,  color: '#1E8A3E' },
  { label: 'Em andamento',      count: 139, color: '#FFB400' },
  { label: 'Aguardando',        count: 79,  color: '#2563EB' },
  { label: 'Sem resposta',      count: 218, color: '#AAAAAA' },
  { label: 'Sem interesse',     count: 218, color: '#D93025' },
]

type Lead = {
  lead: string; empresa: string; canal: string; msgs: number
  status: string; ultima: string; score: number
}

const LEADS_RECENTES: Lead[] = [
  { lead: 'João Matos',       empresa: 'TechBr Soluções',  canal: 'WhatsApp', msgs: 6,  status: 'Reunião agendada',  ultima: '2h',  score: 92 },
  { lead: 'Mariana Luz',      empresa: 'Inova Corp',        canal: 'E-mail',   msgs: 4,  status: 'Aguardando',        ultima: '5h',  score: 74 },
  { lead: 'Carlos Veiga',     empresa: 'SalesForce BR',     canal: 'LinkedIn', msgs: 8,  status: 'Em andamento',      ultima: '1h',  score: 88 },
  { lead: 'Fernanda Castro',  empresa: 'Agência Pulse',     canal: 'WhatsApp', msgs: 3,  status: 'Sem interesse',     ultima: '1d',  score: 35 },
  { lead: 'Rafael Mendes',    empresa: 'Digital Hub',       canal: 'E-mail',   msgs: 5,  status: 'Reunião agendada',  ultima: '3h',  score: 95 },
  { lead: 'Tatiane Borba',    empresa: 'ConvertLab',        canal: 'WhatsApp', msgs: 2,  status: 'Sem resposta',      ultima: '2d',  score: 42 },
  { lead: 'Gustavo Pires',    empresa: 'MKT360',            canal: 'LinkedIn', msgs: 7,  status: 'Em andamento',      ultima: '4h',  score: 81 },
  { lead: 'Simone Teles',     empresa: 'Hiper Vendas',      canal: 'WhatsApp', msgs: 9,  status: 'Reunião agendada',  ultima: '1h',  score: 97 },
  { lead: 'Bruno Lacerda',    empresa: 'Orbit Solutions',   canal: 'E-mail',   msgs: 3,  status: 'Sem resposta',      ultima: '3d',  score: 28 },
  { lead: 'Camila Duarte',    empresa: 'Growfast',          canal: 'WhatsApp', msgs: 11, status: 'Reunião agendada',  ultima: '30m', score: 99 },
  { lead: 'Diego Fonseca',    empresa: 'AdsLab',            canal: 'LinkedIn', msgs: 6,  status: 'Aguardando',        ultima: '6h',  score: 66 },
  { lead: 'Letícia Vargas',   empresa: 'Nexus Digital',     canal: 'WhatsApp', msgs: 4,  status: 'Em andamento',      ultima: '2h',  score: 77 },
]

// ─── FunnelChart ─────────────────────────────────────────────────────────────

function FunnelChart({ data, ready }: { data: typeof FUNNEL_DATA; ready: boolean }) {
  const [hov, setHov] = useState<number | null>(null)
  const total = data[0].count

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
      {data.map((step, i) => {
        const pct = Math.round((step.count / total) * 100)
        const prevPct = i > 0 ? Math.round((step.count / data[i - 1].count) * 100) : 100
        const isHov = hov === i
        const barH = ready ? Math.max((step.count / total) * 100, 12) : 4

        return (
          <div key={step.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
            {/* Arrow connector */}
            {i > 0 && (
              <div style={{
                position: 'absolute', left: -1, top: '50%', transform: 'translateY(-50%)',
                zIndex: 2, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'var(--bg)', border: '1px solid var(--gray3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, color: 'var(--gray2)',
                }}>›</div>
              </div>
            )}

            <div
              onMouseEnter={() => setHov(i)}
              onMouseLeave={() => setHov(null)}
              style={{
                width: '100%', padding: '18px 14px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                borderRight: i < data.length - 1 ? '1px solid var(--gray3)' : 'none',
                background: isHov ? 'var(--bg)' : 'transparent',
                cursor: 'default', transition: 'background .15s',
                borderRadius: i === 0 ? '10px 0 0 10px' : i === data.length - 1 ? '0 10px 10px 0' : 0,
              }}
            >
              {/* Step icon */}
              <div style={{ fontSize: 18, lineHeight: 1, filter: isHov ? 'none' : 'grayscale(0.4)' }}>
                {step.icon}
              </div>

              {/* Label */}
              <div style={{ fontSize: 10, fontWeight: 700, color: isHov ? 'var(--black)' : 'var(--gray2)', textAlign: 'center', letterSpacing: '0.02em', lineHeight: 1.3, transition: 'color .15s' }}>
                {step.label}
              </div>

              {/* Count */}
              <div style={{ fontSize: 28, fontWeight: 900, color: step.color, lineHeight: 1, letterSpacing: '-0.04em', transition: 'transform .2s', transform: isHov ? 'scale(1.06)' : 'scale(1)' }}>
                {step.count.toLocaleString('pt-BR')}
              </div>

              {/* % of total */}
              <div style={{ fontSize: 12, fontWeight: 700, color: isHov ? step.color : 'var(--gray2)', transition: 'color .15s' }}>
                {pct}%
              </div>

              {/* Drop-off badge — from previous step */}
              {i > 0 && (
                <div style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
                  background: isHov ? 'rgba(217,48,37,0.08)' : 'var(--bg)',
                  color: isHov ? 'var(--red)' : 'var(--gray2)',
                  border: `1px solid ${isHov ? 'rgba(217,48,37,0.2)' : 'var(--gray3)'}`,
                  transition: 'all .15s', animation: isHov ? 'ai-step 0.15s ease both' : 'none',
                }}>
                  {prevPct}% de aproveitamento
                </div>
              )}

              {/* Progress bar */}
              <div style={{ width: '80%', height: 4, background: 'var(--gray3)', borderRadius: 99, overflow: 'hidden', marginTop: 4 }}>
                <div style={{
                  height: '100%', borderRadius: 99,
                  background: step.color,
                  width: ready ? `${pct}%` : '0%',
                  boxShadow: isHov ? `0 0 8px ${step.color}88` : 'none',
                  transition: `width 0.7s cubic-bezier(0.4,0,0.2,1) ${i * 100}ms, box-shadow .2s`,
                }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── CanalBars ───────────────────────────────────────────────────────────────

function CanalBars({ data, ready }: { data: typeof CANAIS_CONTATO; ready: boolean }) {
  const [hov, setHov] = useState<string | null>(null)
  const maxContatos = Math.max(...data.map(c => c.contatos))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {data.map((c, i) => {
        const isHov = hov === c.name
        const taxaResp = Math.round((c.respostas / c.contatos) * 100)
        const taxaReu  = Math.round((c.reunioes  / c.contatos) * 100)
        return (
          <div
            key={c.name}
            onMouseEnter={() => setHov(c.name)}
            onMouseLeave={() => setHov(null)}
            style={{ opacity: hov && !isHov ? 0.28 : 1, transition: 'opacity 0.22s', cursor: 'default' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: c.cor,
                  transform: isHov ? 'scale(1.7)' : 'scale(1)',
                  transition: 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1)',
                  boxShadow: isHov ? `0 0 8px ${c.cor}99` : 'none',
                }} />
                <span style={{ fontSize: 13, fontWeight: isHov ? 700 : 600, color: isHov ? 'var(--black)' : 'var(--gray)', transition: 'color .15s' }}>
                  {c.name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {isHov && (
                  <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, animation: 'ai-step 0.15s ease both' }}>
                    {c.reunioes} reuniões ({taxaReu}%)
                  </span>
                )}
                <span style={{ fontSize: 12, fontWeight: 800, color: isHov ? c.cor : 'var(--gray2)', transition: 'color .15s' }}>
                  {taxaResp}% resposta
                </span>
                <span style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500 }}>
                  {c.contatos} contatos
                </span>
              </div>
            </div>

            {/* Stacked bars: resposta + reunioes */}
            <div style={{ position: 'relative', height: isHov ? 11 : 7, background: 'var(--gray3)', borderRadius: 100, overflow: 'hidden', transition: 'height 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 100,
                background: c.cor, opacity: 0.25,
                width: ready ? `${(c.contatos / maxContatos) * 100}%` : '0%',
                transition: `width 0.55s cubic-bezier(0.4,0,0.2,1) ${i * 70}ms`,
              }} />
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 100,
                background: c.cor,
                width: ready ? `${(c.respostas / maxContatos) * 100}%` : '0%',
                boxShadow: isHov ? `0 0 14px ${c.cor}77` : 'none',
                transition: `width 0.55s cubic-bezier(0.4,0,0.2,1) ${i * 70 + 80}ms, box-shadow .22s`,
              }} />
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 100,
                background: 'var(--green)',
                width: ready ? `${(c.reunioes / maxContatos) * 100}%` : '0%',
                transition: `width 0.55s cubic-bezier(0.4,0,0.2,1) ${i * 70 + 160}ms`,
              }} />
            </div>

            {isHov && (
              <div style={{ display: 'flex', gap: 12, marginTop: 6, animation: 'ai-step 0.15s ease both' }}>
                <span style={{ fontSize: 10, color: 'var(--gray2)', fontWeight: 500 }}>
                  <span style={{ color: c.cor }}>■</span> Resposta
                </span>
                <span style={{ fontSize: 10, color: 'var(--gray2)', fontWeight: 500 }}>
                  <span style={{ color: 'var(--green)' }}>■</span> Reunião
                </span>
                <span style={{ fontSize: 10, color: 'var(--gray2)', fontWeight: 500 }}>
                  <span style={{ color: c.cor, opacity: 0.3 }}>■</span> Total contatados
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── WeeklyVolumeChart ────────────────────────────────────────────────────────

function WeeklyVolumeChart({ data, ready }: { data: typeof SEMANAS; ready: boolean }) {
  const [hovBar, setHovBar] = useState<string | null>(null)
  const maxContatos = Math.max(...data.map(d => d.contatos), 1)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 130, position: 'relative' }}>
        {data.map(({ label, contatos, reunioes }) => {
          const isHov = hovBar === label
          const contH = Math.max((contatos / maxContatos) * 100, 8)
          const reuH  = Math.max((reunioes / maxContatos) * 100, 3)

          return (
            <div key={label}
              onMouseEnter={() => setHovBar(label)}
              onMouseLeave={() => setHovBar(null)}
              style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', gap: 3, position: 'relative', cursor: 'pointer' }}
            >
              {/* Tooltip */}
              {isHov && (
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--black)', color: '#fff', borderRadius: 8, padding: '7px 11px',
                  fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', zIndex: 10,
                  lineHeight: 1.6, boxShadow: '0 4px 14px rgba(0,0,0,0.22)', pointerEvents: 'none',
                }}>
                  <div style={{ color: 'var(--gray2)', fontSize: 10 }}>{label}</div>
                  <div style={{ color: 'var(--primary)' }}>{contatos} contatos</div>
                  <div style={{ color: 'var(--green)' }}>{reunioes} reuniões</div>
                </div>
              )}

              {/* Contacts bar */}
              <div style={{
                flex: 1, borderRadius: '4px 4px 0 0',
                background: isHov ? 'var(--primary-mid)' : 'var(--primary)',
                height: ready ? `${contH}%` : '3%',
                transition: 'height 0.7s cubic-bezier(0.22,1,0.36,1), background 0.15s',
              }} />

              {/* Meetings bar */}
              <div style={{
                flex: 1, borderRadius: '4px 4px 0 0',
                background: isHov ? 'rgba(30,138,62,0.6)' : 'var(--green)',
                height: ready ? `${reuH}%` : '2%',
                transition: 'height 0.7s cubic-bezier(0.22,1,0.36,1) 0.05s, background 0.15s',
              }} />
            </div>
          )
        })}
      </div>

      {/* X axis */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        {data.map(({ label }) => (
          <div key={label} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: hovBar === label ? 'var(--primary-text)' : 'var(--gray2)', fontWeight: hovBar === label ? 700 : 500, transition: 'color 0.15s' }}>
            {label}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 10, justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--gray2)', fontWeight: 500 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--primary)' }} /> Contatos
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--gray2)', fontWeight: 500 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--green)' }} /> Reuniões
        </div>
      </div>
    </div>
  )
}

// ─── ObjecoesChart ───────────────────────────────────────────────────────────

function ObjecoesChart({ data, ready }: { data: typeof OBJECOES; ready: boolean }) {
  const [hov, setHov] = useState<string | null>(null)
  const max = Math.max(...data.map(o => o.count))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.map((o, i) => {
        const isHov = hov === o.motivo
        const pct   = (o.count / max) * 100
        return (
          <div
            key={o.motivo}
            onMouseEnter={() => setHov(o.motivo)}
            onMouseLeave={() => setHov(null)}
            style={{ opacity: hov && !isHov ? 0.28 : 1, transition: 'opacity 0.22s', cursor: 'default' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--red)',
                  transform: isHov ? 'scale(1.7)' : 'scale(1)',
                  transition: 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1)',
                  boxShadow: isHov ? '0 0 8px var(--red)88' : 'none',
                }} />
                <span style={{ fontSize: 12, fontWeight: isHov ? 700 : 600, color: isHov ? 'var(--black)' : 'var(--gray)', transition: 'color .15s' }}>
                  {o.motivo}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {isHov && (
                  <span style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, animation: 'ai-step 0.15s ease both' }}>
                    {Math.round((o.count / data.reduce((s, x) => s + x.count, 0)) * 100)}% do total
                  </span>
                )}
                <span style={{ fontSize: 12, fontWeight: 800, color: isHov ? 'var(--red)' : 'var(--gray2)', transition: 'color .15s' }}>
                  {o.count}
                </span>
              </div>
            </div>
            <div style={{ position: 'relative', height: isHov ? 11 : 7, background: 'var(--gray3)', borderRadius: 100, overflow: 'hidden', transition: 'height 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
              <div style={{
                height: '100%', borderRadius: 100,
                background: 'var(--red)',
                width: ready ? `${pct}%` : '0%',
                boxShadow: isHov ? '0 0 14px var(--red)77' : 'none',
                transition: `width 0.55s cubic-bezier(0.4,0,0.2,1) ${i * 70}ms, box-shadow .22s`,
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── StatusBreakdown ─────────────────────────────────────────────────────────

function StatusBreakdown({ data, ready }: { data: typeof STATUS_BREAKDOWN; ready: boolean }) {
  const [hov, setHov] = useState<string | null>(null)
  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Stacked bar */}
      <div style={{ height: 12, borderRadius: 99, overflow: 'hidden', display: 'flex', gap: 2, marginBottom: 4 }}>
        {data.map((s) => {
          const pct = (s.count / total) * 100
          return (
            <div
              key={s.label}
              onMouseEnter={() => setHov(s.label)}
              onMouseLeave={() => setHov(null)}
              style={{
                height: '100%', flex: ready ? pct : 0,
                background: s.color, borderRadius: 4,
                opacity: hov && hov !== s.label ? 0.35 : 1,
                transform: hov === s.label ? 'scaleY(1.3)' : 'scaleY(1)',
                transition: 'flex 0.7s cubic-bezier(0.4,0,0.2,1), opacity .2s, transform .2s',
                cursor: 'default',
              }}
            />
          )
        })}
      </div>

      {/* Rows */}
      {data.map((s) => {
        const pct = Math.round((s.count / total) * 100)
        const isHov = hov === s.label
        return (
          <div
            key={s.label}
            onMouseEnter={() => setHov(s.label)}
            onMouseLeave={() => setHov(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8,
              background: isHov ? 'var(--bg)' : 'transparent',
              cursor: 'default', transition: 'background .15s',
              opacity: hov && !isHov ? 0.4 : 1,
            }}
          >
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0, transform: isHov ? 'scale(1.4)' : 'scale(1)', transition: 'transform .2s cubic-bezier(0.34,1.56,0.64,1)', boxShadow: isHov ? `0 0 8px ${s.color}88` : 'none' }} />
            <span style={{ flex: 1, fontSize: 12, fontWeight: isHov ? 700 : 500, color: isHov ? 'var(--black)' : 'var(--gray)', transition: 'color .15s' }}>{s.label}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: s.color }}>{s.count}</span>
            <span style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, minWidth: 32, textAlign: 'right' }}>{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    'Reunião agendada': { bg: 'rgba(30,138,62,0.10)',  color: 'var(--green)' },
    'Em andamento':     { bg: 'rgba(255,180,0,0.12)',  color: 'var(--primary-text)' },
    'Aguardando':       { bg: 'rgba(37,99,235,0.08)',  color: '#2563EB' },
    'Sem resposta':     { bg: 'rgba(170,170,170,0.12)', color: 'var(--gray2)' },
    'Sem interesse':    { bg: 'rgba(217,48,37,0.08)',  color: 'var(--red)' },
  }
  const s = map[status] ?? { bg: 'var(--bg)', color: 'var(--gray2)' }
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: s.bg, color: s.color, whiteSpace: 'nowrap', border: `1px solid ${s.color}30` }}>
      {status}
    </span>
  )
}

// ─── Canal badge helper ───────────────────────────────────────────────────────

function CanalBadge({ canal }: { canal: string }) {
  const map: Record<string, { color: string; icon: string }> = {
    'WhatsApp': { color: '#25D366', icon: '💬' },
    'E-mail':   { color: '#EA4335', icon: '✉️' },
    'LinkedIn': { color: '#0A66C2', icon: '🔗' },
  }
  const c = map[canal] ?? { color: 'var(--gray2)', icon: '•' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: c.color }}>
      <span style={{ fontSize: 12 }}>{c.icon}</span> {canal}
    </span>
  )
}

// ─── ScorePill ───────────────────────────────────────────────────────────────

function ScorePill({ score }: { score: number }) {
  const color = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--primary-text)' : 'var(--red)'
  const bg    = score >= 80 ? 'rgba(30,138,62,0.08)' : score >= 60 ? 'var(--primary-dim)' : 'rgba(217,48,37,0.08)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 800, color, background: bg, borderRadius: 99, padding: '2px 8px', border: `1px solid ${color}30` }}>
      {score}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type SortCol = 'lead' | 'msgs' | 'status' | 'score'

export default function SdrIaPage() {
  const [period, setPeriod] = useState<Period>('30d')
  const [ready, setReady]   = useState(false)
  const [sortCol, setSortCol]   = useState<SortCol>('score')
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 80)
    return () => clearTimeout(t)
  }, [period])

  useEffect(() => {
    setReady(false)
  }, [period])

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const sortedLeads = [...LEADS_RECENTES].sort((a, b) => {
    let av: number | string, bv: number | string
    if (sortCol === 'msgs')   { av = a.msgs;   bv = b.msgs }
    else if (sortCol === 'score')  { av = a.score;  bv = b.score }
    else if (sortCol === 'status') { av = a.status; bv = b.status }
    else { av = a.lead; bv = b.lead }
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
    return sortDir === 'asc' ? av - (bv as number) : (bv as number) - av
  })

  // Counts from funnel
  const totalContatos = FUNNEL_DATA[1].count
  const totalResposta = FUNNEL_DATA[2].count
  const totalReunioes = FUNNEL_DATA[3].count
  const taxaResposta  = Math.round((totalResposta / totalContatos) * 100)
  const taxaConversao = Math.round((totalReunioes / FUNNEL_DATA[0].count) * 100)

  const cContatos  = useCountUp(totalContatos, 900, 100)
  const cResposta  = useCountUp(taxaResposta,  700, 200)
  const cReunioes  = useCountUp(totalReunioes, 850, 150)
  const cConv      = useCountUp(taxaConversao, 700, 250)

  return (
    <div>

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="animate-slide-up delay-1" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>
              SDR IA
            </div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)' }}>
            Prospecção ativa com IA — do primeiro contato até a reunião com o closer.
          </div>
        </div>
        <PeriodFilter value={period} onChange={p => { setPeriod(p); setReady(false) }} />
      </div>

      {/* ── KPI Cards ────────────────────────────────────────────── */}
      <div className="animate-slide-up delay-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 24 }}>
        <SummaryCard
          label="Contatos realizados"
          value={cContatos}
          format={v => v.toLocaleString('pt-BR')}
          accent="var(--primary-text)"
          sub={`de ${FUNNEL_DATA[0].count.toLocaleString('pt-BR')} leads recebidos`}
          change={12}
        />
        <SummaryCard
          label="Taxa de resposta"
          value={cResposta}
          format={v => `${v}%`}
          accent="#2563EB"
          sub="leads que responderam"
          change={5}
        />
        <SummaryCard
          label="Reuniões agendadas"
          value={cReunioes}
          format={v => String(v)}
          accent="var(--green)"
          sub="com closer este período"
          change={18}
        />
        <SummaryCard
          label="Conversão lead→reunião"
          value={cConv}
          format={v => `${v}%`}
          accent="var(--green)"
          sub="do total de leads"
          change={3}
        />
        <div
          style={{
            background: 'var(--white)', border: '1px solid var(--gray3)',
            borderLeft: '4px solid var(--gray2)', borderRadius: 12, padding: '18px 20px',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            Tempo médio de resposta
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--gray)', lineHeight: 1, letterSpacing: '-0.02em' }}>
            4,2h
          </div>
          <div style={{ fontSize: 11, color: 'var(--gray2)', marginTop: 5, fontWeight: 500 }}>do envio até a resposta</div>
          <ChangeBadge value={-8} />
        </div>
      </div>

      {/* ── Funil + Canal ────────────────────────────────────────── */}
      <div className="animate-slide-up delay-3" style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, marginBottom: 16 }}>

        {/* Funil */}
        <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: '20px 24px' }}>
          <SectionTitle action={<AskAIButton question={`O funil de conversão da SDR IA no período de ${PERIOD_LABELS[period]} mostra: ${FUNNEL_DATA.map(f => `${f.label}: ${f.count}`).join(', ')}. Por que a conversão é essa? Como melhorar?`} />}>
            Funil de prospecção
          </SectionTitle>
          <FunnelChart data={FUNNEL_DATA} ready={ready} />
        </div>

        {/* Status breakdown */}
        <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: '20px 24px' }}>
          <SectionTitle action={<AskAIButton question={`O status das conversas da SDR IA é: ${STATUS_BREAKDOWN.map(s => `${s.label}: ${s.count}`).join(', ')}. Como interpretar esses números e o que priorizar?`} />}>
            Status das conversas
          </SectionTitle>
          <StatusBreakdown data={STATUS_BREAKDOWN} ready={ready} />
        </div>
      </div>

      {/* ── Volume semanal + Objeções ────────────────────────────── */}
      <div className="animate-slide-up delay-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* Volume semanal */}
        <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: '20px 24px' }}>
          <SectionTitle action={<AskAIButton question={`O volume semanal de contatos e reuniões da SDR IA foi: ${SEMANAS.map(s => `${s.label}: ${s.contatos} contatos, ${s.reunioes} reuniões`).join('; ')}. Há tendência de crescimento?`} />}>
            Volume semanal
          </SectionTitle>
          <WeeklyVolumeChart data={SEMANAS} ready={ready} />
        </div>

        {/* Canal de contato */}
        <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: '20px 24px' }}>
          <SectionTitle action={<AskAIButton question={`Performance por canal da SDR IA: ${CANAIS_CONTATO.map(c => `${c.name}: ${c.contatos} contatos, ${c.respostas} respostas, ${c.reunioes} reuniões`).join('; ')}. Qual canal priorizar?`} />}>
            Performance por canal
          </SectionTitle>
          <CanalBars data={CANAIS_CONTATO} ready={ready} />
        </div>

        {/* Objeções */}
        <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: '20px 24px' }}>
          <SectionTitle action={<AskAIButton question={`Os principais motivos de recusa da SDR IA são: ${OBJECOES.map(o => `"${o.motivo}": ${o.count} casos`).join(', ')}. Como contornar essas objeções?`} />}>
            Principais objeções
          </SectionTitle>
          <ObjecoesChart data={OBJECOES} ready={ready} />
        </div>
      </div>

      {/* ── Tabela de leads ──────────────────────────────────────── */}
      <div className="animate-slide-up delay-5" style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', overflow: 'hidden' }}>

        {/* Table header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--gray3)', background: 'var(--bg)' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Leads em prospecção
          </div>
          <AskAIButton question={`Análise dos leads em prospecção pela SDR IA: ${LEADS_RECENTES.length} leads ativos com scores variando de ${Math.min(...LEADS_RECENTES.map(l => l.score))} a ${Math.max(...LEADS_RECENTES.map(l => l.score))}. Quais leads têm maior potencial de converter?`} />
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--gray3)', background: 'var(--bg)' }}>
              {([
                { col: 'lead'  as SortCol, label: 'Lead / Empresa' },
                { col: null,               label: 'Canal' },
                { col: 'msgs'  as SortCol, label: 'Mensagens' },
                { col: 'status'as SortCol, label: 'Status' },
                { col: null,               label: 'Última interação' },
                { col: 'score' as SortCol, label: 'Score IA' },
              ]).map(({ col, label }) => (
                <th key={label}
                  onClick={col ? () => handleSort(col) : undefined}
                  style={{
                    padding: '9px 16px', textAlign: 'left',
                    fontSize: 9, fontWeight: 800, color: 'var(--gray2)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    cursor: col ? 'pointer' : 'default',
                    userSelect: 'none', whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                  {col && <SortIcon col={col} active={sortCol === col} dir={sortDir} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedLeads.map((l, i) => (
              <LeadRow key={l.lead} lead={l} i={i} isLast={i === sortedLeads.length - 1} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── LeadRow ─────────────────────────────────────────────────────────────────

function LeadRow({ lead, i, isLast }: { lead: Lead; i: number; isLast: boolean }) {
  const [hov, setHov] = useState(false)
  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--gray3)',
        background: hov ? 'var(--bg)' : 'transparent',
        borderLeft: hov ? '3px solid var(--primary)' : '3px solid transparent',
        transition: 'background .15s, border-left-color .15s',
        animation: `ai-step 0.22s ease both`,
        animationDelay: `${i * 40}ms`,
      }}
    >
      <td style={{ padding: '12px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{lead.lead}</div>
        <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginTop: 2 }}>{lead.empresa}</div>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <CanalBadge canal={lead.canal} />
      </td>
      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: 'var(--black)', textAlign: 'center' }}>
        {lead.msgs}
      </td>
      <td style={{ padding: '12px 16px' }}>
        <StatusBadge status={lead.status} />
      </td>
      <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--gray2)', fontWeight: 500, whiteSpace: 'nowrap' }}>
        {lead.ultima}
      </td>
      <td style={{ padding: '12px 16px' }}>
        <ScorePill score={lead.score} />
      </td>
    </tr>
  )
}
