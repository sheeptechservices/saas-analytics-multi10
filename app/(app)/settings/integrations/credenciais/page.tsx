'use client'
import { useCallback, useState, useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useCanDispatch } from '@/lib/hooks/useCanDispatch'

// As cinco URLs de n8n que esta tela edita. A rota trata cada par URL/segredo
// separadamente: URL ausente no PUT mantém a guardada, URL diferente derruba o
// segredo dela. Ver lib/sdr/settings-merge.
const URL_KEYS = ['n8nWebhookUrl', 'n8nDispatchUrl', 'n8nEnrollUrl', 'n8nImportUrl', 'n8nBlastUrl'] as const
type UrlKey = typeof URL_KEYS[number]

// ─── SecretInput ──────────────────────────────────────────────────────────────

function SecretInput({
  value,
  onChange,
  show,
  onToggle,
  isSet,
}: {
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggle: () => void
  isSet?: boolean
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={isSet && !value ? '•••• deixe em branco para manter' : '••••••••'}
        autoComplete="new-password"
        style={{
          width: '100%', fontFamily: 'inherit', fontSize: 13,
          border: '1px solid var(--gray3)', borderRadius: 'var(--radius-md)',
          padding: '10px 42px 10px 14px',
          background: 'var(--bg)', color: 'var(--black)', outline: 'none',
          boxSizing: 'border-box' as const, transition: 'border-color .15s',
        }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
        onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
      />
      {/* The eye is ~23px: on phones an invisible 40×40 band (::before), centred
          on it, makes it tappable without moving it or the field's text */}
      <button
        type="button"
        onClick={onToggle}
        title={show ? 'Ocultar' : 'Mostrar'}
        className="max-md:before:absolute max-md:before:top-1/2 max-md:before:left-1/2 max-md:before:size-10 max-md:before:-translate-x-1/2 max-md:before:-translate-y-1/2"
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
  isSecretSet,
}: {
  urlLabel: string
  urlValue: string
  onUrlChange: (v: string) => void
  secretValue: string
  onSecretChange: (v: string) => void
  show: boolean
  onToggle: () => void
  secretHint?: string
  isSecretSet?: boolean
}) {
  const showBadge = !!isSecretSet && !secretValue
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
          border: '1px solid var(--gray3)', borderRadius: 'var(--radius-md)', padding: '10px 14px',
          background: 'var(--bg)', color: 'var(--black)', outline: 'none',
          boxSizing: 'border-box' as const, transition: 'border-color .15s', marginBottom: 10,
        }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
        onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)' }}>
          Segredo (opcional)
        </div>
        {showBadge && (
          <span style={{
            fontSize: 10, fontWeight: 800, color: 'var(--green)',
            background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
            borderRadius: 'var(--radius-pill)', padding: '1px 8px', letterSpacing: '0.03em',
          }}>
            configurado ✓
          </span>
        )}
      </div>
      <SecretInput
        value={secretValue}
        onChange={onSecretChange}
        show={show}
        onToggle={onToggle}
        isSet={isSecretSet}
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
      borderRadius: 'var(--radius-lg)', padding: '20px 24px', marginBottom: 16,
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

  const [secretsSet,   setSecretsSet]   = useState<Record<string, boolean>>({})

  const [loading,      setLoading]      = useState(true)
  const [loaded,       setLoaded]       = useState(false)
  const [loadError,    setLoadError]    = useState<string | null>(null)
  const [loadedUrlKeys, setLoadedUrlKeys] = useState<string[]>([])
  const [version,      setVersion]      = useState<number | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [saveError,    setSaveError]    = useState<string | null>(null)

  const [dispatching,   setDispatching]   = useState(false)
  const [dispatchResult, setDispatchResult] = useState<{ ok: boolean; status?: number; error?: string } | undefined>(undefined)

  // Um GET que falha em silêncio é destrutivo nesta tela: sem as URLs carregadas
  // o save seguinte mandaria as cinco vazias, e a rota trata URL vazia como URL
  // trocada — derrubando junto os segredos, que o GET nunca devolve e ninguém
  // consegue recuperar pela interface. Mesmo defeito da Campanha SDR (issue #94).
  const loadSettings = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    fetch('/api/sdr/settings')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: { configured: boolean; status: string; version?: number; settings: Record<string, unknown>; secretsSet?: Record<string, boolean> }) => {
        const {
          n8nWebhookUrl: wh, n8nDispatchUrl: di, n8nEnrollUrl: en,
          n8nImportUrl: im, n8nBlastUrl: bl,
          ...rest
        } = d.settings
        setFullSettings(rest)
        setFullStatus(d.status)
        setSecretsSet(d.secretsSet ?? {})
        setVersion(typeof d.version === 'number' ? d.version : null)
        setLoadedUrlKeys(URL_KEYS.filter(k => typeof d.settings[k] === 'string'))
        setN8nWebhookUrl(typeof wh === 'string' ? wh : '')
        setN8nDispatchUrl(typeof di === 'string' ? di : '')
        setN8nEnrollUrl(typeof en === 'string' ? en : '')
        setN8nImportUrl(typeof im === 'string' ? im : '')
        setN8nBlastUrl(typeof bl === 'string' ? bl : '')
        setLoaded(true)
      })
      .catch(() => {
        setLoaded(false)
        setLoadedUrlKeys([])
        setLoadError('Não foi possível carregar as credenciais. Nada pode ser salvo até a leitura dar certo — salvar agora apagaria as URLs e os segredos já configurados.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadSettings() }, [loadSettings])

  async function save() {
    // Sem leitura bem-sucedida não há o que preservar — ver loadSettings.
    if (!loaded) return
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      const campos: Record<UrlKey, string> = {
        n8nWebhookUrl, n8nDispatchUrl, n8nEnrollUrl, n8nImportUrl, n8nBlastUrl,
      }
      // Defesa em profundidade: URL que nunca veio do GET e segue vazia fica de
      // fora do PUT, e a rota mantém a guardada em vez de apagá-la (e o segredo
      // dela junto). Campo carregado vai sempre, inclusive vazio — é assim que
      // apagar uma URL de propósito continua funcionando.
      const urls: Record<string, string> = {}
      for (const k of URL_KEYS) {
        if (campos[k] || loadedUrlKeys.includes(k)) urls[k] = campos[k]
      }
      const settingsPayload: Record<string, unknown> = {
        ...fullSettings,
        ...urls,
        ...(n8nWebhookSecret  ? { n8nWebhookSecret }  : {}),
        ...(n8nDispatchSecret ? { n8nDispatchSecret } : {}),
        ...(n8nEnrollSecret   ? { n8nEnrollSecret }   : {}),
        ...(n8nImportSecret   ? { n8nImportSecret }   : {}),
        ...(n8nBlastSecret    ? { n8nBlastSecret }    : {}),
      }
      const res = await fetch('/api/sdr/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: settingsPayload,
          status: fullStatus,
          // Trava otimista: 409 se alguém salvou entre o GET e este PUT.
          ...(version !== null ? { version } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string; message?: string }
        // No conflito a tela recarrega sozinha para mostrar o que está valendo;
        // a mensagem vem da própria rota, para os dois textos não divergirem.
        if (res.status === 409) loadSettings()
        throw new Error(data.message ?? data.error ?? 'Falha ao salvar')
      }
      const ok = await res.json().catch(() => ({})) as { version?: number }
      if (typeof ok.version === 'number') setVersion(ok.version)
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
          className="max-md:min-h-10"
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
      {/* Back link — 40px tall on phones */}
      <Link
        href="/settings?tab=integracoes"
        className="max-md:min-h-10"
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

      {/* Falha ao carregar — sem estilo em linha: classes do design system */}
      {loadError && (
        <div className="mb-4 flex flex-wrap items-start gap-3 rounded-(--radius-md) border border-(--danger-mid) bg-(--danger-dim) p-4">
          {/* No celular a mensagem ocupa a linha inteira e o botão desce */}
          <div className="max-md:basis-full flex flex-1 items-start gap-3">
            <AlertTriangle size={14} className="shrink-0 text-(--danger-text)" />
            <div className="max-lg:wrap-anywhere text-13 font-medium text-(--danger-text)">
              {loadError}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={loadSettings}>
            <RefreshCw size={13} /> Tentar novamente
          </Button>
        </div>
      )}

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
            isSecretSet={!!secretsSet.n8nWebhookSecret}
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
            isSecretSet={!!secretsSet.n8nDispatchSecret}
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
                borderRadius: 'var(--radius-pill)', padding: '5px 14px',
              }}>
                Disparo acionado ✓
                {dispatchResult.status !== undefined && (
                  <span style={{ fontWeight: 500, opacity: 0.75 }}>· HTTP {dispatchResult.status}</span>
                )}
              </div>
            )}
            {dispatchResult !== undefined && !dispatchResult.ok && (
              <div className="max-lg:wrap-anywhere" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 700,
                background: 'rgba(239,68,68,0.08)', color: 'var(--red)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 'var(--radius-pill)', padding: '5px 14px',
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
            isSecretSet={!!secretsSet.n8nImportSecret}
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
            isSecretSet={!!secretsSet.n8nEnrollSecret}
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
            isSecretSet={!!secretsSet.n8nBlastSecret}
            secretHint="Recebe a lista de contatos para disparo direto de template. Deixe em branco para manter o segredo já salvo."
          />
        </Card>

        {/* Save bar — on phones the result message drops below the button */}
        <div className="max-md:flex-wrap" style={{ marginTop: 8, paddingBottom: 48, display: 'flex', alignItems: 'center', gap: 14 }}>
          <Button variant="primary" size="lg" onClick={save} disabled={saving || !loaded}>
            {saving ? 'Salvando...' : 'Salvar credenciais'}
          </Button>

          {saved && (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
              ✓ Salvo com sucesso
            </span>
          )}
          {saveError && !saved && (
            <span className="max-lg:wrap-anywhere" style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>
              ✗ {saveError}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
