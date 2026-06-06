'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGrid, BarChart3, Sparkles, Settings } from 'lucide-react'
import { useSidebar } from '@/stores/sidebarStore'
import { useModules } from '@/components/ModulesProvider'

const navItems = [
  {
    section: 'Principal',
    items: [
      {
        href: '/dashboard', label: 'Dashboard',
        icon: <LayoutGrid size={16} />,
      },
      {
        href: '/pipeline', label: 'Pipeline',
        icon: <BarChart3 size={16} />,
      },
      {
        href: '/prospeccao-ia', label: 'SDR IA', comingSoon: true,
        icon: <Sparkles size={16} />,
      },
    ],
  },
  {
    section: 'Sistema',
    items: [
      {
        href: '/settings', label: 'Configurações',
        icon: <Settings size={16} />,
      },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { open, pinned, setPinned, setOpen } = useSidebar()
  const modules = useModules()

  function isItemVisible(href: string): boolean {
    if (href === '/settings') return true
    if (href === '/dashboard') return modules.some(k => k.startsWith('dashboard.'))
    if (href === '/pipeline') return modules.includes('pipeline')
    if (href === '/prospeccao-ia') return modules.includes('prospeccao-ia')
    return true
  }

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
      {navItems.map((group) => {
        const visibleItems = group.items.filter(item => isItemVisible(item.href))
        if (visibleItems.length === 0) return null
        return (
        <div key={group.section}>
          <div style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: '0.12em', color: 'var(--gray2)',
            padding: '0 20px', margin: '16px 0 6px',
          }}>
            {group.section}
          </div>
          {visibleItems.map(item => {
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
            const active = pathname === item.href
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
        )
      })}
    </aside>
  )
}
