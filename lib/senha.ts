import { ApiError, textoDaFalha, type TextoDaFalha } from '@/lib/api-error'

/* Regra de senha do produto, num lugar só.
 *
 * Existiam dois caminhos para uma senha chegar ao banco — o convite
 * (app/api/users) e a recuperação por e-mail (app/api/auth/reset-password) — e
 * agora há um terceiro, a troca pela própria pessoa. Se cada um escrever a
 * própria regra, uma senha aceita numa tela é recusada na outra, e o usuário não
 * tem como saber qual das duas está certa.
 *
 * Este arquivo NÃO importa o banco de propósito: quem fala com o Postgres é
 * lib/senha-troca.ts. Assim o componente de tela (components/settings/TrocarSenha)
 * pode importar a regra e a mensagem sem arrastar `pg` e o drizzle para o pacote
 * do navegador. */

/** Mínimo de caracteres. É o que app/api/auth/reset-password/route.ts já exige
 *  (`password.length < 8`) — lib/senha.test.ts prende os dois juntos, para que
 *  mudar um sem o outro quebre a suíte em vez de virar divergência silenciosa. */
export const MIN_SENHA = 8

/* Custo do bcrypt: 12.
 *
 * O repositório não é uniforme — os dois scripts de bootstrap (lib/db/seed-300,
 * lib/db/create-master) usam 10, enquanto os dois caminhos que gravam senha de
 * gente de verdade (app/api/users e app/api/auth/reset-password) usam 12. Quem
 * manda aqui é o segundo grupo: 12 é o custo já em uso para as senhas que
 * protegem contas reais, e baixar para 10 neste caminho deixaria a troca de senha
 * gravando um hash MAIS FRACO do que o que a recuperação por e-mail grava — a
 * pessoa pioraria a própria segurança ao usar a tela nova. Subir para 13 ou 14
 * também não: o hash de custo diferente conviveria com os antigos sem ganho
 * prático e com o dobro de CPU por login.
 *
 * O custo fica gravado no próprio hash (`$2b$12$...`), então contas antigas com
 * outro custo continuam validando normalmente no bcrypt.compare. */
export const CUSTO_BCRYPT = 12

// ── As frases que a rota devolve ─────────────────────────────────────────────
//
// São constantes, e não literais espalhados, porque o cliente precisa saber
// QUAIS textos vieram da rota para poder mostrá-los (ver textoDaTrocaDeSenha):
// um `error` que não esteja nesta lista é código de máquina ('insufficient_role')
// e não pode ir para a tela.

export const MSG_DADOS_INVALIDOS = 'Dados inválidos.'
export const MSG_SENHA_CURTA = `A senha deve ter pelo menos ${MIN_SENHA} caracteres.`
export const MSG_SENHA_ATUAL_INCORRETA = 'Senha atual incorreta.'
export const MSG_SENHA_REPETIDA = 'A nova senha precisa ser diferente da atual.'
export const MSG_USUARIO_SUMIU = 'Usuário não encontrado.'

/** Só do lado do cliente: o servidor nunca recebe a confirmação. */
export const MSG_CONFIRMACAO_DIFERENTE = 'As senhas não coincidem.'

/** Toda recusa de negócio da rota de troca de senha. */
export const RECUSAS_DA_TROCA: readonly string[] = [
  MSG_DADOS_INVALIDOS,
  MSG_SENHA_CURTA,
  MSG_SENHA_ATUAL_INCORRETA,
  MSG_SENHA_REPETIDA,
  MSG_USUARIO_SUMIU,
]

/** Mensagem do problema, ou `null` quando a senha serve. */
export function validarNovaSenha(nova: string): string | null {
  if (nova.length < MIN_SENHA) return MSG_SENHA_CURTA
  return null
}

/**
 * Texto para a tela quando o PUT falha.
 *
 * A rota tem dois tipos de recusa, como a de leads (issue #98): a de negócio,
 * que já vem com a frase pronta em português e é a única coisa útil que se pode
 * dizer ("Senha atual incorreta."), e a de infraestrutura (401/403/500), em que
 * só o status explica.
 *
 * O texto genérico do status NÃO serve aqui: `classificarStatus` manda todo 4xx
 * comum para "Revise os filtros e tente de novo", e não há filtro nenhum nesta
 * tela. Por isso a frase da rota vence quando existe — e um `error` que não seja
 * uma das recusas conhecidas (um 'insufficient_role', um 'Unauthorized') volta
 * para o texto do status, porque código cru na tela não ajuda ninguém.
 */
export function textoDaTrocaDeSenha(erro: unknown): TextoDaFalha {
  const codigo = erro instanceof ApiError ? erro.codigo : undefined
  if (codigo && RECUSAS_DA_TROCA.includes(codigo)) {
    return {
      titulo: 'Não foi possível alterar a senha',
      detalhe: codigo,
      // Insistir com os mesmos campos dá exatamente a mesma recusa: quem
      // resolve é corrigir o que está digitado, não repetir o pedido.
      podeTentarDeNovo: false,
    }
  }
  return textoDaFalha(erro, 'a troca de senha')
}
