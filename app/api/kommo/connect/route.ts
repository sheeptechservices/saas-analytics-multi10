import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { integrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const integration = await db.select().from(integrations)
    .where(and(eq(integrations.tenantId, session.user.tenantId), eq(integrations.provider, 'kommo')))
    .then(r => r[0])

  if (!integration?.clientId || !integration?.accountDomain) {
    return NextResponse.json({ error: 'Credenciais não encontradas' }, { status: 400 })
  }

  const redirectUri = process.env.KOMMO_REDIRECT_URI ?? 'http://localhost:3000/api/kommo/callback'
  const oauthUrl = `https://www.kommo.com/oauth?client_id=${integration.clientId}&state=${session.user.tenantId}&mode=popup&redirect_uri=${encodeURIComponent(redirectUri)}`

  return NextResponse.json({ oauthUrl })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, clientSecret, accountDomain } = await req.json()

  if (!clientId || !clientSecret || !accountDomain) {
    return NextResponse.json({ error: 'Campos obrigatórios: clientId, clientSecret, accountDomain' }, { status: 400 })
  }

  const existing = await db.select().from(integrations)
    .where(and(eq(integrations.tenantId, session.user.tenantId), eq(integrations.provider, 'kommo')))
    .then(r => r[0])

  if (existing) {
    await db.update(integrations)
      .set({ clientId, clientSecret, accountDomain })
      .where(eq(integrations.id, existing.id))
  } else {
    await db.insert(integrations).values({
      id: uid(),
      tenantId: session.user.tenantId,
      provider: 'kommo',
      clientId,
      clientSecret,
      accountDomain,
      createdAt: new Date(),
    })
  }

  const redirectUri = process.env.KOMMO_REDIRECT_URI ?? 'http://localhost:3000/api/kommo/callback'
  const oauthUrl = `https://www.kommo.com/oauth?client_id=${clientId}&state=${session.user.tenantId}&mode=popup&redirect_uri=${encodeURIComponent(redirectUri)}`

  return NextResponse.json({ oauthUrl })
}
