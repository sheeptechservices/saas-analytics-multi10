import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { users, passwordResetTokens } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { getTenantBranding } from '@/lib/tenant'
import { trustedOrigin } from '@/lib/origin'
import { requireTenantUser } from '@/lib/auth-guard'
import { isMasterRole, TENANT_ROLE } from '@/lib/roles'
import { configuracaoDeEmail, type ConfigDeEmail } from '@/lib/ambiente'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roleCheck = requireTenantUser(session)
  if (roleCheck) return roleCheck

  const { searchParams } = req.nextUrl
  let tenantId: string

  if (isMasterRole(session.user.role)) {
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
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roleCheck = requireTenantUser(session)
  if (roleCheck) return roleCheck

  const body = await req.json().catch(() => null)
  const { name, email, tenantId: bodyTenantId } = body ?? {}

  // Conta única: o papel não entra mais pelo corpo. Se um cliente antigo mandar
  // `role`, o campo é ignorado em silêncio — a conta nasce sempre como admin do
  // tenant. Recusar seria pior: quebraria o convite de quem ainda não atualizou a
  // tela, e não existe mais papel algum para escolher.
  const role = TENANT_ROLE

  // Validations
  if (!name || !email) {
    return NextResponse.json({ error: 'name e email são obrigatórios.' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 })
  }

  /* Antes de gravar qualquer coisa.
   *
   * Criar o usuário e só então descobrir que o convite não sai deixa no banco
   * uma conta que ninguém consegue ativar: a senha é um UUID aleatório que nem
   * nós sabemos, e o único caminho para dentro era o link que não foi enviado.
   * O admin veria "usuário criado", a pessoa nunca receberia nada, e o e-mail
   * ficaria ocupado para uma segunda tentativa (o 409 acima). Melhor recusar o
   * pedido inteiro e não deixar rastro.
   *
   * A mensagem vai no campo `error` porque é ele que a tela de Configurações
   * mostra ao admin, cru, quando a resposta não é 2xx. */
  const configDeEmail = configuracaoDeEmail(process.env)
  if (configDeEmail.estado === 'quebrado') {
    console.error('[invite] envio de e-mail mal configurado:', configDeEmail.motivo)
    return NextResponse.json(
      { error: 'O convite não foi enviado porque o envio de e-mails não está configurado no servidor, então o usuário não foi criado. Avise o suporte técnico.' },
      { status: 500 },
    )
  }

  let tenantId: string
  if (isMasterRole(session.user.role)) {
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

  // Convite chega pela origem por onde o admin criou o usuário — o subdomínio do
  // tenant dele. Host desconhecido cai na origem configurada.
  const baseUrl = trustedOrigin(req)
  const inviteLink = `${baseUrl}/reset-password?token=${token}`
  const { brandName } = await getTenantBranding(session.user.tenantId)

  await sendInviteEmail({ config: configDeEmail, to: email, userName: name, brandName, inviteLink })

  await logAudit({ req, session, action: 'user.create', entityType: 'user', entityId: id, metadata: { email: email.toLowerCase().trim(), role }, tenantId })
  return NextResponse.json({ id, name: name.trim(), email: email.toLowerCase().trim(), role, createdAt: now }, { status: 201 })
}

/* `config` já chegou conferido do handler: o `|| 'noreply@yourdomain.com'` que
 * morava aqui não tem mais como voltar, porque o remetente não é mais lido neste
 * arquivo. Ou ele é um endereço nosso, ou o convite foi recusado antes de existir. */
async function sendInviteEmail({ config, to, userName, brandName, inviteLink }: {
  config: ConfigDeEmail; to: string; userName: string; brandName: string; inviteLink: string
}) {
  if (config.estado !== 'pronto') {
    /* Só 'desligado' chega aqui, e só fora de produção — em produção a falta da
     * chave já virou 'quebrado' e o handler recusou. O link no console é o que
     * permite testar convite na máquina do dev sem conta na Resend. */
    console.warn('[invite] envio desligado:', config.motivo)
    console.info('[invite] link:', inviteLink)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.remetente,
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
