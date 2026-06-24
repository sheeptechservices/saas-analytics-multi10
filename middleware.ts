import NextAuth from 'next-auth'
import { authConfig } from './auth.config'
import { NextResponse } from 'next/server'

const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth
  const role = req.auth?.user?.role
  const isMaster = role === 'master'

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/webhooks/') ||
    pathname === '/api/sdr/blast/ack' // server-to-server (n8n); autentica via Bearer próprio

  // 1. Master on /login → /master
  if (isLoggedIn && isMaster && pathname === '/login') {
    return NextResponse.redirect(new URL('/master', req.url))
  }

  // 2. Master on /master/* → allow
  if (isLoggedIn && isMaster && pathname.startsWith('/master')) {
    return NextResponse.next()
  }

  // 3. Non-master on /master/* → /dashboard
  if (isLoggedIn && !isMaster && pathname.startsWith('/master')) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // 4. Master on app pages (non-master routes) → /master
  if (isLoggedIn && isMaster && !pathname.startsWith('/master') && !pathname.startsWith('/api')) {
    return NextResponse.redirect(new URL('/master', req.url))
  }

  if (!isLoggedIn && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (isLoggedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
