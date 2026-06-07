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

  let settings: unknown = DEFAULT_SETTINGS
  try { settings = JSON.parse(row.settings) } catch {}

  return NextResponse.json({ configured: true, status: row.status, version: row.version, settings })
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

  const status = body.status as ValidStatus
  const settingsJson = JSON.stringify(body.settings ?? {})
  const now = new Date()

  const [existing] = await db
    .select({ id: campaignSettings.id, version: campaignSettings.version })
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  if (existing) {
    await db
      .update(campaignSettings)
      .set({ settings: settingsJson, status, version: existing.version + 1, updatedAt: now })
      .where(eq(campaignSettings.id, existing.id))
  } else {
    await db.insert(campaignSettings).values({
      id: randomUUID(),
      tenantId,
      source: SOURCE,
      settings: settingsJson,
      status,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.json({ ok: true })
}
