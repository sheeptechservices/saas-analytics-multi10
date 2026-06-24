'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronDown, ExternalLink } from 'lucide-react'
import { SkeletonForm, SkeletonBlock } from '@/components/Skeleton'
import { Button } from '@/components/ui/Button'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tom         = 'formal' | 'consultivo' | 'direto'
type Status      = 'draft' | 'active' | 'paused'
type N8nDelivery = { ok: boolean; status?: number; error?: string } | null
type AreaId      = 'campanha' | 'ia-conteudo' | 'teste-disparo' | 'avancado'

interface Settings {
  tom:              Tom
  objetivo:         string
  delay:            number   // legado — em horas; não usado pela campanha n8n
  limiteDiario:     number
  horario:          { inicio: string; fim: string }
  diasAtivos:       number[]
  templates:        string[]
  remetente:        string   // E.164, ex: +5511999990000
  numToques:        number   // 1–20
  intervaloDias:    number   // 1–30, intervalo entre toques
  n8nWebhookUrl?:   string
  n8nDispatchUrl?:  string
  n8nEnrollUrl?:    string
  n8nImportUrl?:    string
  n8nBlastUrl?:     string
}

interface ApiData {
  configured: boolean
  status:     Status
  version:    number
  settings:   Settings
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULTS: Settings = {
  tom:           'consultivo',
  objetivo:      '',
  delay:         24,
  limiteDiario:  100,
  horario:       { inicio: '08:00', fim: '18:00' },
  diasAtivos:    [1, 2, 3, 4, 5],
  templates:     [''],
  remetente:     '',
  numToques:     10,
  intervaloDias: 3,
}

const E164_RE = /^\+[1-9]\d{6,14}$/
function isValidE164(v: string) { return v === '' || E164_RE.test(v) }

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

const AREAS_KEY     = 'sdr-parametros-areas'
const AREA_DEFAULT: AreaId[] = ['campanha']

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
      onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
      onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
    />
  )
}

