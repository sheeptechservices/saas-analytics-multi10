import type { Metadata } from 'next'
import { Manrope } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'
import { Providers } from '@/components/Providers'
import { auth } from '@/auth'
import { DENSITY_COOKIE, resolveDensity } from '@/lib/density'

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: '300 Franchising',
  description: 'Plataforma de BI integrada ao CRM',
}

// A densidade sai no <html> da própria resposta — cookie lido aqui, sem passar pelo
// cliente. Ler cookie e sessão torna dinâmicas as quatro páginas que eram estáticas
// (/login, /forgot-password, /reset-password, /_not-found); é o preço de não trocar
// a densidade da tela na frente do usuário depois de hidratar.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [jar, session] = await Promise.all([cookies(), auth()])
  const density = resolveDensity(jar.get(DENSITY_COOKIE)?.value, session?.user?.role)

  return (
    <html lang="pt-BR" data-density={density}>
      <body className={manrope.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
