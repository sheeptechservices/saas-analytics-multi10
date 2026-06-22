'use client'
import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'

interface SourceData {
  configured: boolean
  status?: string
  lastSyncStatus?: string | null
  lastSyncError?: string | null
  apiKeyMasked?: string | null
  fromPhone?: string | null
  webhookUrl?: string | null
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function SpinIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="2"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <path d="M1 4v5h5M15 12v-5h-5" />
      <path d="M13.4 7A6 6 0 1 0 12 12.3" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckSmIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="var(--green)" strokeWidth="2">
      <path d="M2 6l3 3 5-5" />
    </svg>
  )
}

function XSmIcon({ color = '#b02619' }: { color?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="2">
      <path d="M2 2l8 8M10 2L2 10" />
    </svg>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 44px 10px 14px',
  fontFamily: 'monospace',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--black)',
  background: 'var(--white)',
  border: '1px solid var(--gray3)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  boxSizing: 'border-box',
}

const plainInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--black)',
  background: 'var(--white)',
  border: '1px solid var(--gray3)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  boxSizing: 'border-box',
}

function PlainField({
  label,
  value,
  onChange,
  placeholder,
  helper,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  helper?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em' }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={plainInputStyle}
        onFocus={e => {
          e.target.style.borderColor = 'var(--primary)'
          e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)'
        }}
        onBlur={e => {
          e.target.style.borderColor = 'var(--gray3)'
          e.target.style.boxShadow = 'none'
        }}
      />
      {helper && (
        <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, lineHeight: 1.5 }}>
          {helper}
        </div>
      )}
    </div>
  )
}

function SecretField({
  label,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggle: () => void
  placeholder?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em' }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
          onFocus={e => {
            e.target.style.borderColor = 'var(--primary)'
            e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)'
          }}
          onBlur={e => {
            e.target.style.borderColor = 'var(--gray3)'
            e.target.style.boxShadow = 'none'
          }}
        />
        <button
          type="button"
          onClick={onToggle}
          style={{
            position: 'absolute', right: 12, top: '50%',
            transform: 'translateY(-50%)', background: 'none',
            border: 'none', cursor: 'pointer', color: 'var(--gray2)', padding: 2,
          }}
        >
          <EyeIcon open={show} />
        </button>
      </div>
    </div>
  )
}

