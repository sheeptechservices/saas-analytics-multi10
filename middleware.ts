import NextAuth from 'next-auth'
import { authConfig } from './auth.config'
import { NextResponse } from 'next/server'
import { requestOrigin } from '@/lib/origin'

const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const { pathname } = req.nextUrl

  // Redirecionar sempre para a origem de quem pediu, não para req.url: o next-auth
  // reescreve a origem da requisição com AUTH_URL/NEXTAUTH_URL quando essas existem
  // (lib/env.js, reqWithEnvURL), e aí todo redirecionamento sai para a origem de um
  // tenant só — ou, em desenvolvimento, para uma porta onde não há servidor nenhum.
  const origem = requestOrigin(req) ?? req.nextUrl.origin
  const paraApp = (destino: string) => NextResponse.redirect(new URL(destino, origem))
  const isLoggedIn = !!req.auth
  const role = req.auth?.user?.role
  const isMaster = role === 'master'

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/api/cron/') ||      // agendador externo; autentica via Bearer CRON_SECRET (lib/cron-auth.ts)
    pathname === '/api/sdr/blast/ack' ||    // server-to-server (n8n); autentica via Bearer próprio
    pathname === '/api/sdr/dispatch/ack'    // idem (ack do drip/campanha)

  // 1. Master on /login → /master
  if (isLoggedIn && isMaster && pathname === '/login') {
    return paraApp('/master')
  }

  // 2. Master on /master/* → allow
  if (isLoggedIn && isMaster && pathname.startsWith('/master')) {
    return NextResponse.next()
  }

  // 3. Non-master on /master/* → /dashboard
  if (isLoggedIn && !isMaster && pathname.startsWith('/master')) {
    return paraApp('/dashboard')
  }

  // 4. Master on app pages (non-master routes) → /master
  if (isLoggedIn && isMaster && !pathname.startsWith('/master') && !pathname.startsWith('/api')) {
    return paraApp('/master')
  }

  if (!isLoggedIn && !isPublic) {
    return paraApp('/login')
  }

  if (isLoggedIn && pathname === '/login') {
    return paraApp('/dashboard')
  }

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
