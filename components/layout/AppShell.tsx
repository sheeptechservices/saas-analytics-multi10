'use client'
import { useSidebar } from '@/stores/sidebarStore'
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
  const inGrid = open && pinned

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: inGrid ? '220px 1fr' : '0px 1fr',
      gridTemplateRows: '60px 1fr',
      minHeight: '100vh',
      transition: 'grid-template-columns 0.25s ease',
    }}>
      <Topbar userName={userName} userRole={userRole} brandName={brandName} logoUrl={logoUrl} />

      {/* Backdrop for unpinned open sidebar */}
      {open && !pinned && (
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

      <main style={{ padding: '32px 36px', overflowY: 'auto', background: 'var(--bg)' }}>
        {children}
      </main>
    </div>
  )
}
