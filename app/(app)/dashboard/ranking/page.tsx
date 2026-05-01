'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useRef } from 'react'
import { formatCurrency } from '@/lib/utils'

type Period = 'all' | '7d' | '30d' | '90d'
type Metric = 'revenue' | 'won' | 'conversion'

const PERIOD_LABELS: Record<Period, string> = {
  all: 'Tudo', '7d': '7 dias', '30d': '30 dias', '90d': '90 dias',
}

interface Rep {
  name: string
  totalLeads: number
  wonLeads: number
  lostLeads: number
  activeLeads: number
  totalRevenue: number
  conversionRate: number
  avgTicket: number
}

// ─── useCountUp ───────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 800, delay = 0): number {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#FF6B6B', '#FF9F43', '#54A0FF', '#5F27CD',
  '#00D2D3', '#1DD1A1', '#FF6348', '#2E86DE',
  '#C0392B', '#8E44AD', '#16A085', '#E67E22',
]

function avatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function metricValue(rep: Rep, metric: Metric): number {
  if (metric === 'revenue') return rep.totalRevenue
  if (metric === 'won') return rep.wonLeads
  return rep.conversionRate
}

function fmtMetric(val: number, metric: Metric): string {
  if (metric === 'revenue') return formatCurrency(val)
  if (metric === 'won') return String(val)
  return `${val}%`
}

const RANK_STYLE = [
  { ring: '#FFB400', glow: 'rgba(255,180,0,0.40)', pillBg: 'rgba(255,180,0,0.12)', pillColor: '#A07000', badge: '#D49000' },
  { ring: '#A8B8CC', glow: 'rgba(168,184,204,0.30)', pillBg: 'rgba(168,184,204,0.15)', pillColor: '#7A8FA8', badge: '#8A9BB0' },
  { ring: '#C07A40', glow: 'rgba(192,122,64,0.30)', pillBg: 'rgba(192,122,64,0.12)', pillColor: '#9A5C28', badge: '#A06030' },
]

// ─── Team types ───────────────────────────────────────────────────────────────

interface Team {
  id: string
  name: string
  color: string
  members: string[]
}

const TEAM_COLORS = [
  '#FFB400', '#FF6B6B', '#54A0FF', '#1DD1A1',
  '#5F27CD', '#FF9F43', '#00D2D3', '#C0392B',
]

// ─── TeamsModal ───────────────────────────────────────────────────────────────

