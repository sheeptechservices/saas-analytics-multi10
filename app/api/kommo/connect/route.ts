import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { integrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { encrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await assertEntitlement(session.user.tenantId, 'integration.kommo')
  if (denied) return denied

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
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!session.user.tenantId) return NextResponse.json({ error: 'Usuário não possui tenant associado' }, { status: 400 })

    const denied = await assertEntitlement(session.user.tenantId, 'integration.kommo')
    if (denied) return denied

    const { clientId, clientSecret, accountDomain } = await req.json()

    if (!clientId || !clientSecret || !accountDomain) {
      return NextResponse.json({ error: 'Campos obrigatórios: clientId, clientSecret, accountDomain' }, { status: 400 })
    }

    const existing = await db.select().from(integrations)
      .where(and(eq(integrations.tenantId, session.user.tenantId), eq(integrations.provider, 'kommo')))
      .then(r => r[0])

    const encryptedSecret = encrypt(clientSecret)
    if (existing) {
      await db.update(integrations)
        .set({ clientId, clientSecret: encryptedSecret, accountDomain })
        .where(eq(integrations.id, existing.id))
    } else {
      await db.insert(integrations).values({
        id: uid(),
        tenantId: session.user.tenantId,
        provider: 'kommo',
        clientId,
        clientSecret: encryptedSecret,
        accountDomain,
        createdAt: new Date(),
      })
    }

    const redirectUri = process.env.KOMMO_REDIRECT_URI ?? 'http://localhost:3000/api/kommo/callback'
    const oauthUrl = `https://www.kommo.com/oauth?client_id=${clientId}&state=${session.user.tenantId}&mode=popup&redirect_uri=${encodeURIComponent(redirectUri)}`

    return NextResponse.json({ oauthUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[kommo/connect POST]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
