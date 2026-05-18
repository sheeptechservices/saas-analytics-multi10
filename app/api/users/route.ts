import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { users, passwordResetTokens } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import bcrypt from 'bcryptjs'

function canManage(role: string) {
  return role === 'admin' || role === 'master'
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  let tenantId: string

  if (session.user.role === 'master') {
    const param = searchParams.get('tenantId')
    if (!param) return NextResponse.json({ error: 'tenantId obrigatório para master' }, { status: 400 })
    tenantId = param
  } else {
    tenantId = session.user.tenantId
  }

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      avatarColor: users.avatarColor,
      avatarBg: users.avatarBg,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.tenantId, tenantId))

  return NextResponse.json({ users: rows })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const { name, email, role, tenantId: bodyTenantId } = body ?? {}

  // Validations
  if (!name || !email || !role) {
    return NextResponse.json({ error: 'name, email e role são obrigatórios.' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 })
  }
  if (!['admin', 'manager', 'user'].includes(role)) {
    return NextResponse.json({ error: 'Role inválido.' }, { status: 400 })
  }

  let tenantId: string
  if (session.user.role === 'master') {
    if (!bodyTenantId) return NextResponse.json({ error: 'tenantId obrigatório para master.' }, { status: 400 })
    tenantId = bodyTenantId
  } else {
    tenantId = session.user.tenantId
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .then(r => r[0])

  if (existing) {
    return NextResponse.json({ error: 'Este e-mail já está em uso.' }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(crypto.randomUUID(), 12)
  const id = crypto.randomUUID()
  const now = new Date()

  await db.insert(users).values({
    id,
    tenantId,
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
    role,
    avatarColor: '#FFB400',
    avatarBg: '#121316',
    createdAt: now,
  })

  // Invite token — 72h
  const token = crypto.randomUUID()
  await db.insert(passwordResetTokens).values({
    id: crypto.randomUUID(),
    userId: id,
    token,
    expiresAt: Date.now() + 72 * 60 * 60 * 1000,
  })

  const baseUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'
  const inviteLink = `${baseUrl}/reset-password?token=${token}`
  const brandName = session.user.brandName || 'Multi10'

  await sendInviteEmail({ to: email, userName: name, brandName, inviteLink })

  return NextResponse.json({ id, name: name.trim(), email: email.toLowerCase().trim(), role, createdAt: now }, { status: 201 })
}

async function sendInviteEmail({ to, userName, brandName, inviteLink }: {
  to: string; userName: string; brandName: string; inviteLink: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[invite] RESEND_API_KEY not set — email skipped')
    console.info('[invite] link:', inviteLink)
    return
  }

  const from = process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com'

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: `Você foi convidado para o ${brandName}`,
      html: `
        <p>Olá, ${userName}!</p>
        <p>Você foi convidado para acessar o <strong>${brandName}</strong>.</p>
        <p>Clique no botão abaixo para criar sua senha e acessar a plataforma:</p>
        <p>
          <a href="${inviteLink}" style="background:#FFB400;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block">
            Criar minha senha
          </a>
        </p>
        <p>Este link é válido por <strong>72 horas</strong>.</p>
        <p>Se você não esperava este convite, ignore este e-mail.</p>
      `,
    }),
  })

  if (!res.ok) console.error('[invite] Resend error:', await res.text())
}
