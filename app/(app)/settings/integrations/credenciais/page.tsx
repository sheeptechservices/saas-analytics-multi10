'use client'
import { useCallback, useState, useEffect } from 'react'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useCanDispatch } from '@/lib/hooks/useCanDispatch'
import { ApiErrorState } from '@/components/ApiErrorState'
import { fetchJson, textoDeLeituraPerdida } from '@/lib/api-error'

// As URLs de n8n que esta tela edita. A rota trata cada par URL/segredo
// separadamente: URL ausente no PUT mantém a guardada, URL diferente derruba o
// segredo dela. Ver lib/sdr/settings-merge.
//
// Eram cinco. As do write-back da configuração, da importação de leads e da
// inscrição na campanha saíram da tela quando a app passou a escrever direto na base
// do cliente: nenhuma rota as lê mais, e um campo que não aciona nada só convida a
// preencher. O que já está guardado NÃO foi apagado — ver CHAVES_APOSENTADAS em
// lib/sdr/settings-merge.
const URL_KEYS = ['n8nDispatchUrl', 'n8nBlastUrl'] as const
type UrlKey = typeof URL_KEYS[number]

/* O que o PUT conta da SEGUNDA gravação, a da `campaign_config` na base do cliente
 * (o mesmo `configCampanha` que a tela de Parâmetros lê como `n8nDelivery`).
 *
 * Esta tela lia só o `version` e jogava o resto fora: um save cuja credencial da
 * fonte não abriu saía com "✓ Salvo com sucesso" e nada mais — e é justamente aqui,
 * em Integrações, que essa credencial é cadastrada. `null` é "não há fonte", que
 * não é falha deste save; o que aparece é o `ok: false`. */
type ConfigCampanha =
  | { ok: true;  semMudanca?: true; ativo?: boolean | null }
  | { ok: false; error: string; credencialIlegivel?: true }
  | null

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

  const [n8nDispatchUrl,    setN8nDispatchUrl]    = useState('')
  const [n8nDispatchSecret, setN8nDispatchSecret] = useState('')
  const [showDispatch,      setShowDispatch]      = useState(false)

  const [n8nBlastUrl,       setN8nBlastUrl]       = useState('')
  const [n8nBlastSecret,    setN8nBlastSecret]    = useState('')
  const [showBlast,         setShowBlast]         = useState(false)

  const [secretsSet,   setSecretsSet]   = useState<Record<string, boolean>>({})

  const [loading,      setLoading]      = useState(true)
  const [loaded,       setLoaded]       = useState(false)
  // O erro inteiro, e não a frase pronta: o aviso de "nada pode ser salvo" é o
  // mesmo em toda falha (é ele que trava o Salvar), mas a causa — 403 do plano,
  // 500 do servidor, queda de rede — precisa aparecer. Ver textoDeLeituraPerdida.
  const [loadError,    setLoadError]    = useState<unknown>(null)
  const [loadedUrlKeys, setLoadedUrlKeys] = useState<string[]>([])
  const [version,      setVersion]      = useState<number | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [saveError,    setSaveError]    = useState<string | null>(null)
  const [configCampanha, setConfigCampanha] = useState<ConfigCampanha | undefined>(undefined)

  const [dispatching,   setDispatching]   = useState(false)
  const [dispatchResult, setDispatchResult] = useState<{ ok: boolean; status?: number; error?: string } | undefined>(undefined)

  // Um GET que falha em silêncio é destrutivo nesta tela: sem as URLs carregadas
  // o save seguinte mandaria as cinco vazias, e a rota trata URL vazia como URL
  // trocada — derrubando junto os segredos, que o GET nunca devolve e ninguém
  // consegue recuperar pela interface. Mesmo defeito da Campanha SDR (issue #94).
  const loadSettings = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    fetchJson<{ configured: boolean; status: string; version?: number; settings: Record<string, unknown>; secretsSet?: Record<string, boolean> }>('/api/sdr/settings')
      .then(d => {
        // As URLs aposentadas seguem no `rest` e voltam intactas no PUT: a tela não
        // as edita mais, e apagá-las daqui seria apagá-las do banco.
        const { n8nDispatchUrl: di, n8nBlastUrl: bl, ...rest } = d.settings
        setFullSettings(rest)
        setFullStatus(d.status)
        setSecretsSet(d.secretsSet ?? {})
        setVersion(typeof d.version === 'number' ? d.version : null)
        setLoadedUrlKeys(URL_KEYS.filter(k => typeof d.settings[k] === 'string'))
        setN8nDispatchUrl(typeof di === 'string' ? di : '')
        setN8nBlastUrl(typeof bl === 'string' ? bl : '')
        setLoaded(true)
      })
      .catch((e: unknown) => {
        // QUALQUER falha — 403, 500, rede — derruba `loaded` e `loadedUrlKeys`.
        // São esses dois que desligam o Salvar e tiram as URLs não lidas do PUT
        // (ver save()); distinguir o status muda só o texto, nunca a trava.
        setLoaded(false)
        setLoadedUrlKeys([])
        setLoadError(e)
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
    setConfigCampanha(undefined)
    try {
      const campos: Record<UrlKey, string> = { n8nDispatchUrl, n8nBlastUrl }
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
        ...(n8nDispatchSecret ? { n8nDispatchSecret } : {}),
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
      // A resposta traz DUAS verdades: o save das settings (que chegou até aqui) e o
      // da `campaign_config` na base do cliente. Ficar só com o `version` era perder
      // a segunda — ver ConfigCampanha, no topo.
      const ok = await res.json().catch(() => ({})) as { version?: number; configCampanha?: ConfigCampanha }
      if (typeof ok.version === 'number') setVersion(ok.version)
      setConfigCampanha(ok.configCampanha)
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
      {loadError != null && (
        <ApiErrorState
          className="mb-4"
          compacto
          texto={textoDeLeituraPerdida(loadError, 'as URLs e os segredos já configurados')}
          onRetry={loadSettings}
        />
      )}

      {/* Card 1: URL de disparo */}
      <div className="animate-slide-up delay-2">
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

        {/* Card 2: URL de disparo de lista */}
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

        {/* As credenciais foram salvas; a configuração da campanha não chegou à base
            do cliente. Fica FORA da barra do Salvar de propósito: o "✓ Salvo" apaga
            sozinho em 3 s e este aviso não pode ir junto com ele. Sem estilo em
            linha — as classes são as mesmas que o ApiErrorState usa. */}
        {configCampanha && !configCampanha.ok && (
          <div
            role="alert"
            className="max-lg:wrap-anywhere mb-4 rounded-(--radius-md) border border-(--warn-mid) bg-(--warn-dim) p-4 text-13 font-medium text-(--warn-text)"
          >
            <span className="font-bold">Credenciais salvas, campanha não publicada.</span>{' '}
            {configCampanha.error}
          </div>
        )}

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