function TeamsModal({ allReps, onClose }: { allReps: string[]; onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery<{ teams: Team[] }>({ queryKey: ['teams'], queryFn: () => fetch('/api/teams').then(r => r.json()) })
  const teams = data?.teams ?? []

  type View = 'list' | 'edit' | 'new'
  const [view, setView] = useState<View>('list')
  const [editing, setEditing] = useState<Team | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(TEAM_COLORS[0])
  const [members, setMembers] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [repSearch, setRepSearch] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  function openNew() {
    setName(''); setColor(TEAM_COLORS[0]); setMembers(new Set()); setEditing(null); setRepSearch(''); setView('new')
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  function openEdit(t: Team) {
    setName(t.name); setColor(t.color); setMembers(new Set(t.members)); setEditing(t); setRepSearch(''); setView('edit')
    setTimeout(() => nameRef.current?.focus(), 50)
  }

  function toggleMember(rep: string) {
    setMembers(prev => { const s = new Set(prev); s.has(rep) ? s.delete(rep) : s.add(rep); return s })
  }

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    if (view === 'new') {
      const res = await fetch('/api/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color }) })
      const { id } = await res.json()
      await fetch(`/api/teams/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color, members: [...members] }) })
    } else if (editing) {
      await fetch(`/api/teams/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color, members: [...members] }) })
    }
    await qc.invalidateQueries({ queryKey: ['teams'] })
    setSaving(false)
    setView('list')
  }

  async function deleteTeam(t: Team) {
    if (!confirm(`Excluir o time "${t.name}"?`)) return
    await fetch(`/api/teams/${t.id}`, { method: 'DELETE' })
    await qc.invalidateQueries({ queryKey: ['teams'] })
    if (editing?.id === t.id) setView('list')
  }

  const isForm = view === 'edit' || view === 'new'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(18,19,22,0.25)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', animation: 'fadeIn .15s ease both' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--white)', borderRadius: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.18)', width: 680, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'panelUp .25s ease both' }}>

        {/* Modal header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--gray3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isForm && (
              <button onClick={() => setView('list')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray2)', fontSize: 18, lineHeight: 1, padding: '0 4px' }}>←</button>
            )}
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--black)' }}>
                {view === 'list' ? 'Times de Vendas' : view === 'new' ? 'Novo Time' : `Editar: ${editing?.name}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginTop: 1 }}>
                {view === 'list' ? `${teams.length} ${teams.length === 1 ? 'time configurado' : 'times configurados'}` : 'Configure nome, cor e membros'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'var(--bg)', cursor: 'pointer', fontSize: 16, color: 'var(--gray2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        {/* Modal body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── LIST VIEW ── */}
          {view === 'list' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {teams.length === 0 && (
                <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--gray2)', fontSize: 13 }}>
                  Nenhum time criado ainda. Clique em "Novo Time" para começar.
                </div>
              )}
              {teams.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12, border: '1px solid var(--gray3)', background: 'var(--bg)' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: t.color, flexShrink: 0, boxShadow: `0 0 0 3px ${t.color}30` }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--gray2)', marginTop: 2 }}>
                      {t.members.length === 0 ? 'Sem membros' : t.members.slice(0, 3).join(', ') + (t.members.length > 3 ? ` +${t.members.length - 3}` : '')}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: `${t.color}18`, color: t.color, border: `1px solid ${t.color}40` }}>
                    {t.members.length} {t.members.length === 1 ? 'membro' : 'membros'}
                  </span>
                  <button onClick={() => openEdit(t)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--gray3)', background: 'var(--white)', fontSize: 12, fontWeight: 600, color: 'var(--gray)', cursor: 'pointer' }}>Editar</button>
                  <button onClick={() => deleteTeam(t)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(217,48,37,0.2)', background: 'rgba(217,48,37,0.06)', fontSize: 12, fontWeight: 600, color: 'var(--red)', cursor: 'pointer' }}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* ── FORM VIEW (new / edit) ── */}
          {isForm && (
            <div style={{ display: 'flex', gap: 24 }}>
              {/* Left: name + color */}
              <div style={{ flex: '0 0 200px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', display: 'block', marginBottom: 8 }}>Nome do time</label>
                  <input
                    ref={nameRef}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && save()}
                    placeholder="Ex: SDR, Hunters..."
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--gray3)', fontSize: 13, fontWeight: 600, color: 'var(--black)', outline: 'none', background: 'var(--bg)', fontFamily: 'inherit' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', display: 'block', marginBottom: 8 }}>Cor</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {TEAM_COLORS.map(c => (
                      <button key={c} onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: color === c ? `3px solid var(--black)` : '3px solid transparent', cursor: 'pointer', transition: 'transform .15s', transform: color === c ? 'scale(1.15)' : 'scale(1)' }} />
                    ))}
                  </div>
                </div>
                {/* Preview */}
                <div style={{ padding: '12px 14px', borderRadius: 10, background: `${color}12`, border: `1px solid ${color}40`, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color }}>{name || 'Nome do time'}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: `${color}CC` }}>{members.size} membros</span>
                </div>
              </div>

              {/* Right: reps checkboxes */}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)' }}>
                    Vendedores ({members.size} selecionados)
                  </label>
                </div>
                {/* Search input */}
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--gray2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                    style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <circle cx="6.5" cy="6.5" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
                  </svg>
                  <input
                    value={repSearch}
                    onChange={e => setRepSearch(e.target.value)}
                    placeholder="Buscar vendedor…"
                    style={{
                      width: '100%', padding: '7px 10px 7px 30px',
                      borderRadius: 8, border: '1px solid var(--gray3)',
                      fontSize: 12, fontWeight: 500, color: 'var(--black)',
                      outline: 'none', background: 'var(--bg)',
                      fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                    onFocus={e => { e.target.style.borderColor = color; e.target.style.boxShadow = `0 0 0 3px ${color}22` }}
                    onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
                  />
                  {repSearch && (
                    <button onClick={() => setRepSearch('')}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray2)', fontSize: 14, lineHeight: 1, padding: 0 }}>
                      ×
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
                  {allReps.filter(rep => rep.toLowerCase().includes(repSearch.toLowerCase())).length === 0 && (
                    <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--gray2)', fontSize: 12, fontWeight: 500 }}>
                      Nenhum vendedor encontrado
                    </div>
                  )}
                  {allReps.filter(rep => rep.toLowerCase().includes(repSearch.toLowerCase())).map(rep => {
                    const checked = members.has(rep)
                    return (
                      <label key={rep} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: `1px solid ${checked ? color + '50' : 'var(--gray3)'}`, background: checked ? `${color}08` : 'var(--bg)', cursor: 'pointer', transition: 'all .15s' }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleMember(rep)} style={{ display: 'none' }} />
                        <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${checked ? color : 'var(--gray3)'}`, background: checked ? color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                          {checked && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                        </div>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarColor(rep), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                          {rep.trim().charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--black)' }}>{rep}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--gray3)', display: 'flex', justifyContent: 'space-between', gap: 10, background: 'var(--bg)' }}>
          {view === 'list' ? (
            <>
              <div />
              <button onClick={openNew} style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: 'var(--black)', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                + Novo Time
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setView('list')} style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--gray3)', background: 'var(--white)', fontSize: 13, fontWeight: 600, color: 'var(--gray)', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={save} disabled={!name.trim() || saving} style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: name.trim() ? 'var(--primary)' : 'var(--gray3)', color: 'var(--black)', fontSize: 13, fontWeight: 800, cursor: name.trim() ? 'pointer' : 'default', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── PerformanceBadge ─────────────────────────────────────────────────────────

function PerformanceBadge({ rep }: { rep: Rep }) {
  if (rep.wonLeads === 0) return null
  if (rep.conversionRate >= 70)
    return (
      <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99, background: 'rgba(30,138,62,0.10)', color: 'var(--green)', border: '1px solid rgba(30,138,62,0.20)', whiteSpace: 'nowrap' }}>
        🔥 Top
      </span>
    )
  if (rep.conversionRate >= 50)
    return (
      <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99, background: 'var(--primary-dim)', color: 'var(--primary-text)', border: '1px solid var(--primary-mid)', whiteSpace: 'nowrap' }}>
        ↑ Bom
      </span>
    )
  return null
}

// ─── BreakdownBar ─────────────────────────────────────────────────────────────

function BreakdownBar({ rep, delay }: { rep: Rep; delay: number }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReady(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  const total = rep.totalLeads || 1
  const wonPct  = ready ? (rep.wonLeads    / total) * 100 : 0
  const actPct  = ready ? (rep.activeLeads / total) * 100 : 0
  const lostPct = ready ? (rep.lostLeads   / total) * 100 : 0

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <div style={{ flex: 1, height: 5, borderRadius: 99, overflow: 'hidden', background: 'var(--gray3)', display: 'flex' }}>
        <div style={{ width: `${wonPct}%`,  background: 'var(--green)', transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)' }} />
        <div style={{ width: `${actPct}%`,  background: '#FFB400', transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1) 0.05s' }} />
        <div style={{ width: `${lostPct}%`, background: 'var(--red)', transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1) 0.1s' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--green)' }}>●{rep.wonLeads}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#7A5600' }}>●{rep.activeLeads}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--red)' }}>●{rep.lostLeads}</span>
      </div>
    </div>
  )
}

// ─── Progress bar with sweep ──────────────────────────────────────────────────

function ProgressBar({ value, max, color, delay }: { value: number; max: number; color: string; delay: number }) {
  const [width, setWidth] = useState(0)
  const [sweep, setSweep] = useState(false)
  const pct = max > 0 ? Math.round((value / max) * 100) : 0

  useEffect(() => {
    const t1 = setTimeout(() => setWidth(pct), delay)
    const t2 = setTimeout(() => { setSweep(true); setTimeout(() => setSweep(false), 700) }, delay + 900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [pct, delay])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--gray3)', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          height: '100%', width: `${width}%`,
          background: color, borderRadius: 99,
          transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
          position: 'relative', overflow: 'hidden',
        }}>
          {sweep && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
              animation: 'barSweep 0.6s ease forwards',
            }} />
          )}
        </div>
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray2)', minWidth: 28, textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  )
}

// ─── Floating sparkle dots ────────────────────────────────────────────────────

const SPARKLES = [
  { top: '14%', left: '7%',   size: 9, delay: '0s',   dur: '3.1s', color: 'var(--primary)' },
  { top: '68%', left: '6%',   size: 5, delay: '0.8s', dur: '2.7s', color: '#FFD700' },
  { top: '42%', left: '13%',  size: 4, delay: '2.0s', dur: '4.2s', color: '#C0C0C0' },
  { top: '22%', right: '7%',  size: 8, delay: '0.4s', dur: '3.5s', color: '#FFD700' },
  { top: '72%', right: '8%',  size: 5, delay: '1.2s', dur: '2.4s', color: 'var(--primary)' },
  { top: '50%', right: '13%', size: 4, delay: '1.8s', dur: '3.9s', color: '#CD9B4B' },
  { top: '48%', left: '49%',  size: 3, delay: '1.6s', dur: '3.2s', color: '#FFD700' },
]

// ─── PodiumCard ───────────────────────────────────────────────────────────────

function PodiumCard({ rep, rank, metric, delay }: { rep: Rep; rank: number; metric: Metric; delay: number }) {
  const [hovered, setHovered] = useState(false)
  const rs = RANK_STYLE[rank - 1]
  const isFirst = rank === 1
  const avatarSize = isFirst ? 96 : 72
  const counted = useCountUp(metricValue(rep, metric), 800, delay + 300)
  const firstName = rep.name.split(' ')[0]

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 10, flex: isFirst ? '0 0 150px' : '0 0 130px',
        paddingTop: isFirst ? 0 : 20,
        animation: `podiumRise 0.6s cubic-bezier(0.34,1.3,0.64,1) ${delay}ms both`,
        transform: hovered ? 'translateY(-4px) scale(1.03)' : 'translateY(0) scale(1)',
        transition: 'transform 0.2s cubic-bezier(0.34,1.3,0.64,1)',
        cursor: 'default',
      }}
    >
      {/* Crown */}
      {isFirst && (
        <svg width="28" height="20" viewBox="0 0 28 20" fill="none" style={{ marginBottom: -4, filter: hovered ? 'drop-shadow(0 2px 6px rgba(255,180,0,0.6))' : 'none', transition: 'filter 0.2s' }}>
          <path d="M2 17L5 5L11 11L14 2L17 11L23 5L26 17H2Z" fill="#FFB400" stroke="#E6A000" strokeWidth="1.2" strokeLinejoin="round"/>
          <rect x="2" y="17" width="24" height="2.5" rx="1.25" fill="#FFB400"/>
        </svg>
      )}

      {/* Avatar + pulsing ring */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Outer pulse ring — only rank 1 */}
        {isFirst && (
          <div style={{
            position: 'absolute',
            width: avatarSize + 16, height: avatarSize + 16,
            borderRadius: '50%',
            border: `2px solid ${rs.ring}`,
            animation: 'ringPulse 2s ease-out infinite',
            pointerEvents: 'none',
          }} />
        )}
        {/* Glow halo that intensifies on hover */}
        <div style={{
          position: 'absolute',
          width: avatarSize + 8, height: avatarSize + 8, borderRadius: '50%',
          boxShadow: hovered
            ? `0 0 0 3px ${rs.ring}, 0 0 32px ${rs.glow}`
            : `0 0 0 3px ${rs.ring}50, 0 0 16px ${rs.glow}80`,
          transition: 'box-shadow 0.2s ease',
          pointerEvents: 'none',
          background: 'transparent',
        }} />
        {/* Avatar */}
        <div style={{
          width: avatarSize, height: avatarSize, borderRadius: '50%',
          background: avatarColor(rep.name),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: avatarSize * 0.38, fontWeight: 900, color: '#fff',
          letterSpacing: '-0.03em', position: 'relative', zIndex: 1,
        }}>
          {rep.name.trim().charAt(0).toUpperCase()}
        </div>
        {/* Rank badge */}
        <div style={{
          position: 'absolute', bottom: -4, right: -4, zIndex: 2,
          width: 24, height: 24, borderRadius: '50%',
          background: rs.badge, border: '2px solid var(--white)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 900, color: '#fff',
          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        }}>
          {rank}
        </div>
      </div>

      {/* Name */}
      <div style={{
        fontSize: isFirst ? 14 : 12, fontWeight: 800, color: 'var(--black)',
        textAlign: 'center', maxWidth: isFirst ? 130 : 100,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {firstName}
      </div>

      {/* Metric pill */}
      <div style={{
        padding: '4px 12px', borderRadius: 99,
        background: hovered ? rs.ring : rs.pillBg,
        color: hovered ? (isFirst ? '#7A5600' : '#fff') : rs.pillColor,
        fontSize: isFirst ? 13 : 11, fontWeight: 800,
        border: `1px solid ${rs.ring}60`,
        transition: 'background 0.2s, color 0.2s',
      }}>
        {fmtMetric(counted, metric)}
      </div>

      {/* Sub-stats */}
      <div style={{ fontSize: 10, color: 'var(--gray2)', fontWeight: 600, textAlign: 'center', lineHeight: 1.6 }}>
        {rep.wonLeads} ganhos
        <br />
        {rep.conversionRate}% conv.
      </div>
    </div>
  )
}

// ─── Leaderboard row ─────────────────────────────────────────────────────────

function LeaderRow({ rep, rank, metric, maxVal, delay, isLast, expanded, onToggle }: {
  rep: Rep; rank: number; metric: Metric; maxVal: number
  delay: number; isLast?: boolean; expanded: boolean; onToggle: () => void
}) {
  const rs = rank <= 3 ? RANK_STYLE[rank - 1] : null
  const val = metricValue(rep, metric)
  const barColor = rs
    ? `linear-gradient(90deg, ${rs.ring}, ${rs.badge})`
    : 'linear-gradient(90deg, var(--primary), var(--primary-mid))'
  const [hov, setHov] = useState(false)

  return (
    <div style={{ borderBottom: isLast && !expanded ? 'none' : '1px solid var(--gray3)' }}>
      {/* Main row */}
      <div
        onClick={onToggle}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        className={`animate-slide-up delay-${Math.min(rank, 9)}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 20px',
          background: expanded
            ? 'var(--bg)'
            : rank === 1
            ? `linear-gradient(90deg, rgba(255,180,0,0.07) 0%, transparent 70%)`
            : hov ? 'var(--bg)' : 'transparent',
          transition: 'background .15s',
          cursor: 'pointer',
        }}
      >
        {/* Rank medal */}
        {rank <= 3 ? (
          <div style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
            background: rank === 1
              ? 'radial-gradient(circle at 35% 30%, #FFE566, #C8960C)'
              : rank === 2
              ? 'radial-gradient(circle at 35% 30%, #F0F0F0, #9A9A9A)'
              : 'radial-gradient(circle at 35% 30%, #E8A84A, #7A4A1A)',
            border: `2px solid ${rank === 1 ? '#DAA520' : rank === 2 ? '#B8B8B8' : '#A06830'}`,
            boxShadow: rank === 1
              ? '0 2px 10px rgba(218,165,32,0.55), inset 0 1px 0 rgba(255,255,255,0.45)'
              : rank === 2
              ? '0 2px 8px rgba(180,180,180,0.45), inset 0 1px 0 rgba(255,255,255,0.45)'
              : '0 2px 8px rgba(160,104,48,0.45), inset 0 1px 0 rgba(255,255,255,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 900,
            color: rank === 2 ? '#555' : '#fff',
            textShadow: rank === 2 ? 'none' : '0 1px 2px rgba(0,0,0,0.28)',
          }}>
            {rank}
          </div>
        ) : (
          <div style={{
            width: 32, flexShrink: 0, textAlign: 'center',
            fontSize: 13, fontWeight: 700, color: 'var(--gray2)',
          }}>
            {rank}
          </div>
        )}

        {/* Avatar */}
        <div style={{
          width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
          background: avatarColor(rep.name),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 900, color: '#fff',
          boxShadow: rs ? `0 0 0 2px ${rs.ring}` : 'none',
          transition: 'transform 0.15s, box-shadow 0.15s',
          transform: hov ? 'scale(1.08)' : 'scale(1)',
        }}>
          {rep.name.trim().charAt(0).toUpperCase()}
        </div>

        {/* Name + bars */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {rep.name}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray2)', flexShrink: 0 }}>
              {rep.totalLeads} leads
            </span>
            <PerformanceBadge rep={rep} />
          </div>
          <ProgressBar value={val} max={maxVal} color={barColor} delay={delay} />
        </div>

        {/* Stats */}
        <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 88 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--black)' }}>
            {fmtMetric(val, metric)}
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray2)', marginTop: 2 }}>
            {rep.conversionRate}% conversão
          </div>
        </div>

        {/* Expand chevron */}
        <div style={{
          flexShrink: 0, width: 24, textAlign: 'center',
          color: expanded ? 'var(--primary-text)' : 'var(--gray2)',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease, color 0.15s ease',
          fontSize: 18, lineHeight: 1,
        }}>
          ▾
        </div>
      </div>

      {/* Expanded detail */}
      <div style={{
        maxHeight: expanded ? 80 : 0,
        overflow: 'hidden',
        transition: 'max-height 0.3s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div style={{
          padding: '8px 20px 14px 60px',
          display: 'flex', gap: 32, alignItems: 'flex-start',
          animation: expanded ? 'rowExpand 0.25s ease both' : 'none',
          borderBottom: isLast ? 'none' : '1px solid var(--gray3)',
        }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', marginBottom: 3 }}>Ticket Médio</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--black)' }}>{formatCurrency(rep.avgTicket)}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', marginBottom: 3 }}>Em negociação</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#7A5600' }}>{rep.activeLeads}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', marginBottom: 3 }}>Perdidos</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--red)' }}>{rep.lostLeads}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', marginBottom: 6 }}>Distribuição</div>
            <BreakdownBar rep={rep} delay={0} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 300px', background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: 32, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 20 }}>
        {[70, 90, 58].map((s, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingBottom: i === 1 ? 0 : 20 }}>
            <div className="shimmer-bar" style={{ width: s, height: s, borderRadius: '50%', background: 'var(--gray3)' }} />
            <div className="shimmer-bar" style={{ width: 60, height: 10, borderRadius: 6, background: 'var(--gray3)' }} />
            <div className="shimmer-bar" style={{ width: 52, height: 24, borderRadius: 99, background: 'var(--gray3)' }} />
          </div>
        ))}
      </div>
      <div style={{ flex: 1, background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)' }}>
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--gray3)', background: 'var(--bg)', borderRadius: '16px 16px 0 0' }}>
          <div className="shimmer-bar" style={{ width: 120, height: 9, borderRadius: 6, background: 'var(--gray3)' }} />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: i < 5 ? '1px solid var(--gray3)' : 'none' }}>
            <div className="shimmer-bar" style={{ width: 20, height: 20, borderRadius: 4, background: 'var(--gray3)' }} />
            <div className="shimmer-bar" style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--gray3)' }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div className="shimmer-bar" style={{ width: 110, height: 10, borderRadius: 6, background: 'var(--gray3)' }} />
              <div className="shimmer-bar" style={{ width: '65%', height: 6, borderRadius: 99, background: 'var(--gray3)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
              <div className="shimmer-bar" style={{ width: 60, height: 12, borderRadius: 6, background: 'var(--gray3)' }} />
              <div className="shimmer-bar" style={{ width: 40, height: 9, borderRadius: 6, background: 'var(--gray3)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent, sub, dot }: {
  label: string; value: string; accent: string; sub: string; dot?: boolean
}) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: 'var(--white)', border: '1px solid var(--gray3)',
        borderLeft: `4px solid ${accent}`, borderRadius: 12, padding: '16px 20px',
        cursor: 'default',
        transition: 'transform 0.22s ease, box-shadow 0.22s ease',
        transform: hov ? 'translateY(-3px) scale(1.01)' : 'translateY(0) scale(1)',
        boxShadow: hov ? `0 8px 24px rgba(0,0,0,0.09), inset 0 0 0 1px ${accent}30` : 'var(--shadow)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 24, fontWeight: 900, color: accent, lineHeight: 1, letterSpacing: '-0.02em' }}>
          {value}
        </div>
        {dot && <span className="live-dot" style={{ background: accent }} />}
      </div>
      <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500 }}>{sub}</div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RankingPage() {
  const [period, setPeriod]           = useState<Period>('30d')
  const [metric, setMetric]           = useState<Metric>('revenue')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [teamsModal, setTeamsModal]   = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['ranking', period],
    queryFn: () => fetch(`/api/ranking?period=${period}`).then(r => r.json()),
  })

  const { data: teamsData } = useQuery<{ teams: Team[] }>({
    queryKey: ['teams'],
    queryFn: () => fetch('/api/teams').then(r => r.json()),
  })
  const teams = teamsData?.teams ?? []

  const reps: Rep[] = data?.reps ?? []

  const filteredReps = selectedTeam
    ? reps.filter(r => teams.find(t => t.id === selectedTeam)?.members.includes(r.name))
    : reps

  const sorted = [...filteredReps].sort((a, b) => metricValue(b, metric) - metricValue(a, metric))
  const maxVal = sorted[0] ? metricValue(sorted[0], metric) : 1

  const top3 = sorted.slice(0, 3)
  const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3.length === 2 ? [top3[1], top3[0]] : top3
  const podiumRanks = top3.length >= 3 ? [2, 1, 3] : top3.length === 2 ? [2, 1] : [1]

  const teamRevenue  = filteredReps.reduce((s, r) => s + r.totalRevenue, 0)
  const top3Revenue  = top3.reduce((s, r) => s + r.totalRevenue, 0)
  const totalWon     = filteredReps.reduce((s, r) => s + r.wonLeads, 0)

  const cTeam   = useCountUp(teamRevenue,  900, 100)
  const cTop3   = useCountUp(top3Revenue,  900, 200)
  const cWon    = useCountUp(totalWon,     700, 300)

  function toggleRow(name: string) {
    setExpandedRow(prev => prev === name ? null : name)
  }

  return (
    <div>
      {/* ── Header + filters ──────────────────────────────────────── */}
      <div className="animate-slide-up delay-1" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>
            Ranking
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 4 }}>
            Desempenho individual e comparativo do seu time comercial.
          </div>
        </div>

        {/* Metric + Period pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 100, padding: '3px 4px', boxShadow: 'var(--shadow)' }}>
            {([
              { key: 'revenue',    label: 'Receita' },
              { key: 'won',        label: 'Ganhos' },
              { key: 'conversion', label: 'Conversão' },
            ] as { key: Metric; label: string }[]).map(tab => (
              <button key={tab.key} onClick={() => { setMetric(tab.key); setExpandedRow(null) }}
                style={{
                  padding: '5px 14px', borderRadius: 100, border: 'none',
                  fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  transition: 'all .18s ease',
                  background: metric === tab.key ? 'var(--primary)' : 'transparent',
                  color: metric === tab.key ? 'var(--primary-contrast)' : 'var(--gray)',
                  boxShadow: metric === tab.key ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
                }}
              >{tab.label}</button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 100, padding: '3px 4px', boxShadow: 'var(--shadow)' }}>
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
              <button key={p} onClick={() => { setPeriod(p); setExpandedRow(null) }}
                style={{
                  padding: '5px 14px', borderRadius: 100, border: 'none',
                  fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  transition: 'all .18s ease',
                  background: period === p ? 'var(--primary)' : 'transparent',
                  color: period === p ? 'var(--primary-contrast)' : 'var(--gray)',
                  boxShadow: period === p ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
                }}
              >{PERIOD_LABELS[p]}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Team stat cards ───────────────────────────────────────── */}
      {!isLoading && reps.length > 0 && (
        <div className="animate-slide-up delay-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
          {[
            { label: 'Total do time',  value: formatCurrency(cTeam),        accent: 'var(--primary)', sub: 'receita acumulada' },
            { label: 'Top 3',          value: formatCurrency(cTop3),        accent: 'var(--primary)', sub: 'soma dos 3 primeiros' },
            { label: 'Leads ganhos',   value: String(cWon),                 accent: 'var(--green)',   sub: 'fechamentos no período', dot: true },
            { label: 'Vendedores',     value: String(filteredReps.length),  accent: 'var(--gray2)',   sub: 'ativos no ranking' },
          ].map(card => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>
      )}

      {/* ── Team filter row ──────────────────────────────────────── */}
      <div className="animate-slide-up delay-1" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0 }}>Time</span>

        {/* "Todos" pill */}
        <button
          onClick={() => { setSelectedTeam(null); setExpandedRow(null) }}
          style={{ padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .15s', border: `1px solid ${selectedTeam === null ? 'var(--primary)' : 'var(--gray3)'}`, background: selectedTeam === null ? 'var(--primary-dim)' : 'var(--white)', color: selectedTeam === null ? 'var(--primary-text)' : 'var(--gray)' }}
        >
          Todos
        </button>

        {/* One pill per team */}
        {teams.map(t => (
          <button
            key={t.id}
            onClick={() => { setSelectedTeam(t.id === selectedTeam ? null : t.id); setExpandedRow(null) }}
            style={{ padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .15s', border: `1px solid ${selectedTeam === t.id ? t.color : 'var(--gray3)'}`, background: selectedTeam === t.id ? `${t.color}18` : 'var(--white)', color: selectedTeam === t.id ? t.color : 'var(--gray)', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.color, display: 'inline-block', flexShrink: 0 }} />
            {t.name}
            <span style={{ fontSize: 10, opacity: 0.7 }}>({t.members.length})</span>
          </button>
        ))}

        {/* Manage button */}
        <button
          onClick={() => setTeamsModal(true)}
          style={{ marginLeft: 'auto', padding: '5px 14px', borderRadius: 99, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--gray3)', background: 'var(--white)', color: 'var(--gray)', display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--black)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--white)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--gray)' }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="5" r="2.2"/><path d="M1 14c0-2.8 2.2-5 5-5h.5"/><circle cx="11" cy="5" r="2.2"/><path d="M15 14c0-2.8-2.2-5-5-5h-.5"/></svg>
          Gerenciar times
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      {isLoading ? (
        <Skeleton />
      ) : reps.length === 0 ? (
        <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', padding: 64, textAlign: 'center', color: 'var(--gray2)', fontSize: 14 }}>
          Nenhum lead com responsável encontrado no período.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

          {/* ── Podium panel ───────────────────────────────── */}
          <div className="animate-slide-up delay-1" style={{
            flex: '0 0 460px',
            background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)',
            padding: '28px 24px 24px',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            position: 'relative', overflow: 'hidden',
          }}>
            {/* Subtle radial glow background */}
            <div style={{
              position: 'absolute', top: '30%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 200, height: 200, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,180,0,0.07) 0%, transparent 70%)',
              pointerEvents: 'none',
            }} />

            {/* Floating sparkle dots */}
            {SPARKLES.map((s, i) => (
              <div key={i} style={{
                position: 'absolute',
                top: s.top, left: (s as any).left, right: (s as any).right,
                width: s.size, height: s.size, borderRadius: '50%',
                background: (s as any).color,
                boxShadow: `0 0 ${s.size * 2}px ${(s as any).color}99`,
                animation: `floatBubble ${s.dur} ease-in-out ${s.delay} infinite`,
                pointerEvents: 'none',
                opacity: 0.75,
              }} />
            ))}

            <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--gray2)', marginBottom: 24, position: 'relative' }}>
              ✦ Pódio
            </div>

            {/* Cards */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 20, width: '100%', position: 'relative' }}>
              {podiumOrder.map((rep, i) => (
                <PodiumCard key={rep.name} rep={rep} rank={podiumRanks[i]} metric={metric} delay={i * 100} />
              ))}
            </div>

            {/* Decorative floor line */}
            <div style={{
              width: '85%', height: 2, borderRadius: 99, marginTop: 20,
              background: 'linear-gradient(90deg, transparent, var(--gray3) 20%, var(--primary-mid) 50%, var(--gray3) 80%, transparent)',
            }} />

            {/* Hint */}
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray2)', marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>▸</span> clique nas linhas para detalhes
            </div>
          </div>

          {/* ── Leaderboard panel ──────────────────────────── */}
          <div className="animate-slide-up delay-2" style={{
            flex: 1, minWidth: 0,
            background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 20px', borderBottom: '1px solid var(--gray3)',
              background: 'var(--bg)',
            }}>
              <div style={{ width: 28 }} />
              <div style={{ flex: 1, fontSize: 9, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Vendedor</div>
              <div style={{ width: 88, fontSize: 9, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right' }}>
                {metric === 'revenue' ? 'Receita' : metric === 'won' ? 'Ganhos' : 'Conversão'}
              </div>
              <div style={{ width: 20 }} />
            </div>

            {sorted.map((rep, i) => (
              <LeaderRow
                key={rep.name}
                rep={rep}
                rank={i + 1}
                metric={metric}
                maxVal={maxVal}
                delay={i * 50 + 200}
                isLast={i === sorted.length - 1}
                expanded={expandedRow === rep.name}
                onToggle={() => toggleRow(rep.name)}
              />
            ))}
          </div>
        </div>
      )}

      {teamsModal && (
        <TeamsModal allReps={reps.map(r => r.name)} onClose={() => setTeamsModal(false)} />
      )}
    </div>
  )
}
