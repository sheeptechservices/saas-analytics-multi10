'use client'
import { useState } from 'react'
import { UserPlus, Check, AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface ManualLeadResult {
  ok: boolean
  leadId: string | null
  duplicate: boolean
  name: string
  error?: string
}

export interface AddedInfo {
  leadId: string | null
  name: string
  duplicate: boolean
}

interface AddLeadFormProps {
  onAdded?: (info: AddedInfo) => void
}

function fieldStyle(focused: boolean): React.CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box' as const,
    padding: '9px 12px', fontSize: 13, fontFamily: 'inherit',
    border: `1px solid ${focused ? 'var(--primary)' : 'var(--gray3)'}`,
    borderRadius: 10,
    background: 'var(--white)', color: 'var(--black)', outline: 'none',
    transition: 'border-color .15s',
  }
}

export function AddLeadForm({ onAdded }: AddLeadFormProps) {
  const [name,       setName]       = useState('')
  const [phone,      setPhone]      = useState('')
  const [company,    setCompany]    = useState('')
  const [focusedField, setFocused]  = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [last, setLast] = useState<(AddedInfo & { error?: string }) | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !phone.trim() || submitting) return
    setSubmitting(true)
    setLast(null)
    try {
      const res  = await fetch('/api/sdr/leads/manual', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:    name.trim(),
          phone:   phone.trim(),
          company: company.trim() || undefined,
        }),
      })
      const data = await res.json() as ManualLeadResult
      if (!res.ok || !data.ok) {
        const msg = data.error === 'telefone_invalido'            ? 'Telefone inválido — use o formato +55 11 99999-9999.'
                  : data.error === 'nome_obrigatorio'             ? 'Nome é obrigatório.'
                  : data.error === 'import_url_nao_configurada'   ? 'URL de importação não configurada — acesse Configurações > Credenciais.'
                  : (data.error ?? `Erro HTTP ${res.status}`)
        setLast({ leadId: null, name: name.trim(), duplicate: false, error: msg })
        return
      }
      const info: AddedInfo = { leadId: data.leadId, name: data.name, duplicate: data.duplicate }
      setLast(info)
      setName('')
      setPhone('')
      setCompany('')
      onAdded?.(info)
    } catch (err) {
      setLast({ leadId: null, name: name.trim(), duplicate: false, error: (err as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--gray)',
    textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 5,
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        <div>
          <label style={labelStyle}>Nome *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nome do lead"
            required
            style={fieldStyle(focusedField === 'name')}
            onFocus={() => setFocused('name')}
            onBlur={() => setFocused(null)}
          />
        </div>

        <div>
          <label style={labelStyle}>Telefone *</label>
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+55 11 99999-9999"
            required
            type="tel"
            style={fieldStyle(focusedField === 'phone')}
            onFocus={() => setFocused('phone')}
            onBlur={() => setFocused(null)}
          />
        </div>

        <div>
          <label style={labelStyle}>Empresa</label>
          <input
            value={company}
            onChange={e => setCompany(e.target.value)}
            placeholder="Empresa (opcional)"
            style={fieldStyle(focusedField === 'company')}
            onFocus={() => setFocused('company')}
            onBlur={() => setFocused(null)}
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          disabled={submitting || !name.trim() || !phone.trim()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
        >
          {submitting
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Cadastrando...</>
            : <><UserPlus size={14} /> Adicionar lead</>}
        </Button>

        {last && !last.error && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '10px 14px', borderRadius: 10,
            background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)',
            fontSize: 13, fontWeight: 600, color: '#15803d',
          }}>
            <Check size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {last.duplicate
                ? <>Lead <strong>{last.name}</strong> já existia &mdash; reaproveitado.</>
                : <>Lead <strong>{last.name}</strong> adicionado.</>}
            </span>
          </div>
        )}

        {last?.error && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '10px 14px', borderRadius: 10,
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)',
            fontSize: 13, fontWeight: 600, color: 'var(--red)',
          }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{last.error}</span>
          </div>
        )}

      </div>
    </form>
  )
}
