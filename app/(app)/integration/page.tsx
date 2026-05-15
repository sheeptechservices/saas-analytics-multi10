'use client'
import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

type Step = 1 | 2 | 3
type IntegrationStatus = 'disconnected' | 'configured' | 'connected' | 'expired'
type SyncStage = 'idle' | 'starting' | 'cleaning' | 'pipeline' | 'leads' | 'done' | 'error'

interface SyncProgress {
  stage: SyncStage
  message?: string
  synced?: number
  error?: string
  ok?: boolean
}

// ─── StepIndicator ────────────────────────────────────────────────────────────

function StepIndicator({ current, step, label, sub }: { current: Step; step: Step; label: string; sub: string }) {
  const done = current > step
  const active = current === step
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
      <div style={{
        width: 26, height: 26, borderRadius: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 800, flexShrink: 0,
        background: done ? 'var(--green)' : active ? 'var(--primary)' : 'var(--bg)',
        color: done ? '#fff' : active ? 'var(--primary-contrast)' : 'var(--gray2)',
        border: !done && !active ? '1px solid var(--gray3)' : 'none',
      }}>
        {done ? '✓' : step}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: done ? 'var(--green)' : active ? 'var(--black)' : 'var(--gray2)' }}>{label}</div>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--gray2)' }}>{sub}</div>
      </div>
    </div>
  )
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

