'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useCanDispatch } from '@/lib/hooks/useCanDispatch'

// ─── SecretInput ──────────────────────────────────────────────────────────────

function SecretInput({
  value,
  onChange,
  show,
  onToggle,
}: {
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggle: () => void
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="••••••••"
        autoComplete="new-password"
        style={{
          width: '100%', fontFamily: 'inherit', fontSize: 13,
          border: '1px solid var(--gray3)', borderRadius: 10,
          padding: '10px 42px 10px 14px',
          background: 'var(--bg)', color: 'var(--black)', outline: 'none',
          boxSizing: 'border-box' as const, transition: 'border-color .15s',
        }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
        onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
      />
      <button
        type="button"
        onClick={onToggle}
        title={show ? 'Ocultar' : 'Mostrar'}
        style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--gray2)', padding: 4, display: 'flex', alignItems: 'center',
        }}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

// ─── UrlPair ──────────────────────────────────────────────────────────────────

function UrlPair({
  urlLabel,
  urlValue,
  onUrlChange,
  secretValue,
  onSecretChange,
  show,
  onToggle,
  secretHint,
}: {
  urlLabel: string
  urlValue: string
  onUrlChange: (v: string) => void
  secretValue: string
  onSecretChange: (v: string) => void
  show: boolean
  onToggle: () => void
  secretHint?: string
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', marginBottom: 6 }}>
        {urlLabel}
      </div>
      <input
        type="url"
        value={urlValue}
        onChange={e => onUrlChange(e.target.value)}
        placeholder="https://…/webhook/…"
        style={{
          width: '100%', fontFamily: 'inherit', fontSize: 13,
          border: '1px solid var(--gray3)', borderRadius: 10, padding: '10px 14px',
          background: 'var(--bg)', color: 'var(--black)', outline: 'none',
          boxSizing: 'border-box' as const, transition: 'border-color .15s', marginBottom: 10,
        }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
        onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
      />
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', marginBottom: 6 }}>
        Segredo (opcional)
      </div>
      <SecretInput
        value={secretValue}
        onChange={onSecretChange}
        show={show}
        onToggle={onToggle}
      />
      {secretHint && (
        <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginTop: 5, lineHeight: 1.5 }}>
          {secretHint}
        </div>
      )}
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--white)', border: '1px solid var(--gray3)',
      borderRadius: 16, padding: '20px 24px', marginBottom: 16,
      boxShadow: 'var(--shadow)',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 800, color: 'var(--gray2)',
        letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 20,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CredenciaisPage() {
  const { canDispatch } = useCanDispatch()

  // full settings from GET — preserved and re-sent on PUT so campaign fields aren't zeroed
  const [fullSettings, setFullSettings]     = useState<Record<string, unknown>>({})
  const [fullStatus,   setFullStatus]       = useState<string>('draft')

  const [n8nWebhookUrl,     setN8nWebhookUrl]     = useState('')
  const [n8nWebhookSecret,  setN8nWebhookSecret]  = useState('')
  const [showWebhook,       setShowWebhook]       = useState(false)

  const [n8nDispatchUrl,    setN8nDispatchUrl]    = useState('')
  const [n8nDispatchSecret, setN8nDispatchSecret] = useState('')
  const [showDispatch,      setShowDispatch]      = useState(false)

  const [n8nEnrollUrl,      setN8nEnrollUrl]      = useState('')
  const [n8nEnrollSecret,   setN8nEnrollSecret]   = useState('')
  const [showEnroll,        setShowEnroll]        = useState(false)

  const [n8nImportUrl,      setN8nImportUrl]      = useState('')
  const [n8nImportSecret,   setN8nImportSecret]   = useState('')
  const [showImport,        setShowImport]        = useState(false)

  const [n8nBlastUrl,       setN8nBlastUrl]       = useState('')
  const [n8nBlastSecret,    setN8nBlastSecret]    = useState('')
  const [showBlast,         setShowBlast]         = useState(false)

  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [saveError,    setSaveError]    = useState<string | null>(null)

  const [dispatching,   setDispatching]   = useState(false)
  const [dispatchResult, setDispatchResult] = useState<{ ok: boolean; status?: number; error?: string } | undefined>(undefined)

  useEffect(() => {
    fetch('/api/sdr/settings')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: { configured: boolean; status: string; settings: Record<string, unknown> }) => {
        const {
          n8nWebhookUrl: wh, n8nDispatchUrl: di, n8nEnrollUrl: en,
          n8nImportUrl: im, n8nBlastUrl: bl,
          ...rest
        } = d.settings
        setFullSettings(rest)
        setFullStatus(d.status)
        setN8nWebhookUrl(typeof wh === 'string' ? wh : '')
        setN8nDispatchUrl(typeof di === 'string' ? di : '')
        setN8nEnrollUrl(typeof en === 'string' ? en : '')
        setN8nImportUrl(typeof im === 'string' ? im : '')
        setN8nBlastUrl(typeof bl === 'string' ? bl : '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      const settingsPayload: Record<string, unknown> = {
        ...fullSettings,
        n8nWebhookUrl,
        n8nDispatchUrl,
        n8nEnrollUrl,
        n8nImportUrl,
        n8nBlastUrl,
        ...(n8nWebhookSecret  ? { n8nWebhookSecret }  : {}),
        ...(n8nDispatchSecret ? { n8nDispatchSecret } : {}),
        ...(n8nEnrollSecret   ? { n8nEnrollSecret }   : {}),
        ...(n8nImportSecret   ? { n8nImportSecret }   : {}),
        ...(n8nBlastSecret    ? { n8nBlastSecret }    : {}),
      }
      const res = await fetch('/api/sdr/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsPayload, status: fullStatus }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? 'Falha ao salvar')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function dispatch() {
    setDispatching(true)
    setDispatchResult(undefined)
    try {
      const res = await fetch('/api/sdr/dispatch', { method: 'POST' })
      const data = await res.json() as { ok: boolean; status?: number; error?: string }
      setDispatchResult(data)
    } catch (e) {
      setDispatchResult({ ok: false, error: (e as Error).message })
    } finally {
      setDispatching(false)
    }
  }

  if (loading) {
    return (
      <div>
        <Link
          href="/settings?tab=integracoes"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--gray)', textDecoration: 'none', marginBottom: 20 }}
        >
          ← Voltar para Integrações
        </Link>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em', marginBottom: 24 }}>Credenciais</div>
        <div style={{ color: 'var(--gray2)', fontSize: 13 }}>Carregando…</div>
      </div>
    )
  }

  return (
    <div>
      {/* Back link */}
      <Link
        href="/settings?tab=integracoes"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 13, fontWeight: 600, color: 'var(--gray)',
          textDecoration: 'none', marginBottom: 20,
        }}
      >
        ← Voltar para Integrações
      </Link>

      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>Credenciais</div>
        <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>
          URLs e segredos de integração usados pela automação de campanha.
        </div>
      </div>

      {/* Card 1: URL de integração */}
      <div className="animate-slide-up delay-2">
        <Card title="URL de integração">
          <UrlPair
            urlLabel="URL de integração"
            urlValue={n8nWebhookUrl}
            onUrlChange={setN8nWebhookUrl}
            secretValue={n8nWebhookSecret}
            onSecretChange={setN8nWebhookSecret}
            show={showWebhook}
            onToggle={() => setShowWebhook(s => !s)}
            secretHint="Enviado como Authorization: Bearer no cabeçalho. Deixe em branco para manter o segredo já salvo."
          />
        </Card>

        {/* Card 2: URL de disparo */}
        <Card title="URL de disparo">
          <UrlPair
            urlLabel="URL de disparo"
            urlValue={n8nDispatchUrl}
            onUrlChange={setN8nDispatchUrl}
            secretValue={n8nDispatchSecret}
            onSecretChange={setN8nDispatchSecret}
            show={showDispatch}
            onToggle={() => setShowDispatch(s => !s)}
            secretHint="Deixe em branco para manter o segredo já salvo."
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' as const }}>
            {canDispatch && (
              <Button
                variant="primary"
                onClick={dispatch}
                disabled={dispatching || !n8nDispatchUrl}
              >
                {dispatching ? 'Disparando...' : 'Disparar agora'}
              </Button>
            )}

            {dispatchResult !== undefined && dispatchResult.ok && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 700,
                background: 'rgba(34,197,94,0.1)', color: 'var(--green)',
                border: '1px solid rgba(34,197,94,0.25)',
                borderRadius: 99, padding: '5px 14px',
              }}>
                Disparo acionado ✓
                {dispatchResult.status !== undefined && (
                  <span style={{ fontWeight: 500, opacity: 0.75 }}>· HTTP {dispatchResult.status}</span>
                )}
              </div>
            )}
            {dispatchResult !== undefined && !dispatchResult.ok && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 700,
                background: 'rgba(239,68,68,0.08)', color: 'var(--red)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 99, padding: '5px 14px',
              }}>
                Falha: {dispatchResult.error ?? `HTTP ${dispatchResult.status}`}
              </div>
            )}
          </div>
        </Card>

        {/* Card 3: URL de importação */}
        <Card title="URL de importação">
          <UrlPair
            urlLabel="URL de importação"
            urlValue={n8nImportUrl}
            onUrlChange={setN8nImportUrl}
            secretValue={n8nImportSecret}
            onSecretChange={setN8nImportSecret}
            show={showImport}
            onToggle={() => setShowImport(s => !s)}
            secretHint="Acionado ao importar leads via Excel. Deixe em branco para manter o segredo já salvo."
          />
        </Card>

        {/* Card 4: URL de enrollment */}
        <Card title="URL de enrollment">
          <UrlPair
            urlLabel="URL de enrollment"
            urlValue={n8nEnrollUrl}
            onUrlChange={setN8nEnrollUrl}
            secretValue={n8nEnrollSecret}
            onSecretChange={setN8nEnrollSecret}
            show={showEnroll}
            onToggle={() => setShowEnroll(s => !s)}
            secretHint="Acionado ao adicionar leads à campanha. Deixe em branco para manter o segredo já salvo."
          />
        </Card>

        {/* Card 5: URL de disparo de lista */}
        <Card title="URL de disparo de lista">
          <UrlPair
            urlLabel="URL de disparo de lista"
            urlValue={n8nBlastUrl}
            onUrlChange={setN8nBlastUrl}
            secretValue={n8nBlastSecret}
            onSecretChange={setN8nBlastSecret}
            show={showBlast}
            onToggle={() => setShowBlast(s => !s)}
            secretHint="Recebe a lista de contatos para disparo direto de template. Deixe em branco para manter o segredo já salvo."
          />
        </Card>

        {/* Save bar */}
        <div style={{ marginTop: 8, paddingBottom: 48, display: 'flex', alignItems: 'center', gap: 14 }}>
          <Button variant="primary" size="lg" onClick={save} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar credenciais'}
          </Button>

          {saved && (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
              ✓ Salvo com sucesso
            </span>
          )}
          {saveError && !saved && (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>
              ✗ {saveError}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