export default function YCloudPage() {
  const [sourceData, setSourceData] = useState<SourceData | null>(null)
  const [loading, setLoading] = useState(true)

  const [apiKey, setApiKey] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [fromPhone, setFromPhone] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Webhook URL returned after a successful save — takes priority over sourceData.webhookUrl
  const [savedWebhookUrl, setSavedWebhookUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchStatus = useCallback(() => {
    return fetch('/api/ycloud/source')
      .then(r => r.json())
      .then((d: SourceData) => setSourceData(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchStatus().finally(() => setLoading(false))
  }, [fetchStatus])

  // Pre-fill fromPhone from API (not a secret — returned in plain text).
  // Runs on initial load and after a successful save so the field stays in sync.
  useEffect(() => {
    if (sourceData?.fromPhone) setFromPhone(sourceData.fromPhone)
  }, [sourceData])

  async function testConnection() {
    if (!apiKey || !webhookSecret) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/ycloud/source/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, webhookSecret }),
      })
      const data = await res.json()
      setTestResult(data)
    } catch {
      setTestResult({ valid: false, error: 'Falha na conexão com o servidor' })
    } finally {
      setTesting(false)
    }
  }

  async function saveSource() {
    if (!apiKey || !webhookSecret || !fromPhone) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/ycloud/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, webhookSecret, fromPhone }),
      })
      const data = await res.json()
      if (!data.ok) {
        setSaveError(data.error ?? 'Erro ao salvar')
        return
      }
      setSavedWebhookUrl(data.webhookUrl ?? null)
      setApiKey('')
      setWebhookSecret('')
      setTestResult(null)
      await fetchStatus()
    } catch {
      setSaveError('Erro de rede ao salvar')
    } finally {
      setSaving(false)
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  if (loading) return null

  const canTest = apiKey.trim().length > 0 && webhookSecret.trim().length > 0 && !testing && !saving
  const canSave = apiKey.trim().length > 0 && webhookSecret.trim().length > 0 && fromPhone.trim().length > 0 && !saving
  const displayUrl = savedWebhookUrl ?? sourceData?.webhookUrl

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
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>
          YCloud (WhatsApp)
        </div>
        <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>
          Receba mensagens WhatsApp via webhook e sincronize conversas automaticamente no painel
        </div>
      </div>

      {/* Status card — only when configured */}
      {sourceData?.configured && (
        <div
          className="animate-slide-up delay-2"
          style={{
            background: 'var(--white)', border: '1px solid var(--gray3)',
            borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 16,
            boxShadow: 'var(--shadow)',
          }}
        >
          <div style={{
            fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--gray2)',
            paddingBottom: 12, borderBottom: '1px solid var(--gray3)', marginBottom: 14,
          }}>
            Status da integração
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: displayUrl ? 14 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
              Conectado
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {sourceData.apiKeyMasked && (
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray2)', fontFamily: 'monospace' }}>
                  API Key: {sourceData.apiKeyMasked}
                </span>
              )}
              {sourceData.fromPhone && (
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray2)', fontFamily: 'monospace' }}>
                  Remetente: {sourceData.fromPhone}
                </span>
              )}
            </div>
          </div>

          {/* Webhook URL in status card */}
          {displayUrl && !savedWebhookUrl && (
            <WebhookUrlBox url={displayUrl} copied={copied} onCopy={copyUrl} />
          )}
        </div>
      )}

      {/* Success panel — shown after a save */}
      {savedWebhookUrl && (
        <div
          className="animate-slide-up delay-2"
          style={{
            background: 'rgba(30,138,62,0.04)',
            border: '1px solid rgba(30,138,62,0.25)',
            borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 16,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, fontWeight: 700, color: '#145c2a', marginBottom: 14,
          }}>
            <CheckSmIcon />
            Integração salva com sucesso!
          </div>

          <div style={{ fontSize: 13, color: '#145c2a', fontWeight: 500, marginBottom: 12, lineHeight: 1.6 }}>
            Cole a URL abaixo no painel do YCloud em{' '}
            <strong>Console → Webhooks</strong> e selecione os eventos{' '}
            <code style={{ fontSize: 12, background: 'rgba(30,138,62,0.1)', padding: '1px 5px', borderRadius: 4 }}>
              whatsapp.inbound_message.received
            </code>{' '}
            e{' '}
            <code style={{ fontSize: 12, background: 'rgba(30,138,62,0.1)', padding: '1px 5px', borderRadius: 4 }}>
              whatsapp.message.updated
            </code>.
          </div>

          <WebhookUrlBox url={savedWebhookUrl} copied={copied} onCopy={copyUrl} />
        </div>
      )}

      {/* Config card */}
      <div
        className="animate-slide-up delay-3"
        style={{
          background: 'var(--white)', border: '1px solid var(--gray3)',
          borderRadius: 'var(--radius-lg)', padding: 24, boxShadow: 'var(--shadow)',
        }}
      >
        <div style={{
          fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--gray2)',
          paddingBottom: 14, borderBottom: '1px solid var(--gray3)', marginBottom: 20,
        }}>
          {sourceData?.configured ? 'Atualizar credenciais' : 'Configurar integração'}
        </div>

        {/* Existing key hint */}
        {sourceData?.configured && sourceData.apiKeyMasked && (
          <div style={{
            padding: '10px 14px', background: 'var(--bg)',
            border: '1px solid var(--gray3)', borderRadius: 'var(--radius-sm)',
            marginBottom: 16, fontSize: 13, fontWeight: 600, color: 'var(--gray)',
          }}>
            API Key atual:{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--black)' }}>
              {sourceData.apiKeyMasked}
            </span>
            {' '}— insira novas credenciais para alterar
          </div>
        )}

        <SecretField
          label="API KEY DO YCLOUD"
          value={apiKey}
          onChange={v => { setApiKey(v); setTestResult(null); setSaveError(null) }}
          show={showApiKey}
          onToggle={() => setShowApiKey(v => !v)}
          placeholder="sua-api-key-do-ycloud"
        />

        <SecretField
          label="SEGREDO DO WEBHOOK (WEBHOOK SECRET)"
          value={webhookSecret}
          onChange={v => { setWebhookSecret(v); setTestResult(null); setSaveError(null) }}
          show={showSecret}
          onToggle={() => setShowSecret(v => !v)}
          placeholder="segredo-gerado-no-ycloud"
        />

        <PlainField
          label="NÚMERO REMETENTE (WHATSAPP)"
          value={fromPhone}
          onChange={v => { setFromPhone(v); setSaveError(null) }}
          placeholder="+5511999999999"
          helper="Número do WhatsApp Business usado como remetente, em formato internacional (E.164)."
        />

        <div style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500, marginTop: -12, marginBottom: 20 }}>
          API Key e Webhook Secret são armazenados criptografados (AES-256-GCM).
        </div>

        {/* Test result badge */}
        {testResult && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 'var(--radius-sm)',
            fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
            background: testResult.valid ? 'rgba(30,138,62,0.06)' : 'rgba(217,48,37,0.06)',
            border: `1px solid ${testResult.valid ? 'rgba(30,138,62,0.25)' : 'rgba(217,48,37,0.2)'}`,
            color: testResult.valid ? '#145c2a' : '#b02619',
          }}>
            {testResult.valid ? (
              <><CheckSmIcon />API Key válida — conexão bem-sucedida</>
            ) : (
              <><XSmIcon />{testResult.error ?? 'Falha na conexão'}</>
            )}
          </div>
        )}

        {/* Save error */}
        {saveError && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 'var(--radius-sm)',
            fontSize: 13, fontWeight: 600, color: '#b02619',
            background: 'rgba(217,48,37,0.06)', border: '1px solid rgba(217,48,37,0.2)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <XSmIcon />{saveError}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={testConnection}
            disabled={!canTest}
            style={{
              padding: '10px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              background: 'var(--bg)', border: '1px solid var(--gray3)',
              borderRadius: 'var(--radius-pill)', cursor: canTest ? 'pointer' : 'not-allowed',
              color: 'var(--black)', opacity: !canTest ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            {testing && <SpinIcon />}
            {testing ? 'Testando…' : 'Testar conexão'}
          </button>

          <button
            type="button"
            onClick={saveSource}
            disabled={!canSave}
            style={{
              padding: '10px 22px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              background: 'var(--primary)', border: 'none',
              borderRadius: 'var(--radius-pill)', cursor: canSave ? 'pointer' : 'not-allowed',
              color: 'var(--primary-contrast)', opacity: !canSave ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            {saving && <SpinIcon />}
            {saving ? 'Salvando…' : 'Salvar e conectar'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg) }
          to   { transform: rotate(360deg) }
        }
      `}</style>
    </div>
  )
}

// ─── Reusable webhook URL display ─────────────────────────────────────────────

function WebhookUrlBox({ url, copied, onCopy }: { url: string; copied: boolean; onCopy: (u: string) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--bg)', border: '1px solid var(--gray3)',
      borderRadius: 'var(--radius-sm)', padding: '10px 14px',
    }}>
      <span style={{
        flex: 1, fontFamily: 'monospace', fontSize: 12, fontWeight: 600,
        color: 'var(--black)', wordBreak: 'break-all',
      }}>
        {url}
      </span>
      <button
        type="button"
        onClick={() => onCopy(url)}
        title="Copiar URL"
        style={{
          flexShrink: 0, padding: '6px 12px',
          fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
          background: copied ? 'rgba(30,138,62,0.08)' : 'var(--white)',
          border: `1px solid ${copied ? 'rgba(30,138,62,0.3)' : 'var(--gray3)'}`,
          borderRadius: 'var(--radius-sm)',
          color: copied ? '#145c2a' : 'var(--gray)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
          transition: 'all .15s',
        }}
      >
        {copied ? <CheckSmIcon /> : <CopyIcon />}
        {copied ? 'Copiado!' : 'Copiar'}
      </button>
    </div>
  )
}