function CollapsibleArea({
  id, title, open, onToggle, children,
}: {
  id: AreaId; title: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div style={{
      marginBottom: 8,
      border: '1px solid var(--gray3)',
      borderRadius: 16,
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`area-${id}`}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '15px 20px',
          background: open ? 'var(--white)' : 'var(--bg)',
          border: 'none',
          borderBottom: open ? '1px solid var(--gray3)' : '1px solid transparent',
          cursor: 'pointer', fontFamily: 'inherit',
          transition: 'background .15s',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.01em' }}>
          {title}
        </span>
        <ChevronDown
          size={16}
          style={{
            color: 'var(--gray2)',
            transition: 'transform .2s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        />
      </button>
      {open && (
        <div id={`area-${id}`} style={{ padding: '20px 20px 4px', background: 'var(--bg)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ParametrosPage() {
  const [settings,        setSettings]        = useState<Settings>(DEFAULTS)
  const [status,          setStatus]          = useState<Status>('draft')
  const [preservedN8nUrls, setPreservedN8nUrls] = useState<Record<string, string>>({})
  const [remetenteError,  setRemetenteError]  = useState<string | null>(null)
  const [loading,            setLoading]            = useState(true)
  const [saving,             setSaving]             = useState(false)
  const [saved,              setSaved]              = useState(false)
  const [saveError,          setSaveError]          = useState<string | null>(null)
  const [n8nDelivery,        setN8nDelivery]        = useState<N8nDelivery | undefined>(undefined)

  // ── Teste de disparo ─────────────────────────────────────────────────────────
  const [testTemplates,    setTestTemplates]    = useState<Array<{ name: string; language: string }>>([])
  const [testTemplateName, setTestTemplateName] = useState('')
  const [testLangCode,     setTestLangCode]     = useState('pt_BR')
  const [testVarsCsv,      setTestVarsCsv]      = useState('')
  const [testNumbers,      setTestNumbers]      = useState('')
  const [testSending,      setTestSending]      = useState(false)
  const [testResults,      setTestResults]      = useState<Array<{ to: string; ok: boolean; id?: string; status?: string; error?: string }> | null>(null)
  const [testError,        setTestError]        = useState<string | null>(null)

  // ── Áreas colapsáveis — persistidas em localStorage ──────────────────────────
  const [openAreas, setOpenAreas] = useState<Set<AreaId>>(() => {
    if (typeof window === 'undefined') return new Set(AREA_DEFAULT)
    try {
      const raw = localStorage.getItem(AREAS_KEY)
      if (raw) {
        const arr = JSON.parse(raw) as unknown
        if (Array.isArray(arr)) return new Set(arr as AreaId[])
      }
    } catch {}
    return new Set(AREA_DEFAULT)
  })

  useEffect(() => {
    try {
      localStorage.setItem(AREAS_KEY, JSON.stringify(Array.from(openAreas)))
    } catch {}
  }, [openAreas])

  function toggleArea(id: AreaId) {
    setOpenAreas(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Fetch templates YCloud ────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/ycloud/templates')
      .then(r => r.ok ? r.json() : null)
      .then((d: { templates?: Array<{ name: string; language: string; status: string }> } | null) => {
        if (d?.templates) {
          setTestTemplates(d.templates.filter(t => t.status === 'approved'))
        }
      })
      .catch(() => {})
  }, [])

  // ── Fetch settings ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/sdr/settings')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: ApiData) => {
        const { n8nWebhookUrl: webhookUrl, n8nDispatchUrl: dispatchUrl, n8nEnrollUrl: enrollUrl, n8nImportUrl: importUrl, n8nBlastUrl: blastUrl, ...coreSettings } = d.settings
        setSettings({ ...DEFAULTS, ...coreSettings })
        setStatus(d.status)
        const urls: Record<string, string> = {}
        if (webhookUrl) urls.n8nWebhookUrl = webhookUrl
        if (dispatchUrl) urls.n8nDispatchUrl = dispatchUrl
        if (enrollUrl) urls.n8nEnrollUrl = enrollUrl
        if (importUrl) urls.n8nImportUrl = importUrl
        if (blastUrl) urls.n8nBlastUrl = blastUrl
        setPreservedN8nUrls(urls)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function save() {
    if (!isValidE164(settings.remetente)) {
      setSaveError('Remetente inválido — use formato E.164 (ex: +5511999990000)')
      return
    }
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    setN8nDelivery(undefined)
    try {
      const settingsPayload = {
        ...settings,
        ...preservedN8nUrls,
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

  async function testSend() {
    const numbers  = testNumbers.split('\n').map(s => s.trim()).filter(Boolean)
    const variaveis = testVarsCsv.split(',').map(s => s.trim()).filter(Boolean)
    if (!testTemplateName) { setTestError('Escolha ou digite um template'); return }
    if (numbers.length === 0) { setTestError('Informe pelo menos 1 número'); return }
    if (numbers.length > 10)  { setTestError('Máximo de 10 números por teste'); return }
    setTestSending(true)
    setTestResults(null)
    setTestError(null)
    try {
      const res = await fetch('/api/ycloud/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numbers, templateName: testTemplateName, languageCode: testLangCode || 'pt_BR', variaveis }),
      })
      const data = await res.json() as { results?: Array<{ to: string; ok: boolean; id?: string; status?: string; error?: string }>; error?: string }
      if (!res.ok || !data.results) {
        setTestError(data.error ?? 'Erro ao enviar')
      } else {
        setTestResults(data.results)
      }
    } catch (e) {
      setTestError((e as Error).message)
    } finally {
      setTestSending(false)
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
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SkeletonBlock height={56} style={{ borderRadius: 12 }} />
        <SkeletonForm rows={5} />
      </div>
    )
  }

  const hasTemplates = settings.templates.length > 0
  const hasWebhook   = !!preservedN8nUrls.n8nWebhookUrl

  return (
    <div>

      {/* ── Banner — sempre visível ──────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        background: 'rgba(255,180,0,0.08)', border: '1px solid rgba(255,180,0,0.30)',
        borderRadius: 12, padding: '14px 18px', marginBottom: 16,
      }}>
        <AlertTriangle size={15} style={{ color: 'var(--primary-text)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13, color: 'var(--primary-text)', fontWeight: 500, lineHeight: 1.55 }}>
          {hasWebhook
            ? <>As configurações são <strong>salvas no sistema</strong> e <strong>enviadas automaticamente à integração</strong> configurada a cada salvamento.</>
            : <>As configurações são <strong>salvas no sistema</strong>. Configure as credenciais de integração em <strong>Configurações → Credenciais</strong> para ativar o envio automático à campanha.</>
          }
        </div>
      </div>

      {/* ━━━ Área 1: Campanha ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <CollapsibleArea
        id="campanha"
        title="Campanha"
        open={openAreas.has('campanha')}
        onToggle={() => toggleArea('campanha')}
      >
        {/* Status da campanha */}
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
            {status === 'active'  ? 'Campanha marcada como ativa — sem disparos até a integração estar configurada.'
             : status === 'paused' ? 'Campanha pausada — sem disparos mesmo quando integrada.'
             : 'Rascunho — configuração em elaboração.'}
          </div>
        </SectionCard>

        {/* Sequência + Cadência em 2 colunas no desktop */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(400px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>

          {/* Sequência de disparo */}
          <SectionCard title="Sequência de disparo">
            <div style={{ marginBottom: 20 }}>
              <FieldLabel>Número remetente (WhatsApp Business)</FieldLabel>
              <input
                type="tel"
                value={settings.remetente}
                onChange={e => {
                  upd('remetente', e.target.value)
                  if (remetenteError) setRemetenteError(null)
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                onBlur={e => {
                  const valid = isValidE164(e.target.value)
                  e.currentTarget.style.borderColor = valid ? 'var(--gray3)' : 'var(--red)'
                  setRemetenteError(valid ? null : 'Formato inválido — use E.164: +5511999990000')
                }}
                placeholder="+5511999990000"
                style={{
                  width: '100%', fontFamily: 'inherit', fontSize: 13,
                  border: `1px solid ${remetenteError ? 'var(--red)' : 'var(--gray3)'}`,
                  borderRadius: 10, padding: '10px 14px',
                  background: 'var(--bg)', color: 'var(--black)', outline: 'none',
                  boxSizing: 'border-box', transition: 'border-color .15s',
                }}
              />
              {remetenteError && (
                <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600, marginTop: 5 }}>
                  {remetenteError}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginTop: 6, lineHeight: 1.5 }}>
                Número WhatsApp Business usado nos disparos. Formato E.164 (ex: +5511999990000).
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div>
                <FieldLabel>
                  Toques na sequência{' '}
                  <span style={{ color: 'var(--primary-text)', fontWeight: 900 }}>{settings.numToques}</span>
                </FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="number"
                    min={1} max={20}
                    value={settings.numToques}
                    onChange={e => upd('numToques', Math.max(1, Math.min(20, Number(e.target.value))))}
                    style={{
                      width: 80, fontFamily: 'inherit', fontSize: 16, fontWeight: 800,
                      border: '1px solid var(--gray3)', borderRadius: 8, padding: '8px 12px',
                      background: 'var(--bg)', color: 'var(--black)', outline: 'none',
                      textAlign: 'center', transition: 'border-color .15s',
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                    onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
                  />
                  <span style={{ fontSize: 13, color: 'var(--gray2)', fontWeight: 500 }}>templates</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginTop: 6 }}>
                  1–20. Define fase_final = &quot;Template {settings.numToques}&quot;.
                </div>
              </div>

              <div>
                <FieldLabel>
                  Intervalo entre toques{' '}
                  <span style={{ color: 'var(--primary-text)', fontWeight: 900 }}>{settings.intervaloDias}</span>
                </FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="number"
                    min={1} max={30}
                    value={settings.intervaloDias}
                    onChange={e => upd('intervaloDias', Math.max(1, Math.min(30, Number(e.target.value))))}
                    style={{
                      width: 80, fontFamily: 'inherit', fontSize: 16, fontWeight: 800,
                      border: '1px solid var(--gray3)', borderRadius: 8, padding: '8px 12px',
                      background: 'var(--bg)', color: 'var(--black)', outline: 'none',
                      textAlign: 'center', transition: 'border-color .15s',
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                    onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
                  />
                  <span style={{ fontSize: 13, color: 'var(--gray2)', fontWeight: 500 }}>dias</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginTop: 6 }}>1–30 dias entre cada toque.</div>
              </div>
            </div>
          </SectionCard>

          {/* Cadência e horário */}
          <SectionCard title="Cadência e horário">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
              <div>
                <FieldLabel>
                  Intervalo entre contatos{' '}
                  <span style={{ fontWeight: 500, color: 'var(--gray2)' }}>(legado — em horas, não usado pela campanha)</span>
                </FieldLabel>
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
                      textAlign: 'center', transition: 'border-color .15s', opacity: 0.5,
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
              <span style={{ color: 'var(--primary-text)', fontWeight: 900 }}>{settings.limiteDiario}</span>
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

        </div>{/* /Sequência+Cadência grid */}
      </CollapsibleArea>

      {/* ━━━ Área 2: IA & Conteúdo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <CollapsibleArea
        id="ia-conteudo"
        title="IA & Conteúdo"
        open={openAreas.has('ia-conteudo')}
        onToggle={() => toggleArea('ia-conteudo')}
      >
        {/* Tom e objetivo */}
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

        {/* Templates de mensagem */}
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
            {' '}como variáveis que serão substituídas em cada envio.
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
                      placeholder={`Mensagem ${i + 1}...`}
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
                          color: 'var(--gray2)', transition: 'all .15s', lineHeight: 1, flexShrink: 0,
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
      </CollapsibleArea>

      {/* ━━━ Área 3: Teste de disparo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <CollapsibleArea
        id="teste-disparo"
        title="Teste de disparo"
        open={openAreas.has('teste-disparo')}
        onToggle={() => toggleArea('teste-disparo')}
      >
        <SectionCard title="Teste de disparo (números selecionados)">
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.22)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 20,
            fontSize: 12, color: 'var(--red)', fontWeight: 500, lineHeight: 1.55,
          }}>
            ⚠ Envia mensagem <strong style={{ fontWeight: 800 }}>real</strong> (com custo) diretamente via WhatsApp, somente para os números informados — não usa a sequência da campanha.
          </div>

          <FieldLabel>Template</FieldLabel>
          {testTemplates.length > 0 && (
            <select
              value={testTemplateName}
              onChange={e => setTestTemplateName(e.target.value)}
              style={{
                width: '100%', fontFamily: 'inherit', fontSize: 13,
                border: '1px solid var(--gray3)', borderRadius: 10, padding: '10px 14px',
                background: 'var(--bg)', color: 'var(--black)', outline: 'none',
                boxSizing: 'border-box', transition: 'border-color .15s', marginBottom: 8,
                cursor: 'pointer',
              }}
            >
              <option value="">— escolha um template aprovado —</option>
              {testTemplates.map(t => (
                <option key={`${t.name}:${t.language}`} value={t.name}>{t.name} ({t.language})</option>
              ))}
            </select>
          )}
          <input
            type="text"
            value={testTemplateName}
            onChange={e => setTestTemplateName(e.target.value)}
            placeholder="nome_do_template (ou digite manualmente)"
            style={{
              width: '100%', fontFamily: 'inherit', fontSize: 13,
              border: '1px solid var(--gray3)', borderRadius: 10, padding: '10px 14px',
              background: 'var(--bg)', color: 'var(--black)', outline: 'none',
              boxSizing: 'border-box', transition: 'border-color .15s', marginBottom: 20,
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 16, marginBottom: 20 }}>
            <div>
              <FieldLabel>Idioma</FieldLabel>
              <input
                type="text"
                value={testLangCode}
                onChange={e => setTestLangCode(e.target.value)}
                placeholder="pt_BR"
                style={{
                  width: '100%', fontFamily: 'inherit', fontSize: 13,
                  border: '1px solid var(--gray3)', borderRadius: 10, padding: '10px 14px',
                  background: 'var(--bg)', color: 'var(--black)', outline: 'none',
                  boxSizing: 'border-box', transition: 'border-color .15s',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
              />
            </div>
            <div>
              <FieldLabel>Variáveis (separadas por vírgula)</FieldLabel>
              <input
                type="text"
                value={testVarsCsv}
                onChange={e => setTestVarsCsv(e.target.value)}
                placeholder="João Silva, Empresa Ltda"
                style={{
                  width: '100%', fontFamily: 'inherit', fontSize: 13,
                  border: '1px solid var(--gray3)', borderRadius: 10, padding: '10px 14px',
                  background: 'var(--bg)', color: 'var(--black)', outline: 'none',
                  boxSizing: 'border-box', transition: 'border-color .15s',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
              />
              <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginTop: 5 }}>
                Preencha conforme as variáveis do template; a maioria usa 1 (nome).
              </div>
            </div>
          </div>

          <FieldLabel>Números — 1 por linha (E.164)</FieldLabel>
          <textarea
            value={testNumbers}
            onChange={e => setTestNumbers(e.target.value)}
            rows={4}
            placeholder={'+5554999990000\n+5551988880000'}
            style={{
              width: '100%', fontFamily: 'monospace', fontSize: 13,
              border: '1px solid var(--gray3)', borderRadius: 10, padding: '10px 14px',
              background: 'var(--bg)', color: 'var(--black)', outline: 'none',
              boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.6,
              transition: 'border-color .15s', marginBottom: 4,
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
            onBlur={e  => (e.currentTarget.style.borderColor = 'var(--gray3)')}
          />
          <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500, marginBottom: 18 }}>
            Máximo de 10 números por teste.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' as const }}>
            <Button
              variant="primary"
              onClick={testSend}
              disabled={testSending}
            >
              {testSending ? 'Enviando...' : 'Enviar teste'}
            </Button>
            {testError && (
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>✗ {testError}</span>
            )}
          </div>

          {testResults && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {testResults.map((r, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: r.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                  border: `1px solid ${r.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                  borderRadius: 10, padding: '8px 14px',
                }}>
                  <span style={{ fontWeight: 800, color: r.ok ? 'var(--green)' : 'var(--red)', flexShrink: 0, fontSize: 14 }}>
                    {r.ok ? '✓' : '✗'}
                  </span>
                  <code style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--black)', flexShrink: 0 }}>{r.to}</code>
                  {r.ok
                    ? <span style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>id: {r.id}</span>
                    : <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 500 }}>{r.error}</span>
                  }
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </CollapsibleArea>

      {/* ━━━ Área 5: Avançado ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <CollapsibleArea
        id="avancado"
        title="Avançado"
        open={openAreas.has('avancado')}
        onToggle={() => toggleArea('avancado')}
      >
        <SectionCard title="Fonte de dados">
          <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 16 }}>
            A conexão com a fonte de dados e a integração são configuradas separadamente.
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
      </CollapsibleArea>

      {/* ── Salvar — sempre visível ──────────────────────────────── */}
      <div style={{ marginTop: 16, paddingBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <Button
            variant="primary"
            size="lg"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </Button>

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
            Integração de envio não configurada — configurações salvas localmente.
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
            ✓ Integração atualizada
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
            ⚠ Falha ao atualizar a integração
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
