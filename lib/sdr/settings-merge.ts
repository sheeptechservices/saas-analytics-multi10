import { decrypt, encrypt } from '@/lib/crypto'

// Merge e leitura das credenciais de n8n guardadas em `campaign_settings.settings`
// (JSON por tenant, source 'sdr-n8n').
//
// Dois defeitos que este módulo existe para resolver:
//
// 1. O segredo seguia a URL. O PUT antigo copiava o segredo guardado de volta
//    sempre que o corpo o omitia — inclusive quando o mesmo PUT tinha trocado a
//    URL. A entrega seguinte ia para o endereço NOVO com `Authorization: Bearer
//    <segredo antigo>`: quem controlasse a URL colhia o segredo e passava a
//    conseguir forjar os acks (/api/sdr/blast/ack, /api/sdr/dispatch/ack).
//    Aqui o segredo só sobrevive enquanto a URL dele não muda.
//
// 2. Os segredos ficavam em texto puro no JSON. Agora vão cifrados
//    (`encrypt()` de lib/crypto). Não há migração: `decrypt()` devolve a
//    entrada intacta quando ela não está no formato `iv:tag:ciphertext`, então
//    o valor legado continua funcionando — e o primeiro save o reescreve
//    cifrado. Os aposentados são a exceção: ninguém os lê, então eles ficam
//    exatamente como estão (ver CHAVES_APOSENTADAS).

// Os pares que ainda saem desta app: o disparo da campanha (/api/sdr/dispatch e o
// ack dele) e o disparo de lista (/api/sdr/leads/blast e o ack dele). Eram cinco;
// os outros três alimentavam webhooks que não existem mais — ver CHAVES_APOSENTADAS.
export const N8N_CREDENTIAL_PAIRS = [
  { urlKey: 'n8nDispatchUrl', secretKey: 'n8nDispatchSecret' },
  { urlKey: 'n8nBlastUrl',    secretKey: 'n8nBlastSecret'    },
] as const

export type N8nUrlKey    = typeof N8N_CREDENTIAL_PAIRS[number]['urlKey']
export type N8nSecretKey = typeof N8N_CREDENTIAL_PAIRS[number]['secretKey']

/**
 * O que saiu do ar quando a app passou a escrever direto na base do cliente: o
 * write-back da configuração (`n8nWebhook*`), a importação de leads (`n8nImport*`)
 * e a inscrição na campanha (`n8nEnroll*`). Nenhuma rota lê, nenhuma tela mostra,
 * nenhuma validação olha — e é por isso mesmo que eles precisam estar listados.
 *
 * O merge parte de `incoming`: chave guardada que ninguém reenvia SOME do JSON. Sem
 * esta lista, o primeiro save de qualquer tela apagaria do banco do tenant as três
 * URLs e os três segredos. A URL dá para redigitar; o segredo não — o GET nunca o
 * devolve, e o que está gravado é a única cópia que a app tem. Desligar um webhook
 * não pode custar uma rotação de credencial no n8n de cada cliente, nem tornar a
 * volta atrás no código impossível sem ela.
 *
 * Passam intactos: nada é lido, nada é recifrado, nada cai por troca de URL. Uma
 * limpeza posterior pode apagá-los do banco de propósito — enquanto ela não vem,
 * ficam onde estão.
 */
export const CHAVES_APOSENTADAS = [
  'n8nWebhookUrl', 'n8nWebhookSecret',
  'n8nEnrollUrl',  'n8nEnrollSecret',
  'n8nImportUrl',  'n8nImportSecret',
] as const

// Formato exato produzido por encrypt(): IV de 12 bytes, tag de 16, tudo em hex.
// Checar a forma completa (e não só "tem dois dois-pontos") evita tratar um
// segredo legado que por acaso tenha dois-pontos como se fosse cifrado.
const FORMATO_CIFRADO = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/i

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

// Só cifra o que ainda não está cifrado — assim um save não reembrulha o mesmo
// segredo a cada gravação, e o legado em texto puro sobe para cifrado sozinho.
function paraRepouso(valor: string): string {
  return FORMATO_CIFRADO.test(valor) ? valor : encrypt(valor)
}

