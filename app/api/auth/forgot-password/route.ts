import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, passwordResetTokens } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'

const GENERIC = { message: 'Se este e-mail estiver cadastrado, você receberá as instruções em breve.' }

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : null
    if (!email) return NextResponse.json(GENERIC)

    const user = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .then(r => r[0])

    if (!user) return NextResponse.json(GENERIC)

    // Invalidate any active tokens for this user
    await db
      .update(passwordResetTokens)
      .set({ usedAt: Date.now() })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)))

    const token = crypto.randomUUID()
    await db.insert(passwordResetTokens).values({
      id: crypto.randomUUID(),
      userId: user.id,
      token,
      expiresAt: Date.now() + 3_600_000,
    })

    const baseUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'
    await sendResetEmail(user.email, `${baseUrl}/reset-password?token=${token}`)

    return NextResponse.json(GENERIC)
  } catch (err) {
    console.error('[forgot-password]', err)
    return NextResponse.json(GENERIC)
  }
}

async function sendResetEmail(to: string, resetLink: string) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[forgot-password] RESEND_API_KEY not set — email skipped')
    console.info('[forgot-password] reset link:', resetLink)
    return
  }

  const from = process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com'

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: 'Redefinição de senha',
      html: `
        <p>Olá,</p>
        <p>Recebemos uma solicitação para redefinir a senha da sua conta.</p>
        <p>
          <a href="${resetLink}" style="background:#FFB400;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block">
            Redefinir minha senha
          </a>
        </p>
        <p>Este link expira em <strong>1 hora</strong>.</p>
        <p>Se você não solicitou a redefinição, ignore este e-mail — sua senha permanece a mesma.</p>
      `,
    }),
  })

  if (!res.ok) {
    console.error('[forgot-password] Resend error:', await res.text())
  }
}
