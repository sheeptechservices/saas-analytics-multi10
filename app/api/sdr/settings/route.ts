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
  remetente: '',
  numToques: 10,
  intervaloDias: 3,
}

const E164_RE = /^\+[1-9]\d{6,14}$/

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

  // Omit secrets from GET response; URLs are returned for UI display
  const { n8nWebhookSecret: _omitWS, n8nDispatchSecret: _omitDS, n8nEnrollSecret: _omitES, n8nImportSecret: _omitIS, n8nBlastSecret: _omitBS, ...settingsForClient } = parsed
  void _omitWS; void _omitDS; void _omitES; void _omitIS; void _omitBS

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

  // Validate dispatch URL if provided (same anti-SSRF rules)
  if (rawSettings.n8nDispatchUrl !== undefined && rawSettings.n8nDispatchUrl !== '') {
    try {
      validateWebhookUrl(rawSettings.n8nDispatchUrl)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'n8nDispatchUrl inválida' },
        { status: 400 },
      )
    }
  }

  // Validate enrollment URL if provided (same anti-SSRF rules)
  if (rawSettings.n8nEnrollUrl !== undefined && rawSettings.n8nEnrollUrl !== '') {
    try {
      validateWebhookUrl(rawSettings.n8nEnrollUrl)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'n8nEnrollUrl inválida' },
        { status: 400 },
      )
    }
  }

  // Validate import URL if provided (same anti-SSRF rules)
  if (rawSettings.n8nImportUrl !== undefined && rawSettings.n8nImportUrl !== '') {
    try {
      validateWebhookUrl(rawSettings.n8nImportUrl)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'n8nImportUrl inválida' },
        { status: 400 },
      )
    }
  }

  // Validate blast URL if provided (same anti-SSRF rules)
  if (rawSettings.n8nBlastUrl !== undefined && rawSettings.n8nBlastUrl !== '') {
    try {
      validateWebhookUrl(rawSettings.n8nBlastUrl)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'n8nBlastUrl inválida' },
        { status: 400 },
      )
    }
  }

  // Validate remetente E.164 if provided and non-empty
  if (rawSettings.remetente !== undefined && rawSettings.remetente !== '') {
    if (typeof rawSettings.remetente !== 'string' || !E164_RE.test(rawSettings.remetente)) {
      return NextResponse.json(
        { error: 'remetente inválido: use formato E.164 (ex: +5511999990000)' },
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

  // Preserve stored secrets when the incoming PUT omits or clears them.
  // (GET strips secrets, so the UI cannot re-send them on subsequent saves.)
  if (existing && (!rawSettings.n8nWebhookSecret || !rawSettings.n8nDispatchSecret || !rawSettings.n8nEnrollSecret || !rawSettings.n8nImportSecret || !rawSettings.n8nBlastSecret)) {
    try {
      const stored = JSON.parse(existing.settings) as Record<string, unknown>
      if (!rawSettings.n8nWebhookSecret && typeof stored.n8nWebhookSecret === 'string' && stored.n8nWebhookSecret) {
        rawSettings.n8nWebhookSecret = stored.n8nWebhookSecret
      }
      if (!rawSettings.n8nDispatchSecret && typeof stored.n8nDispatchSecret === 'string' && stored.n8nDispatchSecret) {
        rawSettings.n8nDispatchSecret = stored.n8nDispatchSecret
      }
      if (!rawSettings.n8nEnrollSecret && typeof stored.n8nEnrollSecret === 'string' && stored.n8nEnrollSecret) {
        rawSettings.n8nEnrollSecret = stored.n8nEnrollSecret
      }
      if (!rawSettings.n8nImportSecret && typeof stored.n8nImportSecret === 'string' && stored.n8nImportSecret) {
        rawSettings.n8nImportSecret = stored.n8nImportSecret
      }
      if (!rawSettings.n8nBlastSecret && typeof stored.n8nBlastSecret === 'string' && stored.n8nBlastSecret) {
        rawSettings.n8nBlastSecret = stored.n8nBlastSecret
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
    // Strip n8n integration config (URLs + secrets) from the payload sent to n8n
    const {
      n8nWebhookUrl: _u,
      n8nWebhookSecret: _s,
      n8nDispatchUrl: _du,
      n8nDispatchSecret: _ds,
      n8nEnrollUrl: _eu,
      n8nEnrollSecret: _es,
      n8nImportUrl: _iu,
      n8nImportSecret: _is,
      n8nBlastUrl: _bu,
      n8nBlastSecret: _bs,
      ...settingsPayload
    } = rawSettings
    void _u; void _s; void _du; void _ds; void _eu; void _es; void _iu; void _is; void _bu; void _bs
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
