'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGrid, MessageSquare, Settings, Send } from 'lucide-react'
import { useSidebar } from '@/stores/sidebarStore'
import { useModules } from '@/components/ModulesProvider'
import { isModuleHidden } from '@/lib/modules'
import { cn } from '@/lib/utils'

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

interface SidebarProps {
  /** Phone drawer (< md). On desktop the store is in charge. */
  drawerOpen: boolean
  /** Phone drawer closed, off-canvas: the aside goes inert — out of the tab
   *  order, of find-in-page and of the accessibility tree. Only ever true on
   *  phones; the desktop sidebar never receives it. */
  offCanvas: boolean
  onNavigate: () => void
}

export function Sidebar({ drawerOpen, offCanvas, onNavigate }: SidebarProps) {
  const pathname = usePathname()
  const { open, pinned, setPinned, setOpen } = useSidebar()
  const modules = useModules()
  const overlay = !pinned

  function isItemVisible(href: string): boolean {
    if (href === '/settings')          return true
    // aba oculta (Ranking) não conta: sozinha, levaria a um Dashboard vazio
    if (href === '/dashboard')         return modules.some(k => k.startsWith('dashboard.') && !isModuleHidden(k))
    if (href === '/sdr-ia/conversas')  return modules.includes('integration.ycloud-whatsapp')
    if (href === '/sdr-ia/disparos')   return modules.includes('sdr.dashboard') || modules.includes('sdr.parametros')
    return true
  }

  // Below md it is always a fixed drawer driven by drawerOpen, with no
  // transition: it opens and closes in the same frame. From md up it behaves as
  // it always did — in the grid when pinned, sliding drawer when unpinned, both
  // driven by the store's `open`.
  const asideClass = cn(
    'fixed left-0 top-[60px] z-[300] h-[calc(100dvh-60px)] overflow-y-auto shadow-[4px_0_20px_rgba(0,0,0,0.12)]',
    drawerOpen ? 'translate-x-0' : '-translate-x-full invisible',
    overlay
      ? cn(
          'md:transition-[translate] md:duration-250 md:ease-[cubic-bezier(0.4,0,0.2,1)]',
          open ? 'md:translate-x-0 md:visible' : 'md:-translate-x-full md:visible',
        )
      : cn(
          'md:static md:z-auto md:h-auto md:shadow-none md:translate-none',
          open ? 'md:visible' : 'md:invisible md:overflow-y-hidden',
        ),
  )

  return (
    <aside
      id="app-sidebar"
      inert={offCanvas}
      className={asideClass}
      style={{
        background: 'var(--white)',
        borderRight: '1px solid var(--gray3)',
        padding: '20px 0',
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden',
        width: 220,
      }}
    >
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
                onClick={() => { onNavigate(); if (overlay) setOpen(false) }}
                className="max-md:min-h-10"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 20px', fontSize: 13, fontWeight: 600,
                  color: active ? 'var(--black)' : 'var(--gray)',
                  textDecoration: 'none', cursor: 'pointer',
                  borderLeft: `var(--rail) solid ${active ? 'var(--primary)' : 'transparent'}`,
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
