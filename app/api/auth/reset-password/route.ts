import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { donoDoLink, usarLinkEGravarSenha } from '@/lib/link-senha'

const LINK_INVALIDO = 'Link inválido ou expirado. Solicite um novo.'

// A tela pergunta de quem é a conta antes de a pessoa escolher a senha. A
// resposta leva nome e e-mail, então não pode ficar em cache nenhum.
export async function GET(req: NextRequest) {
  const semCache = { 'Cache-Control': 'no-store' }
  try {
    const token = req.nextUrl.searchParams.get('token')
    const dono = token ? await donoDoLink(token) : null
    if (!dono) {
      return NextResponse.json({ error: LINK_INVALIDO }, { status: 400, headers: semCache })
    }
    return NextResponse.json({ name: dono.nome, email: dono.email }, { headers: semCache })
  } catch (err) {
    console.error('[reset-password:get]', err)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500, headers: semCache })
  }
}

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

    // O hash vem antes de tocar no link: é a parte lenta, e fazê-la fora da
    // transação não segura a linha do token travada enquanto o bcrypt roda.
    const passwordHash = await bcrypt.hash(password, 12)

    // Link de uso único: validar e queimar é um passo só (ver lib/link-senha.ts).
    if (!(await usarLinkEGravarSenha(token, passwordHash))) {
      return NextResponse.json({ error: LINK_INVALIDO }, { status: 400 })
    }

    return NextResponse.json({ message: 'Senha redefinida com sucesso.' })
  } catch (err) {
    console.error('[reset-password]', err)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
}
