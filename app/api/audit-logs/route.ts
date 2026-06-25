// GET /api/audit-logs
//
// Returns paginated audit log.
// Auth: admin or master only.
// Query params: ?limit (default 50, max 200) | ?offset | ?action
//   Master-only extras: ?scope=all (cross-tenant) | ?tenantId=<id> (filter to tenant)
// Admin always scoped to own tenantId; scope/tenantId params are ignored for admin.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { auditLogs, tenants } from '@/lib/db/schema'
import { and, eq, sql, desc } from 'drizzle-orm'
import { requireRole } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roleCheck = requireRole(['admin', 'master'], session)
  if (roleCheck) return roleCheck

  const sp = req.nextUrl.searchParams

  const limit  = Math.min(Math.max(parseInt(sp.get('limit')  ?? '50',  10) || 50,  1), 200)
  const offset = Math.max(parseInt(sp.get('offset') ?? '0',   10) || 0,  0)
  const action = sp.get('action') ?? ''

  const isMaster      = session.user.role === 'master'
  const scopeAll      = isMaster && sp.get('scope') === 'all'
  const tenantIdParam = sp.get('tenantId') ?? ''

  // Resolve the tenant filter:
  //  - non-master: always own tenantId (ignore all params)
  //  - master + scope=all + no tenantId param: no tenant filter (all tenants)
  //  - master + scope=all + tenantId param: filter to that tenant
  //  - master without scope=all: treat as own tenant (backward compat)
  const tenantIdFilter: string | null =
    !isMaster        ? session.user.tenantId
    : scopeAll && tenantIdParam ? tenantIdParam
    : scopeAll       ? null
    : session.user.tenantId

  const where = and(
    tenantIdFilter !== null ? eq(auditLogs.tenantId, tenantIdFilter) : undefined,
    action ? eq(auditLogs.action, action) : undefined,
  )

  if (scopeAll) {
    // Cross-tenant query: JOIN with tenants to get tenant name
    const [rows, countRow] = await Promise.all([
      db
        .select({
          id:          auditLogs.id,
          createdAt:   auditLogs.createdAt,
          actorName:   auditLogs.actorName,
          actorEmail:  auditLogs.actorEmail,
          actorRole:   auditLogs.actorRole,
          action:      auditLogs.action,
          entityType:  auditLogs.entityType,
          entityId:    auditLogs.entityId,
          metadata:    auditLogs.metadata,
          ip:          auditLogs.ip,
          tenantId:    auditLogs.tenantId,
          tenantName:  tenants.name,
        })
        .from(auditLogs)
        .leftJoin(tenants, eq(auditLogs.tenantId, tenants.id))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)` })
        .from(auditLogs)
        .where(where),
    ])

    return NextResponse.json({
      logs: rows.map(r => ({
        ...r,
        metadata: (() => { try { return JSON.parse(r.metadata) } catch { return {} } })(),
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      })),
      total: Number(countRow[0]?.total ?? 0),
    })
  }

  // Default (scoped) query — same as before, no tenant join
  const [rows, countRow] = await Promise.all([
    db
      .select({
        id:          auditLogs.id,
        createdAt:   auditLogs.createdAt,
        actorName:   auditLogs.actorName,
        actorEmail:  auditLogs.actorEmail,
        actorRole:   auditLogs.actorRole,
        action:      auditLogs.action,
        entityType:  auditLogs.entityType,
        entityId:    auditLogs.entityId,
        metadata:    auditLogs.metadata,
        ip:          auditLogs.ip,
      })
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(auditLogs)
      .where(where),
  ])

  return NextResponse.json({
    logs: rows.map(r => ({
      ...r,
      metadata: (() => { try { return JSON.parse(r.metadata) } catch { return {} } })(),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    })),
    total: Number(countRow[0]?.total ?? 0),
  })
}
