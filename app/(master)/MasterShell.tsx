'use client'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/master', label: 'Dashboard' },
  { href: '/master/tenants', label: 'Tenants' },
]

type Props = {
  userName: string
  logoutAction: () => Promise<void>
  children: React.ReactNode
}

export function MasterShell({ userName, logoutAction, children }: Props) {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'Manrope, sans-serif' }}>
      <aside style={{
        width: 220,
        background: '#0f1117',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        height: '100vh',
      }}>
        {/* Brand */}
        <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', marginBottom: 4 }}>
            MULTI10
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
            Admin
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(({ href, label }) => {
            const isActive = href === '/master' ? pathname === '/master' : pathname.startsWith(href)
            return (
              <a
                key={href}
                href={href}
                style={{
                  display: 'block',
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
                  textDecoration: 'none',
                  borderRadius: 6,
                  background: isActive ? 'rgba(255,255,255,0.09)' : 'transparent',
                  transition: 'background .15s, color .15s',
                }}
              >
                {label}
              </a>
            )
          })}
        </nav>

        {/* User + logout */}
        <div style={{ padding: '14px 10px 20px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{
            padding: '0 12px 10px',
            fontSize: 12,
            color: 'rgba(255,255,255,0.3)',
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {userName}
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.4)',
                textAlign: 'left',
                fontFamily: 'inherit',
                transition: 'background .15s, color .15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                e.currentTarget.style.color = 'rgba(255,255,255,0.8)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'rgba(255,255,255,0.4)'
              }}
            >
              Sair
            </button>
          </form>
        </div>
      </aside>

      <main style={{ flex: 1, background: '#f8f8f6', overflow: 'auto' }}>
        {children}
      </main>
    </div>
  )
}
