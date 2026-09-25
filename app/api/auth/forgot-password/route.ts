import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, passwordResetTokens } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { trustedOrigin } from '@/lib/origin'
import { AVISO_DE_EMAIL_INDISPONIVEL, configuracaoDeEmail, type ConfigDeEmail } from '@/lib/ambiente'

const GENERIC = { message: 'Se este e-mail estiver cadastrado, você receberá as instruções em breve.' }

export async function POST(req: Request) {
  try {
    /* ANTES de qualquer coisa, e essa ordem é de segurança, não de estilo.
     *
     * A rota devolve sempre a mesma frase para não dizer a estranho se um
     * e-mail está cadastrado. Se a recusa por configuração viesse DEPOIS da
     * consulta ao banco, ela mesma viraria o oráculo que a frase genérica
     * evita: e-mail que existe recebendo 500 e e-mail que não existe recebendo
     * 200 responde exatamente a pergunta que não queremos responder.
     *
     * Aqui a resposta depende só do ambiente do servidor, igual para todo
     * mundo, e nenhuma linha do banco foi lida ainda. */
    const configDeEmail = configuracaoDeEmail(process.env)
    if (configDeEmail.estado === 'quebrado') {
      console.error('[forgot-password] envio de e-mail mal configurado:', configDeEmail.motivo)
      return NextResponse.json({ error: AVISO_DE_EMAIL_INDISPONIVEL }, { status: 500 })
    }

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

    // O link volta pela origem por onde o pedido entrou — o subdomínio do tenant de
    // quem pediu, não o de outro. Host desconhecido cai na origem configurada, para
    // que cabeçalho forjado não vire link de phishing com token de verdade.
    const baseUrl = trustedOrigin(req)
    await sendResetEmail(configDeEmail, user.email, `${baseUrl}/reset-password?token=${token}`)

    return NextResponse.json(GENERIC)
  } catch (err) {
    console.error('[forgot-password]', err)
    return NextResponse.json(GENERIC)
  }
}

/* `config` já chegou conferido do começo do handler, e é por isso que não existe
 * mais um `|| 'noreply@yourdomain.com'` aqui: o remetente ou é um endereço nosso
 * ou o pedido nem chegou até esta função. Mandar de um domínio que não é nosso
 * era pior do que não mandar — a Resend recusa, o erro ia só para o console, e a
 * pessoa ficava esperando um e-mail que nunca existiu. */
async function sendResetEmail(config: ConfigDeEmail, to: string, resetLink: string) {
  if (config.estado !== 'pronto') {
    /* Só 'desligado' chega aqui, e só fora de produção: sem conta na Resend, o
     * link no console mantém o fluxo de redefinição testável na máquina do dev. */
    console.warn('[forgot-password] envio desligado:', config.motivo)
    console.info('[forgot-password] reset link:', resetLink)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.remetente,
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
