export type Role = 'admin' | 'manager' | 'user'
export type Priority = 'high' | 'normal' | 'low'
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

export interface Pipeline {
  id: string
  tenantId: string
  kommoId: string | null
  name: string
  isArchived: boolean
}

export interface Stage {
  id: string
  pipelineId: string
  kommoId: string | null
  name: string
  color: string
  order: number
}

export interface Lead {
  id: string
  tenantId: string
  pipelineId: string
  stageId: string
  kommoId: string | null
  name: string
  responsibleName: string
  price: number
  createdAt: Date
  updatedAt: Date
  syncedAt: Date | null
}

export interface LeadExtras {
  id: string
  leadId: string
  tenantId: string
  tags: string[]
  notes: string
  priority: Priority
  customFields: Record<string, string>
  updatedAt: Date
}

export interface LeadWithExtras extends Lead {
  extras?: LeadExtras
  stage?: Stage
}

export interface StageWithLeads extends Stage {
  leads: LeadWithExtras[]
}

export interface BIMetrics {
  totalLeads: number
  leadsThisWeek: number
  conversionRate: number
  averageTicket: number
  leadsByStage: Array<{ stageId: string; stageName: string; color: string; count: number; total: number }>
  leadsPerWeek: Array<{ week: string; count: number }>
  topLeads: LeadWithExtras[]
  leadsWithExtras: number
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
  primaryColor: string
  logoUrl: string | null
  brandName: string
}
