'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ExternalLink, Eye, EyeOff } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tom    = 'formal' | 'consultivo' | 'direto'
type Status = 'draft' | 'active' | 'paused'
type N8nDelivery = { ok: boolean; status?: number; error?: string } | null

interface Settings {
  tom:            Tom
  objetivo:       string
  delay:          number
  limiteDiario:   number
  horario:        { inicio: string; fim: string }
  diasAtivos:     number[]
  templates:      string[]
  n8nWebhookUrl?: string  // returned by GET; extracted to separate state on load
}

interface ApiData {
  configured: boolean
  status:     Status
  version:    number
  settings:   Settings
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULTS: Settings = {
  tom:          'consultivo',
  objetivo:     '',
  delay:        24,
  limiteDiario: 100,
  horario:      { inicio: '08:00', fim: '18:00' },
  diasAtivos:   [1, 2, 3, 4, 5],
  templates:    [''],
}

const DIAS = [
  { num: 1, label: 'Seg' }, { num: 2, label: 'Ter' },
  { num: 3, label: 'Qua' }, { num: 4, label: 'Qui' },
  { num: 5, label: 'Sex' }, { num: 6, label: 'Sáb' },
  { num: 0, label: 'Dom' },
]

const TOM_DESC: Record<Tom, string> = {
  formal:     'Profissional e estruturado',
  consultivo: 'Empático e orientado a valor',
  direto:     'Objetivo e direto ao ponto',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: '20px 24px', marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 18 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray)', marginBottom: 8 }}>
      {children}
    </div>
  )
}

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
        border: '1px solid var(--gray3)', borderRadius: 8, padding: '7px 10px',
        background: 'var(--bg)', color: 'var(--black)', outline: 'none',
        transition: 'border-color .15s',
      }}
      onFocus={e  => (e.currentTarget.style.borderColor = 'var(--primary)')}
      onBlur={e   => (e.currentTarget.style.borderColor = 'var(--gray3)')}
    />
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ParametrosPage() {
  const [settings,         setSettings]         = useState<Settings>(DEFAULTS)
  const [status,           setStatus]           = useState<Status>('draft')
  const [n8nWebhookUrl,    setN8nWebhookUrl]    = useState('')
  const [n8nWebhookSecret, setN8nWebhookSecret] = useState('')
  const [showSecret,       setShowSecret]       = useState(false)
  const [loading,          setLoading]          = useState(true)
  const [saving,           setSaving]           = useState(false)
  const [saved,            setSaved]            = useState(false)
  const [saveError,        setSaveError]        = useState<string | null>(null)
  const [n8nDelivery,      setN8nDelivery]      = useState<N8nDelivery | undefined>(undefined)

  useEffect(() => {
    fetch('/api/sdr/settings')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: ApiData) => {
        const { n8nWebhookUrl: webhookUrl, ...coreSettings } = d.settings
        setSettings({ ...DEFAULTS, ...coreSettings })
        setStatus(d.status)
        setN8nWebhookUrl(webhookUrl ?? '')
        // n8nWebhookSecret is never returned by GET — field stays empty intentionally
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    setN8nDelivery(undefined)
    try {
      const settingsPayload = {
        ...settings,
        n8nWebhookUrl,
        // omit secret when blank — server preserves the previously stored value
        ...(n8nWebhookSecret ? { n8nWebhookSecret } : {}),
      }
      const res = await fetch('/api/sdr/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsPayload, status }),
      })
      if (!res.ok) throw new Error('Falha ao salvar')
      const data = await res.json() as { ok: boolean; n8nDelivery: N8nDelivery }
      setN8nDelivery(data.n8nDelivery)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function upd<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(s => ({ ...s, [key]: value }))
  }

  function toggleDia(num: number) {
    setSettings(s => ({
      ...s,
      diasAtivos: s.diasAtivos.includes(num)
        ? s.diasAtivos.filter(d => d !== num)
        : [...s.diasAtivos, num],
    }))
  }

  function updTemplate(i: number, value: string) {
    const next = [...settings.templates]
    next[i] = value
    upd('templates', next)
  }

  if (loading) {
    return <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>Carregando...</div>
  }

  const hasTemplates = settings.templates.length > 0
  const hasWebhook   = !!n8nWebhookUrl

  return (
    <div style={{ maxWidth: 720 }}>

      {/* ── Aviso write-back ────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        background: 'rgba(255,180,0,0.08)', border: '1px solid rgba(255,180,0,0.30)',
        borderRadius: 12, padding: '14px 18px', marginBottom: 24,
      }}>
        <AlertTriangle size={15} style={{ color: 'var(--primary-text)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13, color: 'var(--primary-text)', fontWeight: 500, lineHeight: 1.55 }}>
          {hasWebhook
            ? <>As configurações são <strong>salvas no sistema</strong> e <strong>enviadas automaticamente ao webhook n8n</strong> configurado a cada salvamento.</>
            : <>As configurações são <strong>salvas no sistema</strong>. Configure o webhook n8n abaixo para ativar o envio automático à campanha.</>
          }
        </div>
      </div>

      {/* ── Status ──────────────────────────────────────────────── */}
      <SectionCard title="Status da campanha">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {(['active', 'paused', 'draft'] as Status[]).map(s => {
            const labels:  Record<Status, string> = { active: '● Ativa', paused: '⏸ Pausada', draft: '✏ Rascunho' }
            const colors:  Record<Status, string> = { active: 'var(--green)', paused: 'var(--gray2)', draft: 'var(--primary-text)' }
            const on = status === s
            return (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding: '7px 18px', borderRadius: 99, fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border:      `1.5px solid ${on ? colors[s] : 'var(--gray3)'}`,
                background:  on ? `${colors[s]}18` : 'transparent',
                color:       on ? colors[s] : 'var(--gray2)',
                transition: 'all .15s',
              }}>
                {labels[s]}
              </button>
            )
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500 }}>
          {status === 'active'  ? 'Campanha marcada como ativa — sem disparos até a integração n8n estar conectada.'
           : status === 'paused' ? 'Campanha pausada — sem disparos mesmo quando integrada.'
           : 'Rascunho — configuração em elaboração.'}
        </div>
      </SectionCard>

      {/* ── Tom e objetivo ──────────────────────────────────────── */}
      <SectionCard title="Tom e objetivo">
        <FieldLabel>Tom da IA</FieldLabel>
        <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
          {(['formal', 'consultivo', 'direto'] as Tom[]).map(t => {
            const on = settings.tom === t
            return (
              <button key={t} onClick={() => upd('tom', t)} style={{
                flex: 1, padding: '10px 14px', borderRadius: 10, fontFamily: 'inherit',
                fontSize: 12, cursor: 'pointer', textAlign: 'left',
                border:     `1.5px solid ${on ? 'var(--primary)' : 'var(--gray3)'}`,
                background: on ? 'var(--primary-dim)' : 'transparent',
                color:      on ? 'var(--primary-text)' : 'var(--gray)',
                transition: 'all .15s',
                display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                <span style={{ fontWeight: 700 }}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </span>
                <span style={{ fontSize: 10, opacity: 0.75, fontWeight: 500 }}>
                  {TOM_DESC[t]}
                </span>
              </button>
            )
          })}
        </div>

        <FieldLabel>Objetivo da campanha</FieldLabel>
        <textarea
          value={settings.objetivo}
          onChange={e => upd('objetivo', e.target.value)}
          placeholder="Ex: Qualificar leads e agendar reuniões com o closer..."
          rows={3}
          style={{
            width: '100%', fontFamily: 'inherit', fontSize: 13, resize: 'vertical',
            border: '1px solid var(--gray3)', borderRadius: 10, padding: '10px 14px',
            background: 'var(--bg)', color: 'var(--black)', outline: 'none',
            boxSizing: 'border-box', transition: 'border-color .15s', lineHeight: 1.5,
          }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
          onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
        />
      </SectionCard>

      {/* ── Cadência ────────────────────────────────────────────── */}
      <SectionCard title="Cadência e horário">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>

          <div>
            <FieldLabel>Intervalo entre contatos</FieldLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="number"
                min={1} max={168}
                value={settings.delay}
                onChange={e => upd('delay', Math.max(1, Math.min(168, Number(e.target.value))))}
                style={{
                  width: 80, fontFamily: 'inherit', fontSize: 16, fontWeight: 800,
                  border: '1px solid var(--gray3)', borderRadius: 8, padding: '8px 12px',
                  background: 'var(--bg)', color: 'var(--black)', outline: 'none',
                  textAlign: 'center', transition: 'border-color .15s',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
              />
              <span style={{ fontSize: 13, color: 'var(--gray2)', fontWeight: 500 }}>horas</span>
            </div>
          </div>

          <div>
            <FieldLabel>Horário ativo</FieldLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TimeInput value={settings.horario.inicio} onChange={v => upd('horario', { ...settings.horario, inicio: v })} />
              <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>até</span>
              <TimeInput value={settings.horario.fim} onChange={v => upd('horario', { ...settings.horario, fim: v })} />
            </div>
          </div>
        </div>

        <FieldLabel>
          Limite diário de contatos{' '}
          <span style={{ color: 'var(--primary-text)', fontWeight: 900 }}>
            {settings.limiteDiario}
          </span>
        </FieldLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <span style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, flexShrink: 0 }}>10</span>
          <input
            type="range" min={10} max={1000} step={10}
            value={settings.limiteDiario}
            onChange={e => upd('limiteDiario', Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--primary)' }}
          />
          <span style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, flexShrink: 0 }}>1000</span>
        </div>

        <FieldLabel>Dias ativos</FieldLabel>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
          {DIAS.map(({ num, label }) => {
            const on = settings.diasAtivos.includes(num)
            return (
              <button key={num} onClick={() => toggleDia(num)} style={{
                padding: '6px 14px', borderRadius: 99, fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border:     `1.5px solid ${on ? 'var(--primary)' : 'var(--gray3)'}`,
                background: on ? 'var(--primary-dim)' : 'transparent',
                color:      on ? 'var(--primary-text)' : 'var(--gray2)',
                transition: 'all .15s',
              }}>
                {label}
              </button>
            )
          })}
        </div>
      </SectionCard>

      {/* ── Templates ───────────────────────────────────────────── */}
      <SectionCard title="Templates de mensagem">
        <div style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500, marginBottom: 16, lineHeight: 1.5 }}>
          Use{' '}
          <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11, color: 'var(--primary-text)' }}>
            {'{{nome}}'}
          </code>
          {' '}e{' '}
          <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11, color: 'var(--primary-text)' }}>
            {'{{empresa}}'}
          </code>
          {' '}como variáveis que o n8n substituirá em cada envio.
        </div>

        {hasTemplates && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 12 }}>
            {settings.templates.map((tmpl, i) => (
              <div key={i}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--gray2)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 6 }}>
                  Mensagem {i + 1}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <textarea
                    value={tmpl}
                    onChange={e => updTemplate(i, e.target.value)}
                    rows={4}
                    placeholder={`Template ${i + 1}...`}
                    style={{
                      flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 13,
                      resize: 'vertical', lineHeight: 1.55,
                      border: '1px solid var(--gray3)', borderRadius: 10, padding: '10px 14px',
                      background: 'var(--bg)', color: 'var(--black)', outline: 'none',
                      boxSizing: 'border-box', transition: 'border-color .15s',
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                    onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
                  />
                  {settings.templates.length > 1 && (
                    <button
                      onClick={() => upd('templates', settings.templates.filter((_, idx) => idx !== i))}
                      title="Remover template"
                      style={{
                        padding: '7px 10px', borderRadius: 8, fontFamily: 'inherit',
                        fontSize: 16, fontWeight: 700, cursor: 'pointer',
                        border: '1px solid var(--gray3)', background: 'transparent',
                        color: 'var(--gray2)', transition: 'all .15s', lineHeight: 1,
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = 'var(--red)'; b.style.color = 'var(--red)' }}
                      onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = 'var(--gray3)'; b.style.color = 'var(--gray2)' }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => upd('templates', [...settings.templates, ''])}
          style={{
            padding: '8px 18px', borderRadius: 99, fontFamily: 'inherit',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: '1.5px dashed var(--gray3)', background: 'transparent',
            color: 'var(--gray2)', transition: 'all .15s',
          }}
          onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = 'var(--primary)'; b.style.color = 'var(--primary-text)' }}
          onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = 'var(--gray3)'; b.style.color = 'var(--gray2)' }}
        >
          + Adicionar template
        </button>
      </SectionCard>

      {/* ── Integração n8n ──────────────────────────────────────── */}
      <SectionCard title="Integração n8n">
        <FieldLabel>URL do Webhook n8n</FieldLabel>
        <input
          type="url"
          value={n8nWebhookUrl}
          onChange={e => setN8nWebhookUrl(e.target.value)}
          placeholder="https://seu-n8n.example.com/webhook/..."
          style={{
            width: '100%', fontFamily: 'inherit', fontSize: 13,
            border: '1px solid var(--gray3)', borderRadius: 10, padding: '10px 14px',
            background: 'var(--bg)', color: 'var(--black)', outline: 'none',
            boxSizing: 'border-box', transition: 'border-color .15s', marginBottom: 20,
          }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
          onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
        />

        <FieldLabel>Segredo (opcional)</FieldLabel>
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <input
            type={showSecret ? 'text' : 'password'}
            value={n8nWebhookSecret}
            onChange={e => setN8nWebhookSecret(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            style={{
              width: '100%', fontFamily: 'inherit', fontSize: 13,
              border: '1px solid var(--gray3)', borderRadius: 10,
              padding: '10px 42px 10px 14px',
              background: 'var(--bg)', color: 'var(--black)', outline: 'none',
              boxSizing: 'border-box', transition: 'border-color .15s',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
          />
          <button
            type="button"
            onClick={() => setShowSecret(s => !s)}
            title={showSecret ? 'Ocultar' : 'Mostrar'}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--gray2)', padding: 4, display: 'flex', alignItems: 'center',
            }}
          >
            {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, lineHeight: 1.5 }}>
          Enviado como <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', fontSize: 10 }}>Authorization: Bearer</code> no cabeçalho da requisição.{' '}
          Deixe em branco para manter o segredo já salvo.
        </div>
      </SectionCard>

      {/* ── Conexão (link, não duplica a fonte) ─────────────────── */}
      <SectionCard title="Fonte de dados">
        <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 16 }}>
          A conexão com o Supabase e o n8n é configurada separadamente.
          As configurações de campanha acima serão aplicadas quando a fonte estiver conectada e a integração ativada.
        </div>
        <Link href="/settings/integrations/sdr-source" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 13, fontWeight: 700, color: 'var(--primary-text)',
          background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)',
          borderRadius: 99, padding: '8px 18px', textDecoration: 'none',
        }}>
          <ExternalLink size={13} /> Configurar fonte de dados
        </Link>
      </SectionCard>

      {/* ── Salvar ──────────────────────────────────────────────── */}
      <div style={{ marginTop: 8, paddingBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '12px 28px', borderRadius: 99, fontFamily: 'inherit',
              fontSize: 14, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer',
              background: saving ? 'var(--gray3)' : 'var(--primary)',
              color: saving ? 'var(--gray2)' : 'var(--primary-contrast)',
              border: 'none', transition: 'all .18s', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>

          {saved && (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', animation: 'ai-step 0.2s ease both' }}>
              ✓ Salvo com sucesso
            </span>
          )}
          {saveError && !saved && (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>
              ✗ {saveError}
            </span>
          )}
        </div>

        {/* n8n delivery feedback */}
        {n8nDelivery === null && (
          <div style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>
            Webhook n8n não configurado — settings salvas localmente.
          </div>
        )}
        {n8nDelivery !== null && n8nDelivery !== undefined && n8nDelivery.ok && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 700,
            background: 'rgba(34,197,94,0.1)', color: 'var(--green)',
            border: '1px solid rgba(34,197,94,0.25)',
            borderRadius: 99, padding: '5px 14px',
          }}>
            ✓ Enviado ao n8n
            {n8nDelivery.status !== undefined && (
              <span style={{ fontWeight: 500, opacity: 0.75 }}>· HTTP {n8nDelivery.status}</span>
            )}
          </div>
        )}
        {n8nDelivery !== null && n8nDelivery !== undefined && !n8nDelivery.ok && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 700,
            background: 'rgba(245,158,11,0.10)', color: '#b45309',
            border: '1px solid rgba(245,158,11,0.30)',
            borderRadius: 99, padding: '5px 14px',
          }}>
            ⚠ Falha ao enviar ao n8n
            {(n8nDelivery.error ?? n8nDelivery.status) !== undefined && (
              <span style={{ fontWeight: 500, opacity: 0.85 }}>
                · {n8nDelivery.error ?? `HTTP ${n8nDelivery.status}`}
              </span>
            )}
            <span style={{ fontWeight: 400, opacity: 0.7 }}>(settings salvas)</span>
          </div>
        )}
      </div>
    </div>
  )
}
