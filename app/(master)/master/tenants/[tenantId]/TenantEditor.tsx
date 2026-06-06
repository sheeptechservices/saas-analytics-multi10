'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MODULES } from '@/lib/modules'

const MODULE_GROUPS = [
  { label: 'Sidebar', type: 'sidebar' as const },
  { label: 'Dashboard', type: 'dashboard-tab' as const },
  { label: 'Integrações', type: 'integration' as const },
]

type Plan = { id: string; name: string; modules: string[] }

export function TenantEditor({
  tenantId,
  initialName,
  initialColor,
  initialLogo,
  enabledKeys,
  plans,
}: {
  tenantId: string
  initialName: string
  initialColor: string
  initialLogo: string
  enabledKeys: string[]
  plans: Plan[]
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor ?? '#FFB400')
  const [logo, setLogo] = useState(initialLogo ?? '')
  const [enabledSet, setEnabledSet] = useState<Set<string>>(new Set(enabledKeys))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState('')

  function toggleModule(key: string) {
    setEnabledSet(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setSaved(false)
  }

  function applyPlan() {
    const plan = plans.find(p => p.id === selectedPlanId)
    if (!plan) return
    setEnabledSet(new Set(plan.modules))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const res = await fetch(`/api/master/tenants/${tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          primaryColor: color,
          logoUrl: logo || null,
          modules: [...enabledSet],
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? 'Erro ao salvar.')
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError('Erro de conexão.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 28 }}>
      {/* Dados editáveis */}
      <div style={{ background: '#fff', border: '1px solid #e3e4de', borderRadius: 12, padding: '24px 28px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#aaa', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 20 }}>
          Dados do tenant
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              Nome
            </label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setSaved(false) }}
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, color: '#121316', background: '#fff', border: '1px solid #e3e4de', borderRadius: 8, outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              Cor primária
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                value={color}
                onChange={e => { setColor(e.target.value); setSaved(false) }}
                style={{ width: 38, height: 38, borderRadius: 6, border: '1px solid #e3e4de', cursor: 'pointer', padding: 2, flexShrink: 0 }}
              />
              <input
                value={color}
                onChange={e => { setColor(e.target.value); setSaved(false) }}
                style={{ flex: 1, padding: '9px 12px', fontFamily: 'monospace', fontSize: 13, fontWeight: 500, color: '#121316', background: '#fff', border: '1px solid #e3e4de', borderRadius: 8, outline: 'none' }}
              />
            </div>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
            Logo URL (opcional)
          </label>
          <input
            value={logo}
            onChange={e => { setLogo(e.target.value); setSaved(false) }}
            placeholder="https://…/logo.png"
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, color: '#121316', background: '#fff', border: '1px solid #e3e4de', borderRadius: 8, outline: 'none' }}
          />
        </div>
      </div>

      {/* Módulos */}
      <div style={{ background: '#fff', border: '1px solid #e3e4de', borderRadius: 12, padding: '24px 28px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#aaa', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 16 }}>
          Módulos & Integrações
        </div>

        {/* Aplicar plano */}
        {plans.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #f0f0ee' }}>
            <select
              value={selectedPlanId}
              onChange={e => setSelectedPlanId(e.target.value)}
              style={{ flex: 1, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, color: selectedPlanId ? '#121316' : '#aaa', background: '#fff', border: '1px solid #e3e4de', borderRadius: 8, outline: 'none', cursor: 'pointer' }}
            >
              <option value="">Selecionar plano…</option>
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={applyPlan}
              disabled={!selectedPlanId}
              style={{
                padding: '8px 16px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                background: selectedPlanId ? '#FFB400' : '#e3e4de',
                color: selectedPlanId ? '#121316' : '#aaa',
                border: 'none', borderRadius: 8, cursor: selectedPlanId ? 'pointer' : 'not-allowed',
                flexShrink: 0,
              }}
            >
              Aplicar
            </button>
          </div>
        ) : (
          <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #f0f0ee' }}>
            <span style={{ fontSize: 12, color: '#bbb' }}>
              Nenhum plano cadastrado.{' '}
              <a href="/master/plans" style={{ color: '#aaa', textDecoration: 'underline' }}>Criar planos</a>
            </span>
          </div>
        )}

        {/* Grupos de toggles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {MODULE_GROUPS.map(group => {
            const items = MODULES.filter(m => m.type === group.type)
            return (
              <div key={group.type}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#bbb', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                  {group.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {items.map(m => {
                    const on = enabledSet.has(m.key)
                    return (
                      <div
                        key={m.key}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, background: on ? '#f8f8f6' : 'transparent' }}
                      >
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#121316' }}>{m.label}</span>
                          <span style={{ fontSize: 11, color: '#bbb', marginLeft: 8, fontFamily: 'monospace' }}>{m.key}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleModule(m.key)}
                          role="switch"
                          aria-checked={on}
                          style={{
                            width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
                            position: 'relative', background: on ? '#FFB400' : '#d1d5db',
                            flexShrink: 0, padding: 0,
                          }}
                        >
                          <span style={{
                            position: 'absolute', top: 3, left: on ? 21 : 3,
                            width: 16, height: 16, borderRadius: '50%', background: '#fff',
                          }} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Salvar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 24px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
            background: saving ? '#e3e4de' : '#FFB400',
            color: saving ? '#999' : '#121316',
            border: 'none', borderRadius: 100, cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Salvando…' : 'Salvar alterações'}
        </button>
        {saved && (
          <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>Salvo!</span>
        )}
        {error && (
          <span style={{ fontSize: 13, fontWeight: 600, color: '#dc2626' }}>{error}</span>
        )}
      </div>
    </div>
  )
}
