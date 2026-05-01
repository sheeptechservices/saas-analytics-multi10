'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/dashboard',            label: 'Visão Geral' },
  { href: '/dashboard/ranking',    label: 'Ranking' },
  { href: '/dashboard/marketing',  label: 'Marketing' },
  { href: '/dashboard/sdr-ia',     label: 'SDR IA' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div>
      <div style={{
        display: 'flex', gap: 0, marginBottom: 28,
        borderBottom: '1px solid var(--gray3)',
      }}>
        {TABS.map(tab => {
          const active = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
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
      {children}
    </div>
  )
}
