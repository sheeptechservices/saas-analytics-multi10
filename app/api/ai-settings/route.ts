import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { aiSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { encrypt, decrypt } from '@/lib/crypto'
import { randomUUID } from 'crypto'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const setting = await db.select().from(aiSettings)
    .where(eq(aiSettings.tenantId, session.user.tenantId))
    .then(r => r[0])

  if (!setting) return NextResponse.json({ configured: false })

  let maskedKey: string | null = null
  if (setting.apiKeyEnc) {
    const decrypted = decrypt(setting.apiKeyEnc)
    maskedKey = '••••' + decrypted.slice(-4)
  }

  return NextResponse.json({
    configured: true,
    apiKey: maskedKey,
    defaultModel: setting.defaultModel,
    monthlyBudgetBrl: setting.monthlyBudgetBrl,
    isActive: setting.isActive,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { apiKey, defaultModel, monthlyBudgetBrl } = await req.json()

  const existing = await db.select().from(aiSettings)
    .where(eq(aiSettings.tenantId, session.user.tenantId))
    .then(r => r[0])

  const now = Date.now()

  if (existing) {
    const updates: Partial<typeof aiSettings.$inferInsert> = { updatedAt: now }
    if (apiKey !== undefined) {
      updates.apiKeyEnc = encrypt(apiKey)
      updates.isActive = apiKey ? 1 : 0
    }
    if (defaultModel !== undefined) updates.defaultModel = defaultModel
    if (monthlyBudgetBrl !== undefined) updates.monthlyBudgetBrl = monthlyBudgetBrl

    await db.update(aiSettings).set(updates).where(eq(aiSettings.tenantId, session.user.tenantId))
  } else {
    await db.insert(aiSettings).values({
      id: randomUUID(),
      tenantId: session.user.tenantId,
      apiKeyEnc: apiKey ? encrypt(apiKey) : null,
      defaultModel: defaultModel ?? 'claude-haiku-4-5-20251001',
      monthlyBudgetBrl: monthlyBudgetBrl ?? 0,
      isActive: apiKey ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.json({ ok: true })
}
