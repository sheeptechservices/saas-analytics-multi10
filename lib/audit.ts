import { randomUUID } from 'crypto'
import type { Session } from 'next-auth'
import { db } from '@/lib/db'
import { auditLogs } from '@/lib/db/schema'

interface AuditOpts {
  req:         Request
  session:     Session
  action:      string
  entityType?: string
  entityId?:   string
  metadata?:   Record<string, unknown>
  tenantId?:   string   // override session.user.tenantId (e.g. for master acting on another tenant)
}

/**
 * Fire-and-forget audit log. Always resolves — never throws.
 * Await it so the write flushes before the serverless function exits.
 */
export async function logAudit(opts: AuditOpts): Promise<void> {
  try {
    const { req, session, action, entityType, entityId, metadata, tenantId: tenantIdOverride } = opts
    const u = session.user

    const rawTenant = tenantIdOverride !== undefined ? tenantIdOverride : u.tenantId
    const tenantId  = rawTenant && rawTenant.trim() ? rawTenant.trim() : null

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      ?? req.headers.get('x-real-ip')
      ?? null
    const userAgent = req.headers.get('user-agent') ?? null

    await db.insert(auditLogs).values({
      id:         randomUUID(),
      tenantId,
      actorId:    u.id    || null,
      actorEmail: u.email || null,
      actorName:  u.name  || null,
      actorRole:  u.role  || null,
      action,
      entityType: entityType ?? null,
      entityId:   entityId   ?? null,
      metadata:   JSON.stringify(metadata ?? {}),
      ip,
      userAgent,
      createdAt:  new Date(),
    })
  } catch (e) {
    console.error('[audit]', e)
  }
}
