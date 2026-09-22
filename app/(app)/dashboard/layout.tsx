'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useModules } from '@/components/ModulesProvider'

const TABS = [
  { href: '/dashboard',            label: 'Visão Geral' },
  { href: '/dashboard/marketing',  label: 'Marketing' },
]

const TAB_MODULE: Record<string, string> = {
  '/dashboard':            'dashboard.overview',
  '/dashboard/marketing':  'dashboard.marketing',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const modules = useModules()
  const visibleTabs = TABS.filter(t => modules.includes(TAB_MODULE[t.href]))

  return (
    <div>
      {/* On phones the tabs sit on the line, scrolling sideways */}
      <div style={{ marginBottom: 28, borderBottom: '1px solid var(--gray3)' }}>
        <div className="max-md:overflow-x-auto max-md:overflow-y-hidden max-md:pb-px" style={{ display: 'flex', gap: 0 }}>
          {visibleTabs.map(tab => {
            const active = pathname === tab.href
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="max-md:flex max-md:min-h-10 max-md:shrink-0 max-md:items-center max-md:whitespace-nowrap"
                style={{
                  padding: '8px 18px', fontSize: 13, fontWeight: 700,
                  color: active ? 'var(--black)' : 'var(--gray2)',
                  textDecoration: 'none',
                  borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`,
                  marginBottom: -1,
                  transition: 'color .15s, border-color .15s',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLAnchorElement).style.color = 'var(--gray)' }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLAnchorElement).style.color = 'var(--gray2)' }}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>
      {children}
    </div>
  )
}
