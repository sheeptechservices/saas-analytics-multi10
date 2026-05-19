'use client'
import { useState, useEffect } from 'react'

// ─── Config ───────────────────────────────────────────────────────────────────

export type AdProvider = 'google_ads' | 'meta_ads' | 'tiktok_ads'

interface AdField { key: string; label: string; placeholder: string; secret: boolean }

interface AdProviderConfig {
  title: string
  description: string
  color: string
  icon: React.ReactNode
  fields: AdField[]
}

const AD_CONFIG: Record<AdProvider, AdProviderConfig> = {
  google_ads: {
    title: 'Google Ads',
    description: 'Sincronize campanhas, conjuntos de anúncios e métricas diárias do Google Ads.',
    color: '#4285F4',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    ),
    fields: [
      { key: 'accountId',     label: 'Customer ID',     placeholder: '123-456-7890',                          secret: false },
      { key: 'clientId',      label: 'Client ID',        placeholder: 'Ex: 12345.apps.googleusercontent.com',  secret: false },
      { key: 'accountDomain', label: 'Developer Token',  placeholder: 'Ex: AB12cDEFGhijk34…',                  secret: true  },
      { key: 'clientSecret',  label: 'Client Secret',    placeholder: 'Ex: GOCSPX-…',                          secret: true  },
      { key: 'refreshToken',  label: 'Refresh Token',    placeholder: 'Ex: 1//04…',                            secret: true  },
    ],
  },
  meta_ads: {
    title: 'Meta Ads',
    description: 'Sincronize campanhas e insights do Facebook e Instagram Ads automaticamente.',
    color: '#1877F2',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="#1877F2">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
    ),
    fields: [
      { key: 'accountId',    label: 'Ad Account ID', placeholder: 'act_123456789', secret: false },
      { key: 'clientId',     label: 'App ID',         placeholder: 'Ex: 987654321', secret: false },
      { key: 'clientSecret', label: 'App Secret',     placeholder: 'Ex: abc123…',   secret: true  },
      { key: 'accessToken',  label: 'Access Token',   placeholder: 'Ex: EAABs…',    secret: true  },
    ],
  },
  tiktok_ads: {
    title: 'TikTok Ads',
    description: 'Sincronize campanhas e métricas de performance do TikTok for Business.',
    color: '#010101',
    icon: (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.88a8.28 8.28 0 0 0 4.83 1.56V7a4.85 4.85 0 0 1-1.06-.31z"/>
      </svg>
    ),
    fields: [
      { key: 'accountId',    label: 'Advertiser ID', placeholder: 'Ex: 7123456789', secret: false },
      { key: 'clientId',     label: 'App ID',         placeholder: 'Ex: abc1234…',   secret: false },
      { key: 'clientSecret', label: 'App Secret',     placeholder: 'Ex: xyz987…',    secret: true  },
      { key: 'accessToken',  label: 'Access Token',   placeholder: 'Ex: xxxxxxxx…',  secret: true  },
    ],
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdProviderPage({ provider }: { provider: AdProvider }) {
  const config = AD_CONFIG[provider]

  const [status, setStatus] = useState<{ accountId: string | null; clientId: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    fetch(`/api/ads/${provider}`)
      .then(r => r.ok ? r.json() : null)
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false))
  }, [provider])

  async function handleSave() {
    const body: Record<string, string> = {}
    for (const [k, v] of Object.entries(formValues)) {
      if (v.trim()) body[k] = v.trim()
    }
    if (Object.keys(body).length === 0) {
      setMsg({ text: 'Preencha pelo menos um campo para salvar.', ok: false })
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/ads/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setMsg({ text: data.error ?? 'Erro ao salvar', ok: false }); return }
      setStatus(data.integration)
      setFormValues({})
      setMsg({ text: 'Credenciais salvas com sucesso. A sincronização será iniciada em background.', ok: true })
    } catch {
      setMsg({ text: 'Erro de conexão', ok: false })
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!confirm(`Remover integração com ${config.title}? Todos os dados sincronizados serão apagados.`)) return
    setRemoving(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/ads/${provider}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        setMsg({ text: data.error ?? 'Erro ao remover', ok: false })
        return
      }
      setStatus(null)
      setFormValues({})
      setMsg({ text: 'Integração removida.', ok: true })
    } catch {
      setMsg({ text: 'Erro de conexão', ok: false })
    } finally {
      setRemoving(false)
    }
  }

  const isConnected = !!status?.accountId

  if (loading) return null

  return (
    <div>
      {/* ── Header ── */}
      <div className="animate-slide-up delay-1" style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, border: '1px solid var(--gray3)',
            background: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--shadow)', flexShrink: 0,
          }}>
            {config.icon}
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>
              {config.title}
            </div>
            <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>{config.description}</div>
          </div>
        </div>

        {/* Status badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 100,
            background: isConnected ? 'rgba(30,138,62,0.08)' : 'rgba(0,0,0,0.04)',
            border: `1px solid ${isConnected ? 'rgba(30,138,62,0.25)' : 'var(--gray3)'}`,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: isConnected ? 'var(--green)' : 'var(--gray3)',
            }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: isConnected ? 'var(--green)' : 'var(--gray2)' }}>
              {isConnected ? 'Conectado' : 'Não conectado'}
            </span>
            {isConnected && status?.accountId && (
              <span style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500 }}>· {status.accountId}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Credentials form ── */}
      <div className="animate-slide-up delay-2" style={{
        background: 'var(--white)', border: '1px solid var(--gray3)',
        borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)', marginBottom: 16,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--gray2)',
          paddingBottom: 14, borderBottom: '1px solid var(--gray3)', marginBottom: 20,
        }}>
          {isConnected ? 'Atualizar credenciais' : 'Configurar credenciais'}
        </div>

        {isConnected && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 20, fontSize: 12, fontWeight: 600,
            background: 'rgba(30,138,62,0.06)', border: '1px solid rgba(30,138,62,0.2)',
            color: '#145c2a',
          }}>
            Integração ativa. Deixe os campos secretos em branco para manter as credenciais atuais.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          {config.fields.map(field => (
            <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--gray)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {field.label}
              </label>
              <input
                type={field.secret ? 'password' : 'text'}
                value={formValues[field.key] ?? ''}
                onChange={e => setFormValues(v => ({ ...v, [field.key]: e.target.value }))}
                placeholder={isConnected && field.secret ? '••••••••' : field.placeholder}
                autoComplete={field.secret ? 'new-password' : 'off'}
                style={{
                  padding: '10px 14px', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                  color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)',
                  borderRadius: 8, outline: 'none', width: '100%', boxSizing: 'border-box',
                }}
                onFocus={e => { e.target.style.borderColor = `${config.color}80`; e.target.style.boxShadow = `0 0 0 3px ${config.color}18` }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>
          ))}
        </div>

        {msg && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 20, fontSize: 12, fontWeight: 600,
            background: msg.ok ? 'rgba(30,138,62,0.06)' : 'rgba(217,48,37,0.06)',
            border: `1px solid ${msg.ok ? 'rgba(30,138,62,0.2)' : 'rgba(217,48,37,0.2)'}`,
            color: msg.ok ? '#145c2a' : '#b02619',
          }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {isConnected ? (
            <button
              onClick={handleRemove}
              disabled={removing}
              style={{
                padding: '9px 18px', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                background: 'rgba(217,48,37,0.06)', border: '1px solid rgba(217,48,37,0.2)',
                borderRadius: 100, cursor: removing ? 'not-allowed' : 'pointer',
                color: 'var(--red)', opacity: removing ? 0.6 : 1,
              }}
            >
              {removing ? 'Removendo…' : 'Remover integração'}
            </button>
          ) : <div />}

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '11px 28px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              background: config.color, border: 'none', borderRadius: 100,
              cursor: saving ? 'not-allowed' : 'pointer',
              color: '#fff', opacity: saving ? 0.7 : 1,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            {saving ? (
              <>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M1 4v5h5M15 12v-5h-5"/><path d="M13.4 7A6 6 0 1 0 12 12.3"/>
                </svg>
                Salvando…
              </>
            ) : 'Salvar credenciais'}
          </button>
        </div>
      </div>

      {/* ── Info card ── */}
      <div className="animate-slide-up delay-3" style={{
        background: 'var(--white)', border: '1px solid var(--gray3)',
        borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--black)', marginBottom: 14 }}>O que é sincronizado?</div>
        {[
          ['Campanhas', 'Nome, status, objetivo e orçamento de todas as campanhas ativas'],
          ['Conjuntos de anúncios', 'Grupos de anúncios com status e orçamento diário'],
          ['Anúncios', 'Criativos individuais com status e tipo'],
          ['Insights diários', 'Impressões, cliques, gasto, CTR, CPC, CPM, ROAS e conversões por dia'],
        ].map(([t, d]) => (
          <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 20, height: 20, borderRadius: 100,
              background: `${config.color}18`,
              border: `1px solid ${config.color}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, marginTop: 1,
            }}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={config.color} strokeWidth="2">
                <path d="M2 6l3 3 5-5"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{t}</div>
              <div style={{ fontSize: 12, color: 'var(--gray)', fontWeight: 500 }}>{d}</div>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 4, padding: '10px 14px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--gray3)', fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>
          A sincronização ocorre automaticamente 1x/dia via cron. Os dados históricos são importados no primeiro sync (até 2 anos).
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
