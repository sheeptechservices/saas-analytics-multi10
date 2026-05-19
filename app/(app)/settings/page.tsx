'use client'
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWhiteLabel } from '@/stores/whiteLabelStore'
import { initials } from '@/lib/utils'
import { Pencil, Trash2 } from 'lucide-react'

const PRESET_COLORS = [
  '#FFB400', '#2563eb', '#1E8A3E', '#D93025',
  '#7C3AED', '#DB2777', '#0891B2', '#059669',
]

export default function SettingsPage() {
  const qc = useQueryClient()
  const { primaryColor, logoUrl, brandName, setPrimaryColor, setLogoUrl, setBrandName } = useWhiteLabel()
  const [localColor, setLocalColor] = useState(primaryColor)
  const [localLogo, setLocalLogo] = useState(logoUrl ?? '')
  const [localName, setLocalName] = useState(brandName)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Profile state
  const [profileName, setProfileName] = useState('')
  const [profilePhoto, setProfilePhoto] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savedProfile, setSavedProfile] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then(r => r.json()),
  })

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => fetch('/api/me').then(r => r.json()),
  })

  useEffect(() => {
    if (data?.tenant) {
      setLocalColor(data.tenant.primaryColor ?? '#FFB400')
      setLocalLogo(data.tenant.logoUrl ?? '')
      setLocalName(data.tenant.name ?? 'Multi10')
    }
  }, [data])

  useEffect(() => {
    if (meData?.user) {
      setProfileName(meData.user.name ?? '')
      setProfilePhoto(meData.user.photoUrl ?? '')
    }
  }, [meData])

  function handleColorChange(color: string) {
    setLocalColor(color)
    setPrimaryColor(color) // live preview
  }

  async function save() {
    setSaving(true)
    await fetch('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryColor: localColor, logoUrl: localLogo || null, name: localName }),
    })
    setPrimaryColor(localColor)
    setLogoUrl(localLogo || null)
    setBrandName(localName)
    qc.invalidateQueries({ queryKey: ['settings'] })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function saveProfile() {
    if (!profileName.trim()) return
    setSavingProfile(true)
    await fetch('/api/me', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: profileName, photoUrl: profilePhoto || null }),
    })
    qc.invalidateQueries({ queryKey: ['me'] })
    qc.invalidateQueries({ queryKey: ['settings'] })
    setSavingProfile(false)
    setSavedProfile(true)
    setTimeout(() => setSavedProfile(false), 3000)
  }

  const users = data?.users ?? []
  const me = meData?.user

  if (isLoading) {
    const sk = (w: string | number, h: number, r = 8) => (
      <div className="shimmer-bar" style={{ width: w, height: h, borderRadius: r, background: 'var(--gray3)', flexShrink: 0 }} />
    )
    return (
      <div style={{ animation: 'fadeIn .3s ease both' }}>
        <div style={{ marginBottom: 24 }}>{sk(160, 22, 6)}<div style={{ marginTop: 8 }}>{sk(240, 13, 4)}</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {sk('40%', 11, 4)}
            {[0,1,2].map(i => <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{sk('30%', 11, 4)}{sk('100%', 40, 8)}</div>)}
            {sk('100%', 44, 100)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {sk('35%', 11, 4)}{sk('100%', 80, 12)}
            </div>
            <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sk('30%', 11, 4)}
              {[0,1,2].map(i => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{sk(36, 36, 100)}<div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>{sk('50%', 13, 4)}{sk('35%', 11, 4)}</div></div>)}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="animate-slide-up delay-1" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--black)', letterSpacing: '-0.02em' }}>Configurações</div>
        <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 2 }}>Personalize a identidade visual da plataforma</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        {/* White Label Form */}
        <div className="animate-slide-up delay-2">
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', paddingBottom: 14, borderBottom: '1px solid var(--gray3)', marginBottom: 20 }}>
              Identidade Visual
            </div>

            {/* Brand name */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 6 }}>NOME DA MARCA</label>
              <input
                value={localName}
                onChange={e => setLocalName(e.target.value)}
                style={{
                  width: '100%', padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                  color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            {/* Color picker */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 10 }}>COR PRIMÁRIA</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {PRESET_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => handleColorChange(color)}
                    style={{
                      width: 32, height: 32, borderRadius: 8, background: color, cursor: 'pointer',
                      border: localColor === color ? '3px solid var(--black)' : '2px solid transparent',
                      outline: localColor === color ? '2px solid var(--black)' : 'none',
                      outlineOffset: 2, transition: 'all .15s',
                    }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="color"
                  value={localColor}
                  onChange={e => handleColorChange(e.target.value)}
                  style={{ width: 40, height: 36, borderRadius: 6, border: '1px solid var(--gray3)', cursor: 'pointer', padding: 2 }}
                />
                <input
                  value={localColor}
                  onChange={e => handleColorChange(e.target.value)}
                  style={{
                    flex: 1, padding: '10px 14px', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                    color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none',
                  }}
                  onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
                />
              </div>
            </div>

            {/* Logo URL */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 6 }}>URL DA LOGO (opcional)</label>
              <input
                value={localLogo}
                onChange={e => setLocalLogo(e.target.value)}
                placeholder="https://…/logo.png"
                style={{
                  width: '100%', padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
                  color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            {saved && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(30,138,62,0.06)', border: '1px solid rgba(30,138,62,0.25)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#145c2a' }}>
                ✓ Configurações salvas com sucesso
              </div>
            )}

            <button
              onClick={save}
              disabled={saving}
              style={{
                width: '100%', padding: '11px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
                background: 'var(--primary)', border: 'none', borderRadius: 100, cursor: 'pointer',
                color: 'var(--primary-contrast)',
              }}
            >
              {saving ? 'Salvando…' : 'Salvar configurações'}
            </button>
          </div>
        </div>

        {/* Profile + Team */}
        <div className="animate-slide-up delay-3">
          {/* Profile */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow)', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)', paddingBottom: 14, borderBottom: '1px solid var(--gray3)', marginBottom: 20 }}>
              Meu Perfil
            </div>

            {/* Avatar preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
                background: me?.avatarColor ?? 'var(--primary)',
                overflow: 'hidden',
                border: '2px solid var(--gray3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {profilePhoto ? (
                  <img src={profilePhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  <span style={{ fontSize: 20, fontWeight: 800, color: me?.avatarBg ?? '#121316' }}>
                    {initials(profileName || me?.name || '?')}
                  </span>
                )}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--black)' }}>{profileName || me?.name}</div>
                <div style={{ fontSize: 12, color: 'var(--gray2)', marginTop: 2 }}>{me?.email}</div>
                <span style={{ display: 'inline-block', marginTop: 6, fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 100, background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)', color: 'var(--primary-text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {me?.role}
                </span>
              </div>
            </div>

            {/* Name */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 6 }}>NOME</label>
              <input
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none' }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            {/* Photo URL */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 6 }}>URL DA FOTO (opcional)</label>
              <input
                value={profilePhoto}
                onChange={e => setProfilePhoto(e.target.value)}
                placeholder="https://…/foto.jpg"
                style={{ width: '100%', padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--black)', background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none' }}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            {savedProfile && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(30,138,62,0.06)', border: '1px solid rgba(30,138,62,0.25)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#145c2a' }}>
                ✓ Perfil atualizado com sucesso
              </div>
            )}

            <button
              onClick={saveProfile}
              disabled={savingProfile}
              style={{ width: '100%', padding: '11px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--primary)', border: 'none', borderRadius: 100, cursor: 'pointer', color: 'var(--primary-contrast)' }}
            >
              {savingProfile ? 'Salvando…' : 'Salvar perfil'}
            </button>
          </div>

          {/* Team */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--gray3)', background: 'var(--bg)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)' }}>Equipe</div>
            </div>
            {users.map((u: any) => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--gray3)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 100, flexShrink: 0, background: u.avatarColor, color: u.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
                  {initials(u.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--black)' }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray2)', fontWeight: 500 }}>{u.email}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 100, background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)', color: 'var(--primary-text)' }}>
                  {u.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {me?.role === 'admin' && <UsersSection meId={me.id} />}
    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

type UserRow = {
  id: string
  name: string
  email: string
  role: string
  avatarColor: string
  avatarBg: string
  createdAt: string | number
}

const ROLE_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  admin:   { bg: '#dbeafe', color: '#1e40af', label: 'Admin' },
  manager: { bg: '#fef3c7', color: '#92400e', label: 'Gerente' },
  user:    { bg: '#f3f4f6', color: '#374151', label: 'Usuário' },
  master:  { bg: '#ede9fe', color: '#5b21b6', label: 'Master' },
}

