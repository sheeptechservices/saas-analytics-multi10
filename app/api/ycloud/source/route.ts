import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { encrypt, decrypt } from '@/lib/crypto'
import { randomUUID, randomBytes } from 'crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { getProvider } from '@/lib/providers/registry'
import { runBackfill } from '@/lib/sync/runner'
import { waitUntil } from '@vercel/functions'

const PROVIDER_KEY = 'ycloud-whatsapp'
const MODULE_KEY   = 'integration.ycloud-whatsapp'

function getBaseUrl(): string {
  return process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'
}

function buildWebhookUrl(token: string): string {
  return `${getBaseUrl()}/api/webhooks/ycloud/${token}`
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return '••••'
  return `••••${apiKey.slice(-4)}`
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await assertEntitlement(session.user.tenantId, MODULE_KEY)
  if (denied) return denied

  const row = await db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.tenantId, session.user.tenantId),
        eq(dataSources.providerKey, PROVIDER_KEY)
      )
    )
    .then(r => r[0])

  if (!row) return NextResponse.json({ configured: false })

  let apiKeyMasked: string | null = null
  let fromPhone:    string | null = null
  if (row.configEnc) {
    try {
      const cfg = JSON.parse(decrypt(row.configEnc)) as { apiKey?: string; fromPhone?: string }
      if (cfg.apiKey)    apiKeyMasked = maskApiKey(cfg.apiKey)
      if (cfg.fromPhone) fromPhone    = cfg.fromPhone
    } catch {
      // keep nulls — config is unreadable but don't surface crypto errors
    }
  }

  const webhookUrl = row.webhookToken ? buildWebhookUrl(row.webhookToken) : null

  return NextResponse.json({
    configured: true,
    status:          row.status,
    lastSyncAt:      row.lastSyncAt ? row.lastSyncAt.getTime() : null,
    lastSyncStatus:  row.lastSyncStatus,
    lastSyncError:   row.lastSyncError,
    apiKeyMasked,
    fromPhone,
    webhookUrl,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await assertEntitlement(session.user.tenantId, MODULE_KEY)
  if (denied) return denied

  const body = await req.json()
  const { apiKey, webhookSecret, fromPhone } = body as { apiKey?: string; webhookSecret?: string; fromPhone?: string }

  const provider = getProvider(PROVIDER_KEY)
  if (!provider) {
    return NextResponse.json({ error: 'Provider não encontrado' }, { status: 500 })
  }

  try {
    provider.parseConfig({ apiKey, webhookSecret, fromPhone })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  try {
    const configEnc = encrypt(JSON.stringify({ apiKey, webhookSecret, fromPhone }))
    const now = new Date()
    const tenantId = session.user.tenantId

    const existing = await db
      .select()
      .from(dataSources)
      .where(
        and(
          eq(dataSources.tenantId, tenantId),
          eq(dataSources.providerKey, PROVIDER_KEY)
        )
      )
      .then(r => r[0])

    let webhookToken: string
    let savedRow: typeof dataSources.$inferSelect

    if (existing) {
      await db
        .update(dataSources)
        .set({ configEnc, status: 'connected', updatedAt: now })
        .where(eq(dataSources.id, existing.id))

      // Preserve the existing token — regenerating would break the URL already
      // registered in the YCloud dashboard.
      webhookToken = existing.webhookToken ?? randomBytes(32).toString('hex')

      if (!existing.webhookToken) {
        await db
          .update(dataSources)
          .set({ webhookToken })
          .where(eq(dataSources.id, existing.id))
      }

      savedRow = { ...existing, configEnc, status: 'connected', webhookToken, updatedAt: now }
    } else {
      webhookToken = randomBytes(32).toString('hex')
      const insertId = randomUUID()
      await db.insert(dataSources).values({
        id:           insertId,
        tenantId,
        providerKey:  PROVIDER_KEY,
        label:        'YCloud (WhatsApp)',
        configEnc,
        status:       'connected',
        webhookToken,
        createdAt:    now,
        updatedAt:    now,
      })
      savedRow = {
        id:             insertId,
        tenantId,
        providerKey:    PROVIDER_KEY,
        label:          'YCloud (WhatsApp)',
        configEnc,
        status:         'connected',
        syncCursor:     null,
        lastSyncAt:     null,
        lastSyncStatus: null,
        lastSyncError:  null,
        webhookToken,
        createdAt:      now,
        updatedAt:      now,
      }
    }

    try {
      waitUntil(runBackfill(savedRow).catch(err => console.error('[ycloud backfill]', err)))
    } catch (err) {
      console.error('[ycloud backfill schedule]', err)
    }

    return NextResponse.json({ ok: true, webhookUrl: buildWebhookUrl(webhookToken) })
  } catch (err) {
    console.error('[ycloud source POST]', err)
    return NextResponse.json(
      { ok: false, error: String((err as Error)?.message ?? err) },
      { status: 500 }
    )
  }
}
