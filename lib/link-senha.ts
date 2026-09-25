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

/**
 * Queima o link e grava a senha nova — o link vale UMA vez.
 *
 * O "marcar como usado" é o próprio teste de validade: um único UPDATE com a
 * condição de link vivo, que devolve o dono só se ESTA chamada foi a que virou o
 * `used_at`. Ler primeiro e marcar depois deixava uma janela em que dois envios
 * simultâneos do mesmo link passavam os dois pela leitura e gravavam duas senhas.
 * Com o UPDATE condicional, o Postgres trava a linha: o segundo envio espera o
 * primeiro, reavalia `used_at IS NULL`, não casa mais, e volta vazio.
 *
 * Tudo numa transação: se a gravação da senha falhar, o link não fica queimado
 * à toa e a pessoa pode tentar de novo.
 *
 * Devolve false para link usado, vencido ou inexistente.
 */
export async function usarLinkEGravarSenha(token: string, passwordHash: string, agora = Date.now()): Promise<boolean> {
  return db.transaction(async tx => {
    const queimado = await tx
      .update(passwordResetTokens)
      .set({ usedAt: agora })
      .where(condicaoLinkVivo(token, agora))
      .returning({ userId: passwordResetTokens.userId })
      .then(r => r[0])

    if (!queimado) return false

    await tx.update(users).set({ passwordHash }).where(eq(users.id, queimado.userId))
    return true
  })
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
