import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { Session } from 'next-auth'
import { requireMaster, requireTenantUser } from '@/lib/auth-guard'
import { sharesTenant } from '@/lib/roles'

type Params = { params: Promise<{ userId: string }> }

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
  // Isolamento: o usuário do cliente só alcança quem é do próprio tenant. Só o
  // master atravessa — e isso não mudou com a conta única.
  if (!sharesTenant(session.user, user.tenantId)) return null
  return user
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roleCheck = requireTenantUser(session)
  if (roleCheck) return roleCheck

  const { userId } = await params
  const user = await resolveTarget(userId, session)
  if (!user) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const { id, name, email, role, createdAt } = user
  return NextResponse.json({ id, name, email, role, createdAt })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roleCheck = requireTenantUser(session)
  if (roleCheck) return roleCheck

  const { userId } = await params
  const target = await resolveTarget(userId, session)
  if (!target) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  // Conta única: só o nome é editável. Um `role` no corpo é ignorado, do mesmo
  // jeito que no POST — não há papel de tenant para escolher, e trocar o papel de
  // alguém deixou de ser uma operação do produto.
  const { name } = body

  const updates: Record<string, unknown> = {}
  if (typeof name === 'string' && name.trim()) updates.name = name.trim()

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
  await logAudit({ req, session, action: 'user.update', entityType: 'user', entityId: userId, metadata: { changes }, tenantId: target.tenantId ?? undefined })
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Exceção à conta única, por decisão do dono: remover conta é irreversível e
  // apaga o acesso de outra pessoa, então fica com a plataforma. Listar,
  // convidar e renomear seguem abertos a todo usuário do cliente.
  const roleCheck = requireMaster(session)
  if (roleCheck) return roleCheck

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
