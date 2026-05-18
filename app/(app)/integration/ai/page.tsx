'use client'
import { useState, useEffect } from 'react'

type Step = 1 | 2 | 3
type Period = 'day' | 'week' | 'month'

interface UsageData {
  totalUsd: number
  totalBrl: number
  totalInputTokens: number
  totalOutputTokens: number
  callCount: number
  budgetBrl: number
  budgetUsedPercent: number | null
  monthlySpendBrl: number
  exchangeRate: number
  byModel: Record<string, { costUsd: number; calls: number }>
  dailySeries: { date: string; costUsd: number }[]
}

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', desc: 'Rápido e econômico', price: '$0,80/M tokens' },
  { id: 'claude-sonnet-4-6',          name: 'Claude Sonnet 4.6', desc: 'Equilibrado',         price: '$3,00/M tokens' },
  { id: 'claude-opus-4-7',            name: 'Claude Opus 4.7',   desc: 'Mais poderoso',       price: '$15,00/M tokens' },
]

const MODEL_LABEL: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-7': 'Opus 4.7',
}

const fmtBrl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmtUsd = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 }).format(v)
const fmtNum = (v: number) =>
  new Intl.NumberFormat('pt-BR').format(v)

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

// ─── EyeIcon ──────────────────────────────────────────────────────────────────