const ROLE_OPTIONS = [
  { value: 'admin',   label: 'Administrador' },
  { value: 'manager', label: 'Gerente' },
  { value: 'user',    label: 'Usuário' },
]

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
  color: 'var(--black)', background: 'var(--white)',
  border: '1px solid var(--gray3)', borderRadius: 8, outline: 'none',
}

function fmtDate(d: string | number) {
  try {
    const dt = typeof d === 'number' ? new Date(d * 1000) : new Date(d)
    return dt.toLocaleDateString('pt-BR')
  } catch { return '—' }
}

function Field({ value, onChange, type = 'text', placeholder, disabled }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
      style={{ ...fieldStyle, ...(disabled ? { background: 'var(--bg)', color: 'var(--gray)', cursor: 'not-allowed' } : {}) }}
      onFocus={e => { if (!disabled) { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 3px var(--primary-dim)' } }}
      onBlur={e => { e.target.style.borderColor = 'var(--gray3)'; e.target.style.boxShadow = 'none' }}
    />
  )
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--white)', borderRadius: 16, padding: '28px 32px', width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', animation: 'modalSlideUp .2s ease both' }}>
        {children}
      </div>
    </div>
  )
}

function BtnRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>{children}</div>
}

function CancelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ flex: 1, padding: '10px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: 'var(--bg)', color: 'var(--gray)', border: '1px solid var(--gray3)', borderRadius: 100, cursor: 'pointer' }}>
      Cancelar
    </button>
  )
}

