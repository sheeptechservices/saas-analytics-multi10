'use client'
import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { SkeletonTable } from '@/components/Skeleton'
import { Button } from '@/components/ui/Button'
import { useCountUp } from '@/components/widgets/KpiCard'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadItem {
  id:      string
  name:    string | null
  phone:   string | null
  company: string | null
  source:  string | null
  status:  string | null
  ativo:   boolean | null
}

interface ApiResponse {
  items: LeadItem[]
  page:  number
  limit: number
  total: number
}

interface ImportResult {
  ok:         boolean
  totalLinhas?: number
  importados?:  number
  ignorados?:   { total: number; amostra: Array<{ linha: number; motivo: string }> }
  duplicados?:  { total: number; amostra: Array<{ linha: number; telefone: string }> }
  suspeitos?:   { total: number; amostra: Array<{ linha: number; telefone: string }> }
  n8nStatus?:   number
  leadIds?:        string[]
  existingLeadIds?: string[]
  names?:          Record<string, string>
  semNome?:        number
  error?:          string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LIMIT = 50

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

function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <span style={{ color: 'var(--gray3)', fontSize: 11 }}>—</span>
  const colors: Record<string, { bg: string; color: string }> = {
    ativo:       { bg: 'rgba(34,197,94,0.10)',  color: '#15803d' },
    inativo:     { bg: 'rgba(239,68,68,0.08)',  color: 'var(--red)' },
    qualificado: { bg: 'rgba(37,99,235,0.10)',  color: '#1d4ed8' },
  }
  const style = colors[value.toLowerCase()] ?? { bg: 'rgba(0,0,0,0.05)', color: 'var(--gray)' }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: style.bg, color: style.color,
      border: `1px solid ${style.color}30`,
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
        <div style={{
          height: '100%', borderRadius: 3, background: 'var(--primary)',
          width: `${pct}%`, transition: 'width .5s ease-out',
        }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--gray)', fontWeight: 500 }}>
        {started} enviado{started !== 1 ? 's' : ''}
        {skipped > 0 && <> · {skipped} ignorado{skipped !== 1 ? 's' : ''} (telefone inválido)</>}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const [data,         setData]         = useState<ApiResponse | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [page,         setPage]         = useState(1)
  const [q,            setQ]            = useState('')
  const [debQ,         setDebQ]         = useState('')
  const [selected,     setSelected]     = useState<Set<string>>(new Set())
  const [enrolling,    setEnrolling]    = useState(false)
  const [enrollResult, setEnrollResult] = useState<{ ok: boolean; enrolled?: number; error?: string } | null>(null)
  const [importing,    setImporting]    = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [fetchSeq,     setFetchSeq]     = useState(0)
  const [showBar,      setShowBar]      = useState(false)

  const [showCampaignModal,    setShowCampaignModal]    = useState(false)
  const [campaignEnrolling,    setCampaignEnrolling]    = useState(false)
  const [campaignEnrollResult, setCampaignEnrollResult] = useState<{
    ok: boolean; enrolled?: number; partialError?: string; error?: string
  } | null>(null)

  // Blast (disparo direto de template à lista importada)
  const [blastMode,        setBlastMode]        = useState(false)
  const [blastTemplates,   setBlastTemplates]   = useState<{ nome_template: string; preview: string; fase_envio: string | null }[] | null>(null)
  const [blastTplLoading,  setBlastTplLoading]  = useState(false)
  const [blastTplError,    setBlastTplError]    = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [templateOpen,     setTemplateOpen]     = useState(false)
  const [templateSearch,   setTemplateSearch]   = useState('')
  const [blasting,             setBlasting]             = useState(false)
  const [blastPendingConfirm,  setBlastPendingConfirm]  = useState(false)
  const [blastResult,      setBlastResult]      = useState<{
    ok: boolean; started?: number; totalSolicitado?: number; skipped?: number; error?: string
  } | null>(null)

