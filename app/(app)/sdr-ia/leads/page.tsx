'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, Send, UserPlus, AlertTriangle, Check } from 'lucide-react'
import { SkeletonTable } from '@/components/Skeleton'
import { Button } from '@/components/ui/Button'
import { useCountUp } from '@/components/widgets/KpiCard'
import { useCanDispatch } from '@/lib/hooks/useCanDispatch'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadItem {
  id:      string
  name:    string | null
  phone:   string | null
  company: string | null
  source:  string | null
  status:  string | null
}

interface ApiResponse {
  items: LeadItem[]
  page:  number
  limit: number
  total: number
}

interface ImportResult {
  ok:               boolean
  totalLinhas?:     number
  importados?:      number
  ignorados?:       { total: number; amostra: Array<{ linha: number; motivo: string }> }
  duplicados?:      { total: number; amostra: Array<{ linha: number; telefone: string }> }
  suspeitos?:       { total: number; amostra: Array<{ linha: number; telefone: string }> }
  n8nStatus?:       number
  leadIds?:         string[]
  existingLeadIds?: string[]
  names?:           Record<string, string>
  semNome?:         number
  error?:           string
}

interface BlastResult {
  ok:               boolean
  started?:         number
  totalSolicitado?: number
  skipped?:         number
  error?:           string
}

interface EnrollResult {
  ok:           boolean
  enrolled?:    number
  partialError?: string
  error?:       string
}

type Step   = 1 | 2 | 3
type Source = 'base' | 'import'
type Action = 'blast' | 'enroll' | null

// ─── Constants ────────────────────────────────────────────────────────────────

const LIMIT       = 50
const ENROLL_BATCH = 100

// ─── Helpers ──────────────────────────────────────────────────────────────────

function friendlyImportError(code: string): string {
  if (code === 'import_url_nao_configurada')
    return 'URL de importação não configurada — acesse Configurações > Credenciais.'
  if (code === 'fonte_sdr_nao_configurada')
    return 'Fonte de dados SDR não configurada — acesse Configurações > Integrações.'
  return code
}

function friendlyBlastError(code: string): string {
  if (code === 'blast_url_nao_configurada')
    return 'URL de disparo de lista não configurada — acesse Configurações > Credenciais.'
  if (code === 'remetente_nao_configurado')
    return 'Remetente não configurado na campanha — defina em Parâmetros.'
  if (code === 'fonte_sdr_nao_configurada')
    return 'Fonte de dados SDR não configurada — acesse Configurações > Integrações.'
  return code
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <span style={{ color: 'var(--gray3)', fontSize: 11 }}>—</span>
  const colors: Record<string, { bg: string; color: string }> = {
    ativo:       { bg: 'rgba(34,197,94,0.10)',  color: '#15803d' },
    inativo:     { bg: 'rgba(239,68,68,0.08)',  color: 'var(--red)' },
    qualificado: { bg: 'rgba(37,99,235,0.10)',  color: '#1d4ed8' },
  }
  const s = colors[value.toLowerCase()] ?? { bg: 'rgba(0,0,0,0.05)', color: 'var(--gray)' }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: s.bg, color: s.color, border: `1px solid ${s.color}30`,
    }}>
      {value}
    </span>
  )
}

function ProportionBar({ started, total, skipped }: { started: number; total: number; skipped: number }) {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const target = total > 0 ? Math.min(100, Math.round((started / total) * 100)) : 0
    const raf = requestAnimationFrame(() => setPct(target))
    return () => cancelAnimationFrame(raf)
  }, [started, total])
  return (
    <div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--primary-dim)', overflow: 'hidden', marginBottom: 6 }}>
        <div style={{ height: '100%', borderRadius: 3, background: 'var(--primary)', width: `${pct}%`, transition: 'width .5s ease-out' }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--gray)', fontWeight: 500 }}>
        {started} enviado{started !== 1 ? 's' : ''}
        {skipped > 0 && <> · {skipped} ignorado{skipped !== 1 ? 's' : ''} (telefone inválido)</>}
      </div>
    </div>
  )
}

