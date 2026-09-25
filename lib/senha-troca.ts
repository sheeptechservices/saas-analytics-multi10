import bcrypt from 'bcryptjs'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, passwordResetTokens } from '@/lib/db/schema'
import {
  CUSTO_BCRYPT,
  MSG_DADOS_INVALIDOS,
  MSG_SENHA_ATUAL_INCORRETA,
  MSG_SENHA_REPETIDA,
  MSG_USUARIO_SUMIU,
  validarNovaSenha,
} from '@/lib/senha'

/* A troca de senha da própria pessoa, fora do handler.
 *
 * Está aqui, e não dentro de app/api/me/password/route.ts, por um motivo só:
 * para poder ser testada. O handler precisa de `auth()`, ou seja, de NextAuth,
 * de cookie e de requisição; esta função precisa apenas do banco — e o banco, no
 * teste, é o PGlite de test-support/pglite.ts. Assim lib/senha-troca.test.ts
 * exercita o código DE PRODUÇÃO contra um Postgres de verdade, em vez de reler o
 * que o handler faria.
 *
 * O handler fica com o que é dele: sessão, papel, auditoria e o NextResponse. */

export type TrocaDeSenha =
  | { ok: true }
  | { ok: false; status: number; error: string }

export interface PedidoDeTroca {
  /** Vem de `session.user.id`: a pessoa só troca a própria senha. Não existe
   *  caminho para informar o id de outra conta — quem troca a senha alheia é o
   *  convite/recuperação por e-mail, que passa por posse da caixa de entrada. */
  userId: string
  /** `unknown` porque vem do corpo JSON: pode ser número, objeto, ausente. */
  senhaAtual: unknown
  novaSenha: unknown
}

/**
 * Troca a senha conferindo a atual.
 *
 * EXIGIR A SENHA ATUAL É O PONTO. O cookie de sessão sozinho não basta: um
 * navegador logado e deixado aberto permitiria a qualquer um trocar a senha e
 * trancar o dono para fora da própria conta. Com a conferência, quem não sabe a
 * senha atual não consegue trocá-la nem com a sessão na mão.
 *
 * Os status: tudo que é recusa de conteúdo sai como 400, INCLUSIVE a senha atual
 * errada. 401 e 403 seriam mais "semânticos", mas neste app eles já têm outro
 * significado para o cliente: lib/api-error.ts classifica 401 como sessão
 * expirada e 403 como módulo fora do plano, e a tela mostraria "Entre de novo" ou
 * "Módulo não disponível" para quem só errou a senha antiga. Errar a senha atual
 * é um problema do que foi enviado no corpo, e 400 é o que descreve isso sem
 * mentir para o resto do sistema.
 */
export async function trocarSenhaDoUsuario(pedido: PedidoDeTroca): Promise<TrocaDeSenha> {
  const { userId, senhaAtual, novaSenha } = pedido

  // Campo ausente, nulo ou de outro tipo. A senha atual vazia entra aqui também:
  // nenhuma conta tem hash de string vazia, então deixar passar só gastaria um
  // bcrypt.compare para chegar na mesma recusa.
  if (typeof senhaAtual !== 'string' || senhaAtual === '' || typeof novaSenha !== 'string') {
    return { ok: false, status: 400, error: MSG_DADOS_INVALIDOS }
  }

  const problema = validarNovaSenha(novaSenha)
  if (problema) return { ok: false, status: 400, error: problema }

  /* Comparação entre dois valores que a própria pessoa acabou de digitar — não
   * revela nada sobre o hash guardado, e evita o caso em que alguém "troca" a
   * senha por ela mesma e fica achando que rotacionou a credencial. */
  if (novaSenha === senhaAtual) {
    return { ok: false, status: 400, error: MSG_SENHA_REPETIDA }
  }

  const usuario = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .then(r => r[0])

  // A sessão é um JWT: ela continua válida depois de a linha sumir do banco
  // (conta removida pelo master). Sem este caminho, o update abaixo não acharia
  // nada e a rota responderia "senha alterada" sem ter alterado coisa nenhuma.
  if (!usuario) return { ok: false, status: 404, error: MSG_USUARIO_SUMIU }

  const confere = await bcrypt.compare(senhaAtual, usuario.passwordHash)
  if (!confere) return { ok: false, status: 400, error: MSG_SENHA_ATUAL_INCORRETA }

  const passwordHash = await bcrypt.hash(novaSenha, CUSTO_BCRYPT)
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId))

  /* Queima os links de recuperação que ainda estavam de pé.
   *
   * É o único "encerrar as outras sessões" que a arquitetura de hoje permite de
   * verdade. A sessão é JWT: não há tabela de sessão para limpar, e um token
   * emitido antes da troca continua valendo até expirar (ver o comentário longo
   * em app/api/me/password/route.ts). Mas o link de recuperação ESTÁ no banco, e
   * um link vazando numa caixa de e-mail invadida é justamente o motivo mais
   * comum para alguém correr a trocar a senha — deixá-lo vivo permitiria ao
   * invasor desfazer a troca em seguida.
   *
   * É a mesma limpeza que app/api/auth/forgot-password/route.ts faz ao emitir um
   * link novo, com o mesmo `usedAt = Date.now()` (a coluna é bigint de epoch ms). */
  await db
    .update(passwordResetTokens)
    .set({ usedAt: Date.now() })
    .where(and(
      eq(passwordResetTokens.userId, userId),
      isNull(passwordResetTokens.usedAt),
    ))

  return { ok: true }
}