  const masterRef           = useRef<HTMLInputElement>(null)
  const fileInputRef        = useRef<HTMLInputElement>(null)
  const templateDropdownRef = useRef<HTMLDivElement>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebQ(q), 350)
    return () => clearTimeout(t)
  }, [q])

  // Close template dropdown on click-outside or Escape
  useEffect(() => {
    if (!templateOpen) return
    function handleDown(e: MouseEvent) {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) {
        setTemplateOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setTemplateOpen(false)
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [templateOpen])

  // Reset page on search change
  useEffect(() => { setPage(1) }, [debQ])

  // Clear enroll feedback when page/search changes
  useEffect(() => { setEnrollResult(null) }, [page, debQ])

  // Fetch leads
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
    if (debQ) params.set('q', debQ)

    fetch(`/api/sdr/leads?${params}`)
      .then(r => r.ok ? r.json() : r.json().then((d: { error?: string }) => Promise.reject(d.error ?? r.status)))
      .then((d: ApiResponse) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e: unknown) => { if (!cancelled) { setError(String(e)); setLoading(false) } })

    return () => { cancelled = true }
  }, [page, debQ, fetchSeq])

  // Keep master checkbox indeterminate state in sync
  const pageIds    = data?.items.map(i => i.id) ?? []
  const selCount   = pageIds.filter(id => selected.has(id)).length
  const allOnPage  = pageIds.length > 0 && selCount === pageIds.length
  const someOnPage = selCount > 0 && selCount < pageIds.length

  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someOnPage
  }, [someOnPage])

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

  async function enroll() {
    const leadIds = Array.from(selected)
    if (leadIds.length === 0) return
    setEnrolling(true)
    setEnrollResult(null)
    try {
      const res = await fetch('/api/sdr/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds }),
      })
      const data = await res.json() as { ok: boolean; enrolled?: number; status?: number; error?: string }
      if (res.ok && data.ok) {
        setEnrollResult({ ok: true, enrolled: data.enrolled ?? leadIds.length })
        setSelected(new Set())
      } else {
        setEnrollResult({ ok: false, error: data.error ?? `HTTP ${data.status ?? res.status}` })
      }
    } catch (e) {
      setEnrollResult({ ok: false, error: (e as Error).message })
    } finally {
      setEnrolling(false)
    }
  }

  const ENROLL_BATCH = 100

  async function enrollImported() {
    const ids = importResult?.leadIds ?? []
    if (ids.length === 0) return

    setCampaignEnrolling(true)
    setCampaignEnrollResult(null)

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
      setCampaignEnrollResult({ ok: false, error: lastError })
    } else {
      setCampaignEnrollResult({
        ok:           true,
        enrolled:     totalEnrolled,
        partialError: lastError ?? undefined,
      })
    }
    setCampaignEnrolling(false)
  }

  function closeCampaignModal() {
    setShowCampaignModal(false)
    setCampaignEnrollResult(null)
    setBlastMode(false)
    setBlastResult(null)
    setSelectedTemplate('')
    setBlastPendingConfirm(false)
  }

  async function openBlast() {
    setBlastMode(true)
    setBlastResult(null)
    setSelectedTemplate('')
    if (blastTemplates) return  // já carregado
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

  async function runBlast() {
    // Alvo do blast = novos + já existentes (deduplicado)
    const ids = Array.from(new Set([
      ...(importResult?.leadIds ?? []),
      ...(importResult?.existingLeadIds ?? []),
    ]))
    if (ids.length === 0 || !selectedTemplate) return
    const tpl = blastTemplates?.find(t => t.nome_template === selectedTemplate)
    const templateBody = tpl?.preview ?? ''
    setBlasting(true)
    setBlastResult(null)
    try {
      const res = await fetch('/api/sdr/leads/blast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: ids, template: selectedTemplate, names: importResult?.names ?? {}, templateBody }),
      })
      const data = await res.json() as { ok: boolean; started?: number; totalSolicitado?: number; skipped?: number; error?: string }
      if (res.ok && data.ok) {
        setBlastResult({ ok: true, started: data.started, totalSolicitado: data.totalSolicitado, skipped: data.skipped })
      } else {
        setBlastResult({ ok: false, error: data.error ?? `HTTP ${res.status}`, skipped: data.skipped })
      }
    } catch (e) {
      setBlastResult({ ok: false, error: (e as Error).message })
    } finally {
      setBlasting(false)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''  // reset so the same file can be re-selected
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
        setPage(1)
        setFetchSeq(s => s + 1)
        // Open modal when there are targets: novos OU já existentes (casaram na dedup)
        const targetCount = (json.leadIds?.length ?? 0) + (json.existingLeadIds?.length ?? 0)
        if (targetCount > 0) {
          setCampaignEnrolling(false)
          setCampaignEnrollResult(null)
          setBlastMode(false)
          setShowCampaignModal(true)
        }
      }
    } catch (e) {
      setImportResult({ ok: false, error: (e as Error).message })
    } finally {
      setImporting(false)
    }
  }

  const total      = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))
  const hasPrev    = page > 1
  const hasNext    = page < totalPages

  // Fade the progress bar in on import start, fade out after import ends
  useEffect(() => {
    if (importing) { setShowBar(true); return }
    const t = setTimeout(() => setShowBar(false), 400)
    return () => clearTimeout(t)
  }, [importing])

  // n8nFalhou: leads were sent but the webhook returned a non-2xx status.
  // importados = 0 (nothing sent) is NOT a failure — n8nStatus stays 0 in that case.
  const n8nFalhou = (importResult?.importados ?? 0) > 0
    && typeof importResult?.n8nStatus === 'number'
    && (importResult.n8nStatus < 200 || importResult.n8nStatus >= 300)

  // Alvos pós-import: novos (vieram do n8n) + já existentes (casaram na dedup)
  const novosCount      = importResult?.leadIds?.length ?? 0
  const existentesCount = importResult?.existingLeadIds?.length ?? 0
  const blastTotal      = new Set([
    ...(importResult?.leadIds ?? []),
    ...(importResult?.existingLeadIds ?? []),
  ]).size

  const importadosCount = useCountUp(importResult?.importados ?? 0, 800)
  const ignoradosCount  = useCountUp(importResult?.ignorados?.total ?? 0, 600)
  const duplicadosCount = useCountUp(importResult?.duplicados?.total ?? 0, 600)

  return (
    <div>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, marginBottom: 24,
      }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            Leads
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)' }}>
            Selecione leads para adicioná-los à campanha de disparo.
          </div>
        </div>

        {/* Actions + Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
          {/* Download template */}
          <a
            href="/api/sdr/leads/template"
            download="modelo-leads.xlsx"
            className="btn btn-secondary btn-sm"
          >
            Baixar modelo
          </a>

          {/* Import Excel */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? 'Importando...' : 'Importar Excel'}
          </Button>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--gray2)', pointerEvents: 'none',
            }} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Nome, telefone ou empresa..."
              style={{
                paddingLeft: 34, paddingRight: 14, paddingTop: 9, paddingBottom: 9,
                fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
                border: '1px solid var(--gray3)', borderRadius: 99,
                background: 'var(--white)', color: 'var(--black)',
                outline: 'none', transition: 'border-color .15s', minWidth: 240,
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
              onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
            />
          </div>
        </div>
      </div>

      {/* ── Import progress bar ─────────────────────────────────────── */}
      {showBar && (
        <div
          className="shimmer-bar"
          style={{
            height: 3, borderRadius: 2,
            background: 'var(--primary)',
            marginBottom: 12,
            opacity: importing ? 1 : 0,
            transition: 'opacity 0.4s ease',
          }}
        />
      )}

      {/* ── Import result panel ─────────────────────────────────────── */}
      {importResult && (
        <div
          className="animate-slide-up"
          style={{
            marginBottom: 16,
            background: !importResult.ok
            ? 'rgba(239,68,68,0.06)'
            : n8nFalhou
              ? 'rgba(245,158,11,0.08)'
              : 'rgba(34,197,94,0.06)',
          border: `1px solid ${
            !importResult.ok
              ? 'rgba(239,68,68,0.25)'
              : n8nFalhou
                ? 'rgba(245,158,11,0.35)'
                : 'rgba(34,197,94,0.25)'
          }`,
          borderRadius: 12, padding: '14px 18px',
        }}>
          {importResult.ok ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8,
                color: n8nFalhou ? '#b45309' : 'var(--green)',
              }}>
                {n8nFalhou
                  ? <>⚠ <span className="animate-count-pop tabular-nums">{importadosCount}</span> lead{importResult.importados !== 1 ? 's' : ''} enviados, mas a importação retornou um erro (HTTP {importResult.n8nStatus}) — tente novamente em instantes ou verifique a configuração de importação.</>
                  : <>✓ <span className="animate-count-pop tabular-nums">{importadosCount}</span> lead{importResult.importados !== 1 ? 's' : ''} enviados para importação</>
                }
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500, marginBottom: 6 }}>
                <span className="animate-count-pop tabular-nums">{importadosCount}</span> importados
                {' · '}<span className="animate-count-pop tabular-nums">{ignoradosCount}</span> ignorados
                {' · '}<span className="animate-count-pop tabular-nums">{duplicadosCount}</span> duplicados
                {' — '}{importResult.totalLinhas} linha{importResult.totalLinhas !== 1 ? 's' : ''} no arquivo
              </div>

              {(importResult.ignorados?.total ?? 0) > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{
                    fontSize: 12, color: 'var(--gray2)', cursor: 'pointer',
                    fontWeight: 600, userSelect: 'none' as const,
                  }}>
                    Ignorados ({importResult.ignorados!.total})
                  </summary>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {importResult.ignorados!.amostra.map((it, i) => (
                      <div key={i} style={{ fontSize: 11, color: 'var(--gray)', fontFamily: 'monospace' }}>
                        Linha {it.linha}: {it.motivo}
                      </div>
                    ))}
                    {importResult.ignorados!.total > importResult.ignorados!.amostra.length && (
                      <div style={{ fontSize: 11, color: 'var(--gray2)', fontStyle: 'italic' }}>
                        … e mais {importResult.ignorados!.total - importResult.ignorados!.amostra.length}
                      </div>
                    )}
                  </div>
                </details>
              )}

              {(importResult.duplicados?.total ?? 0) > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{
                    fontSize: 12, color: 'var(--gray2)', cursor: 'pointer',
                    fontWeight: 600, userSelect: 'none' as const,
                  }}>
                    Duplicados ({importResult.duplicados!.total})
                  </summary>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {importResult.duplicados!.amostra.map((it, i) => (
                      <div key={i} style={{ fontSize: 11, color: 'var(--gray)', fontFamily: 'monospace' }}>
                        Linha {it.linha}: {it.telefone}
                      </div>
                    ))}
                    {importResult.duplicados!.total > importResult.duplicados!.amostra.length && (
                      <div style={{ fontSize: 11, color: 'var(--gray2)', fontStyle: 'italic' }}>
                        … e mais {importResult.duplicados!.total - importResult.duplicados!.amostra.length}
                      </div>
                    )}
                  </div>
                </details>
              )}

              {(importResult.suspeitos?.total ?? 0) > 0 && (
                <div style={{
                  marginTop: 10, padding: '10px 14px', borderRadius: 10,
                  background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.35)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
                    ⚠ {importResult.suspeitos!.total} número{importResult.suspeitos!.total !== 1 ? 's' : ''} podem estar sem o 9 (possível celular incompleto) — confira na planilha. O WhatsApp pode recusar (erro de não-entrega).
                  </div>
                  <details>
                    <summary style={{
                      fontSize: 12, color: '#92400e', cursor: 'pointer',
                      fontWeight: 600, userSelect: 'none' as const,
                    }}>
                      Suspeitos ({importResult.suspeitos!.total})
                    </summary>
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {importResult.suspeitos!.amostra.map((it, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#78350f', fontFamily: 'monospace' }}>
                          Linha {it.linha}: {it.telefone}
                        </div>
                      ))}
                      {importResult.suspeitos!.total > importResult.suspeitos!.amostra.length && (
                        <div style={{ fontSize: 11, color: '#92400e', fontStyle: 'italic' }}>
                          … e mais {importResult.suspeitos!.total - importResult.suspeitos!.amostra.length}
                        </div>
                      )}
                    </div>
                  </details>
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--gray2)', marginTop: 10, lineHeight: 1.5 }}>
                A importação é processada de forma assíncrona — os leads podem levar alguns instantes para aparecer na lista.
                {' '}
                <button
                  onClick={() => setFetchSeq(s => s + 1)}
                  style={{
                    background: 'none', border: 'none', padding: 0,
                    fontSize: 11, fontWeight: 700, color: 'var(--primary-text)',
                    cursor: 'pointer', textDecoration: 'underline',
                  }}
                >
                  Atualizar lista
                </button>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>
              ✗ {friendlyImportError(importResult.error ?? 'Erro desconhecido')}
            </div>
          )}
        </div>
      )}

      {/* ── Enroll bar ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        marginBottom: 16, flexWrap: 'wrap' as const,
      }}>
        <Button
          variant="primary"
          onClick={enroll}
          disabled={enrolling || selected.size === 0}
        >
          {enrolling ? 'Adicionando...' : `Adicionar à campanha${selected.size > 0 ? ` (${selected.size})` : ''}`}
        </Button>

        {enrollResult?.ok && (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
            ✓ {enrollResult.enrolled ?? selected.size} leads adicionados
          </span>
        )}
        {enrollResult && !enrollResult.ok && (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>
            ✗ {enrollResult.error}
          </span>
        )}

        {!enrollResult && (
          <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>
            Os leads selecionados entram na campanha e recebem a primeira mensagem da sequência.
          </span>
        )}
      </div>

      {/* ── Status line ────────────────────────────────────────────── */}
      {!loading && !error && data && (
        <div style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500, marginBottom: 12 }}>
          {total.toLocaleString('pt-BR')} lead{total !== 1 ? 's' : ''}
          {debQ && ` para "${debQ}"`}
          {totalPages > 1 && ` — página ${page} de ${totalPages}`}
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────────── */}
      {loading && (
        <SkeletonTable rows={8} colWidths={['28%', '18%', '18%', '14%', '10%']} />
      )}

      {/* ── Error ──────────────────────────────────────────────────── */}
      {!loading && error && (
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)', marginBottom: 8 }}>
            Falha ao carregar leads
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray2)' }}>
            {error === 'fonte_sdr_nao_configurada'
              ? 'Configure a fonte de dados do SDR primeiro.'
              : error}
          </div>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────── */}
      {!loading && !error && (
        <div style={{
          background: 'var(--white)', borderRadius: 16,
          border: '1px solid var(--gray3)', overflow: 'hidden',
        }}>
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
              {(data?.items ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>
                    {debQ ? `Nenhum lead encontrado para "${debQ}"` : 'Nenhum lead encontrado'}
                  </td>
                </tr>
              ) : (data?.items ?? []).map((lead, i) => {
                const checked = selected.has(lead.id)
                const isLast  = i === (data?.items.length ?? 0) - 1
                return (
                  <tr
                    key={lead.id}
                    className="row-cascade"
                    onClick={() => toggleOne(lead.id)}
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
                        style={{ cursor: 'pointer', accentColor: 'var(--primary)' }}
                      />
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>
                      {lead.name || '—'}
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--gray)' }}>
                        {lead.phone || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--gray)', fontWeight: 500 }}>
                      {lead.company || '—'}
                    </td>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>
                      {lead.source || '—'}
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <StatusBadge value={lead.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ─────────────────────────────────────────────── */}
      {!loading && !error && totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 20 }}>
          <button
            onClick={() => setPage(p => p - 1)}
            disabled={!hasPrev}
            style={{
              padding: '8px 18px', borderRadius: 99, fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
              cursor: hasPrev ? 'pointer' : 'not-allowed',
              border: '1px solid var(--gray3)', background: 'var(--white)',
              color: hasPrev ? 'var(--black)' : 'var(--gray3)',
            }}
          >
            ← Anterior
          </button>
          <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={!hasNext}
            style={{
              padding: '8px 18px', borderRadius: 99, fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700,
              cursor: hasNext ? 'pointer' : 'not-allowed',
              border: '1px solid var(--gray3)', background: 'var(--white)',
              color: hasNext ? 'var(--black)' : 'var(--gray3)',
            }}
          >
            Próxima →
          </button>
        </div>
      )}

      {/* ── Campaign enroll modal ─────────────────────────────────── */}
      {showCampaignModal && (
        <div
          onClick={(campaignEnrolling || blasting) ? undefined : closeCampaignModal}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--white)', borderRadius: 20, padding: '28px 32px',
              boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
              maxWidth: 440, width: '100%',
            }}
          >
            {!blastMode ? (
              <>
                {/* Title */}
                <div style={{
                  fontSize: 18, fontWeight: 800, color: 'var(--black)',
                  letterSpacing: '-0.01em', marginBottom: 10,
                }}>
                  {[
                    novosCount > 0 ? `${novosCount} novo${novosCount !== 1 ? 's' : ''}` : null,
                    existentesCount > 0 ? `${existentesCount} já na base` : null,
                  ].filter(Boolean).join(' · ')} — o que fazer?
                </div>

                {/* Description */}
                <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.65, marginBottom: 24 }}>
                  <strong>Disparar mensagens</strong> envia um template aprovado agora para toda a
                  lista ({blastTotal} contato{blastTotal !== 1 ? 's' : ''}, novos + já existentes).
                  {novosCount > 0 && (
                    <> <strong>Adicionar à campanha</strong> inicia a sequência de mensagens para os {novosCount} novo{novosCount !== 1 ? 's' : ''}.</>
                  )}
                  {novosCount === 0 && (
                    <> Todos os contatos já estão na base — só o disparo está disponível.</>
                  )}
                </div>

                {/* Loading */}
                {campaignEnrolling && (
                  <div style={{ fontSize: 13, color: 'var(--gray2)', marginBottom: 20 }}>
                    Adicionando...
                  </div>
                )}

                {/* Result */}
                {campaignEnrollResult && (
                  <div style={{
                    marginBottom: 20, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: campaignEnrollResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${campaignEnrollResult.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    color: campaignEnrollResult.ok ? '#15803d' : 'var(--red)',
                  }}>
                    {campaignEnrollResult.ok
                      ? `✓ ${campaignEnrollResult.enrolled} lead${campaignEnrollResult.enrolled !== 1 ? 's' : ''} adicionados à campanha`
                      : `Erro ao adicionar: ${campaignEnrollResult.error}`
                    }
                    {campaignEnrollResult.partialError && (
                      <div style={{ fontSize: 11, color: '#b45309', marginTop: 6, fontWeight: 500 }}>
                        Alguns lotes falharam: {campaignEnrollResult.partialError}
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <Button
                    variant="ghost"
                    onClick={closeCampaignModal}
                    disabled={campaignEnrolling}
                  >
                    {campaignEnrollResult ? 'Fechar' : 'Só manter na lista'}
                  </Button>

                  {!campaignEnrollResult && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={openBlast}
                        disabled={campaignEnrolling}
                      >
                        Disparar mensagens agora
                      </Button>
                      {novosCount > 0 && (
                        <Button
                          variant="primary"
                          onClick={enrollImported}
                          disabled={campaignEnrolling}
                        >
                          Adicionar à campanha
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Blast sub-view */}
                <div style={{
                  fontSize: 18, fontWeight: 800, color: 'var(--black)',
                  letterSpacing: '-0.01em', marginBottom: 10,
                }}>
                  Disparar para {blastTotal} contato{blastTotal !== 1 ? 's' : ''}
                </div>
                <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.65, marginBottom: 18 }}>
                  Envio real de WhatsApp usando um <strong>template aprovado</strong> para toda a
                  lista importada. As mensagens são enviadas com um pequeno intervalo entre elas.
                </div>

                {blastTplLoading && (
                  <div style={{ fontSize: 13, color: 'var(--gray2)', marginBottom: 18 }}>Carregando templates...</div>
                )}
                {blastTplError && (
                  <div style={{
                    marginBottom: 18, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)',
                  }}>
                    {friendlyBlastError(blastTplError)}
                  </div>
                )}

                {blastTemplates && !blastResult && !blastPendingConfirm && (
                  <div ref={templateDropdownRef} style={{ marginBottom: 18, position: 'relative' }}>
                    {/* Trigger */}
                    <button
                      onClick={() => { if (!blasting) setTemplateOpen(o => !o) }}
                      disabled={blasting}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 10, fontFamily: 'inherit',
                        fontSize: 13, border: '1px solid var(--gray3)', background: 'var(--white)',
                        color: selectedTemplate ? 'var(--black)' : 'var(--gray2)',
                        cursor: blasting ? 'not-allowed' : 'pointer',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedTemplate || 'Escolha um template…'}
                      </span>
                      <span style={{ flexShrink: 0, marginLeft: 8, fontSize: 11, opacity: 0.6 }}>▾</span>
                    </button>

                    {/* Dropdown panel */}
                    {templateOpen && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                        zIndex: 2000,
                        background: 'var(--white)', border: '1px solid var(--gray3)',
                        borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
                        maxHeight: 260, overflowY: 'auto',
                      }}>
                        <div style={{
                          padding: '8px 10px', borderBottom: '1px solid var(--gray3)',
                          position: 'sticky', top: 0, background: 'var(--white)',
                        }}>
                          <input
                            autoFocus
                            value={templateSearch}
                            onChange={e => setTemplateSearch(e.target.value)}
                            placeholder="Buscar template…"
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              fontFamily: 'inherit', fontSize: 12,
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
                            return (
                              <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--gray2)' }}>
                                Nenhum template encontrado
                              </div>
                            )
                          }
                          return filtered.map(t => (
                            <button
                              key={t.nome_template}
                              onClick={() => {
                                setSelectedTemplate(t.nome_template)
                                setTemplateOpen(false)
                                setTemplateSearch('')
                              }}
                              style={{
                                width: '100%', textAlign: 'left', padding: '10px 14px',
                                background: t.nome_template === selectedTemplate ? 'rgba(0,0,0,0.04)' : 'transparent',
                                border: 'none', borderBottom: '1px solid var(--gray3)',
                                cursor: 'pointer', fontFamily: 'inherit',
                              }}
                            >
                              <div style={{
                                fontSize: 13, color: 'var(--black)',
                                fontWeight: t.nome_template === selectedTemplate ? 700 : 400,
                              }}>
                                {t.nome_template}
                              </div>
                              {t.preview && (
                                <div style={{
                                  fontSize: 11, color: 'var(--gray2)', marginTop: 2,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                  {t.preview.length > 60 ? t.preview.slice(0, 60) + '…' : t.preview}
                                </div>
                              )}
                            </button>
                          ))
                        })()}
                      </div>
                    )}

                    {/* Preview do template selecionado */}
                    {(() => {
                      const tpl = blastTemplates.find(t => t.nome_template === selectedTemplate)
                      return tpl?.preview ? (
                        <div style={{
                          marginTop: 10, padding: '10px 14px', borderRadius: 10, fontSize: 12.5,
                          color: 'var(--gray)', background: 'rgba(0,0,0,0.04)',
                          border: '1px solid rgba(0,0,0,0.08)', lineHeight: 1.55,
                        }}>
                          {tpl.preview}
                        </div>
                      ) : null
                    })()}
                  </div>
                )}

                {blastPendingConfirm && !blastResult && (
                  <div style={{
                    marginBottom: 18, padding: '12px 16px', borderRadius: 10,
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
                      Confirmar disparo
                    </div>
                    <div style={{ fontSize: 13, color: '#78350f', lineHeight: 1.6 }}>
                      {(importResult?.semNome ?? 0)} contato{(importResult?.semNome ?? 0) !== 1 ? 's' : ''} sem nome serão
                      enviados com a saudação padrão <strong>&ldquo;tudo bem&rdquo;</strong>.
                      Deseja continuar?
                    </div>
                  </div>
                )}

                {blasting && (
                  <div style={{ fontSize: 13, color: 'var(--gray2)', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 4 }}>
                    Disparando
                    <span aria-hidden="true" style={{ display: 'inline-flex', gap: 3, marginLeft: 2 }}>
                      <span className="blast-dot" />
                      <span className="blast-dot" style={{ animationDelay: '.2s' }} />
                      <span className="blast-dot" style={{ animationDelay: '.4s' }} />
                    </span>
                  </div>
                )}
                {blastResult && (
                  <div style={{
                    marginBottom: 18, padding: '10px 14px', borderRadius: 10,
                    background: blastResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${blastResult.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                  }}>
                    {blastResult.ok ? (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d', marginBottom: 10 }}>
                          ✓ Disparo iniciado para {blastResult.started} contato{blastResult.started !== 1 ? 's' : ''}
                        </div>
                        <ProportionBar
                          started={blastResult.started ?? 0}
                          total={blastResult.totalSolicitado ?? blastResult.started ?? 0}
                          skipped={blastResult.skipped ?? 0}
                        />
                      </>
                    ) : (
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
                        {`Erro ao disparar: ${friendlyBlastError(blastResult.error ?? 'erro desconhecido')}`}
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {blastPendingConfirm && !blastResult ? (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => setBlastPendingConfirm(false)}
                        disabled={blasting}
                      >
                        Cancelar
                      </Button>
                      <Button
                        variant="primary"
                        className={blasting ? 'btn-pulse' : undefined}
                        onClick={runBlast}
                        disabled={blasting}
                      >
                        Confirmar disparo
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (blastResult) { closeCampaignModal() }
                          else { setBlastMode(false); setBlastPendingConfirm(false) }
                        }}
                        disabled={blasting}
                      >
                        {blastResult ? 'Fechar' : 'Voltar'}
                      </Button>
                      {!blastResult && (
                        <Button
                          variant="primary"
                          className={blasting ? 'btn-pulse' : undefined}
                          onClick={() => {
                            if ((importResult?.semNome ?? 0) > 0) { setBlastPendingConfirm(true) }
                            else { void runBlast() }
                          }}
                          disabled={blasting || !selectedTemplate}
                        >
                          Disparar
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
