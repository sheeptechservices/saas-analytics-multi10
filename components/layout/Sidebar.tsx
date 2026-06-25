'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGrid, BarChart3, MessageSquare, Settings, Send } from 'lucide-react'
import { useSidebar } from '@/stores/sidebarStore'
import { useModules } from '@/components/ModulesProvider'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'

// ─── Nav structure ────────────────────────────────────────────────────────────

interface NavItem {
  href:         string
  label:        string
  icon:         React.ReactNode
  activePrefix?: string
  isActive?:    (pathname: string) => boolean
  hrefFor?:     (modules: string[]) => string   // destino dinâmico por módulo do tenant
}

interface NavGroup {
  section: string
  items:   NavItem[]
}

const navItems: NavGroup[] = [
  {
    section: 'Principal',
    items: [
      {
        href: '/dashboard', label: 'Dashboard',
        icon: <LayoutGrid size={16} />,
        isActive: (p) => p.startsWith('/dashboard'),
      },
      {
        href: '/sdr-ia/conversas', label: 'Conversas',
        icon: <MessageSquare size={16} />,
        isActive: (p) => p.startsWith('/sdr-ia/conversas') || p.startsWith('/sdr-ia/contatos'),
      },
      {
        href: '/sdr-ia/disparos', label: 'Disparos',
        icon: <Send size={16} />,
        // abre no "Novo disparo" (ação) se o tenant pode disparar; senão no Histórico
        hrefFor: (m) => m.includes('sdr.parametros') ? '/sdr-ia/leads' : '/sdr-ia/disparos',
        isActive: (p) => p.startsWith('/sdr-ia/disparos') || p.startsWith('/sdr-ia/leads'),
      },
      {
        href: '/pipeline', label: 'Pipeline',
        icon: <BarChart3 size={16} />,
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

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname()
  const { open, pinned, setPinned, setOpen } = useSidebar()
  const modules = useModules()
  const isMobile = useIsMobile()
  const overlay = !pinned || isMobile

  function isItemVisible(href: string): boolean {
    if (href === '/settings')          return true
    if (href === '/dashboard')         return modules.some(k => k.startsWith('dashboard.'))
    if (href === '/pipeline')          return modules.includes('pipeline')
    if (href === '/sdr-ia/conversas')  return modules.includes('integration.ycloud-whatsapp')
    if (href === '/sdr-ia/disparos')   return modules.includes('sdr.dashboard') || modules.includes('sdr.parametros')
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
      overflowY: !overlay && !open ? 'hidden' : 'auto',
      width: 220,
      visibility: !overlay && !open ? 'hidden' : 'visible',
      // overlay mode (unpinned or mobile): fixed drawer; normal mode: grid flow
      ...(overlay ? {
        position: 'fixed',
        left: 0,
        top: 60,
        height: 'calc(100vh - 60px)',
        zIndex: 300,
        boxShadow: '4px 0 20px rgba(0,0,0,0.12)',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
      } : {}),
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
            const href = item.hrefFor ? item.hrefFor(modules) : item.href
            const active = item.isActive
              ? item.isActive(pathname)
              : item.activePrefix
                ? pathname.startsWith(item.activePrefix)
                : pathname === item.href
            return (
              <Link
                key={item.href}
                href={href}
                onClick={() => { if (overlay) setOpen(false) }}
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
