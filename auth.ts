import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { authConfig } from './auth.config'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const { db } = await import('@/lib/db')
        const { users, tenants } = await import('@/lib/db/schema')
        const { eq } = await import('drizzle-orm')

        const user = await db
          .select()
          .from(users)
          .where(eq(users.email, credentials.email as string))
          .then(r => r[0])

        if (!user) return null

        const valid = await bcrypt.compare(credentials.password as string, user.passwordHash)
        if (!valid) return null

        const tenant = await db
          .select()
          .from(tenants)
          .where(eq(tenants.id, user.tenantId))
          .then(r => r[0])

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId,
          primaryColor: tenant?.primaryColor ?? '#FFB400',
          logoUrl: tenant?.logoUrl ?? null,
          brandName: tenant?.name ?? 'Multi10',
        }
      },
    }),
  ],
})
