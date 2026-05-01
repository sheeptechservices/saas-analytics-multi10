import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { WhiteLabelInit } from '@/components/WhiteLabelInit'
import { AIAssistant } from '@/components/AIAssistant'
import { AppShell } from '@/components/layout/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  const { name, role, brandName, primaryColor, logoUrl } = session.user

  return (
    <>
      <WhiteLabelInit primaryColor={primaryColor} logoUrl={logoUrl} brandName={brandName} />
      <AIAssistant />
      <AppShell
        userName={name!}
        userRole={role}
        brandName={brandName}
        logoUrl={logoUrl}
      >
        {children}
      </AppShell>
    </>
  )
}
