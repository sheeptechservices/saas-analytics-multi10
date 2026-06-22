import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { campaignSettings } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'
import { randomUUID } from 'crypto'

const SOURCE = 'sdr-n8n'

const DEFAULT_SETTINGS = {
  tom: 'consultivo',
  objetivo: '',
  delay: 24,
  limiteDiario: 100,
  horario: { inicio: '08:00', fim: '18:00' },
  diasAtivos: [1, 2, 3, 4, 5],
  templates: [''],
}

type N8nDeliveryResult = { ok: boolean; status?: number; error?: string }

// Anti-SSRF: rejeita localhost e ranges de IP privados (mesma lógica do supabase-n8n provider).
// Apenas http/https são aceitos.
function validateWebhookUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) {
    throw new Error('n8nWebhookUrl deve ser uma string não vazia')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('n8nWebhookUrl inválida: URL malformada')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('n8nWebhookUrl inválida: apenas http/https são aceitos')
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (hostname === 'localhost' || hostname === '::1') {
    throw new Error('n8nWebhookUrl inválida: host privado/local bloqueado')
  }
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      throw new Error('n8nWebhookUrl inválida: IP privado bloqueado')
    }
  }
  return raw
}

async function deliverToN8n(
  webhookUrl: string,
  webhookSecret: string | undefined,
  payload: object,
): Promise<N8nDeliveryResult> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (webhookSecret) headers['Authorization'] = `Bearer ${webhookSecret}`
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[sdr settings → n8n]', error)
    return { ok: false, error }
  }
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  const [row] = await db
    .select()
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  if (!row) {
    return NextResponse.json({ configured: false, status: 'draft', version: 0, settings: DEFAULT_SETTINGS })
  }

  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(row.settings) } catch {}

  // Omit n8nWebhookSecret from GET response; n8nWebhookUrl is returned for UI display
  const { n8nWebhookSecret: _omit, ...settingsForClient } = parsed
  void _omit

  return NextResponse.json({ configured: true, status: row.status, version: row.version, settings: settingsForClient })
}

export async function PUT(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  let body: { settings?: unknown; status?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const VALID_STATUS = ['draft', 'active', 'paused'] as const
  type ValidStatus = typeof VALID_STATUS[number]
  if (!VALID_STATUS.includes(body.status as ValidStatus)) {
    return NextResponse.json({ error: 'status inválido' }, { status: 400 })
  }

  const rawSettings = (typeof body.settings === 'object' && body.settings !== null
    ? body.settings
    : {}) as Record<string, unknown>

  // Validate webhook URL if provided (empty string = not configured, skip)
  if (rawSettings.n8nWebhookUrl !== undefined && rawSettings.n8nWebhookUrl !== '') {
    try {
      validateWebhookUrl(rawSettings.n8nWebhookUrl)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'n8nWebhookUrl inválida' },
        { status: 400 },
      )
    }
  }

  const status = body.status as ValidStatus
  const now = new Date()

  const [existing] = await db
    .select({ id: campaignSettings.id, version: campaignSettings.version, settings: campaignSettings.settings })
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  // Preserve the stored n8nWebhookSecret when the incoming PUT omits or clears it.
  // (GET strips the secret, so the UI cannot re-send it on subsequent saves.)
  if (existing && !rawSettings.n8nWebhookSecret) {
    try {
      const stored = JSON.parse(existing.settings) as Record<string, unknown>
      if (typeof stored.n8nWebhookSecret === 'string' && stored.n8nWebhookSecret) {
        rawSettings.n8nWebhookSecret = stored.n8nWebhookSecret
      }
    } catch { /* corrupt stored JSON — skip merge */ }
  }

  // n8nWebhookSecret fica no settings JSON por ora (coluna não exposta a anon).
  // Follow-up futuro: criptografar antes de persistir.
  const settingsJson = JSON.stringify(rawSettings)

  let newVersion: number
  if (existing) {
    newVersion = existing.version + 1
    await db
      .update(campaignSettings)
      .set({ settings: settingsJson, status, version: newVersion, updatedAt: now })
      .where(eq(campaignSettings.id, existing.id))
  } else {
    newVersion = 1
    await db.insert(campaignSettings).values({
      id: randomUUID(),
      tenantId,
      source: SOURCE,
      settings: settingsJson,
      status,
      version: newVersion,
      createdAt: now,
      updatedAt: now,
    })
  }

  // Deliver to n8n webhook if a valid URL is configured
  const webhookUrl =
    typeof rawSettings.n8nWebhookUrl === 'string' && rawSettings.n8nWebhookUrl
      ? rawSettings.n8nWebhookUrl
      : null
  const webhookSecret =
    typeof rawSettings.n8nWebhookSecret === 'string' && rawSettings.n8nWebhookSecret
      ? rawSettings.n8nWebhookSecret
      : undefined

  if (webhookUrl) {
    // Strip webhook config from the payload sent to n8n
    const { n8nWebhookUrl: _u, n8nWebhookSecret: _s, ...settingsPayload } = rawSettings
    void _u; void _s
    const payload = {
      tenantId,
      status,
      version: newVersion,
      settings: settingsPayload,
      sentAt: new Date().toISOString(),
    }
    const n8nDelivery = await deliverToN8n(webhookUrl, webhookSecret, payload)
    return NextResponse.json({ ok: true, n8nDelivery })
  }

  return NextResponse.json({ ok: true, n8nDelivery: null })
}