function SubmitBtn({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={loading} style={{ flex: 2, padding: '10px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: loading ? 'var(--gray3)' : 'var(--primary)', color: loading ? 'var(--gray)' : 'var(--primary-contrast)', border: 'none', borderRadius: 100, cursor: loading ? 'not-allowed' : 'pointer' }}>
      {children}
    </button>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--gray)', letterSpacing: '0.04em', marginBottom: 6 }}>{children}</label>
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div style={{ padding: '10px 14px', background: 'rgba(217,48,37,0.06)', border: '1px solid rgba(217,48,37,0.2)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
      {msg}
    </div>
  )
}

// ─── UsersSection ─────────────────────────────────────────────────────────────

function UsersSection({ meId }: { meId: string }) {
  const qc = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => fetch('/api/users').then(r => r.json()),
  })

  // ── invite ──
  const [showInvite, setShowInvite] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('user')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState(false)

  // ── edit ──
  const [editUser, setEditUser] = useState<UserRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState('')

  // ── delete ──
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const userList: UserRow[] = data?.users ?? []

  function openInvite() {
    setInviteName(''); setInviteEmail(''); setInviteRole('user')
    setInviteError(''); setInviteSuccess(false); setShowInvite(true)
  }

  function openEdit(u: UserRow) {
    setEditUser(u); setEditName(u.name); setEditRole(u.role); setEditError('')
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteLoading(true); setInviteError('')
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: inviteName, email: inviteEmail, role: inviteRole }),
    })
    const body = await res.json()
    setInviteLoading(false)
    if (res.ok) {
      setInviteSuccess(true)
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      setTimeout(() => { setShowInvite(false); setInviteSuccess(false) }, 1800)
    } else {
      setInviteError(body.error || 'Erro ao enviar convite.')
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setEditLoading(true); setEditError('')
    const res = await fetch(`/api/users/${editUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, role: editRole }),
    })
    const body = await res.json()
    setEditLoading(false)
    if (res.ok) { qc.invalidateQueries({ queryKey: ['admin-users'] }); setEditUser(null) }
    else setEditError(body.error || 'Erro ao salvar.')
  }

  async function handleDelete() {
    if (!deleteUser) return
    setDeleteLoading(true)
    await fetch(`/api/users/${deleteUser.id}`, { method: 'DELETE' })
    setDeleteLoading(false)
    setDeleteUser(null)
    qc.invalidateQueries({ queryKey: ['admin-users'] })
  }

  return (
    <>
      <div className="animate-slide-up delay-4" style={{ marginTop: 20 }}>
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray3)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--gray3)', background: 'var(--bg)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray2)' }}>Usuários</div>
            <button
              onClick={openInvite}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, background: 'var(--primary)', color: 'var(--primary-contrast)', border: 'none', borderRadius: 100, cursor: 'pointer' }}
            >
              + Convidar usuário
            </button>
          </div>

          {/* States */}
          {isLoading && (
            <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>Carregando…</div>
          )}
          {isError && (
            <div style={{ padding: '24px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>Erro ao carregar usuários.</div>
              <button onClick={() => refetch()} style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary-text)', background: 'var(--primary-dim)', border: 'none', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
                Tentar novamente
              </button>
            </div>
          )}

          {/* Table */}
          {!isLoading && !isError && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {['', 'Nome', 'E-mail', 'Role', 'Membro desde', ''].map((h, i) => (
                    <th key={i} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--gray2)', letterSpacing: '0.06em', borderBottom: '1px solid var(--gray3)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {userList.map((u, i) => {
                  const badge = ROLE_BADGE[u.role] ?? ROLE_BADGE.user
                  const isMe = u.id === meId
                  return (
                    <tr key={u.id} style={{ borderBottom: i < userList.length - 1 ? '1px solid var(--gray3)' : 'none' }}>
                      <td style={{ padding: '10px 16px', width: 44 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: u.avatarColor || 'var(--primary)', color: u.avatarBg || '#121316', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
                          {initials(u.name)}
                        </div>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, color: 'var(--black)', whiteSpace: 'nowrap' }}>
                        {u.name}
                        {isMe && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--gray2)' }}>(você)</span>}
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--gray)' }}>{u.email}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, background: badge.bg, color: badge.color, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.04em' }}>
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--gray2)', whiteSpace: 'nowrap' }}>
                        {fmtDate(u.createdAt)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <IconBtn title="Editar" onClick={() => openEdit(u)} hoverColor="var(--primary-text)" hoverBorder="var(--primary)">
                            <Pencil size={13} />
                          </IconBtn>
                          {!isMe && (
                            <IconBtn title="Remover" onClick={() => setDeleteUser(u)} hoverColor="var(--red)" hoverBorder="var(--red)">
                              <Trash2 size={13} />
                            </IconBtn>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {userList.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: 'var(--gray2)' }}>Nenhum usuário encontrado.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Invite modal ── */}
      {showInvite && (
        <Overlay onClose={() => setShowInvite(false)}>
          <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--black)', marginBottom: 4 }}>Convidar usuário</div>
          <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 24 }}>O usuário receberá um link para criar sua senha.</div>
          {inviteSuccess ? (
            <div style={{ padding: 20, background: 'rgba(30,138,62,0.06)', border: '1px solid rgba(30,138,62,0.25)', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#145c2a', textAlign: 'center' }}>
              ✓ Convite enviado com sucesso!
            </div>
          ) : (
            <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><FieldLabel>NOME *</FieldLabel><Field value={inviteName} onChange={e => setInviteName((e.target as HTMLInputElement).value)} placeholder="Nome completo" required /></div>
              <div><FieldLabel>E-MAIL *</FieldLabel><Field type="email" value={inviteEmail} onChange={e => setInviteEmail((e.target as HTMLInputElement).value)} placeholder="email@exemplo.com" required /></div>
              <div>
                <FieldLabel>PERFIL *</FieldLabel>
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                  {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {inviteError && <ErrorBanner msg={inviteError} />}
              <BtnRow><CancelBtn onClick={() => setShowInvite(false)} /><SubmitBtn loading={inviteLoading}>{inviteLoading ? 'Enviando…' : 'Enviar convite'}</SubmitBtn></BtnRow>
            </form>
          )}
        </Overlay>
      )}

      {/* ── Edit modal ── */}
      {editUser && (
        <Overlay onClose={() => setEditUser(null)}>
          <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--black)', marginBottom: 24 }}>Editar usuário</div>
          <form onSubmit={handleEdit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><FieldLabel>E-MAIL</FieldLabel><Field value={editUser.email} disabled /></div>
            <div><FieldLabel>NOME</FieldLabel><Field value={editName} onChange={e => setEditName((e.target as HTMLInputElement).value)} placeholder="Nome completo" required /></div>
            <div>
              <FieldLabel>PERFIL</FieldLabel>
              {editUser.id === meId ? (
                <Field value={ROLE_BADGE[editUser.role]?.label ?? editUser.role} disabled />
              ) : (
                <select value={editRole} onChange={e => setEditRole(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                  {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </div>
            {editError && <ErrorBanner msg={editError} />}
            <BtnRow><CancelBtn onClick={() => setEditUser(null)} /><SubmitBtn loading={editLoading}>{editLoading ? 'Salvando…' : 'Salvar'}</SubmitBtn></BtnRow>
          </form>
        </Overlay>
      )}

      {/* ── Delete confirmation ── */}
      {deleteUser && (
        <Overlay onClose={() => setDeleteUser(null)}>
          <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--black)', marginBottom: 12 }}>Remover usuário</div>
          <p style={{ fontSize: 14, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 24 }}>
            Tem certeza que deseja remover <strong style={{ color: 'var(--black)' }}>{deleteUser.name}</strong>? Esta ação não pode ser desfeita.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <CancelBtn onClick={() => setDeleteUser(null)} />
            <button
              onClick={handleDelete}
              disabled={deleteLoading}
              style={{ flex: 2, padding: '10px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: deleteLoading ? 'var(--gray3)' : 'var(--red)', color: deleteLoading ? 'var(--gray)' : '#fff', border: 'none', borderRadius: 100, cursor: deleteLoading ? 'not-allowed' : 'pointer' }}
            >
              {deleteLoading ? 'Removendo…' : 'Remover'}
            </button>
          </div>
        </Overlay>
      )}
    </>
  )
}

function IconBtn({ children, title, onClick, hoverColor, hoverBorder }: { children: React.ReactNode; title: string; onClick: () => void; hoverColor: string; hoverBorder: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--gray3)', borderRadius: 6, cursor: 'pointer', color: 'var(--gray)', transition: 'all .15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = hoverBorder; e.currentTarget.style.color = hoverColor }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--gray3)'; e.currentTarget.style.color = 'var(--gray)' }}
    >
      {children}
    </button>
  )
}
