'use client'
import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { initials } from '@/lib/utils'
import { useWhiteLabel } from '@/stores/whiteLabelStore'
import { useSidebar } from '@/stores/sidebarStore'

interface TopbarProps {
  userName: string
  userRole: string
  brandName: string
  logoUrl: string | null
}

export function Topbar({ userName, userRole, brandName, logoUrl }: TopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { primaryColor, brandName: storeBrandName, logoUrl: storeLogoUrl } = useWhiteLabel()
  const { toggle } = useSidebar()

  const displayName = storeBrandName || brandName
  const displayLogo = storeLogoUrl !== undefined ? storeLogoUrl : logoUrl

  const roleLabels: Record<string, string> = { admin: 'Administrador', manager: 'Gerente', user: 'Usuário' }

  return (
    <header style={{
      gridColumn: '1 / -1',
      background: 'var(--white)',
      borderBottom: '1px solid var(--gray3)',
      padding: '0 28px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 200,
      height: 60,
    }}>
      {/* Sidebar toggle + Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={toggle}
          title="Alternar sidebar"
          style={{
            width: 30, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'transparent', color: 'var(--gray2)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'background .15s, color .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg)'; e.currentTarget.style.color = 'var(--black)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--gray2)' }}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/>
          </svg>
        </button>

        {displayLogo ? (
          <img src={displayLogo} alt={displayName} style={{ height: 28, width: 'auto', borderRadius: 6 }} />
        ) : (
          <div style={{
            width: 28, height: 28, background: 'var(--primary)', borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 800, color: 'var(--black)',
          }}>{displayName.charAt(0).toUpperCase()}</div>
        )}
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--black)' }}>{displayName}</div>
          <div style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>Analytics · Insights · IA</div>
        </div>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 100,
          background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)',
          color: 'var(--primary-text)',
        }}>
          {roleLabels[userRole] ?? userRole}
        </span>

        <div style={{ position: 'relative' }}>
          <div
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              width: 34, height: 34, borderRadius: 100, background: 'var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: 'var(--black)', cursor: 'pointer',
            }}
          >
            {initials(userName)}
          </div>

          {menuOpen && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 299 }}
                onClick={() => setMenuOpen(false)}
              />
              <div style={{
                position: 'absolute', top: 42, right: 0,
                background: 'var(--white)', border: '1px solid var(--gray3)',
                borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                zIndex: 300, minWidth: 160, overflow: 'hidden',
              }}>
                <div style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--gray3)',
                  background: 'var(--bg)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)' }}>{userName}</div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--gray2)', marginTop: 1 }}>
                    {roleLabels[userRole] ?? userRole}
                  </div>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  style={{
                    width: '100%', padding: '9px 14px', fontSize: 13, fontWeight: 600,
                    color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer',
                    textAlign: 'left', transition: 'background .2s',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(217,48,37,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  Sair
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
