import type { Role } from './index'
import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name: string
      email: string
      role: Role
      tenantId: string
      primaryColor: string
      logoUrl: string | null
      brandName: string
    }
  }
  interface User {
    id: string
    name: string
    email: string
    role: Role
    tenantId: string
    primaryColor: string
    logoUrl: string | null
    brandName: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: Role
    tenantId: string
    primaryColor: string
    logoUrl: string | null
    brandName: string
  }
}
