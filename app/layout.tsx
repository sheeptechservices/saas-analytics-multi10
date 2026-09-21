import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'
import { Providers } from '@/components/Providers'
import { auth } from '@/auth'
import { DENSITY_COOKIE, resolveDensity } from '@/lib/density'
import { ANIMATION_GATE_SCRIPT } from './animation-gate-script'

// As duas entram como variável CSS, não como className: o globals.css lê
// var(--font-inter) e var(--font-jetbrains-mono) dentro do bloco @theme. Se
// viessem por className, --font-sans cairia na cadeia de reserva e o produto
// inteiro renderizaria em system-ui — sem erro de build e sem aviso de lint.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
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
    // suppressHydrationWarning: o script do <head> escreve data-animate no <html>
    // antes da hidratação — é o objetivo dele —, e o React acusaria o atributo que
    // a árvore do servidor não tem. Vale só para os atributos deste elemento; os
    // filhos continuam verificados.
    <html
      lang="pt-BR"
      data-density={density}
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Decide data-animate antes da primeira pintura. O HTML do servidor sai
            no estado final; sem esta decisão síncrona, o gráfico apareceria
            pronto e voltaria ao início da animação depois de hidratar.
            A regra é a mesma de lib/animation-gate.ts, e lib/animation-gate.test.ts
            compara as duas nas sete fronteiras de período. */}
        <script dangerouslySetInnerHTML={{ __html: ANIMATION_GATE_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