function ConfirmModal({ pipelineName, onConfirm, onCancel }: {
  pipelineName: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCancel])

  return (
    <div
      onClick={e => { if (!cardRef.current?.contains(e.target as Node)) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(18,19,22,0.45)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, animation: 'fadeIn .18s ease both',
      }}
    >
      <div ref={cardRef} style={{
        background: 'var(--white)', borderRadius: 20, width: '100%', maxWidth: 460,
        boxShadow: '0 24px 60px rgba(0,0,0,0.22)',
        animation: 'modalSlideUp .22s cubic-bezier(0.34,1.56,0.64,1) both',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--gray3)', background: 'var(--bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: 'rgba(217,48,37,0.08)', border: '1px solid rgba(217,48,37,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            }}>
              ⚠️
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--black)' }}>Reimportar dados do Kommo?</div>
              <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginTop: 1 }}>Esta ação substituirá os dados atuais</div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          <p style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.7, margin: 0, marginBottom: 14 }}>
            Você está prestes a reimportar todos os leads do funil{' '}
            <strong style={{ color: 'var(--black)' }}>"{pipelineName}"</strong>.
            Os dados atuais do dashboard serão <strong>substituídos completamente</strong>.
          </p>

          {/* Safety notice */}
          <div style={{
            padding: '12px 14px', borderRadius: 10,
            background: 'rgba(30,138,62,0.06)', border: '1px solid rgba(30,138,62,0.2)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--green)" strokeWidth="1.5" style={{ flexShrink: 0, marginTop: 1 }}>
              <rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/>
            </svg>
            <div style={{ fontSize: 12, color: '#145c2a', fontWeight: 500, lineHeight: 1.5 }}>
              <strong>100% seguro — somente leitura.</strong> Nenhum dado será alterado, criado ou excluído no Kommo. A sincronização apenas lê seus leads.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 20px', borderRadius: 10, border: '1px solid var(--gray3)',
              background: 'var(--white)', fontSize: 13, fontWeight: 600,
              color: 'var(--gray)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '10px 22px', borderRadius: 10, border: 'none',
              background: 'var(--primary)', fontSize: 13, fontWeight: 800,
              color: 'var(--primary-contrast)', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v5h5M15 12v-5h-5"/><path d="M13.4 7A6 6 0 1 0 12 12.3"/>
            </svg>
            Sim, reimportar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SyncProgressCard ──────────────────────────────────────────────────────────

const STAGE_META: Record<SyncStage, { icon: string; label: string; color: string }> = {
  idle:     { icon: '⏳', label: 'Aguardando...', color: 'var(--gray2)' },
  starting: { icon: '🚀', label: 'Iniciando sincronização...', color: 'var(--primary-text)' },
  cleaning: { icon: '🗑️', label: 'Limpando dados anteriores...', color: '#d97706' },
  pipeline: { icon: '🔄', label: 'Sincronizando funil e etapas...', color: 'var(--primary-text)' },
  leads:    { icon: '👥', label: 'Importando leads...', color: 'var(--primary-text)' },
  done:     { icon: '✅', label: 'Concluído!', color: 'var(--green)' },
  error:    { icon: '❌', label: 'Erro na sincronização', color: 'var(--red)' },
}

function SyncProgressCard({ progress }: { progress: SyncProgress }) {
  const meta = STAGE_META[progress.stage] ?? STAGE_META.idle
  const isDone = progress.stage === 'done'
  const isError = progress.stage === 'error'
  const isLeads = progress.stage === 'leads'
  const isIndeterminate = ['starting', 'cleaning', 'pipeline'].includes(progress.stage)

  // Estimate total from synced (progress by pages of 250)
  const synced = progress.synced ?? 0

  return (
    <div style={{
      marginTop: 16, padding: '18px 20px', borderRadius: 14,
      background: isError ? 'rgba(217,48,37,0.04)' : isDone ? 'rgba(30,138,62,0.04)' : 'rgba(37,99,235,0.03)',
      border: `1px solid ${isError ? 'rgba(217,48,37,0.18)' : isDone ? 'rgba(30,138,62,0.2)' : 'rgba(37,99,235,0.12)'}`,
      animation: 'fadeIn .2s ease both',
    }}>
      {/* Stage row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{meta.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{meta.label}</div>
          {progress.message && progress.stage !== 'done' && progress.stage !== 'error' && (
            <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginTop: 2 }}>{progress.message}</div>
          )}
          {isDone && (
            <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, marginTop: 2 }}>
              {synced} leads sincronizados com sucesso
            </div>
          )}
          {isError && (
            <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 500, marginTop: 2 }}>{progress.error}</div>
          )}
        </div>
        {isLeads && synced > 0 && (
          <div style={{
            padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 800,
            background: 'var(--primary-dim)', color: 'var(--primary-text)',
            border: '1px solid var(--primary-mid)', whiteSpace: 'nowrap',
          }}>
            {synced.toLocaleString('pt-BR')}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {!isError && (
        <div style={{
          height: 6, borderRadius: 99,
          background: 'rgba(0,0,0,0.06)',
          overflow: 'hidden',
          position: 'relative',
        }}>
          {isIndeterminate ? (
            <div style={{
              position: 'absolute', inset: 0,
              background: `linear-gradient(90deg, transparent 0%, var(--primary) 40%, var(--primary-text) 60%, transparent 100%)`,
              backgroundSize: '200% 100%',
              animation: 'shimmerBar 1.4s ease-in-out infinite',
            }} />
          ) : isDone ? (
            <div style={{
              height: '100%', width: '100%', borderRadius: 99,
              background: 'var(--green)',
              transition: 'width .5s ease',
            }} />
          ) : (
            // Leads progress — grows each page
            <div style={{
              height: '100%',
              width: synced === 0 ? '4%' : `${Math.min(95, (synced % 250 === 0 && synced > 0 ? 80 : 50))}%`,
              borderRadius: 99,
              background: 'var(--primary)',
              transition: 'width .6s ease',
              minWidth: 24,
            }} />
          )}
        </div>
      )}

      {/* Shimmer keyframe injected via style tag */}
      <style>{`
        @keyframes shimmerBar {
          0%   { background-position: 200% 0 }
          100% { background-position: -200% 0 }
        }
      `}</style>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IntegrationPage() {
  const [step, setStep] = useState<Step>(1)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [accountDomain, setAccountDomain] = useState('')
  const [savingCreds, setSavingCreds] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({ stage: 'idle' })
  const [successMsg, setSuccessMsg] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  // Pipeline selection state
  const [availablePipelines, setAvailablePipelines] = useState<{ kommoId: string; name: string; stagesCount: number }[]>([])
  // What the dropdown currently shows (local only — may not be saved to DB yet)
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('')
  // What is actually confirmed saved in the DB (source of truth for sync eligibility)
  const [dbPipelineId, setDbPipelineId] = useState<string | null>(null)
  const [dbPipelineName, setDbPipelineName] = useState<string | null>(null)
  const [savingPipeline, setSavingPipeline] = useState(false)
  const [pipelineSaved, setPipelineSaved] = useState(false)
  const [loadingPipelines, setLoadingPipelines] = useState(false)
  // (selectedPipelineName not used — dbPipelineName is the source of truth)

  const { data: status, refetch } = useQuery<{
    status: IntegrationStatus
    accountDomain: string | null
    lastSyncAt: string | null
    hasCredentials: boolean
    selectedPipelineId: string | null
    selectedPipelineName: string | null
  }>({
    queryKey: ['integration-status'],
    queryFn: () => fetch('/api/kommo/sync').then(r => r.json()),
  })

  useEffect(() => {
    if (status?.status === 'connected') setStep(3)
    else if (status?.hasCredentials) setStep(2)
    else setStep(1)

    // Sync DB values → local DB state (source of truth for sync eligibility)
    setDbPipelineId(status?.selectedPipelineId ?? null)
    setDbPipelineName(status?.selectedPipelineName ?? null)
    // Pre-populate dropdown with whatever is saved in DB
    if (status?.selectedPipelineId) setSelectedPipelineId(status.selectedPipelineId)

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('connected') === 'true') {
        setSuccessMsg('Kommo conectado com sucesso! Selecione o funil e sincronize.')
        setStep(3)
        refetch()
      }
      if (params.get('error')) {
        const detail = params.get('detail')
        setSuccessMsg(`Erro na conexão: ${params.get('error')}${detail ? ` — ${detail}` : ''}`)
      }
    }
  }, [status])

  // Load pipelines when step 3 is reached
  useEffect(() => {
    if (step !== 3) return
    setLoadingPipelines(true)
    fetch('/api/kommo/pipelines')
      .then(r => r.json())
      .then(data => {
        if (data.pipelines) {
          setAvailablePipelines(data.pipelines)

          // Update DB state from pipelines endpoint (has same data as status)
          if (data.selectedPipelineId) {
            setDbPipelineId(data.selectedPipelineId)
            setDbPipelineName(data.selectedPipelineName ?? null)
            setSelectedPipelineId(data.selectedPipelineId)
          } else if (data.pipelines.length > 0 && !selectedPipelineId) {
            // No DB selection — auto-show first in dropdown (NOT saved to DB)
            setSelectedPipelineId(data.pipelines[0].kommoId)
            // dbPipelineId stays null → sync button stays disabled
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingPipelines(false))
  }, [step])

  async function saveCredentials() {
    if (!clientId || !clientSecret || !accountDomain) return
    setSavingCreds(true)
    const res = await fetch('/api/kommo/connect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret, accountDomain }),
    })
    const data = await res.json()
    setSavingCreds(false)
    if (data.oauthUrl) window.location.href = data.oauthUrl
  }

  async function savePipelineSelection() {
    if (!selectedPipelineId) return
    setSavingPipeline(true)
    const pip = availablePipelines.find(p => p.kommoId === selectedPipelineId)
    await fetch('/api/kommo/pipeline-select', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineKommoId: selectedPipelineId, pipelineName: pip?.name ?? null }),
    })
    // Update DB state — now sync is eligible
    setDbPipelineId(selectedPipelineId)
    setDbPipelineName(pip?.name ?? null)
    setSavingPipeline(false)
    setPipelineSaved(true)
    setTimeout(() => setPipelineSaved(false), 2500)
    refetch()
  }

  async function syncNow() {
    setShowConfirm(false)
    setSyncing(true)
    setSyncProgress({ stage: 'starting', message: 'Iniciando sincronização...' })

    try {
      const res = await fetch('/api/kommo/sync', { method: 'POST' })

      if (!res.body) {
        setSyncProgress({ stage: 'error', error: 'Resposta inválida do servidor' })
        setSyncing(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let receivedFinal = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data: SyncProgress = JSON.parse(line.slice(6))
            setSyncProgress(data)
            if (data.stage === 'done' || data.stage === 'error') {
              setSyncing(false)
              receivedFinal = true
            }
          } catch {}
        }
      }

      // Safety net: if stream closed without a done/error event, stop loading
      if (!receivedFinal) {
        setSyncing(false)
        setSyncProgress(prev =>
          prev.stage !== 'done' && prev.stage !== 'error'
            ? { stage: 'error', error: 'Sincronização interrompida inesperadamente' }
            : prev
        )
      }
    } catch {
      setSyncProgress({ stage: 'error', error: 'Falha na conexão com o servidor' })
      setSyncing(false)
    }

    refetch()
  }

  // hasSavedPipeline = pipeline is confirmed saved in the DB (not just locally selected)
  const hasSavedPipeline = !!(dbPipelineId && dbPipelineName)
  // Dropdown selection differs from what's in DB → user needs to save
  const hasUnsavedChange = selectedPipelineId && selectedPipelineId !== dbPipelineId
  const canSync = status?.status === 'connected' && hasSavedPipeline && !syncing && !hasUnsavedChange

  const statusColor: Record<IntegrationStatus, string> = {
    connected: 'var(--green)', configured: 'var(--primary-text)',
    expired: 'var(--red)', disconnected: 'var(--gray2)',
  }
  const statusLabel: Record<IntegrationStatus, string> = {
    connected: 'Conectado', configured: 'Credenciais salvas',
    expired: 'Token expirado', disconnected: 'Não conectado',
  }

  return (
    <div>
      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>Integração Kommo</div>
        <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>Conecte seu CRM para sincronizar leads e pipelines</div>
      </div>

      {/* Stepper */}
      <div className="animate-slide-up delay-2" style={{
        background: 'var(--white)', border: '1px solid var(--gray3)',
        borderRadius: 16, padding: '16px 24px', marginBottom: 20, boxShadow: 'var(--shadow)',
        display: 'flex', alignItems: 'center',
      }}>
        <StepIndicator current={step} step={1} label="Configurar app" sub="Client ID e Secret" />
        <div style={{ flex: 1, height: 1, background: 'var(--gray3)', margin: '0 16px', maxWidth: 60 }} />
        <StepIndicator current={step} step={2} label="Autorizar" sub="OAuth 2.0 Kommo" />
        <div style={{ flex: 1, height: 1, background: 'var(--gray3)', margin: '0 16px', maxWidth: 60 }} />
        <StepIndicator current={step} step={3} label="Sincronizar" sub="Importar leads" />
      </div>

      {successMsg && (
        <div className="animate-slide-up" style={{
          padding: '12px 16px', borderRadius: 12, marginBottom: 16, fontSize: 13, fontWeight: 600,
          background: successMsg.includes('sucesso') ? 'rgba(30,138,62,0.06)' : 'rgba(217,48,37,0.06)',
          border: `1px solid ${successMsg.includes('sucesso') ? 'rgba(30,138,62,0.25)' : 'rgba(217,48,37,0.2)'}`,
          color: successMsg.includes('sucesso') ? '#145c2a' : '#b02619',
        }}>
          {successMsg}
        </div>
      )}

      {/* Step 1 — Credentials */}
      {step === 1 && (
        <div className="animate-slide-up delay-3" style={{
          background: 'var(--white)', border: '1px solid var(--gray3)',
          borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', paddingBottom: 14, borderBottom: '1px solid var(--gray3)', marginBottom: 20 }}>
            Credenciais do Aplicativo Kommo
          </div>

          <div style={{ padding: '12px 16px', background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)', borderRadius: 12, marginBottom: 20, fontSize: 13, fontWeight: 600, color: 'var(--primary-text)', lineHeight: 1.6 }}>
            Acesse <strong>kommo.com → Configurações → Integrações → Criar integração</strong> para obter as credenciais.
            Use <code style={{ background: 'var(--white)', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>http://localhost:3000/api/kommo/callback</code> como URL de redirecionamento.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {[
              { label: 'Client ID', value: clientId, set: setClientId, placeholder: 'Ex: abc123def456…' },
              { label: 'Client Secret', value: clientSecret, set: setClientSecret, placeholder: 'Ex: xyz789…', type: 'password' },
            ].map(field => (
              <div key={field.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em' }}>{field.label.toUpperCase()}</label>
                <input
                  type={(field as any).type ?? 'text'}
                  value={field.value}
                  onChange={e => field.set(e.target.value)}
                  placeholder={field.placeholder}
                  style={{ width: '100%', padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none' }}
                  onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
                />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em' }}>DOMÍNIO DA CONTA</label>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <input
                value={accountDomain}
                onChange={e => setAccountDomain(e.target.value)}
                placeholder="suaconta"
                style={{ flex: 1, padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: '8px 0 0 8px', outline: 'none', borderRight: 'none' }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
              <div style={{ padding: '10px 14px', background: 'var(--bg)', border: '1px solid var(--gray3)', borderRadius: '0 8px 8px 0', fontSize: 14, color: 'var(--gray2)', fontWeight: 500 }}>.kommo.com</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={saveCredentials}
              disabled={savingCreds || !clientId || !clientSecret || !accountDomain}
              style={{ padding: '11px 24px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--primary)', border: 'none', borderRadius: 100, cursor: 'pointer', color: 'var(--primary-contrast)', opacity: (!clientId || !clientSecret || !accountDomain) ? 0.5 : 1 }}
            >
              {savingCreds ? 'Salvando…' : 'Salvar e conectar com Kommo →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — OAuth pending */}
      {step === 2 && (
        <div className="animate-slide-up delay-3" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, background: 'var(--primary-dim)', borderRadius: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary-text)" strokeWidth="1.5">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--black)', marginBottom: 8 }}>Credenciais salvas</div>
          <div style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 24, lineHeight: 1.6 }}>
            Clique no botão abaixo para autorizar o acesso ao seu Kommo via OAuth 2.0.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={() => setStep(1)} style={{ padding: '11px 20px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 100, cursor: 'pointer', color: 'var(--gray)' }}>
              ← Editar credenciais
            </button>
            <button onClick={saveCredentials} disabled={savingCreds} style={{ padding: '11px 24px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--primary)', border: 'none', borderRadius: 100, cursor: 'pointer', color: 'var(--primary-contrast)' }}>
              Conectar com Kommo →
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Sync */}
      {step === 3 && (
        <div className="animate-slide-up delay-3" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Status card */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--black)', marginBottom: 4 }}>Status da integração</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor[status?.status ?? 'disconnected'], flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: statusColor[status?.status ?? 'disconnected'] }}>
                    {statusLabel[status?.status ?? 'disconnected']}
                  </span>
                  {status?.accountDomain && (
                    <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>· {status.accountDomain}.kommo.com</span>
                  )}
                  <button
                    onClick={async () => {
                      const res = await fetch('/api/kommo/connect')
                      const data = await res.json()
                      if (data.oauthUrl) window.location.href = data.oauthUrl
                    }}
                    style={{
                      padding: '3px 10px', fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                      background: 'var(--bg)', border: '1px solid var(--gray3)',
                      borderRadius: 99, cursor: 'pointer', color: 'var(--gray)',
                    }}
                  >
                    Reconectar
                  </button>
                  <button
                    onClick={() => setStep(1)}
                    style={{
                      padding: '3px 10px', fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                      background: 'var(--bg)', border: '1px solid var(--gray3)',
                      borderRadius: 99, cursor: 'pointer', color: 'var(--gray)',
                    }}
                  >
                    Editar credenciais
                  </button>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 600, marginBottom: 4 }}>Última sincronização</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>
                  {status?.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('pt-BR') : 'Nunca'}
                </div>
              </div>
            </div>

            {/* Pipeline selector */}
            <div style={{ borderTop: '1px solid var(--gray3)', paddingTop: 20, marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', display: 'block', marginBottom: 10 }}>
                Funil a sincronizar <span style={{ color: 'var(--red)', fontSize: 10 }}>obrigatório</span>
              </label>

              {loadingPipelines ? (
                <div style={{ fontSize: 13, color: 'var(--gray2)', fontWeight: 500 }}>Carregando funis disponíveis…</div>
              ) : availablePipelines.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--gray2)', fontWeight: 500 }}>
                  Nenhum funil encontrado. Certifique-se de que a integração está ativa.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <select
                    value={selectedPipelineId}
                    onChange={e => {
                      setSelectedPipelineId(e.target.value)
                      setPipelineSaved(false)
                    }}
                    disabled={syncing}
                    style={{
                      flex: 1, padding: '10px 14px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                      color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)',
                      borderRadius: 10, outline: 'none', cursor: syncing ? 'not-allowed' : 'pointer',
                    }}
                    onFocus={e => { if (!syncing) { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' } }}
                    onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
                  >
                    {availablePipelines.map(p => (
                      <option key={p.kommoId} value={p.kommoId}>
                        {p.name} ({p.stagesCount} etapas)
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={savePipelineSelection}
                    disabled={savingPipeline || syncing || !selectedPipelineId}
                    style={{
                      padding: '10px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                      background: pipelineSaved ? 'rgba(30,138,62,0.1)' : 'var(--bg)',
                      color: pipelineSaved ? 'var(--green)' : 'var(--black)',
                      border: `1px solid ${pipelineSaved ? 'rgba(30,138,62,0.3)' : 'var(--gray3)'}`,
                      borderRadius: 10, cursor: savingPipeline || syncing ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap', transition: 'all .2s ease', opacity: syncing ? 0.5 : 1,
                    }}
                  >
                    {savingPipeline ? 'Salvando…' : pipelineSaved ? '✓ Salvo' : 'Salvar seleção'}
                  </button>
                </div>
              )}

              {/* Notice when pipeline not saved or has unsaved change */}
              {(hasUnsavedChange || (!hasSavedPipeline && selectedPipelineId)) && !loadingPipelines && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#d97706', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  ⚠️ {hasUnsavedChange ? 'Funil alterado — salve antes de sincronizar' : 'Salve a seleção do funil antes de sincronizar'}
                </div>
              )}

              {/* Active pipeline badge — only shows when DB has a confirmed selection */}
              {hasSavedPipeline && !hasUnsavedChange && (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: 'var(--primary-dim)', color: 'var(--primary-text)', border: '1px solid var(--primary-mid)' }}>
                    Funil ativo: {dbPipelineName}
                  </span>
                </div>
              )}
            </div>

            {/* Sync button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => setShowConfirm(true)}
                disabled={!canSync}
                style={{
                  padding: '11px 24px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
                  background: syncing ? 'var(--primary-mid)' : 'var(--primary)',
                  border: 'none', borderRadius: 100, cursor: canSync ? 'pointer' : 'not-allowed',
                  color: 'var(--primary-contrast)', display: 'inline-flex', alignItems: 'center', gap: 8,
                  opacity: !canSync ? 0.5 : 1,
                  transition: 'opacity .2s, transform .18s',
                  position: 'relative', overflow: 'hidden',
                }}
                onMouseEnter={e => { if (canSync) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)' }}
              >
                {syncing ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                      <path d="M1 4v5h5M15 12v-5h-5"/><path d="M13.4 7A6 6 0 1 0 12 12.3"/>
                    </svg>
                    Sincronizando...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 4v5h5M15 12v-5h-5"/><path d="M13.4 7A6 6 0 1 0 12 12.3"/>
                    </svg>
                    Sincronizar agora
                  </>
                )}
              </button>

              {/* Read-only notice */}
              {!syncing && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--gray2)', fontWeight: 500 }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--green)" strokeWidth="1.5">
                    <rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/>
                  </svg>
                  Somente leitura — nenhum dado alterado no Kommo
                </div>
              )}
            </div>

            {/* Progress / Result */}
            {syncProgress.stage !== 'idle' && (
              <SyncProgressCard progress={syncProgress} />
            )}
          </div>

          {/* Info */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--black)', marginBottom: 14 }}>O que é sincronizado?</div>
            {[
              ['Pipeline selecionado', hasSavedPipeline ? `Somente "${dbPipelineName}" — dados anteriores são limpos a cada sync` : 'Selecione e salve um funil acima'],
              ['Etapas', 'As colunas do funil com suas cores originais do Kommo'],
              ['Leads', 'Nome, responsável, valor e data de criação — somente leitura'],
            ].map(([t, d]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 20, height: 20, borderRadius: 100, background: 'rgba(30,138,62,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="var(--green)" strokeWidth="2"><path d="M2 6l3 3 5-5"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{t}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500 }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spin keyframe */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg) }
          to   { transform: rotate(360deg) }
        }
      `}</style>

      {/* Confirmation modal */}
      {showConfirm && (
        <ConfirmModal
          pipelineName={dbPipelineName}
          onConfirm={syncNow}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}
