import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { tenants, users } from '@/lib/db/schema'
import { count, eq, desc } from 'drizzle-orm'
import { validateSlug, slugErrorMessage, slugFromName } from '@/lib/slug'
import { normalizeHex, DEFAULT_PRIMARY } from '@/lib/brand'

export async function GET() {
  const session = await auth()
  if (session?.user?.role !== 'master') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      primaryColor: tenants.primaryColor,
      logoUrl: tenants.logoUrl,
      createdAt: tenants.createdAt,
      userCount: count(users.id),
    })
    .from(tenants)
    .leftJoin(users, eq(users.tenantId, tenants.id))
    .groupBy(tenants.id)
    .orderBy(desc(tenants.createdAt))

  return NextResponse.json({ tenants: rows })
}

/**
 * Cria um cliente. Até aqui não havia caminho de criação no produto — tenant novo
 * nascia por script ou na mão no banco, sem validação nenhuma de slug.
 *
 * Body: { name: string, slug?: string, primaryColor?: string, logoUrl?: string }
 * Sem slug, deriva do nome — mas o derivado passa pela mesma validação, então nome
 * como "App" devolve erro de reservado em vez de virar endereço da plataforma.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (session?.user?.role !== 'master') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: 'Informe o nome do cliente.' }, { status: 400 })
  }

  const slug = typeof body.slug === 'string' && body.slug.trim()
    ? body.slug.trim().toLowerCase()
    : slugFromName(name)

  const motivo = validateSlug(slug)
  if (motivo) {
    return NextResponse.json({ error: slugErrorMessage(motivo), campo: 'slug', motivo }, { status: 400 })
  }

  // Unicidade verificada aqui para dar erro legível; a coluna é unique, então corrida
  // entre dois cadastros ainda esbarra na restrição do banco e cai no catch abaixo.
  const jaExiste = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .then(r => r[0])
  if (jaExiste) {
    return NextResponse.json(
      { error: `O endereço "${slug}" já pertence a outro cliente.`, campo: 'slug', motivo: 'em-uso' },
      { status: 409 },
    )
  }

  const primaryColor = normalizeHex(body.primaryColor as string) ?? DEFAULT_PRIMARY
  const logoUrl = typeof body.logoUrl === 'string' && body.logoUrl.trim() ? body.logoUrl.trim() : null

  const id = randomUUID()
  const createdAt = new Date()

  try {
    await db.insert(tenants).values({ id, name, slug, primaryColor, logoUrl, createdAt })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/unique/i.test(msg)) {
      return NextResponse.json(
        { error: `O endereço "${slug}" já pertence a outro cliente.`, campo: 'slug', motivo: 'em-uso' },
        { status: 409 },
      )
    }
    console.error('[master tenants POST]', err)
    return NextResponse.json({ error: 'Não foi possível criar o cliente.' }, { status: 500 })
  }

  await logAudit({
    req,
    session,
    action: 'tenant.create',
    entityType: 'tenant',
    entityId: id,
    metadata: { name, slug, primaryColor, logoUrl },
    tenantId: id,
  })

  return NextResponse.json(
    { id, name, slug, primaryColor, logoUrl, createdAt, userCount: 0 },
    { status: 201 },
  )
}
