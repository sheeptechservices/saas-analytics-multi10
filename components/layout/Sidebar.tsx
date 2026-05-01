'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSidebar } from '@/stores/sidebarStore'

const navItems = [
  {
    section: 'Principal',
    items: [
      {
        href: '/dashboard', label: 'Dashboard',
        icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>,
      },
      {
        href: '/pipeline', label: 'Pipeline',
        icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="3" height="10" rx="1"/><rect x="6" y="5" width="3" height="8" rx="1"/><rect x="11" y="1" width="3" height="12" rx="1"/></svg>,
      },
      {
        href: '/prospeccao-ia', label: 'SDR IA', comingSoon: true,
        icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1l1.5 3 3.5.5-2.5 2.5.5 3.5L8 9l-3 1.5.5-3.5L3 4.5l3.5-.5z"/><path d="M8 11v4M6 13h4"/></svg>,
      },
    ],
  },
  {
    section: 'Integrações',
    items: [
      {
        href: '/integration', label: 'Kommo CRM',
        icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0z"/><path d="M8 5v3l2 2"/></svg>,
      },
    ],
  },
  {
    section: 'Sistema',
    items: [
      {
        href: '/settings', label: 'Configurações',
        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>,
      },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { open, pinned, setPinned, setOpen } = useSidebar()

  return (
    <aside style={{
      background: 'var(--white)',
      borderRight: '1px solid var(--gray3)',
      padding: '20px 0',
      display: 'flex',
      flexDirection: 'column',
      overflowX: 'hidden',
      overflowY: pinned && !open ? 'hidden' : 'auto',
      width: 220,
      visibility: pinned && !open ? 'hidden' : 'visible',
      // When unpinned: fixed overlay; when pinned: normal grid flow
      ...(pinned ? {} : {
        position: 'fixed',
        left: 0,
        top: 60,
        height: 'calc(100vh - 60px)',
        zIndex: 300,
        boxShadow: '4px 0 20px rgba(0,0,0,0.12)',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
      }),
    }}>
      {navItems.map((group) => (
        <div key={group.section}>
          <div style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: '0.12em', color: 'var(--gray2)',
            padding: '0 20px', margin: '16px 0 6px',
          }}>
            {group.section}
          </div>
          {group.items.map(item => {
            if ((item as any).comingSoon) {
              return (
                <div
                  key={item.href}
                  title="Em breve"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 20px', fontSize: 13, fontWeight: 600,
                    color: 'var(--gray2)', cursor: 'not-allowed',
                    borderLeft: '2px solid transparent',
                  }}
                >
                  <span style={{ flexShrink: 0, color: 'var(--gray2)' }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 100,
                    background: 'var(--gray2)', color: 'var(--white)',
                    textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0,
                  }}>Em breve</span>
                </div>
              )
            }
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 20px', fontSize: 13, fontWeight: 600,
                  color: active ? 'var(--black)' : 'var(--gray)',
                  textDecoration: 'none', cursor: 'pointer',
                  borderLeft: `2px solid ${active ? 'var(--primary)' : 'transparent'}`,
                  background: active ? 'var(--primary-dim)' : 'transparent',
                  transition: 'all .2s',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    (e.currentTarget as HTMLAnchorElement).style.color = 'var(--black)'
                    ;(e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg)'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    (e.currentTarget as HTMLAnchorElement).style.color = 'var(--gray)'
                    ;(e.currentTarget as HTMLAnchorElement).style.background = 'transparent'
                  }
                }}
              >
                <span style={{ flexShrink: 0, color: active ? 'var(--black)' : 'var(--gray)' }}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            )
          })}
        </div>
      ))}
    </aside>
  )
}