// Duas URLs apontam para o mesmo destino? Compara protocolo + host (porta
// padrão já cai fora no `new URL`) + caminho sem a barra final. Query string e
// fragmento são ignorados de propósito: mudar `?x=1` não muda para onde o
// segredo vai. URL malformada cai na comparação literal da string.
function normalizarDestino(bruto: string): string {
  try {
    const url = new URL(bruto)
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return bruto.trim()
  }
}

export function sameWebhookTarget(a: string, b: string): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return normalizarDestino(a) === normalizarDestino(b)
}

// Devolve o segredo em claro, ou null quando não há segredo utilizável.
// Aceita tanto o valor cifrado quanto o legado em texto puro. Nunca registra o
// valor — nem cifrado.
export function readN8nSecret(
  settings: Record<string, unknown>,
  key: N8nSecretKey,
): string | null {
  const bruto = texto(settings[key])
  if (!bruto) return null
  if (!FORMATO_CIFRADO.test(bruto)) return bruto
  try {
    return decrypt(bruto) || null
  } catch {
    console.error(`[sdr settings] ${key}: falha ao decifrar — segredo ignorado`)
    return null
  }
}

// Regras (cada par URL/segredo é resolvido de forma independente):
//  - URL omitida no PUT  → mantém a guardada (é o que impede a tela da Campanha
//    SDR de apagar as URLs ao salvar — issue #94) e, por consequência, o segredo;
//  - segredo novo no PUT → sempre vence, e vai cifrado;
//  - segredo omitido/vazio + URL igual à guardada → mantém o guardado;
//  - segredo omitido/vazio + URL diferente → o guardado CAI FORA, para que nada
//    se autentique no destino novo com o segredo do antigo.
export function mergeSdrSettings(
  stored: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...incoming }

  for (const { urlKey, secretKey } of N8N_CREDENTIAL_PAIRS) {
    const urlGuardada     = texto(stored?.[urlKey])
    const segredoGuardado = texto(stored?.[secretKey])
    const enviouUrl       = incoming[urlKey] !== undefined
    const urlFinal        = enviouUrl ? texto(incoming[urlKey]) : urlGuardada
    const segredoNovo     = texto(incoming[secretKey])

    if (urlFinal) merged[urlKey] = urlFinal
    else delete merged[urlKey]

    if (segredoNovo) {
      merged[secretKey] = paraRepouso(segredoNovo)
    } else if (segredoGuardado && sameWebhookTarget(urlGuardada, urlFinal)) {
      merged[secretKey] = paraRepouso(segredoGuardado)
    } else {
      delete merged[secretKey]
    }
  }

  // O que já está guardado dos pares aposentados atravessa o save — ver
  // CHAVES_APOSENTADAS. Só entra o que o PUT não trouxe: se a tela reenviou a URL
  // (ela ainda volta no GET, dentro das settings), o valor dela é que vale.
  //
  // ARESTA LATENTE, registrada de propósito e SEM correção: a guarda é
  // `=== undefined`, então um cliente que mandasse `n8nWebhookUrl: ''` apagaria a URL
  // guardada e deixaria o `n8nWebhookSecret` no JSON sem URL nenhuma — o par a que
  // este bloco existe para proteger, pela metade. Hoje é inalcançável: as duas telas
  // que salvam settings (Parâmetros e Credenciais) devolvem no PUT o que o GET
  // entregou, e o GET entrega a URL guardada. Trocar a guarda por "string vazia
  // também carrega" tornaria impossível apagar uma URL de propósito, que é o que uma
  // tela futura pode querer; a decisão fica para quem precisar dela.
  for (const chave of CHAVES_APOSENTADAS) {
    if (merged[chave] === undefined && stored?.[chave] !== undefined) {
      merged[chave] = stored[chave]
    }
  }

  return merged
}

// Controle de concorrência otimista do PUT de settings.
//
// `version` é OPCIONAL por compatibilidade: cliente que não manda (o legado)
// continua salvando como antes — último a escrever vence. Quem manda um número
// leva 409 se ele não for exatamente o que está guardado. Valor não numérico é
// ignorado em vez de recusado, para não quebrar um cliente antigo que mande
// lixo no campo.
export function isStaleVersion(storedVersion: number, incomingVersion: unknown): boolean {
  if (typeof incomingVersion !== 'number' || !Number.isInteger(incomingVersion)) return false
  return incomingVersion !== storedVersion
}