function EyeIcon({ open }: { open: boolean }) {
  if (open) return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

// ─── UsageSection ─────────────────────────────────────────────────────────────

function UsageSection({ isActive }: { isActive: boolean }) {
  const [period, setPeriod] = useState<Period>('month')
  const [data, setData] = useState<UsageData | null>(null)
  const [loadingUsage, setLoadingUsage] = useState(true)

  useEffect(() => {
    if (!isActive) return
    setLoadingUsage(true)
    fetch(`/api/ai-settings/usage?period=${period}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoadingUsage(false))
  }, [period, isActive])

  if (!isActive) return null

  const PERIOD_LABELS: Record<Period, string> = { day: 'Hoje', week: 'Esta semana', month: 'Este mês' }
  const pct = data?.budgetUsedPercent ?? 0
  const barColor = pct > 90 ? 'var(--red)' : pct > 70 ? '#d97706' : 'var(--green)'

  return (
    <div className="animate-slide-up delay-2" style={{
      background: 'var(--white)', border: '1px solid var(--gray3)',
      borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: 'var(--shadow)',
    }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--black)' }}>Uso e Gastos</div>
          <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500, marginTop: 2 }}>
            {data ? `Câmbio: 1 USD = ${fmtBrl(data.exchangeRate)}` : ' '}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['day', 'week', 'month'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '5px 12px', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                border: `1px solid ${period === p ? 'var(--primary)' : 'var(--gray3)'}`,
                background: period === p ? 'var(--primary-dim)' : 'var(--white)',
                color: period === p ? 'var(--primary-text)' : 'var(--gray)',
                borderRadius: 8, cursor: 'pointer', transition: 'all .15s',
              }}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loadingUsage ? (
        <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--gray2)', fontWeight: 500 }}>
          Carregando…
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              {
                label: 'Gasto no período',
                value: fmtBrl(data?.totalBrl ?? 0),
                sub: fmtUsd(data?.totalUsd ?? 0),
              },
              {
                label: 'Chamadas',
                value: fmtNum(data?.callCount ?? 0),
                sub: 'total no período',
              },
              {
                label: 'Tokens de entrada',
                value: fmtNum(data?.totalInputTokens ?? 0),
                sub: 'tokens enviados',
              },
              {
                label: 'Tokens de saída',
                value: fmtNum(data?.totalOutputTokens ?? 0),
                sub: 'tokens gerados',
              },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{
                padding: '14px 16px', borderRadius: 12,
                background: 'var(--bg)', border: '1px solid var(--gray3)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  {label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--black)', lineHeight: 1.2 }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginTop: 4 }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* Budget progress */}
          <div style={{ marginBottom: 20, padding: '16px', borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--gray3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Orçamento mensal
              </div>
              {(data?.budgetBrl ?? 0) > 0 && data?.budgetUsedPercent != null && (
                <div style={{ fontSize: 12, fontWeight: 700, color: barColor }}>
                  {data.budgetUsedPercent.toFixed(1)}%
                </div>
              )}
            </div>

            {(data?.budgetBrl ?? 0) === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--gray2)', fontWeight: 500 }}>Sem limite definido</div>
            ) : (
              <>
                <div style={{ height: 8, borderRadius: 99, background: 'var(--gray3)', overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    height: '100%', borderRadius: 99,
                    width: `${Math.min(100, data?.budgetUsedPercent ?? 0)}%`,
                    background: barColor,
                    transition: 'width .6s ease',
                    minWidth: (data?.budgetUsedPercent ?? 0) > 0 ? 6 : 0,
                  }} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500 }}>
                  {fmtBrl(data?.monthlySpendBrl ?? 0)} de {fmtBrl(data?.budgetBrl ?? 0)} utilizados
                </div>
              </>
            )}
          </div>

          {/* Model breakdown */}
          {data && Object.keys(data.byModel).length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Por modelo
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(data.byModel)
                  .sort((a, b) => b[1].costUsd - a[1].costUsd)
                  .map(([modelId, stats]) => (
                    <div key={modelId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--gray3)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>
                          {MODEL_LABEL[modelId] ?? modelId}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>
                          {stats.calls} chamada{stats.calls !== 1 ? 's' : ''}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>
                          {fmtBrl(stats.costUsd * (data.exchangeRate))}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {data && Object.keys(data.byModel).length === 0 && (
            <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 13, color: 'var(--gray2)', fontWeight: 500 }}>
              Nenhum uso registrado no período
            </div>
          )}

          {/* External link */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <a
              href="https://console.anthropic.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--gray)', textDecoration: 'none', padding: '6px 14px', borderRadius: 8, border: '1px solid var(--gray3)', background: 'var(--bg)' }}
            >
              Ver detalhes no Console da Anthropic
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 3H3v10h10V9M9 3h4v4M13 3L7 9"/>
              </svg>
            </a>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AIIntegrationPage() {
  const [step, setStep] = useState<Step>(1)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [model, setModel] = useState('claude-haiku-4-5-20251001')
  const [budgetBrl, setBudgetBrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [existingKeyMasked, setExistingKeyMasked] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    fetch('/api/ai-settings')
      .then(r => r.json())
      .then(data => {
        if (data.configured) {
          setExistingKeyMasked(data.apiKey)
          setModel(data.defaultModel ?? 'claude-haiku-4-5-20251001')
          setBudgetBrl(String(data.monthlyBudgetBrl ?? 0))
          setIsActive(data.isActive === 1)
          setStep(3)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  async function validateKey() {
    if (!apiKey) return
    setValidating(true)
    setValidationResult(null)
    const res = await fetch('/api/ai-settings/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    })
    const data = await res.json()
    setValidationResult(data)
    setValidating(false)
  }

  async function saveSettings() {
    setSaving(true)
    const body: Record<string, unknown> = {
      defaultModel: model,
      monthlyBudgetBrl: parseFloat(budgetBrl) || 0,
    }
    if (apiKey) body.apiKey = apiKey

    const res = await fetch('/api/ai-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    setSaving(false)
    if (data.ok) {
      if (apiKey) setExistingKeyMasked('••••' + apiKey.slice(-4))
      setApiKey('')
      setIsActive(true)
      setSaved(true)
    }
  }

  if (loading) return null

  const canAdvanceStep1 = validationResult?.valid || (!!existingKeyMasked && !apiKey)
  const displayKey = apiKey ? `••••${apiKey.slice(-4)}` : (existingKeyMasked ?? '—')
  const selectedModel = MODELS.find(m => m.id === model)
  const budgetDisplay = budgetBrl && parseFloat(budgetBrl) > 0
    ? `R$ ${parseFloat(budgetBrl).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Sem limite definido'

  return (
    <div>
      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>Integração Claude IA</div>
        <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>Configure sua chave de API da Anthropic para usar recursos de inteligência artificial</div>
      </div>

      {/* Stepper */}
      <div className="animate-slide-up delay-2" style={{
        background: 'var(--white)', border: '1px solid var(--gray3)',
        borderRadius: 16, padding: '16px 24px', marginBottom: 20, boxShadow: 'var(--shadow)',
        display: 'flex', alignItems: 'center',
      }}>
        <StepIndicator current={step} step={1} label="API Key" sub="Chave de acesso" />
        <div style={{ flex: 1, height: 1, background: 'var(--gray3)', margin: '0 16px', maxWidth: 60 }} />
        <StepIndicator current={step} step={2} label="Modelo" sub="Configurações" />
        <div style={{ flex: 1, height: 1, background: 'var(--gray3)', margin: '0 16px', maxWidth: 60 }} />
        <StepIndicator current={step} step={3} label="Confirmar" sub="Finalizar" />
      </div>

      {/* Usage dashboard — only when active */}
      <UsageSection isActive={isActive} />

      {/* Step 1 — API Key */}
      {step === 1 && (
        <div className="animate-slide-up delay-3" style={{
          background: 'var(--white)', border: '1px solid var(--gray3)',
          borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', paddingBottom: 14, borderBottom: '1px solid var(--gray3)', marginBottom: 20 }}>
            Chave de API da Anthropic
          </div>

          <div style={{ padding: '12px 16px', background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)', borderRadius: 12, marginBottom: 20, fontSize: 13, fontWeight: 600, color: 'var(--primary-text)', lineHeight: 1.6 }}>
            Acesse{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-text)', fontWeight: 800 }}>
              console.anthropic.com → API Keys
            </a>{' '}
            para criar ou copiar sua chave de acesso.
          </div>

          {existingKeyMasked && (
            <div style={{ padding: '10px 14px', background: 'rgba(30,138,62,0.06)', border: '1px solid rgba(30,138,62,0.2)', borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600, color: '#145c2a' }}>
              Chave atual: <span style={{ fontFamily: 'monospace' }}>{existingKeyMasked}</span> — deixe em branco para manter a chave atual
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em' }}>
              {existingKeyMasked ? 'NOVA CHAVE DE API (OPCIONAL)' : 'CHAVE DE API'}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setValidationResult(null) }}
                  placeholder="sk-ant-api03-…"
                  style={{ width: '100%', padding: '10px 44px 10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }}
                  onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
                />
                <button
                  onClick={() => setShowKey(v => !v)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray2)', padding: 2 }}
                >
                  <EyeIcon open={showKey} />
                </button>
              </div>
              <button
                onClick={validateKey}
                disabled={validating || !apiKey}
                style={{ padding: '10px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: 'var(--bg)', border: '1px solid var(--gray3)', borderRadius: 8, cursor: !apiKey ? 'not-allowed' : 'pointer', color: 'var(--black)', whiteSpace: 'nowrap', opacity: !apiKey ? 0.5 : 1 }}
              >
                {validating ? 'Validando…' : 'Validar conexão'}
              </button>
            </div>

            {validationResult && (
              <div style={{
                marginTop: 8, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 8,
                background: validationResult.valid ? 'rgba(30,138,62,0.06)' : 'rgba(217,48,37,0.06)',
                border: `1px solid ${validationResult.valid ? 'rgba(30,138,62,0.25)' : 'rgba(217,48,37,0.2)'}`,
                color: validationResult.valid ? '#145c2a' : '#b02619',
              }}>
                {validationResult.valid ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="var(--green)" strokeWidth="2"><path d="M2 6l3 3 5-5"/></svg>
                    Chave válida — conexão com a Anthropic confirmada
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="#b02619" strokeWidth="2"><path d="M2 2l8 8M10 2L2 10"/></svg>
                    {validationResult.error ?? 'Chave inválida'}
                  </>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setStep(2)}
              disabled={!canAdvanceStep1}
              style={{ padding: '11px 24px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--primary)', border: 'none', borderRadius: 100, cursor: canAdvanceStep1 ? 'pointer' : 'not-allowed', color: 'var(--primary-contrast)', opacity: !canAdvanceStep1 ? 0.5 : 1 }}
            >
              Próximo →
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Model + Budget */}
      {step === 2 && (
        <div className="animate-slide-up delay-3" style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', paddingBottom: 14, borderBottom: '1px solid var(--gray3)', marginBottom: 20 }}>
            Modelo e Orçamento
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 2 }}>MODELO PADRÃO</label>
            {MODELS.map(m => {
              const selected = model === m.id
              return (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 16px', borderRadius: 12, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', width: '100%',
                    background: selected ? 'var(--primary-dim)' : 'var(--white)',
                    border: `1.5px solid ${selected ? 'var(--primary)' : 'var(--gray3)'}`,
                    transition: 'all .18s',
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${selected ? 'var(--primary)' : 'var(--gray3)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {selected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)' }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: selected ? 'var(--primary-text)' : 'var(--black)' }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500, marginTop: 2 }}>{m.desc} · {m.price}</div>
                  </div>
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em' }}>ORÇAMENTO MENSAL (R$)</label>
            <input
              type="number"
              min="0"
              step="10"
              value={budgetBrl}
              onChange={e => setBudgetBrl(e.target.value)}
              placeholder="0"
              style={{ width: '100%', padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
            />
            <div style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>O orçamento reinicia no 1º dia de cada mês</div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button
              onClick={() => setStep(1)}
              style={{ padding: '11px 20px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 100, cursor: 'pointer', color: 'var(--gray)' }}
            >
              ← Voltar
            </button>
            <button
              onClick={() => setStep(3)}
              style={{ padding: '11px 24px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--primary)', border: 'none', borderRadius: 100, cursor: 'pointer', color: 'var(--primary-contrast)' }}
            >
              Próximo →
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Confirm */}
      {step === 3 && (
        <div className="animate-slide-up delay-3" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!saved ? (
            <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', paddingBottom: 14, borderBottom: '1px solid var(--gray3)', marginBottom: 20 }}>
                {existingKeyMasked ? 'Configuração atual' : 'Resumo da configuração'}
              </div>

              {[
                { label: 'Modelo', value: selectedModel?.name ?? model, mono: false },
                { label: 'Orçamento mensal', value: budgetDisplay, mono: false },
                { label: 'API Key', value: displayKey, mono: true },
              ].map(({ label, value, mono }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--gray3)' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray)' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</span>
                </div>
              ))}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <button
                  onClick={() => { setSaved(false); setStep(2) }}
                  style={{ padding: '11px 20px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 100, cursor: 'pointer', color: 'var(--gray)' }}
                >
                  ← Editar
                </button>
                <button
                  onClick={saveSettings}
                  disabled={saving}
                  style={{ padding: '11px 28px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--primary)', border: 'none', borderRadius: 100, cursor: saving ? 'not-allowed' : 'pointer', color: 'var(--primary-contrast)', display: 'flex', alignItems: 'center', gap: 8, opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                        <path d="M1 4v5h5M15 12v-5h-5"/><path d="M13.4 7A6 6 0 1 0 12 12.3"/>
                      </svg>
                      Salvando…
                    </>
                  ) : 'Salvar integração'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 40, boxShadow: 'var(--shadow)', textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, background: 'rgba(30,138,62,0.1)', borderRadius: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="24" height="24" viewBox="0 0 12 12" fill="none" stroke="var(--green)" strokeWidth="2"><path d="M2 6l3 3 5-5"/></svg>
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--black)', marginBottom: 8 }}>Integração salva com sucesso!</div>
              <div style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 24, lineHeight: 1.6 }}>
                Sua chave Claude IA está configurada e pronta para uso.
              </div>
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 24px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--primary)', border: 'none', borderRadius: 100, cursor: 'pointer', color: 'var(--primary-contrast)', textDecoration: 'none' }}
              >
                Abrir Console Anthropic
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M7 3H3v10h10V9M9 3h4v4M13 3L7 9"/>
                </svg>
              </a>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg) }
          to   { transform: rotate(360deg) }
        }
      `}</style>
    </div>
  )
}
