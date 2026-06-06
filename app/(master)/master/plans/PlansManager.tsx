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

export function PlansManager({ initialPlans }: { initialPlans: Plan[] }) {
  const router = useRouter()
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list')
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [formName, setFormName] = useState('')
  const [enabledSet, setEnabledSet] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function openCreate() {
    setFormName('')
    setEnabledSet(new Set())
    setError('')
    setMode('create')
  }

  function openEdit(plan: Plan) {
    setFormName(plan.name)
    setEnabledSet(new Set(plan.modules))
    setError('')
    setEditingPlan(plan)
    setMode('edit')
  }

  function closeForm() {
    setMode('list')
    setEditingPlan(null)
    setError('')
  }

  function toggleModule(key: string) {
    setEnabledSet(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleCreate() {
    if (!formName.trim()) { setError('Nome obrigatório.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/master/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, modules: [...enabledSet] }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? 'Erro ao criar.')
        return
      }
      router.refresh()
      closeForm()
    } catch {
      setError('Erro de conexão.')
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!formName.trim()) { setError('Nome obrigatório.'); return }
    if (!editingPlan) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/master/plans/${editingPlan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, modules: [...enabledSet] }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? 'Erro ao salvar.')
        return
      }
      router.refresh()
      closeForm()
    } catch {
      setError('Erro de conexão.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(plan: Plan) {
    if (!confirm(`Excluir o plano "${plan.name}"?`)) return
    try {
      const res = await fetch(`/api/master/plans/${plan.id}`, { method: 'DELETE' })
      if (!res.ok) {
        alert('Erro ao excluir o plano.')
        return
      }
      router.refresh()
    } catch {
      alert('Erro de conexão.')
    }
  }

  if (mode !== 'list') {
    const isCreate = mode === 'create'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <button
          onClick={closeForm}
          style={{ alignSelf: 'flex-start', fontSize: 13, fontWeight: 600, color: '#666', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 4 }}
        >
          ← Voltar
        </button>

        {/* Nome */}
        <div style={{ background: '#fff', border: '1px solid #e3e4de', borderRadius: 12, padding: '24px 28px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#aaa', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 16 }}>
            {isCreate ? 'Novo plano' : 'Editar plano'}
          </div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
            Nome
          </label>
          <input
            value={formName}
            onChange={e => { setFormName(e.target.value); setError('') }}
            placeholder="Ex: Pro, Starter…"
            autoFocus
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, color: '#121316', background: '#fff', border: '1px solid #e3e4de', borderRadius: 8, outline: 'none' }}
          />
        </div>

        {/* Módulos */}
        <div style={{ background: '#fff', border: '1px solid #e3e4de', borderRadius: 12, padding: '24px 28px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#aaa', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 20 }}>
            Módulos & Integrações
          </div>
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

        {/* Ações */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={isCreate ? handleCreate : handleEdit}
            disabled={saving}
            style={{
              padding: '10px 24px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              background: saving ? '#e3e4de' : '#FFB400',
              color: saving ? '#999' : '#121316',
              border: 'none', borderRadius: 100, cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Salvando…' : isCreate ? 'Criar plano' : 'Salvar alterações'}
          </button>
          <button
            onClick={closeForm}
            disabled={saving}
            style={{ padding: '10px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: 'transparent', color: '#888', border: '1px solid #e3e4de', borderRadius: 100, cursor: 'pointer' }}
          >
            Cancelar
          </button>
          {error && <span style={{ fontSize: 13, fontWeight: 600, color: '#dc2626' }}>{error}</span>}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header com botão */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          onClick={openCreate}
          style={{
            padding: '9px 20px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
            background: '#FFB400', color: '#121316', border: 'none', borderRadius: 100, cursor: 'pointer',
          }}
        >
          + Novo plano
        </button>
      </div>

      {/* Lista */}
      <div style={{ background: '#fff', border: '1px solid #e3e4de', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8f8f6' }}>
              {['Nome', 'Módulos', ''].map(h => (
                <th key={h} style={{
                  padding: '10px 20px', textAlign: 'left',
                  fontSize: 11, fontWeight: 700, color: '#888',
                  letterSpacing: '0.06em', borderBottom: '1px solid #e3e4de',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {initialPlans.map((plan, i) => (
              <tr key={plan.id} style={{ borderBottom: i < initialPlans.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
                <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 700, color: '#121316' }}>
                  {plan.name}
                </td>
                <td style={{ padding: '14px 20px', fontSize: 13, color: '#666' }}>
                  {plan.modules.length} módulo{plan.modules.length !== 1 ? 's' : ''}
                </td>
                <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => openEdit(plan)}
                      style={{
                        fontSize: 12, fontWeight: 700, color: '#7A5600',
                        background: 'rgba(255,180,0,0.1)', border: 'none',
                        padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(plan)}
                      style={{
                        fontSize: 12, fontWeight: 700, color: '#dc2626',
                        background: 'rgba(220,38,38,0.07)', border: 'none',
                        padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {initialPlans.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: '#aaa' }}>
                  Nenhum plano cadastrado. Clique em "+ Novo plano" para começar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
