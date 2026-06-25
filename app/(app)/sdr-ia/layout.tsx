'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useModules } from '@/components/ModulesProvider'

type Tab = { href: string; label: string; isVisible: (mods: string[]) => boolean }

// Sub-nav shown when in the Conversas context (/sdr-ia/conversas or /sdr-ia/contatos)
const CONV_TABS: Tab[] = [
  { href: '/sdr-ia/conversas', label: 'Conversas', isVisible: m => m.includes('integration.ycloud-whatsapp') },
  { href: '/sdr-ia/contatos',  label: 'Contatos',  isVisible: m => m.includes('integration.ycloud-whatsapp') },
]

// Sub-nav shown when in the Disparos context (/sdr-ia/disparos or /sdr-ia/leads)
const DISPAR_TABS: Tab[] = [
  { href: '/sdr-ia/leads',    label: 'Leads',     isVisible: m => m.includes('sdr.parametros') },
  { href: '/sdr-ia/disparos', label: 'Histórico', isVisible: m => m.includes('sdr.dashboard') || m.includes('sdr.parametros') },
]

function inConvContext(p: string) {
  return p.startsWith('/sdr-ia/conversas') || p.startsWith('/sdr-ia/contatos')
}

function inDisparContext(p: string) {
  return p.startsWith('/sdr-ia/disparos') || p.startsWith('/sdr-ia/leads')
}

export default function SdrIaLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const modules  = useModules()

  const contextTabs = inConvContext(pathname) ? CONV_TABS
    : inDisparContext(pathname) ? DISPAR_TABS
    : []

  const visibleTabs = contextTabs.filter(t => t.isVisible(modules))

  return (
    <div>
      {visibleTabs.length > 1 && (
        <div style={{
          display: 'flex', alignItems: 'flex-end',
          marginBottom: 28, borderBottom: '1px solid var(--gray3)',
        }}>
          {visibleTabs.map(tab => {
            const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
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
      )}
      {children}
    </div>
  )
}
