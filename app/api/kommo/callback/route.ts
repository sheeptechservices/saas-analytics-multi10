import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { integrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const tenantId = searchParams.get('state')

  if (!code || !tenantId) {
    return NextResponse.redirect(new URL('/integration?error=invalid_callback', req.url))
  }

  const integration = await db.select().from(integrations)
    .where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, 'kommo')))
    .then(r => r[0])

  if (!integration?.clientId || !integration?.clientSecret || !integration?.accountDomain) {
    return NextResponse.redirect(new URL('/integration?error=missing_credentials', req.url))
  }

  try {
    const res = await fetch(`https://${integration.accountDomain}.kommo.com/oauth2/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: integration.clientId,
        client_secret: integration.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.KOMMO_REDIRECT_URI ?? 'http://localhost:3000/api/kommo/callback',
      }),
    })

    if (!res.ok) {
      return NextResponse.redirect(new URL('/integration?error=token_exchange', req.url))
    }

    const data = await res.json()
    const expiresAt = new Date(Date.now() + data.expires_in * 1000)

    await db.update(integrations).set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    }).where(eq(integrations.id, integration.id))

    return NextResponse.redirect(new URL('/integration?connected=true', req.url))
  } catch {
    return NextResponse.redirect(new URL('/integration?error=network', req.url))
  }
}
