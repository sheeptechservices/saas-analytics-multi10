import type { NextAuthConfig } from 'next-auth'

// Edge-compatible auth config — no Node.js modules (no DB, no bcrypt)
// Used by middleware for JWT verification only
export const authConfig: NextAuthConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
        token.role = (user as any).role
        token.tenantId = (user as any).tenantId
        token.primaryColor = (user as any).primaryColor
        token.logoUrl = (user as any).logoUrl
        token.brandName = (user as any).brandName
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as any
      session.user.tenantId = token.tenantId as string
      session.user.primaryColor = token.primaryColor as string
      session.user.logoUrl = token.logoUrl as string | null
      session.user.brandName = token.brandName as string
      return session
    },
  },
}
