import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { integrations, adCampaigns, adAdsets, adAds, adInsights } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { encrypt } from '@/lib/crypto'

type Params = { params: Promise<{ provider: string }> }

const VALID_PROVIDERS = new Set(['google_ads', 'meta_ads', 'tiktok_ads'])
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

export async function GET(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = session.user.tenantId

  const { provider } = await params
  if (!VALID_PROVIDERS.has(provider)) return NextResponse.json({ error: 'Provider inválido' }, { status: 400 })

  const row = await db
    .select({
      accountId: integrations.accountId,
      clientId: integrations.clientId,
      provider: integrations.provider,
      createdAt: integrations.createdAt,
    })
    .from(integrations)
    .where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, provider)))
    .then(r => r[0] ?? null)

  return NextResponse.json(row)
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = session.user.tenantId

  const { provider } = await params
  if (!VALID_PROVIDERS.has(provider)) return NextResponse.json({ error: 'Provider inválido' }, { status: 400 })

  try {
    const body = await req.json()

    const update: Partial<typeof integrations.$inferInsert> = {}
    if (body.accountId?.trim()) update.accountId = body.accountId.trim()
    if (body.clientId?.trim()) update.clientId = body.clientId.trim()

    if (provider === 'google_ads') {
      if (body.accountDomain?.trim()) update.accountDomain = encrypt(body.accountDomain.trim())
      if (body.clientSecret?.trim()) update.clientSecret = encrypt(body.clientSecret.trim())
      if (body.refreshToken?.trim()) update.refreshToken = encrypt(body.refreshToken.trim())
    } else {
      // meta_ads | tiktok_ads
      if (body.clientSecret?.trim()) update.clientSecret = encrypt(body.clientSecret.trim())
      if (body.accessToken?.trim()) update.accessToken = encrypt(body.accessToken.trim())
    }

    const existing = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, provider)))
      .then(r => r[0])

    if (existing) {
      await db.update(integrations).set(update).where(eq(integrations.id, existing.id))
    } else {
      await db.insert(integrations).values({
        id: uid(),
        tenantId,
        provider,
        ...update,
        createdAt: new Date(),
      })
    }

    const row = await db
      .select({
        accountId: integrations.accountId,
        clientId: integrations.clientId,
        provider: integrations.provider,
        createdAt: integrations.createdAt,
      })
      .from(integrations)
      .where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, provider)))
      .then(r => r[0] ?? null)

    return NextResponse.json({ integration: row })
  } catch (err) {
    console.error(`[ads/${provider} POST]`, err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = session.user.tenantId

  const { provider } = await params
  if (!VALID_PROVIDERS.has(provider)) return NextResponse.json({ error: 'Provider inválido' }, { status: 400 })

  try {
    await db.delete(adInsights).where(and(eq(adInsights.tenantId, tenantId), eq(adInsights.provider, provider)))
    await db.delete(adAds).where(and(eq(adAds.tenantId, tenantId), eq(adAds.provider, provider)))
    await db.delete(adAdsets).where(and(eq(adAdsets.tenantId, tenantId), eq(adAdsets.provider, provider)))
    await db.delete(adCampaigns).where(and(eq(adCampaigns.tenantId, tenantId), eq(adCampaigns.provider, provider)))
    await db.delete(integrations).where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, provider)))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(`[ads/${provider} DELETE]`, err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
