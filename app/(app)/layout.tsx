import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { WhiteLabelInit } from '@/components/WhiteLabelInit'
import { UserInit } from '@/components/UserInit'
import { getUserProfile } from '@/lib/user'
import { AIAssistant } from '@/components/AIAssistant'
import { AppShell } from '@/components/layout/AppShell'
import { getEnabledModuleKeys } from '@/lib/entitlements'
import { ModulesProvider } from '@/components/ModulesProvider'
import { moduleKeyForPath, firstAllowedPath } from '@/lib/modules'
import { getTenantBranding } from '@/lib/tenant'
import { brandCss } from '@/lib/brand'

// Título e ícone do tenant já na resposta do servidor. Sem isto, o cliente
// white-label recebe o nome e o favicon da marca padrão e só vê os seus depois de
// hidratar — em toda navegação.
export async function generateMetadata() {
  const session = await auth()
  if (!session) return {}
  const branding = await getTenantBranding(session.user.tenantId)
  return {
    title: branding.brandName,
    ...(branding.logoUrl ? { icons: { icon: branding.logoUrl } } : {}),
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  const { id, name, role, tenantId } = session.user
  const [modules, branding, profile] = await Promise.all([
    getEnabledModuleKeys(tenantId),
    getTenantBranding(tenantId),
    getUserProfile(id),
  ])

  const pathname = (await headers()).get('x-pathname') ?? ''
  const required = moduleKeyForPath(pathname)
  if (required && !modules.includes(required)) {
    redirect(firstAllowedPath(modules))
  }

  return (
    <ModulesProvider modules={modules}>
      <>
        {/* A cor da marca sai daqui dentro do HTML, antes da primeira pintura. Estas
            variáveis sobrescrevem as do globals.css, que carrega a cor padrão; o
            WhiteLabelInit abaixo só existe para a troca ao vivo em Configurações. */}
        <style dangerouslySetInnerHTML={{ __html: brandCss(branding.primaryColor) }} />
        <WhiteLabelInit primaryColor={branding.primaryColor} logoUrl={branding.logoUrl} brandName={branding.brandName} />
        <UserInit name={profile.name || name!} photoUrl={profile.photoUrl} />
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
