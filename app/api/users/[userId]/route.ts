import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { Session } from 'next-auth'

type Params = { params: Promise<{ userId: string }> }

function canManage(role: string) {
  return role === 'admin' || role === 'master'
}

async function resolveTarget(userId: string, session: Session) {
  const user = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      tenantId: users.tenantId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .then(r => r[0] ?? null)

  if (!user) return null
  if (session.user.role === 'admin' && user.tenantId !== session.user.tenantId) return null
  return user
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params
  const user = await resolveTarget(userId, session)
  if (!user) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const { id, name, email, role, createdAt } = user
  return NextResponse.json({ id, name, email, role, createdAt })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params
  const target = await resolveTarget(userId, session)
  if (!target) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const { name, role } = body

  if (role !== undefined) {
    if (!['admin', 'manager', 'user'].includes(role)) {
      return NextResponse.json({ error: 'Role inválido.' }, { status: 400 })
    }
    if (userId === session.user.id) {
      return NextResponse.json({ error: 'Você não pode alterar seu próprio role.' }, { status: 400 })
    }
  }

  const updates: Record<string, unknown> = {}
  if (typeof name === 'string' && name.trim()) updates.name = name.trim()
  if (role !== undefined) updates.role = role

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo para atualizar.' }, { status: 400 })
  }

  await db.update(users).set(updates).where(eq(users.id, userId))

  const updated = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .then(r => r[0])

  const changes: Record<string, unknown> = {}
  if (updates.name !== undefined) changes.name = updates.name
  if (updates.role !== undefined) changes.role = updates.role
  await logAudit({ req, session, action: 'user.update', entityType: 'user', entityId: userId, metadata: { changes }, tenantId: target.tenantId ?? undefined })
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await params

  if (userId === session.user.id) {
    return NextResponse.json({ error: 'Você não pode remover sua própria conta.' }, { status: 400 })
  }

  const target = await resolveTarget(userId, session)
  if (!target) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  await db.delete(users).where(eq(users.id, userId))

  await logAudit({ req, session, action: 'user.delete', entityType: 'user', entityId: userId, tenantId: target.tenantId ?? undefined })
  return NextResponse.json({ message: 'Usuário removido com sucesso.' })
}
