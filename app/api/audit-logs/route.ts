// GET /api/audit-logs
//
// Returns paginated audit log for the session's tenant.
// Auth: admin or master only.
// Query params: ?limit (default 50, max 200) | ?offset | ?action

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { auditLogs } from '@/lib/db/schema'
import { and, eq, sql, desc } from 'drizzle-orm'
import { requireRole } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roleCheck = requireRole(['admin', 'master'], session)
  if (roleCheck) return roleCheck

  const { tenantId } = session.user
  const sp = req.nextUrl.searchParams

  const limit  = Math.min(Math.max(parseInt(sp.get('limit')  ?? '50',  10) || 50,  1), 200)
  const offset = Math.max(parseInt(sp.get('offset') ?? '0',   10) || 0,  0)
  const action = sp.get('action') ?? ''

  const where = and(
    eq(auditLogs.tenantId, tenantId),
    action ? eq(auditLogs.action, action) : undefined,
  )

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
