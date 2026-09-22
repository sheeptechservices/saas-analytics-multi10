import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { tenants, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requireMaster } from '@/lib/auth-guard'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = await db.select().from(tenants)
    .where(eq(tenants.id, session.user.tenantId))
    .then(r => r[0])

  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const teamUsers = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    avatarColor: users.avatarColor,
    avatarBg: users.avatarBg,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.tenantId, session.user.tenantId))

  return NextResponse.json({ tenant, users: teamUsers })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Exceção à conta única, por decisão do dono: a marca é da plataforma. O mesmo
  // tenant já é editado em /master (TenantEditor → PATCH /api/master/tenants/:id);
  // este PUT continua existindo só para o master. O GET acima segue aberto: sem
  // ler a marca a aplicação não pinta a tela.
  const roleCheck = requireMaster(session)
  if (roleCheck) return roleCheck

  const body = await req.json()
  const { primaryColor, logoUrl, name } = body

  await db.update(tenants)
    .set({
      ...(primaryColor && { primaryColor }),
      ...(logoUrl !== undefined && { logoUrl }),
      ...(name && { name }),
    })
    .where(eq(tenants.id, session.user.tenantId))

  const changedKeys = Object.entries({ primaryColor, logoUrl, name }).filter(([, v]) => v !== undefined).map(([k]) => k)
  await logAudit({ req, session, action: 'whitelabel.update', metadata: { changedKeys } })
  return NextResponse.json({ ok: true })
}