function Stepper({ step }: { step: Step }) {
  const labels = ['Destinatários', 'Mensagem & ação', 'Revisar & disparar']
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 28 }}>
      {labels.map((label, i) => {
        const num = i + 1
        const done   = step > num
        const active = step === num
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'flex-start', flex: i < labels.length - 1 ? 1 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 72 }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800,
                background: done || active ? 'var(--primary)' : 'var(--gray3)',
                color: done || active ? '#fff' : 'var(--gray2)',
                marginBottom: 5, flexShrink: 0,
              }}>
                {done ? <Check size={13} /> : num}
              </div>
              <div style={{
                fontSize: 10, fontWeight: 700, textAlign: 'center', lineHeight: 1.3,
                color: active ? 'var(--black)' : done ? 'var(--gray)' : 'var(--gray2)',
                maxWidth: 68,
              }}>
                {label}
              </div>
            </div>
            {i < labels.length - 1 && (
              <div style={{
                flex: 1, height: 1, marginTop: 13,
                background: done ? 'var(--primary)' : 'var(--gray3)',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Import feedback panel ────────────────────────────────────────────────────

function ImportFeedback({
  result, n8nFalhou, importadosCount, ignoradosCount, duplicadosCount, onRefresh,
}: {
  result: ImportResult
  n8nFalhou: boolean
  importadosCount: number
  ignoradosCount:  number
  duplicadosCount: number
  onRefresh: () => void
}) {
  if (!result.ok) {
    return (
      <div style={{
        marginTop: 12, padding: '12px 16px', borderRadius: 12,
        background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>
          ✗ {friendlyImportError(result.error ?? 'Erro desconhecido')}
        </div>
      </div>
    )
  }
  return (
    <div style={{
      marginTop: 12, padding: '14px 18px', borderRadius: 12,
      background: n8nFalhou ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.06)',
      border: `1px solid ${n8nFalhou ? 'rgba(245,158,11,0.35)' : 'rgba(34,197,94,0.25)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, fontWeight: 700, marginBottom: 8, color: n8nFalhou ? '#b45309' : 'var(--green)' }}>
        {n8nFalhou
          ? <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          : <Check size={14} style={{ flexShrink: 0, marginTop: 1 }} />}
        <span>
          {n8nFalhou
            ? <><span className="animate-count-pop tabular-nums">{importadosCount}</span> lead{result.importados !== 1 ? 's' : ''} enviados, mas a importação retornou um erro (HTTP {result.n8nStatus}) — tente novamente ou verifique a configuração.</>
            : <><span className="animate-count-pop tabular-nums">{importadosCount}</span> lead{result.importados !== 1 ? 's' : ''} enviados para importação</>
          }
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500, marginBottom: 6 }}>
        <span className="animate-count-pop tabular-nums">{importadosCount}</span> importados
        {' · '}<span className="animate-count-pop tabular-nums">{ignoradosCount}</span> ignorados
        {' · '}<span className="animate-count-pop tabular-nums">{duplicadosCount}</span> duplicados
        {' — '}{result.totalLinhas} linha{result.totalLinhas !== 1 ? 's' : ''} no arquivo
      </div>

      {(result.ignorados?.total ?? 0) > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12, color: 'var(--gray2)', cursor: 'pointer', fontWeight: 600, userSelect: 'none' as const }}>
            Ignorados ({result.ignorados!.total})
          </summary>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {result.ignorados!.amostra.map((it, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--gray)', fontFamily: 'monospace' }}>
                Linha {it.linha}: {it.motivo}
              </div>
            ))}
            {result.ignorados!.total > result.ignorados!.amostra.length && (
              <div style={{ fontSize: 11, color: 'var(--gray2)', fontStyle: 'italic' }}>
                … e mais {result.ignorados!.total - result.ignorados!.amostra.length}
              </div>
            )}
          </div>
        </details>
      )}

      {(result.duplicados?.total ?? 0) > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 12, color: 'var(--gray2)', cursor: 'pointer', fontWeight: 600, userSelect: 'none' as const }}>
            Duplicados ({result.duplicados!.total})
          </summary>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {result.duplicados!.amostra.map((it, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--gray)', fontFamily: 'monospace' }}>
                Linha {it.linha}: {it.telefone}
              </div>
            ))}
            {result.duplicados!.total > result.duplicados!.amostra.length && (
              <div style={{ fontSize: 11, color: 'var(--gray2)', fontStyle: 'italic' }}>
                … e mais {result.duplicados!.total - result.duplicados!.amostra.length}
              </div>
            )}
          </div>
        </details>
      )}

      {(result.suspeitos?.total ?? 0) > 0 && (
        <div style={{
          marginTop: 10, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.35)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{result.suspeitos!.total} número{result.suspeitos!.total !== 1 ? 's' : ''} podem estar sem o 9 — confira na planilha.</span>
          </div>
          <details>
            <summary style={{ fontSize: 12, color: '#92400e', cursor: 'pointer', fontWeight: 600, userSelect: 'none' as const }}>
              Suspeitos ({result.suspeitos!.total})
            </summary>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {result.suspeitos!.amostra.map((it, i) => (
                <div key={i} style={{ fontSize: 11, color: '#78350f', fontFamily: 'monospace' }}>
                  Linha {it.linha}: {it.telefone}
                </div>
              ))}
              {result.suspeitos!.total > result.suspeitos!.amostra.length && (
                <div style={{ fontSize: 11, color: '#92400e', fontStyle: 'italic' }}>
                  … e mais {result.suspeitos!.total - result.suspeitos!.amostra.length}
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--gray2)', marginTop: 10, lineHeight: 1.5 }}>
        Processado de forma assíncrona — os leads podem levar alguns instantes para aparecer.{' '}
        <button
          onClick={onRefresh}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 700, color: 'var(--primary-text)', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Atualizar lista
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NovDisparoPage() {

  // ── Wizard state ─────────────────────────────────────────────────────────────
  const [step,   setStep]   = useState<Step>(1)
  const [source, setSource] = useState<Source>('base')
  const [action, setAction] = useState<Action>(null)

  // ── Step 1: base selection ────────────────────────────────────────────────────
  const [leadsData,    setLeadsData]    = useState<ApiResponse | null>(null)
  const [leadsLoading, setLeadsLoading] = useState(true)
  const [leadsError,   setLeadsError]   = useState<string | null>(null)
  const [page,         setPage]         = useState(1)
  const [q,            setQ]            = useState('')
  const [debQ,         setDebQ]         = useState('')
  const [fetchSeq,     setFetchSeq]     = useState(0)
  const [selected,     setSelected]     = useState<Set<string>>(new Set())
  const masterRef = useRef<HTMLInputElement>(null)

  // ── Step 1: import ────────────────────────────────────────────────────────────
  const [importing,    setImporting]    = useState(false)
  const [showBar,      setShowBar]      = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Step 2: template ──────────────────────────────────────────────────────────
  const [blastTemplates,  setBlastTemplates]  = useState<{ nome_template: string; preview: string; fase_envio: string | null }[] | null>(null)
  const [blastTplLoading, setBlastTplLoading] = useState(false)
  const [blastTplError,   setBlastTplError]   = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [templateOpen,    setTemplateOpen]    = useState(false)
  const [templateSearch,  setTemplateSearch]  = useState('')
  const templateDropdownRef = useRef<HTMLDivElement>(null)

  // ── Step 3: send results ──────────────────────────────────────────────────────
  const [sending,      setSending]      = useState(false)
  const [blastResult,  setBlastResult]  = useState<BlastResult | null>(null)
  const [enrollResult, setEnrollResult] = useState<EnrollResult | null>(null)

  const { canDispatch } = useCanDispatch()

  // ── Derived recipient set ─────────────────────────────────────────────────────
  const importedIds = new Set([
    ...(importResult?.leadIds ?? []),
    ...(importResult?.existingLeadIds ?? []),
  ])
  const recipientIds    = source === 'base' ? selected : importedIds
  const recipientCount  = recipientIds.size
  const names           = source === 'import' ? (importResult?.names ?? {}) : {}
  const semNome         = source === 'import' ? (importResult?.semNome ?? 0) : 0

  const n8nFalhou = (importResult?.importados ?? 0) > 0
    && typeof importResult?.n8nStatus === 'number'
    && (importResult.n8nStatus < 200 || importResult.n8nStatus >= 300)

  const importadosCount = useCountUp(importResult?.importados ?? 0, 800)
  const ignoradosCount  = useCountUp(importResult?.ignorados?.total ?? 0, 600)
  const duplicadosCount = useCountUp(importResult?.duplicados?.total ?? 0, 600)

  const total      = leadsData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))
  const hasPrev    = page > 1
  const hasNext    = page < totalPages

  const pageIds    = leadsData?.items.map(i => i.id) ?? []
  const selCount   = pageIds.filter(id => selected.has(id)).length
  const allOnPage  = pageIds.length > 0 && selCount === pageIds.length
  const someOnPage = selCount > 0 && selCount < pageIds.length

  // step 2 can proceed when action chosen + template chosen (if blast)
  const step2CanContinue = action !== null && (action !== 'blast' || !!selectedTemplate)

  // ── Effects ───────────────────────────────────────────────────────────────────

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebQ(q), 350)
    return () => clearTimeout(t)
  }, [q])

  // Reset page on search change
  useEffect(() => { setPage(1) }, [debQ])

  // Fetch leads (base mode only)
  useEffect(() => {
    if (step !== 1 || source !== 'base') return
    let cancelled = false
    setLeadsLoading(true)
    setLeadsError(null)
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
    if (debQ) params.set('q', debQ)
    fetch(`/api/sdr/leads?${params}`)
      .then(r => r.ok ? r.json() : r.json().then((d: { error?: string }) => Promise.reject(d.error ?? r.status)))
      .then((d: ApiResponse) => { if (!cancelled) { setLeadsData(d); setLeadsLoading(false) } })
      .catch((e: unknown) => { if (!cancelled) { setLeadsError(String(e)); setLeadsLoading(false) } })
    return () => { cancelled = true }
  }, [page, debQ, fetchSeq, step, source])

  // Master checkbox indeterminate
  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someOnPage
  }, [someOnPage])

  // Template dropdown: click-outside + Escape
  useEffect(() => {
    if (!templateOpen) return
    function handleDown(e: MouseEvent) {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node))
        setTemplateOpen(false)
    }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setTemplateOpen(false) }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [templateOpen])

  // Import progress bar fade
  useEffect(() => {
    if (importing) { setShowBar(true); return }
    const t = setTimeout(() => setShowBar(false), 400)
    return () => clearTimeout(t)
  }, [importing])

  // ── Event handlers ────────────────────────────────────────────────────────────

  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allOnPage) { pageIds.forEach(id => next.delete(id)) }
      else            { pageIds.forEach(id => next.add(id)) }
      return next
    })
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/sdr/leads/import', { method: 'POST', body: fd })
      const json = await res.json() as ImportResult & { error?: string }
      if (!res.ok) {
        setImportResult({ ok: false, error: json.error ?? `HTTP ${res.status}` })
      } else {
        setImportResult(json)
        setFetchSeq(s => s + 1)
      }
    } catch (e) {
      setImportResult({ ok: false, error: (e as Error).message })
    } finally {
      setImporting(false)
    }
  }

  async function loadTemplates() {
    if (blastTemplates) return
    setBlastTplLoading(true)
    setBlastTplError(null)
    try {
      const res = await fetch('/api/sdr/templates')
      const data = await res.json() as { items?: { nome_template: string; preview: string; fase_envio: string | null }[]; error?: string }
      if (!res.ok) { setBlastTplError(data.error ?? `HTTP ${res.status}`); return }
      setBlastTemplates(data.items ?? [])
    } catch (e) {
      setBlastTplError((e as Error).message)
    } finally {
      setBlastTplLoading(false)
    }
  }

  function selectAction(a: 'blast' | 'enroll') {
    setAction(a)
    if (a === 'blast') {
      setSelectedTemplate('')
      loadTemplates()
    }
  }

  async function runSend() {
    if (action === 'blast') {
      const ids = Array.from(recipientIds)
      if (ids.length === 0 || !selectedTemplate) return
      const tpl          = blastTemplates?.find(t => t.nome_template === selectedTemplate)
      const templateBody = tpl?.preview ?? ''
      setSending(true)
      setBlastResult(null)
      try {
        const res = await fetch('/api/sdr/leads/blast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadIds: ids, template: selectedTemplate, names, templateBody }),
        })
        const data = await res.json() as BlastResult
        if (res.ok && data.ok) {
          setBlastResult({ ok: true, started: data.started, totalSolicitado: data.totalSolicitado, skipped: data.skipped })
        } else {
          setBlastResult({ ok: false, error: data.error ?? `HTTP ${res.status}` })
        }
      } catch (e) {
        setBlastResult({ ok: false, error: (e as Error).message })
      } finally {
        setSending(false)
      }
    } else if (action === 'enroll') {
      const ids = Array.from(recipientIds)
      setSending(true)
      setEnrollResult(null)
      let totalEnrolled = 0
      let lastError: string | null = null
      for (let i = 0; i < ids.length; i += ENROLL_BATCH) {
        const batch = ids.slice(i, i + ENROLL_BATCH)
        try {
          const res = await fetch('/api/sdr/enroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadIds: batch }),
          })
          const body = await res.json() as { ok: boolean; enrolled?: number; error?: string }
          if (res.ok && body.ok) {
            totalEnrolled += body.enrolled ?? batch.length
          } else {
            lastError = body.error ?? `HTTP ${res.status}`
          }
        } catch (e) {
          lastError = (e as Error).message
        }
      }
      if (lastError && totalEnrolled === 0) {
        setEnrollResult({ ok: false, error: lastError })
      } else {
        setEnrollResult({ ok: true, enrolled: totalEnrolled, partialError: lastError ?? undefined })
      }
      setSending(false)
    }
  }

  function resetWizard() {
    setStep(1)
    setSource('base')
    setAction(null)
    setSelected(new Set())
    setImportResult(null)
    setSelectedTemplate('')
    setBlastTemplates(null)
    setBlastResult(null)
    setEnrollResult(null)
    setQ('')
    setPage(1)
    setFetchSeq(s => s + 1)
  }

  const hasSentResult = blastResult !== null || enrollResult !== null

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Stepper */}
      <Stepper step={step} />

      {/* ── STEP 1 — Destinatários ─────────────────────────────────────────── */}
      {step === 1 && (
        <div className="animate-slide-up delay-1">

          {/* Source toggle */}
          <div style={{ display: 'inline-flex', borderRadius: 10, border: '1px solid var(--gray3)', overflow: 'hidden', marginBottom: 20, background: 'var(--bg)' }}>
            {(['base', 'import'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSource(s)}
                style={{
                  padding: '8px 18px', fontSize: 12, fontWeight: 700,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: source === s ? 'var(--white)' : 'transparent',
                  color: source === s ? 'var(--black)' : 'var(--gray2)',
                  boxShadow: source === s ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all .15s',
                }}
              >
                {s === 'base' ? 'Selecionar da base' : 'Importar planilha'}
              </button>
            ))}
          </div>

          {/* ── BASE mode ────────────────────────────────────────────────────── */}
          {source === 'base' && (
            <>
              {/* Search */}
              <div style={{ position: 'relative', marginBottom: 14, maxWidth: 320 }}>
                <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray2)', pointerEvents: 'none' }} />
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Nome, telefone ou empresa..."
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    paddingLeft: 34, paddingRight: 14, paddingTop: 9, paddingBottom: 9,
                    fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
                    border: '1px solid var(--gray3)', borderRadius: 99,
                    background: 'var(--white)', color: 'var(--black)',
                    outline: 'none', transition: 'border-color .15s',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                  onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
                />
              </div>

              {/* Status line */}
              {!leadsLoading && !leadsError && leadsData && (
                <div style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500, marginBottom: 12 }}>
                  {total.toLocaleString('pt-BR')} lead{total !== 1 ? 's' : ''}
                  {debQ && ` para "${debQ}"`}
                  {totalPages > 1 && ` — página ${page} de ${totalPages}`}
                </div>
              )}

              {leadsLoading && <SkeletonTable rows={8} colWidths={['28%', '18%', '18%', '14%', '10%']} />}

              {!leadsLoading && leadsError && (
                <div style={{ padding: '48px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)', marginBottom: 8 }}>Falha ao carregar leads</div>
                  <div style={{ fontSize: 13, color: 'var(--gray2)' }}>
                    {leadsError === 'fonte_sdr_nao_configurada'
                      ? 'Configure a fonte de dados do SDR primeiro.'
                      : leadsError}
                  </div>
                </div>
              )}

              {!leadsLoading && !leadsError && (
                <div style={{ background: 'var(--white)', borderRadius: 16, border: '1px solid var(--gray3)', overflow: 'hidden', marginBottom: 16 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg)' }}>
                        <th style={{ padding: '9px 16px', borderBottom: '1px solid var(--gray3)', width: 40 }}>
                          <input
                            ref={masterRef}
                            type="checkbox"
                            checked={allOnPage}
                            onChange={toggleAll}
                            disabled={pageIds.length === 0}
                            aria-label="Selecionar todos"
                            style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
                          />
                        </th>
                        {(['Nome', 'Telefone', 'Empresa', 'Origem', 'Status'] as const).map(col => (
                          <th key={col} style={{
                            padding: '9px 16px', textAlign: 'left',
                            fontSize: 10, fontWeight: 800, color: 'var(--gray2)',
                            textTransform: 'uppercase', letterSpacing: '0.07em',
                            borderBottom: '1px solid var(--gray3)', whiteSpace: 'nowrap',
                          }}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(leadsData?.items ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
                            {debQ ? `Nenhum lead encontrado para "${debQ}"` : 'Nenhum lead encontrado'}
                          </td>
                        </tr>
                      ) : (leadsData?.items ?? []).map((lead, i) => {
                        const checked = selected.has(lead.id)
                        const isLast  = i === (leadsData?.items.length ?? 0) - 1
                        return (
                          <tr
                            key={lead.id}
                            className="row-cascade"
                            onClick={() => toggleOne(lead.id)}
                            aria-selected={checked}
                            style={{
                              '--row-delay': `${Math.min(i, 9) * 40}ms`,
                              borderBottom: isLast ? 'none' : '1px solid var(--gray3)',
                              background: checked ? 'var(--primary-dim)' : 'transparent',
                              borderLeft: `3px solid ${checked ? 'var(--primary)' : 'transparent'}`,
                              cursor: 'pointer', transition: 'background .12s, border-color .12s',
                            } as React.CSSProperties}
                          >
                            <td style={{ padding: '11px 16px' }} onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleOne(lead.id)}
                                aria-label={`Selecionar ${lead.name || lead.phone}`}
                                style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
                              />
                            </td>
                            <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{lead.name || '—'}</td>
                            <td style={{ padding: '11px 16px' }}>
                              <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--gray)' }}>{lead.phone || '—'}</span>
                            </td>
                            <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--gray)', fontWeight: 500 }}>{lead.company || '—'}</td>
                            <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>{lead.source || '—'}</td>
                            <td style={{ padding: '11px 16px' }}><StatusBadge value={lead.status} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {!leadsLoading && !leadsError && totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 16 }}>
                  <button
                    onClick={() => setPage(p => p - 1)}
                    disabled={!hasPrev}
                    style={{ padding: '8px 18px', borderRadius: 99, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: hasPrev ? 'pointer' : 'not-allowed', border: '1px solid var(--gray3)', background: 'var(--white)', color: hasPrev ? 'var(--black)' : 'var(--gray3)' }}
                  >← Anterior</button>
                  <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => p + 1)}
                    disabled={!hasNext}
                    style={{ padding: '8px 18px', borderRadius: 99, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: hasNext ? 'pointer' : 'not-allowed', border: '1px solid var(--gray3)', background: 'var(--white)', color: hasNext ? 'var(--black)' : 'var(--gray3)' }}
                  >Próxima →</button>
                </div>
              )}
            </>
          )}

          {/* ── IMPORT mode ──────────────────────────────────────────────────── */}
          {source === 'import' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <a
                  href="/api/sdr/leads/template"
                  download="modelo-leads.xlsx"
                  className="btn btn-secondary btn-sm"
                >
                  Baixar modelo
                </a>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                >
                  {importing ? 'Importando...' : 'Importar Excel'}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
              </div>

              {/* Progress bar */}
              {showBar && (
                <div
                  className="shimmer-bar"
                  style={{ height: 3, borderRadius: 2, background: 'var(--primary)', marginBottom: 12, opacity: importing ? 1 : 0, transition: 'opacity 0.4s ease' }}
                />
              )}

              {/* Import feedback */}
              {importResult && (
                <ImportFeedback
                  result={importResult}
                  n8nFalhou={n8nFalhou}
                  importadosCount={importadosCount}
                  ignoradosCount={ignoradosCount}
                  duplicadosCount={duplicadosCount}
                  onRefresh={() => setFetchSeq(s => s + 1)}
                />
              )}

              {!importResult && !importing && (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--gray2)', fontSize: 13 }}>
                  Faça upload de uma planilha Excel para selecionar destinatários.
                </div>
              )}
            </>
          )}

          {/* ── Footer ─────────────────────────────────────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--gray3)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: recipientCount > 0 ? 'var(--black)' : 'var(--gray2)' }}>
              {recipientCount > 0
                ? `${recipientCount} destinatário${recipientCount !== 1 ? 's' : ''} selecionado${recipientCount !== 1 ? 's' : ''}`
                : 'Nenhum destinatário selecionado'}
            </div>
            <Button
              variant="primary"
              disabled={recipientCount === 0}
              onClick={() => setStep(2)}
            >
              Continuar →
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 2 — Mensagem & ação ──────────────────────────────────────────── */}
      {step === 2 && (
        <div className="animate-slide-up delay-1">

          <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 20 }}>
            Escolha o que fazer com os <strong>{recipientCount} destinatário{recipientCount !== 1 ? 's' : ''}</strong> selecionados.
          </div>

          {!canDispatch && (
            <div style={{
              marginBottom: 16, padding: '12px 16px', borderRadius: 12,
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.20)',
              fontSize: 13, color: 'var(--red)', fontWeight: 600,
            }}>
              Você não tem permissão para realizar disparos.
            </div>
          )}

          {/* Action cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>

            {/* Blast card */}
            <button
              onClick={() => canDispatch && selectAction('blast')}
              disabled={!canDispatch}
              style={{
                textAlign: 'left', padding: '18px 20px', borderRadius: 14,
                border: `2px solid ${action === 'blast' ? 'var(--primary)' : 'var(--gray3)'}`,
                background: action === 'blast' ? 'var(--primary-dim)' : 'var(--white)',
                cursor: canDispatch ? 'pointer' : 'not-allowed',
                opacity: canDispatch ? 1 : 0.5,
                fontFamily: 'inherit',
                transition: 'border-color .15s, background .15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: 'var(--black)', marginBottom: 4 }}>
                <Send size={16} style={{ flexShrink: 0 }} />
                Disparar template agora
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.55 }}>
                Envia um template aprovado via WhatsApp para toda a lista de uma só vez.
              </div>
            </button>

            {/* Enroll card */}
            <button
              onClick={() => canDispatch && selectAction('enroll')}
              disabled={!canDispatch}
              style={{
                textAlign: 'left', padding: '18px 20px', borderRadius: 14,
                border: `2px solid ${action === 'enroll' ? 'var(--primary)' : 'var(--gray3)'}`,
                background: action === 'enroll' ? 'var(--primary-dim)' : 'var(--white)',
                cursor: canDispatch ? 'pointer' : 'not-allowed',
                opacity: canDispatch ? 1 : 0.5,
                fontFamily: 'inherit',
                transition: 'border-color .15s, background .15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: 'var(--black)', marginBottom: 4 }}>
                <UserPlus size={16} style={{ flexShrink: 0 }} />
                Adicionar à campanha
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.55 }}>
                Inicia a sequência automática de mensagens SDR — os leads recebem os toques programados.
              </div>
            </button>
          </div>

          {/* Template selector (blast only) */}
          {action === 'blast' && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>
                Template
              </div>

              {blastTplLoading && (
                <div style={{ fontSize: 13, color: 'var(--gray2)', padding: '10px 0' }}>Carregando templates...</div>
              )}
              {blastTplError && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
                  {friendlyBlastError(blastTplError)}
                </div>
              )}

              {blastTemplates && (
                <div ref={templateDropdownRef} style={{ position: 'relative', maxWidth: 420 }}>
                  <button
                    onClick={() => setTemplateOpen(o => !o)}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 10, fontFamily: 'inherit',
                      fontSize: 13, border: '1px solid var(--gray3)', background: 'var(--white)',
                      color: selectedTemplate ? 'var(--black)' : 'var(--gray2)',
                      cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedTemplate || 'Escolha um template…'}
                    </span>
                    <span style={{ flexShrink: 0, marginLeft: 8, fontSize: 11, opacity: 0.6 }}>▾</span>
                  </button>

                  {templateOpen && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 2000,
                      background: 'var(--white)', border: '1px solid var(--gray3)',
                      borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
                      maxHeight: 260, overflowY: 'auto',
                    }}>
                      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--gray3)', position: 'sticky', top: 0, background: 'var(--white)' }}>
                        <input
                          autoFocus
                          value={templateSearch}
                          onChange={e => setTemplateSearch(e.target.value)}
                          placeholder="Buscar template…"
                          style={{
                            width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 12,
                            padding: '6px 10px', border: '1px solid var(--gray3)',
                            borderRadius: 8, background: 'var(--bg)', color: 'var(--black)', outline: 'none',
                          }}
                        />
                      </div>
                      {(() => {
                        const filtered = blastTemplates.filter(t =>
                          t.nome_template.toLowerCase().includes(templateSearch.toLowerCase())
                        )
                        if (filtered.length === 0) {
                          return <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--gray2)' }}>Nenhum template encontrado</div>
                        }
                        return filtered.map(t => (
                          <button
                            key={t.nome_template}
                            onClick={() => { setSelectedTemplate(t.nome_template); setTemplateOpen(false); setTemplateSearch('') }}
                            style={{
                              width: '100%', textAlign: 'left', padding: '10px 14px',
                              background: t.nome_template === selectedTemplate ? 'rgba(0,0,0,0.04)' : 'transparent',
                              border: 'none', borderBottom: '1px solid var(--gray3)', cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            <div style={{ fontSize: 13, color: 'var(--black)', fontWeight: t.nome_template === selectedTemplate ? 700 : 400 }}>
                              {t.nome_template}
                            </div>
                            {t.preview && (
                              <div style={{ fontSize: 11, color: 'var(--gray2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {t.preview.length > 60 ? t.preview.slice(0, 60) + '…' : t.preview}
                              </div>
                            )}
                          </button>
                        ))
                      })()}
                    </div>
                  )}

                  {/* Inline preview */}
                  {(() => {
                    const tpl = blastTemplates.find(t => t.nome_template === selectedTemplate)
                    return tpl?.preview ? (
                      <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 10, fontSize: 12.5, color: 'var(--gray)', background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', lineHeight: 1.55 }}>
                        {tpl.preview}
                      </div>
                    ) : null
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, borderTop: '1px solid var(--gray3)' }}>
            <Button variant="ghost" onClick={() => { setAction(null); setStep(1) }}>← Voltar</Button>
            <Button variant="primary" disabled={!step2CanContinue} onClick={() => setStep(3)}>Continuar →</Button>
          </div>
        </div>
      )}

      {/* ── STEP 3 — Revisar & disparar ──────────────────────────────────────── */}
      {step === 3 && (
        <div className="animate-slide-up delay-1">

          {!hasSentResult ? (
            <>
              {/* Summary card */}
              <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: '20px 24px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--gray2)', marginBottom: 12 }}>
                  Resumo
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--gray)', fontWeight: 600, minWidth: 120 }}>Destinatários</span>
                    <span style={{ fontSize: 13, color: 'var(--black)', fontWeight: 700 }}>{recipientCount}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--gray)', fontWeight: 600, minWidth: 120 }}>Origem</span>
                    <span style={{ fontSize: 13, color: 'var(--black)', fontWeight: 700 }}>
                      {source === 'base' ? 'Seleção da base' : 'Planilha importada'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--gray)', fontWeight: 600, minWidth: 120 }}>Ação</span>
                    <span style={{ fontSize: 13, color: 'var(--black)', fontWeight: 700 }}>
                      {action === 'blast' ? 'Disparar template' : 'Adicionar à campanha'}
                    </span>
                  </div>
                  {action === 'blast' && selectedTemplate && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ fontSize: 13, color: 'var(--gray)', fontWeight: 600, minWidth: 120 }}>Template</span>
                      <span style={{ fontSize: 13, color: 'var(--black)', fontWeight: 700 }}>{selectedTemplate}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* sem-nome warning */}
              {semNome > 0 && (
                <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 12, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.35)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{semNome} contato{semNome !== 1 ? 's' : ''} sem nome — serão enviados com a saudação padrão <strong>&ldquo;tudo bem&rdquo;</strong>.</span>
                  </div>
                </div>
              )}

              {/* Confirm box */}
              <div style={{ marginBottom: 24, padding: '14px 18px', borderRadius: 12, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.18)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>Envio real via WhatsApp</div>
                <div style={{ fontSize: 12, color: '#b91c1c', lineHeight: 1.55 }}>
                  Esta ação é <strong>irreversível</strong>. As mensagens serão enviadas imediatamente para os {recipientCount} destinatário{recipientCount !== 1 ? 's' : ''}.
                </div>
              </div>

              {/* Send button */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Button variant="ghost" onClick={() => setStep(2)} disabled={sending}>← Voltar</Button>
                <Button
                  variant="primary"
                  className={sending ? 'btn-pulse' : undefined}
                  disabled={sending || !canDispatch}
                  onClick={runSend}
                >
                  {sending
                    ? action === 'blast'
                      ? <>Disparando <span aria-hidden="true" style={{ display: 'inline-flex', gap: 3, marginLeft: 4 }}><span className="blast-dot" /><span className="blast-dot" style={{ animationDelay: '.2s' }} /><span className="blast-dot" style={{ animationDelay: '.4s' }} /></span></>
                      : 'Adicionando...'
                    : action === 'blast'
                      ? 'Enviar agora'
                      : 'Adicionar à campanha'}
                </Button>
              </div>
            </>
          ) : (
            /* ── Result ──────────────────────────────────────────────── */
            <div>
              {/* Blast result */}
              {blastResult && (
                <div style={{
                  padding: '20px 24px', borderRadius: 16,
                  background: blastResult.ok ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                  border: `1px solid ${blastResult.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                  marginBottom: 20,
                }}>
                  {blastResult.ok ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15, fontWeight: 800, color: '#15803d', marginBottom: 14 }}>
                        <Check size={16} style={{ flexShrink: 0 }} />
                        Disparo iniciado para {blastResult.started} contato{blastResult.started !== 1 ? 's' : ''}
                      </div>
                      <ProportionBar
                        started={blastResult.started ?? 0}
                        total={blastResult.totalSolicitado ?? blastResult.started ?? 0}
                        skipped={blastResult.skipped ?? 0}
                      />
                      <div style={{ marginTop: 16 }}>
                        <Link
                          href="/sdr-ia/disparos"
                          style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary-text)', textDecoration: 'underline' }}
                        >
                          Ver no histórico →
                        </Link>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
                      ✗ {friendlyBlastError(blastResult.error ?? 'Erro desconhecido')}
                    </div>
                  )}
                </div>
              )}

              {/* Enroll result */}
              {enrollResult && (
                <div style={{
                  padding: '20px 24px', borderRadius: 16,
                  background: enrollResult.ok ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                  border: `1px solid ${enrollResult.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                  marginBottom: 20,
                }}>
                  {enrollResult.ok ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15, fontWeight: 800, color: '#15803d' }}>
                        <Check size={16} style={{ flexShrink: 0 }} />
                        {enrollResult.enrolled} lead{enrollResult.enrolled !== 1 ? 's' : ''} adicionado{enrollResult.enrolled !== 1 ? 's' : ''} à campanha
                      </div>
                      {enrollResult.partialError && (
                        <div style={{ fontSize: 11, color: '#b45309', marginTop: 8, fontWeight: 500 }}>
                          Alguns lotes falharam: {enrollResult.partialError}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
                      ✗ Erro ao adicionar: {enrollResult.error}
                    </div>
                  )}
                </div>
              )}

              {/* Reset */}
              <Button variant="secondary" onClick={resetWizard}>
                Novo disparo
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
