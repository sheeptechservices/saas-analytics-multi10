import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { encrypt, decrypt } from '@/lib/crypto'
import { randomUUID } from 'crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { getProvider } from '@/lib/providers/registry'
import { runBackfill } from '@/lib/sync/runner'
import { waitUntil } from '@vercel/functions'

const PROVIDER_KEY = 'supabase-n8n'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await assertEntitlement(session.user.tenantId, 'integration.sdr-source')
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

  let connMasked = 'postgres://••••'
  if (row.configEnc) {
    try {
      const cfg = JSON.parse(decrypt(row.configEnc)) as { connectionString?: string }
      if (cfg.connectionString) {
        const url = new URL(cfg.connectionString)
        connMasked = `${url.protocol}//****@${url.host}${url.pathname}`
      }
    } catch {
      // keep default mask
    }
  }

  return NextResponse.json({
    configured: true,
    status: row.status,
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.getTime() : null,
    lastSyncStatus: row.lastSyncStatus,
    lastSyncError: row.lastSyncError,
    hasConfig: Boolean(row.configEnc),
    connMasked,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await assertEntitlement(session.user.tenantId, 'integration.sdr-source')
  if (denied) return denied

  const body = await req.json()
  const { connectionString } = body as { connectionString?: string }

  if (!connectionString || typeof connectionString !== 'string') {
    return NextResponse.json({ error: 'connectionString é obrigatório' }, { status: 400 })
  }

  const provider = getProvider(PROVIDER_KEY)
  if (!provider) {
    return NextResponse.json({ error: 'Provider não encontrado' }, { status: 500 })
  }

  try {
    provider.parseConfig({ connectionString })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  try {
    const configEnc = encrypt(JSON.stringify({ connectionString }))
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

    let savedRow: typeof dataSources.$inferSelect

    if (existing) {
      await db
        .update(dataSources)
        .set({ configEnc, status: 'connected', syncCursor: null, updatedAt: now })
        .where(eq(dataSources.id, existing.id))
      savedRow = {
        ...existing,
        configEnc,
        status: 'connected',
        syncCursor: null,
        updatedAt: now,
      }
    } else {
      const id = randomUUID()
      await db.insert(dataSources).values({
        id,
        tenantId,
        providerKey: PROVIDER_KEY,
        label: 'Fonte SDR (Supabase / n8n)',
        configEnc,
        status: 'connected',
        syncCursor: null,
        createdAt: now,
        updatedAt: now,
      })
      savedRow = {
        id,
        tenantId,
        providerKey: PROVIDER_KEY,
        label: 'Fonte SDR (Supabase / n8n)',
        configEnc,
        status: 'connected',
        syncCursor: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
        createdAt: now,
        updatedAt: now,
      }
    }

    try {
      waitUntil(runBackfill(savedRow).catch(err => console.error('[sdr backfill]', err)))
    } catch (err) {
      console.error('[sdr backfill schedule]', err)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[sdr source POST]', err)
    return NextResponse.json({ ok: false, error: String((err as Error)?.message ?? err) })
  }
}
