import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from './db'
import { passwordResetTokens, users } from './db/schema'

/* O link de senha (convite de conta nova e "esqueci minha senha" usam o mesmo
 * token, na mesma tela /reset-password).
 *
 * A regra de "link vivo" mora aqui, uma vez só, e as duas pontas da rota a usam:
 * o GET, que mostra de quem é a conta antes de a pessoa digitar, e o POST, que
 * grava a senha. Se cada uma tivesse a sua, a tela poderia dizer "conta do
 * Fulano" para um link que o POST recusa — ou o contrário. */
export function condicaoLinkVivo(token: string, agora: number) {
  return and(
    eq(passwordResetTokens.token, token),
    isNull(passwordResetTokens.usedAt),
    gt(passwordResetTokens.expiresAt, agora),
  )
}

export interface DonoDoLink {
  nome: string
  email: string
}

/**
 * De quem é a conta deste link — para a pessoa confirmar que o convite é dela
 * antes de escolher a senha.
 *
 * Mostrar nome e e-mail a quem tem o link não abre nada novo: o token é um UUID
 * aleatório, e quem o tem já pode definir a senha da conta, que é muito mais do
 * que ler o nome dela. Link usado, vencido ou inexistente devolve null, sem dizer
 * qual dos três — a resposta não serve para sondar tokens nem e-mails.
 */
export async function donoDoLink(token: string, agora = Date.now()): Promise<DonoDoLink | null> {
  const linha = await db
    .select({ nome: users.name, email: users.email })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(condicaoLinkVivo(token, agora))
    .then(r => r[0])

  return linha ?? null
}
