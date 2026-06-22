// POST /api/ycloud/messages
//
// Sends a WhatsApp message (text or template) and records the outbound
// conversation as role='ai' in Turso (idempotent via YCloud message id).
//
// Request body (discriminated on type):
//   { to: string; type: 'text'; body: string }
//   { to: string; type: 'template'; templateName: string; languageCode: string; components?: unknown[] }
//
// 24-hour window rule (WhatsApp policy):
//   Free-form text is only allowed within 24h of the customer's last inbound message.
//   Outside that window, or when no inbound message exists for the session, only
//   templates are permitted. Attempting to send text outside the window returns 422.
//
// Response on success: { ok: true, messageId: string }
// Requires module 'integration.ycloud-whatsapp'.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { dataSources, conversations } from '@/lib/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { assertEntitlement } from '@/lib/entitlements'
import { yCloudProvider, sendWhatsappMessage } from '@/lib/providers/ycloud'
import type { SendWhatsappParams } from '@/lib/providers/ycloud'
import { upsertBatch } from '@/lib/sync/runner'

const PROVIDER_KEY = 'ycloud-whatsapp'
const MODULE_KEY   = 'integration.ycloud-whatsapp'

// WhatsApp policy: free-form text window (ms)
const WINDOW_24H_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, MODULE_KEY)
  if (denied) return denied

  // ── Parse body ──────────────────────────────────────────────────────────────

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'body_required' }, { status: 400 })
  }

  const b = raw as Record<string, unknown>
  const to   = typeof b.to   === 'string' ? b.to.trim()   : ''
  const type = b.type

  if (!to) {
    return NextResponse.json(
      { error: 'to_required', message: '"to" (E.164 phone) é obrigatório' },
      { status: 400 },
    )
  }
  if (type !== 'text' && type !== 'template') {
    return NextResponse.json(
      { error: 'type_invalid', message: '"type" deve ser "text" ou "template"' },
      { status: 400 },
    )
  }
  if (type === 'text') {
    if (!b.body || typeof b.body !== 'string' || !(b.body as string).trim()) {
      return NextResponse.json(
        { error: 'body_required', message: '"body" é obrigatório para type=text' },
        { status: 400 },
      )
    }
  }
  if (type === 'template') {
    if (!b.templateName || typeof b.templateName !== 'string') {
      return NextResponse.json(
        { error: 'templateName_required', message: '"templateName" é obrigatório para type=template' },
        { status: 400 },
      )
    }
    if (!b.languageCode || typeof b.languageCode !== 'string') {
      return NextResponse.json(
        { error: 'languageCode_required', message: '"languageCode" é obrigatório para type=template' },
        { status: 400 },
      )
    }
  }

  // ── Load & decrypt config ───────────────────────────────────────────────────

  const row = await db
    .select()
    .from(dataSources)
    .where(and(
      eq(dataSources.tenantId, tenantId),
      eq(dataSources.providerKey, PROVIDER_KEY),
    ))
    .then(r => r[0])

  if (!row?.configEnc) {
    return NextResponse.json({ error: 'integration_not_configured' }, { status: 404 })
  }

  let cfg: ReturnType<typeof yCloudProvider.parseConfig>
  try {
    cfg = yCloudProvider.parseConfig(JSON.parse(decrypt(row.configEnc)))
  } catch (err) {
    return NextResponse.json(
      { error: 'config_invalid', message: (err as Error).message },
      { status: 500 },
    )
  }

  // ── 24-hour window check (text-only) ───────────────────────────────────────
  //
  // occurredAt is mode:'timestamp' → Drizzle stores as INTEGER seconds,
  // returns Date objects on read. `.getTime()` gives epoch ms.
  // We sort descending and take the single latest inbound row to avoid a
  // MAX() aggregate that would bypass Drizzle's timestamp conversion.

  if (type === 'text') {
    const [latest] = await db
      .select({ occurredAt: conversations.occurredAt })
      .from(conversations)
      .where(and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.source,   'ycloud-whatsapp'),
        eq(conversations.sessionId, to),
        eq(conversations.role,      'human'),
      ))
      .orderBy(desc(conversations.occurredAt))
      .limit(1)

    // epoch ms of the last inbound message from this customer
    const lastInboundMs = latest?.occurredAt instanceof Date
      ? latest.occurredAt.getTime()
      : null

    const inWindow = lastInboundMs != null && (Date.now() - lastInboundMs) <= WINDOW_24H_MS

    if (!inWindow) {
      return NextResponse.json(
        {
          error:   'fora_da_janela_24h',
          message: 'Fora da janela de 24h. Use um template aprovado.',
        },
        { status: 422 },
      )
    }
  }

  // ── Build send params & dispatch ────────────────────────────────────────────

  const sendParams: SendWhatsappParams = type === 'text'
    ? { to, type: 'text', body: (b.body as string).trim() }
    : {
        to,
        type:         'template',
        templateName: b.templateName as string,
        languageCode: b.languageCode as string,
        components:   Array.isArray(b.components) ? b.components : undefined,
      }

  let messageId: string
  try {
    const result = await sendWhatsappMessage(cfg, sendParams)
    messageId = result.id
  } catch (err) {
    return NextResponse.json(
      { error: 'ycloud_error', message: (err as Error).message },
      { status: 502 },
    )
  }

  // ── Record outbound as conversation role='ai' ───────────────────────────────
  //
  // sourceId = YCloud message id → deterministic row id (tenantId:source:messageId).
  // Idempotent: a duplicate call with the same messageId (won't happen via YCloud,
  // but possible in retries) will onConflictDoUpdate instead of inserting a new row.
  // When YCloud fires whatsapp.message.updated webhooks for this message,
  // those go into the events table under the same id — no collision.

  const content = type === 'text'
    ? (b.body as string).trim()
    : `[template:${b.templateName as string}]`

  const metadata: Record<string, unknown> = { type }
  if (type === 'template') {
    metadata.templateName = b.templateName
    metadata.languageCode = b.languageCode
  }

  await upsertBatch(
    {
      conversations: [{
        sourceId:   messageId,
        sessionId:  to,
        role:       'ai',
        content,
        occurredAt: Date.now(),
        metadata,
      }],
    },
    tenantId,
    row.id,
    'ycloud-whatsapp',
  )

  return NextResponse.json({ ok: true, messageId })
}
