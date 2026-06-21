'use client'
import { useEffect } from 'react'
import { useSidebar } from '@/stores/sidebarStore'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { Topbar } from './Topbar'
import { Sidebar } from './Sidebar'

interface Props {
  children: React.ReactNode
  userName: string
  userRole: string
  brandName: string
  logoUrl: string | null
}

export function AppShell({ children, userName, userRole, brandName, logoUrl }: Props) {
  const { open, pinned, setOpen } = useSidebar()
  const isMobile = useIsMobile()
  const inGrid = open && pinned && !isMobile

  useEffect(() => {
    if (isMobile) setOpen(false)
  }, [isMobile, setOpen])

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: inGrid ? '220px minmax(0, 1fr)' : '0px minmax(0, 1fr)',
      gridTemplateRows: '60px 1fr',
      height: '100vh',
      overflow: 'hidden',
      transition: 'grid-template-columns 0.25s ease',
    }}>
      <Topbar userName={userName} userRole={userRole} brandName={brandName} logoUrl={logoUrl} />

      {/* Backdrop for overlay sidebar (unpinned or mobile) */}
      {open && (!pinned || isMobile) && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 290,
            background: 'rgba(18,19,22,0.25)',
            animation: 'fadeIn .2s ease both',
          }}
        />
      )}

      <Sidebar />

      <main style={{ gridColumn: 2, padding: isMobile ? '16px 16px' : '32px 36px', overflowY: 'auto', background: 'var(--bg)', minHeight: 0, minWidth: 0 }}>
        {children}
      </main>
    </div>
  )
}
