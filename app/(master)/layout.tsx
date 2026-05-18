import { auth, signOut } from '@/auth'
import { redirect } from 'next/navigation'
import { MasterShell } from './MasterShell'

export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (session?.user?.role !== 'master') redirect('/dashboard')

  async function logout() {
    'use server'
    await signOut({ redirectTo: '/login' })
  }

  return (
    <MasterShell userName={session.user.name ?? 'master'} logoutAction={logout}>
      {children}
    </MasterShell>
  )
}
