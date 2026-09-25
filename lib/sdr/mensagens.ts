// As frases de tela dos códigos de recusa que saem de lib/sdr/conexao-tenant.
//
// POR QUE FICAM NUM MÓDULO, E NÃO EM CADA TELA
// `fonte_sdr_nao_configurada` e `credencial_sdr_ilegivel` são os dois estados de UMA
// credencial, e hoje chegam a três lugares diferentes: a lista de leads
// (importação e inscrição), o cadastro manual de lead e o save de Parâmetros, que
// recebe a frase pronta da própria rota. Copiar o texto é como as cópias
// divergem — e divergir aqui não é cosmético: cada frase manda o operador para uma
// tela, e a errada manda cadastrar uma fonte que já existe.
//
// POR QUE O SEGUNDO CÓDIGO NÃO É `config_invalid`
// Porque esse nome não diz QUAL credencial não abriu. As rotas da YCloud
// (app/api/ycloud/*, app/api/sdr/templates) devolvem `config_invalid` para a
// credencial DELAS, e a tela de leads traduz num tradutor só (friendlyBlastError) as
// recusas de /api/sdr/leads — que é a fonte SDR — e as de /api/sdr/templates — que é
// a YCloud. Com um código para as duas, metade dos operadores era mandada para a
// tela que não resolve. Ver CODIGO_CREDENCIAL_SDR_ILEGIVEL.
//
// Mora em lib/ porque um `page.tsx` do App Router não pode exportar nada além do
// componente (o Next valida os exports da página no build), então a tela de leads
// não tem como ser a dona do texto.

/** A fonte não está cadastrada — ou está pela metade, sem connectionString. O que
 *  resolve é terminar o cadastro. */
export const FONTE_SDR_NAO_CONFIGURADA =
  'Fonte de dados SDR não configurada — acesse Configurações > Integrações.'

/* A credencial ESTÁ salva e não abre (chave de criptografia trocada ou valor
 * corrompido). Vale dizer onde ela é salva: "acesse Configurações > Integrações"
 * sozinho levaria o operador a cadastrar uma fonte que já existe. */
export const CREDENCIAL_SDR_ILEGIVEL =
  'A credencial da fonte de dados SDR está salva mas não pôde ser lida — salve-a de novo em Configurações > Integrações > Fonte de Dados SDR.'

/** O código que as rotas devolvem para o estado acima. TODAS as rotas da fonte SDR
 *  emitem este, e nenhuma emite mais `config_invalid`: /api/sdr/leads,
 *  /api/sdr/leads/blast, /api/sdr/leads/manual, /api/sdr/leads/import,
 *  /api/sdr/leads/template e /api/sdr/enroll. Rota nova que fale com a fonte SDR usa
 *  esta constante — `config_invalid` hoje é só da YCloud. */
export const CODIGO_CREDENCIAL_SDR_ILEGIVEL = 'credencial_sdr_ilegivel'

/**
 * Traduz os dois códigos de credencial do SDR. Devolve `null` para qualquer outro
 * — assim cada tela continua dona dos códigos que só ela conhece, e um código novo
 * não cai em silêncio numa frase genérica sobre credencial.
 *
 * `config_invalid` não está aqui de propósito. Ele existia como ramo de compatibilidade
 * enquanto import, enroll e template ainda o emitiam; hoje nenhuma rota da fonte SDR o
 * emite, e o único dono do código é a YCloud (app/api/ycloud/*, app/api/sdr/templates),
 * que tem tradutor próprio — friendlyBlastError, na tela de leads. Aceitá-lo aqui seria
 * deixar no módulo que existe para separar as duas credenciais o código que as
 * confundia, e é assim que alguém volta a emiti-lo copiando o padrão.
 */
export function mensagemDeFonteSdr(code: string): string | null {
  if (code === 'fonte_sdr_nao_configurada') return FONTE_SDR_NAO_CONFIGURADA
  if (code === CODIGO_CREDENCIAL_SDR_ILEGIVEL) return CREDENCIAL_SDR_ILEGIVEL
  return null
}
