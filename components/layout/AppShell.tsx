'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSidebar } from '@/stores/sidebarStore'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { useModules } from '@/components/ModulesProvider'
import { cn } from '@/lib/utils'
import { Topbar } from './Topbar'
import { Sidebar } from './Sidebar'

interface Props {
  children: React.ReactNode
  userName: string
  userRole: string
  brandName: string
  logoUrl: string | null
}

// Screen width drives the layout through CSS (md: classes), never through
// useIsMobile: the server doesn't know the screen, so a phone's first paint
// would come out with the 220px sidebar column. Here useIsMobile only decides
// behavior — which state the top-bar button toggles.
export function AppShell({ children, userName, userRole, brandName, logoUrl }: Props) {
  const { open, pinned, toggle, setOpen } = useSidebar()
  const isMobile = useIsMobile()
  const pathname = usePathname()
  const hasAssistant = useModules().includes('integration.ai')
  const inGrid = open && pinned

  // Phone drawer: its own state, outside the persisted store, so it starts
  // closed on server and client alike and never touches the desktop preference.
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => { setDrawerOpen(false) }, [pathname])
  useEffect(() => { if (!isMobile) setDrawerOpen(false) }, [isMobile])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  function toggleSidebar() {
    if (isMobile) setDrawerOpen(o => !o)
    else toggle()
  }

  const desktopOverlay = open && !pinned

  return (
    <div
      className={cn(
        'grid h-dvh overflow-hidden grid-cols-[0px_minmax(0,1fr)]',
        inGrid && 'md:grid-cols-[220px_minmax(0,1fr)]',
      )}
      style={{ gridTemplateRows: '60px 1fr', transition: 'grid-template-columns 0.25s ease' }}
    >
      <Topbar
        userName={userName} userRole={userRole} brandName={brandName} logoUrl={logoUrl}
        onToggleSidebar={toggleSidebar}
        sidebarOpen={isMobile ? drawerOpen : open}
      />

      {/* Backdrop for the drawer sidebar: always on phones, unpinned on desktop */}
      {(drawerOpen || desktopOverlay) && (
        <div
          onClick={() => { if (isMobile) setDrawerOpen(false); else setOpen(false) }}
          className={cn(!drawerOpen && 'max-md:hidden', !desktopOverlay && 'md:hidden')}
          style={{
            position: 'fixed', inset: 0, zIndex: 290,
            background: 'rgba(18,19,22,0.25)',
            animation: 'fadeIn .2s ease both',
          }}
        />
      )}

      <Sidebar drawerOpen={drawerOpen} onNavigate={() => setDrawerOpen(false)} />

      {/* On phones the extra bottom padding lets the end of the page scroll clear of the floating AI button */}
      <main
        className={cn('px-4 pt-4 md:px-9 md:py-8', hasAssistant ? 'pb-20' : 'pb-4')}
        style={{ gridColumn: 2, overflowY: 'auto', background: 'var(--bg)', minHeight: 0, minWidth: 0 }}
      >
        {children}
      </main>
    </div>
  )
}
