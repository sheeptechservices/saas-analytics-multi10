'use client'
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWhiteLabel } from '@/stores/whiteLabelStore'
import { initials } from '@/lib/utils'

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
    </div>
  )
}
