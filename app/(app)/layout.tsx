import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { WhiteLabelInit } from '@/components/WhiteLabelInit'
import { AIAssistant } from '@/components/AIAssistant'
import { AppShell } from '@/components/layout/AppShell'
import { getEnabledModuleKeys } from '@/lib/entitlements'
import { ModulesProvider } from '@/components/ModulesProvider'
import { moduleKeyForPath, firstAllowedPath } from '@/lib/modules'
import { getTenantBranding } from '@/lib/tenant'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  const { name, role, tenantId } = session.user
  const [modules, branding] = await Promise.all([
    getEnabledModuleKeys(tenantId),
    getTenantBranding(tenantId),
  ])

  const pathname = (await headers()).get('x-pathname') ?? ''
  const required = moduleKeyForPath(pathname)
  if (required && !modules.includes(required)) {
    redirect(firstAllowedPath(modules))
  }

  return (
    <ModulesProvider modules={modules}>
      <>
        <WhiteLabelInit primaryColor={branding.primaryColor} logoUrl={branding.logoUrl} brandName={branding.brandName} />
        {modules.includes('integration.ai') && <AIAssistant />}
        <AppShell
          userName={name!}
          userRole={role}
          brandName={branding.brandName}
          logoUrl={branding.logoUrl}
        >
          {children}
        </AppShell>
      </>
    </ModulesProvider>
  )
}
