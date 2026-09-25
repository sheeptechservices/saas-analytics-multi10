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
import { after } from 'next/server'
import { configuredOrigin } from '@/lib/origin'

const PROVIDER_KEY = 'ycloud-whatsapp'
const MODULE_KEY   = 'integration.ycloud-whatsapp'

// Fica na origem configurada de propósito: esta URL é registrada na YCloud e precisa ser
// estável e igual para todos. Origem tirada da requisição daria um webhook diferente a
// cada subdomínio de acesso. O outro caso da mesma família é o `ackUrl` que
// lib/sdr/rodada.ts manda ao disparador — pela mesma razão, e porque uma URL escrita à
// mão dentro de um fluxo do n8n já envelheceu numa troca de host e quebrou o histórico
// de disparo em silêncio.
function getBaseUrl(): string {
  return configuredOrigin()
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

    /* `after` do Next, e não o `waitUntil` da Vercel: o backfill roda depois da
     * resposta, sem segurar o operador esperando uma sincronização que pode levar
     * minutos.
     *
     * O `waitUntil` do `@vercel/functions` era NO-OP fora da Vercel — `getContext()`
     * devolvia `{}` e a chamada não fazia nada. O backfill acontecia assim mesmo, por
     * acidente: a promessa já tinha sido criada e o processo Node persiste. Funcionava
     * e não era suportado por ninguém. O `after` é a mesma intenção com apoio do
     * framework, e sem depender de um pacote de outra hospedagem. */
    try {
      after(() => runBackfill(savedRow).catch(err => console.error('[ycloud backfill]', err)))
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
