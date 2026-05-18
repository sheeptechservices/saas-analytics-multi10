import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, passwordResetTokens } from '@/lib/db/schema'
import { eq, and, isNull, gt } from 'drizzle-orm'
import bcrypt from 'bcryptjs'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const { token, password } = body ?? {}

    if (typeof token !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'A senha deve ter pelo menos 8 caracteres.' }, { status: 400 })
    }

    const now = Date.now()

    const resetToken = await db
      .select()
      .from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.token, token),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ))
      .then(r => r[0])

    if (!resetToken) {
      return NextResponse.json(
        { error: 'Link inválido ou expirado. Solicite um novo.' },
        { status: 400 },
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, resetToken.userId))

    await db
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(eq(passwordResetTokens.id, resetToken.id))

    return NextResponse.json({ message: 'Senha redefinida com sucesso.' })
  } catch (err) {
    console.error('[reset-password]', err)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
}
