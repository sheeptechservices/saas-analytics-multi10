export type Role = 'master' | 'admin' | 'manager' | 'user'
export type IntegrationStatus = 'connected' | 'expired' | 'disconnected'

export interface Tenant {
  id: string
  name: string
  slug: string
  primaryColor: string
  logoUrl: string | null
  createdAt: Date
}

export interface User {
  id: string
  tenantId: string
  name: string
  email: string
  role: Role
  avatarColor: string
  avatarBg: string
  createdAt: Date
}

export interface Integration {
  id: string
  tenantId: string
  provider: string
  accountDomain: string | null
  accountId: string | null
  expiresAt: Date | null
  createdAt: Date
}

export interface WhiteLabelConfig {
  primaryColor: string
  logoUrl: string | null
  brandName: string
}

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
  tenantId: string
}
