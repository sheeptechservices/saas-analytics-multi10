import { MODULES } from '@/lib/modules'

/* Por que este arquivo existe (issue #98)
 *
 * Quase toda tela do produto lia a resposta com `.then(r => r.json())`. Como as
 * rotas devolvem JSON também no erro, um 403 de módulo desligado e um 500 do
 * banco viravam `{ error: '...' }` — e o `?? []` logo abaixo transformava os
 * dois em lista vazia. A tela então dizia "nada por aqui" para três situações
 * que não são a mesma coisa:
 *
 *   403  o cliente não contratou o módulo   → não adianta tentar de novo
 *   5xx  o servidor falhou                  → adianta tentar de novo
 *   200 + lista vazia  não há o que mostrar → está certo como está
 *
 * `fetchJson` estoura em vez de devolver o corpo do erro, e `classificarFalha`
 * + `textoDaFalha` dão a cada caso a palavra certa, em português. */

export type FalhaKind =
  | 'sem-modulo'   // 403 — módulo fora do plano do cliente
  | 'sem-sessao'   // 401 — sessão expirada
  | 'requisicao'   // demais 4xx
  | 'servidor'     // 5xx
  | 'rede'         // não houve resposta, ou ela não era JSON

export class ApiError extends Error {
  readonly status: number
  readonly kind: FalhaKind
  /** `error` do corpo da resposta, quando a rota mandou um. */
  readonly codigo?: string

  constructor(status: number, kind: FalhaKind, codigo?: string) {
    super(`ApiError ${status}${codigo ? ` (${codigo})` : ''}`)
    this.name = 'ApiError'
    this.status = status
    this.kind = kind
    this.codigo = codigo
  }
}

export function classificarStatus(status: number): FalhaKind {
  if (status === 403) return 'sem-modulo'
  if (status === 401) return 'sem-sessao'
  if (status >= 500) return 'servidor'
  if (status >= 400) return 'requisicao'
  // 0 e os 2xx/3xx que chegaram aqui só chegam quando o corpo não era JSON.
  return 'rede'
}

/** Aceita o que veio do `catch`: ApiError, TypeError de rede, qualquer coisa. */
export function classificarFalha(erro: unknown): FalhaKind {
  return erro instanceof ApiError ? erro.kind : 'rede'
}

export interface TextoDaFalha {
  titulo: string
  detalhe: string
  /** Tentar de novo só ajuda quando a falha é transitória. */
  podeTentarDeNovo: boolean
}

/** `assunto` entra na frase: "Não foi possível carregar os contatos." */
export function textoDaFalha(erro: unknown, assunto?: string): TextoDaFalha {
  const alvo = assunto ? ` ${assunto}` : ' os dados'
  switch (classificarFalha(erro)) {
    case 'sem-modulo':
      return {
        titulo:  'Módulo não disponível',
        detalhe: `Este recurso não faz parte do plano contratado, então não há${alvo} para mostrar. Fale com o suporte para liberá-lo.`,
        podeTentarDeNovo: false,
      }
    case 'sem-sessao':
      return {
        titulo:  'Sessão expirada',
        detalhe: 'Entre de novo para continuar.',
        podeTentarDeNovo: false,
      }
    case 'requisicao':
      return {
        titulo:  'Não foi possível completar a solicitação',
        detalhe: 'O pedido foi recusado. Revise os filtros e tente de novo.',
        podeTentarDeNovo: true,
      }
    case 'servidor':
      return {
        titulo:  `Não foi possível carregar${alvo}`,
        detalhe: 'A falha foi do servidor, não do seu acesso. Tente de novo em instantes.',
        podeTentarDeNovo: true,
      }
    default:
      return {
        titulo:  `Não foi possível carregar${alvo}`,
        detalhe: 'Verifique a conexão e tente de novo.',
        podeTentarDeNovo: true,
      }
  }
}

/** Texto do bloqueio decidido no próprio cliente, antes de pedir nada ao
 *  servidor — é o outro lado de `moduleKeyForEndpoint`. */
export function textoDeModuloDesligado(moduleKey: string): TextoDaFalha {
  const rotulo = MODULES.find(m => m.key === moduleKey)?.label
  return {
    titulo:  'Módulo não disponível',
    detalhe: rotulo
      ? `O módulo ${rotulo} não faz parte do plano contratado. Fale com o suporte para liberá-lo.`
      : 'Este recurso não faz parte do plano contratado. Fale com o suporte para liberá-lo.',
    podeTentarDeNovo: false,
  }
}

/** Como `fetch(...).then(r => r.json())`, mas estourando `ApiError` em tudo que
 *  não for 2xx — e também quando o 2xx não trouxe JSON. É o único jeito de o
 *  react-query marcar `isError` e de um `catch` distinguir 403 de 500. */
export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(input, init)
  } catch {
    throw new ApiError(0, 'rede')
  }
  if (!res.ok) {
    let codigo: string | undefined
    try {
      const corpo = await res.json() as { error?: unknown }
      if (typeof corpo?.error === 'string') codigo = corpo.error
    } catch { /* corpo vazio ou não-JSON: o status já basta */ }
    throw new ApiError(res.status, classificarStatus(res.status), codigo)
  }
  try {
    return await res.json() as T
  } catch {
    throw new ApiError(res.status, 'rede')
  }
}

/* Telas em que a leitura que falha é destrutiva (issue #94, e a issue #98 não
 * pode desfazer isso): Campanha SDR e Credenciais carregam com um GET, e o
 * Salvar seguinte reenvia o que foi lido. Se o GET falha e a tela finge que
 * leu, o Salvar grava vazio por cima — e derruba as URLs e os segredos de n8n,
 * que o GET nunca devolve e ninguém recupera pela interface.
 *
 * Por isso o aviso de "nada pode ser salvo" entra em TODA falha, seja 403, 500
 * ou queda de rede: o que muda com o status é só a explicação da causa. Quem
 * trava o Salvar é o estado da tela (baseline === null / loaded === false);
 * este texto existe para o usuário entender o botão desligado. */
export function textoDeLeituraPerdida(erro: unknown, oQueSePerde: string): TextoDaFalha {
  const base = textoDaFalha(erro)
  return {
    titulo: 'Não foi possível carregar',
    detalhe: `${base.detalhe} Nada pode ser salvo até a leitura dar certo — salvar agora apagaria ${oQueSePerde}.`,
    podeTentarDeNovo: true,
  }
}
