'use client'
import { useState, useEffect } from 'react'
import { signOut } from 'next-auth/react'
import { Menu } from 'lucide-react'
import { initials } from '@/lib/utils'
import { IconButton } from '@/components/ui/Button'
import { useWhiteLabel } from '@/stores/whiteLabelStore'
import { useUser } from '@/stores/userStore'
import { roleLabel } from '@/lib/roles'

interface TopbarProps {
  userName: string
  userRole: string
  brandName: string
  logoUrl: string | null
  /** Opens/closes the sidebar: drawer on phones, grid column on desktop (decided in AppShell). */
  onToggleSidebar: () => void
  /** The toggle button, so AppShell can return focus to it when the phone drawer closes. */
  toggleRef?: React.Ref<HTMLButtonElement>
  sidebarOpen: boolean
}

export function Topbar({ userName, userRole, brandName, logoUrl, onToggleSidebar, toggleRef, sidebarOpen }: TopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { primaryColor, brandName: storeBrandName, logoUrl: storeLogoUrl } = useWhiteLabel()
  const { name: storeUserName, photoUrl: storeUserPhoto } = useUser()
  const displayUserName = storeUserName || userName
  const [photoError, setPhotoError] = useState(false)
  useEffect(() => { setPhotoError(false) }, [storeUserPhoto])

  const displayName = storeBrandName || brandName
  const displayLogo = storeLogoUrl !== undefined ? storeLogoUrl : logoUrl

  // Conta única: duas etiquetas, a da plataforma e a do cliente. O mapa antigo
  // chamava de "Gerente"/"Usuário" quem hoje tem acesso completo (lib/roles.ts).
  const papel = roleLabel(userRole)

  return (
    <header
      className="px-3.5 md:px-7"
      style={{
        gridColumn: '1 / -1',
        background: 'var(--white)',
        borderBottom: '1px solid var(--gray3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 200,
        height: 60,
      }}
    >
      {/* Sidebar toggle + Brand */}
      <div className="min-w-0" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* touch-target: 28px no desktop, 44×44 no celular (A14). */}
        <IconButton
          ref={toggleRef}
          label="Alternar sidebar"
          size="sm"
          className="touch-target"
          onClick={onToggleSidebar}
          aria-controls="app-sidebar"
          aria-expanded={sidebarOpen}
          style={{ flexShrink: 0 }}
        >
          <Menu size={15} />
        </IconButton>

        {displayLogo ? (
          <img src={displayLogo} alt={displayName} className="max-md:max-w-24 max-md:object-contain" style={{ height: 28, width: 'auto', borderRadius: 'var(--radius-sm)' }} />
        ) : (
          <div style={{
            width: 28, height: 28, background: 'var(--primary)', borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 800, color: 'var(--primary-contrast)',
            flexShrink: 0,
          }}>{displayName.charAt(0).toUpperCase()}</div>
        )}
        <div className="min-w-0">
          <div className="max-md:truncate" title={displayName} style={{ fontSize: 15, fontWeight: 700, color: 'var(--black)' }}>{displayName}</div>
          <div className="hidden md:block" style={{ fontSize: 12, color: 'var(--gray2)', fontWeight: 500 }}>Analytics · Insights · IA</div>
        </div>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
        {/* The role also shows in the avatar menu; on phones the brand name needs the room */}
        <span className="hidden sm:inline" style={{
          fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 'var(--radius-pill)',
          background: 'var(--primary-dim)', border: '1px solid var(--primary-mid)',
          color: 'var(--primary-text)',
        }}>
          {papel}
        </span>

        <div style={{ position: 'relative' }}>
          <div
            onClick={() => setMenuOpen(!menuOpen)}
            className="size-10 md:size-[34px]"
            style={{
              borderRadius: 'var(--radius-pill)', background: 'var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: 'var(--primary-contrast)', cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            {storeUserPhoto && !photoError ? (
              <img
                src={storeUserPhoto}
                alt={displayUserName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={() => setPhotoError(true)}
              />
            ) : (
              initials(displayUserName)
            )}
          </div>

          {menuOpen && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 299 }}
                onClick={() => setMenuOpen(false)}
              />
              <div className="top-12 md:top-[42px]" style={{
                position: 'absolute', right: 0,
                background: 'var(--white)', border: '1px solid var(--gray3)',
                borderRadius: 'var(--radius-md)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                zIndex: 300, minWidth: 160, overflow: 'hidden',
              }}>
                <div style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--gray3)',
                  background: 'var(--bg)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--black)' }}>{displayUserName}</div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--gray2)', marginTop: 1 }}>
                    {papel}
                  </div>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="max-md:min-h-10"
                  style={{
                    width: '100%', padding: '9px 14px', fontSize: 13, fontWeight: 600,
                    color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer',
                    textAlign: 'left', transition: 'background .2s',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--danger-dim)')}
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
