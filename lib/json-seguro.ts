/* Serialização de JSON que o Postgres consegue reler como jsonb.
 *
 * São DOIS buracos, não um, e os dois têm o mesmo raio de estrago.
 *
 * (1) NUL. `JSON.stringify` transforma U+0000 na sequência de SEIS caracteres
 *     `\u0000`. Uma coluna `text` guarda numa boa — no SQLite e no Postgres. Mas
 *     `payload::jsonb` recusa com 22P05 ("unsupported Unicode escape sequence"),
 *     porque jsonb não tem como representar NUL.
 *
 * (2) SURROGATE SOLTO. Desde o ES2019 o `JSON.stringify` é "well-formed": um
 *     surrogate sem par sai como escape (`\ud83d` sozinho, por exemplo) em vez de
 *     virar caractere inválido. O jsonb recusa isso também, com 22P02 ("Unicode
 *     low surrogate must follow a high surrogate"). Aparece sempre que um texto
 *     do provedor foi CORTADO no meio de um emoji — prévia de mensagem do
 *     WhatsApp, legenda truncada — e passou por parse e re-serialização.
 *
 * Em ambos os casos o estrago não é de uma linha: o cast roda sobre TODAS as
 * linhas da varredura, então UMA linha ruim derruba a consulta inteira — o painel
 * do SDR (lib/bi/whatsapp-mensagens.ts) e todo reconcile() daquele cliente
 * (lib/blast/reconcile.ts) passam a devolver 500, para sempre, até alguém editar
 * a linha na mão. No SQLite nada disso acontecia: `json_extract` não validava o
 * documento, só procurava a chave.
 *
 * A solução é na ESCRITA: os dois somem antes de virar texto. Note que não dá
 * para limpar depois, com um replace sobre o texto já serializado — um `\\u0000`
 * legítimo (barra invertida literal seguida de "u0000") termina nos mesmos seis
 * caracteres e viraria `\\`, quebrando o JSON. Aqui a limpeza acontece nos
 * VALORES, antes da serialização, onde NUL é NUL e surrogate é surrogate, sem
 * ambiguidade.
 *
 * Vale para todo JSON que vira linha de dados. O `sync_cursor` de data_sources
 * fica de fora de propósito: é marcador de paginação do provedor, ninguém o
 * converte para jsonb, e mexer nele arriscaria corromper um cursor. */

const NUL = /\u0000/g

/* Surrogate alto sem um baixo depois, ou baixo sem um alto antes. Um PAR válido
 * (emoji de verdade) não casa com nenhum dos dois lados e passa intacto. */
const SURROGATE_SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

function limpar(texto: string): string {
  return texto.replace(NUL, '').replace(SURROGATE_SOLTO, '')
}

function semLixo(_chave: string, valor: unknown): unknown {
  if (typeof valor === 'string') return limpar(valor)
  // Chave inválida é tão fatal quanto valor inválido; o replacer não consegue
  // reescrever chaves, então devolvemos um objeto novo já com as chaves limpas.
  // (O JSON.stringify percorre este objeto novo chamando o replacer nos filhos;
  // não há recursão infinita, porque cada nível é reconstruído uma vez só.)
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
    const limpo: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor)) limpo[limpar(k)] = v
    return limpo
  }
  return valor
}

/**
 * `JSON.stringify` sem NUL e sem surrogate solto — os dois escapes que o
 * `::jsonb` do Postgres recusa. O texto resultante sempre sobrevive ao cast.
 */
export function jsonSemNulos(valor: unknown): string {
  return JSON.stringify(valor, semLixo)
}
