// Para QUAL número a mensagem vai, e o que está escrito nela. Uma regra só, num lugar só.
//
// POR QUE ESTE ARQUIVO EXISTE
// Quatro ajudantes e duas regexes decidem as duas coisas de um disparo que não têm
// volta: o NÚMERO de destino e o TEXTO que chega nele. Até agora eles existiam DUAS
// vezes — os originais, sem `export`, em app/api/sdr/leads/blast/route.ts, e uma cópia
// declarada em lib/sdr/regua.ts, sob o comentário CÓPIA DECLARADA, com
// `unresolvedPlaceholders` rebatizada `placeholdersPendentes`. Duas versões de "como um
// telefone brasileiro vira E.164" é como um lead passa a receber mensagem num número e o
// histórico ir para outro; o cabeçalho da régua já chamava isso de dívida e mandava
// extrair para um módulo comum. É este arquivo.
//
// As duas cópias foram conferidas MECANICAMENTE antes de virarem esta, e não de olho:
// corpo por corpo, sem comentários e sem espaço em branco, elas batem — três dos quatro
// corpos são byte a byte iguais depois de normalizar o fim de linha (a rota está em CRLF,
// a régua em LF), e o quarto, `ensureBr9`, difere só por três comentários de fim de linha
// que a régua não copiou. As duas regexes são o mesmo literal. A ÚNICA divergência é o
// nome de `unresolvedPlaceholders`. O teste que prende isso continua rodando; ver abaixo.
//
// HOJE EXISTEM TRÊS CÓPIAS, e isso é deliberado e temporário. Este lote é ADIÇÃO PURA:
// nenhum arquivo existente foi tocado, porque a régua e o ack estavam sendo mexidos em
// paralelo e trocar imports no meio disso é conflito garantido. Substituir as duas cópias
// por um `import` daqui é o lote seguinte — «refactor(sdr): as duas cópias de telefone
// viram import de lib/sdr/telefone» —, e o que impede as três de divergirem enquanto isso
// é um teste de pinagem em lib/sdr/telefone.test.ts, que LÊ os dois arquivos do disco e
// compara os corpos com os daqui. Aquele teste morre no mesmo lote que as cópias: com uma
// implementação só, ele passa a comparar um arquivo consigo mesmo.
//
// NADA AQUI FOI MELHORADO, e isso é a regra deste arquivo, não uma preguiça. Qualquer
// diferença de comportamento em relação às duas cópias mudaria para QUEM a mensagem vai —
// pessoas reais, número por número — sem que nenhum teste das cópias reprovasse. Os
// defeitos que a extração encontrou estão escritos em voz alta mais abaixo e continuam
// funcionando exatamente como funcionam hoje. Consertar qualquer um deles é decisão do
// dono do produto, num commit próprio, com o número de leads afetados na mão.
//
// OS NOMES — e por que continuam em inglês num diretório que fala português
// As duas cópias discordavam em um nome, e o módulo comum tem de acabar com isso. Ficaram
// os nomes ORIGINAIS, os da rota de blast, e não os da régua nem uma tradução:
//
//   · `E164` não é inglês, é o número da recomendação da ITU-T que define o formato.
//     `normalizarE164` trocaria metade de um nome próprio e não explicaria mais nada;
//   · a rota de blast é o caminho que ESTÁ NO AR mandando mensagem hoje; a cópia da régua
//     ainda não é chamada por ninguém (o cabeçalho dela diz isso). Rebatizar o chamador
//     vivo para casar com uma cópia que nunca enviou nada inverte o ônus da prova;
//   · e é o que deixa o lote de troca ser o que ele precisa ser: no blast, apagar quatro
//     funções e acrescentar uma linha de `import`, sem encostar em NENHUMA chamada. Cada
//     nome que aquele lote tivesse de reescrever é um lugar onde um typo muda o número
//     que recebe a mensagem. Na régua sobra um rename só, de `placeholdersPendentes`.
//
// O preço é honesto e fica registrado: o resto de lib/sdr/* nomeia em português, e estes
// quatro destoam. Achou-se que essa feiura vale menos que um erro de destinatário.
//
// DEFEITOS CONHECIDOS, PRESERVADOS DE PROPÓSITO
// A numeração brasileira é cheia de armadilha, e a extração passou por estas. Todas estão
// cobertas por teste em lib/sdr/telefone.test.ts — o teste PRENDE o comportamento de
// hoje, inclusive o errado, para que consertar vire uma decisão e não um acidente:
//
//   1. SEM DDI, O NÚMERO VIRA ESTRANGEIRO. `toE164` não presume 55: ela só prega um `+`
//      na frente dos dígitos. Um lead gravado como '11987654321' vira '+11987654321', que
//      passa na `E164_RE` inteirinho e é um número de +1 (América do Norte). Pior: como
//      não começa com '+55', `ensureBr9` não encosta nele. Não é rejeição, é um número
//      plausível e ERRADO. É o defeito mais grave da lista.
//
//   2. `phone_adjusted` VAZIA APAGA UM `phone` BOM. A escolha da coluna é
//      `phoneAdjusted ?? phone`, e `??` só cai para o segundo com `null`/`undefined` —
//      string vazia NÃO é nula. Então `phone = '5511987654321'` com `phone_adjusted = ''`
//      devolve `null`, e o lead é pulado como "sem telefone" tendo telefone. O `phone` só
//      ganha antes disso quando já está em E.164 COM o `+`; sem o `+`, ele perde até para
//      uma `phone_adjusted` de outro número.
//
//   3. LIXO COLADO NO FIM ENTRA NA CONTA. A limpeza é `replace(/\D/g, '')`, que não
//      distingue ramal de número: '5511987654321 ramal 22' vira '+551198765432122', 16
//      dígitos… que a `E164_RE` recusa — mas '…ramal 2' viraria 15 dígitos e SERIA aceito,
//      como um número que não existe.
//
//   4. PREFIXO DE TRONCO É RECUSA, NÃO CONSERTO. '011 98765-4321' vira '+011987654321', e
//      a `E164_RE` exige `[1-9]` depois do `+`: resultado `null`, lead pulado. Aqui a
//      falha ao menos é silenciosa do lado seguro — ninguém recebe nada.
//
//   5. O NONO DÍGITO É UM PALPITE, e só age no caso de 10 dígitos. `ensureBr9` usa o
//      corte oficial da Anatel para assinante de 8 dígitos (2–5 fixo, 6–9 móvel) e o
//      aplica ao terceiro dígito depois do `+55`. Ele acerta o caso comum — cadastro
//      velho de celular sem o 9 — e erra nas duas pontas: um FIXO cuja numeração comece
//      em 6–9 ganha um 9 e vira número inexistente; um MÓVEL antigo numa faixa 2–5 fica
//      sem o 9 e a mensagem vai para um fixo. Nenhum dos dois dá erro em lugar nenhum.
//
//   6. NINGUÉM CONFERE DDD NEM O FORMATO DE 11 DÍGITOS. '+5511812345678' tem 11 dígitos
//      nacionais e não é celular (celular válido é `9XXXXXXXX` depois do DDD) nem fixo:
//      sai intacto e é enviado. `ensureBr9` também não valida a própria entrada — ela
//      confia em estar recebendo saída de `toE164`. Chamada com '+55abcdefghij' ela
//      devolve '+55ab9cdefghij', alegremente.
//
//   7. `unresolvedPlaceholders` NÃO PEGA TUDO. A regex é `[\w.]+` entre chaves duplas, o
//      que deixa passar, literal, para o lead: `{{}}` (vazio), `{{primeiro nome}}` (espaço
//      NO MEIO — só espaço nas bordas é tolerado) e `{{nome-do-lead}}` (hífen). São
//      exatamente as grafias que um humano cadastrando template erra. Em compensação ela
//      não dá falso positivo em chave simples (`{1}`, `{"a":1}`), que é o outro lado da
//      moeda e o motivo de a regex ser estreita.
//
//   8. NOME DE LEAD COM CHAVES ENVENENA A GUARDA. `renderMessage` não relê o que
//      substituiu (é um `replace` só, sem recursão), então um lead chamado '{{2}}' não
//      causa substituição em cascata — mas a guarda roda depois, na mensagem PRONTA, e
//      acha ali o `{{2}}` que veio do NOME. No blast isso derruba o pedido inteiro; na
//      régua, descarta aquele destinatário. Falha para o lado seguro, e é uma negação de
//      envio que o dado do lead consegue provocar.
//
//   9. `{{01}}` É `{{1}}`. `Number('01')` é 1, então as duas grafias são o mesmo
//      placeholder. E `{{0}}` não existe (`vars[-1]` é `undefined`), fica literal e cai na
//      guarda — que é o desfecho certo pelo motivo errado.
//
// COMO OS DOIS CHAMADORES COMPÕEM ISTO — a forma importa e não está no tipo
// Nos dois lados a chamada é `ensureBr9(toE164(phone, phone_adjusted) ?? '')`, e o `?? ''`
// é load-bearing: `ensureBr9('')` devolve `''`, e é esse `''` que o chamador testa com
// `if (!phone)` para pular o lead como "sem telefone". Passar o `null` direto seria
// `TypeError`. Depois vem o primeiro nome (`String(name ?? '').trim().split(/\s+/)[0]`), a
// recusa de mandar template com nome para lead sem nome (`POSICIONAL_RE.test(corpo)`), o
// render e só então a guarda de placeholder. A ORDEM é parte da regra: trocar a guarda de
// lugar faria `{{...}}` literal sair.
//
// Uma coisa que os chamadores fazem e que NÃO está aqui, de propósito: o `session_id`, que
// os dois montam com os dígitos crus de `phone_adjusted ?? phone` — e não com o E.164 que
// acabou de ser calculado. Ou seja, a chave de sessão do WhatsApp pode apontar para uma
// grafia do número diferente daquela para a qual a mensagem foi. É o mesmo risco de
// "mensagem num número, histórico em outro" que este módulo veio reduzir, e ele continua
// aberto; extrair também essa montagem mudaria comportamento, e este lote não muda nenhum.
//
// REGRA DO PROJETO: este módulo é PURO. Nada aqui lê ambiente, abre conexão, toca relógio
// ou lança na importação — o que o arquivo faz ao ser carregado é compilar duas regexes e
// declarar quatro funções. É o que permite que o teste dele não precise de banco nenhum.

/**
 * E.164 como a rota de blast sempre a escreveu: `+`, um dígito de 1 a 9, e mais 6 a 14
 * dígitos — de 7 a 15 dígitos no total, que é o teto da recomendação.
 *
 * Sem a flag `g`, e isso não é descuido: uma regex global usada com `.test()` guarda
 * `lastIndex` entre chamadas e passa a alternar entre `true` e `false` para a MESMA
 * entrada. Numa regex de módulo, compartilhada por todo mundo, isso seria um lead sim,
 * outro não. Vale igual para `POSICIONAL_RE`.
 */
export const E164_RE = /^\+[1-9]\d{6,14}$/

/** "Este template usa variável posicional?" — é o que decide se lead sem nome pode
 *  receber a mensagem. Só chave dupla com número conta; `{{nome}}` não é posicional. */
export const POSICIONAL_RE = /\{\{\s*\d+\s*\}\}/

/** Normaliza o telefone guardado para E.164. `null` quando não dá para usar.
 *  Ver os defeitos 1 a 4 no cabeçalho antes de confiar no resultado. */
export function toE164(phone: string | null, phoneAdjusted: string | null): string | null {
  const raw = (phone ?? '').trim()
  if (raw.startsWith('+') && E164_RE.test(raw)) return raw
  const digits = (phoneAdjusted ?? phone ?? '').replace(/\D/g, '')
  if (!digits) return null
  const e164 = '+' + digits
  return E164_RE.test(e164) ? e164 : null
}

/** Garante o nono dígito do celular brasileiro (DDD + 9 + 8 dígitos). Fixo (primeiro
 *  dígito 2-5) e número de fora do Brasil passam intactos. Ver os defeitos 5 e 6. */
export function ensureBr9(e164: string): string {
  if (!e164.startsWith('+55')) return e164
  const national = e164.slice(3)
  if (national.length !== 10) return e164
  const firstDigit = national[2]
  if (firstDigit < '6') return e164
  return '+55' + national.slice(0, 2) + '9' + national.slice(2)
}

/** Substitui as variáveis POSICIONAIS do template: {{1}} é a primeira, {{2}} a
 *  segunda. O que a lista não cobre fica intacto — de propósito, para
 *  `unresolvedPlaceholders` pegar antes de a mensagem sair. */
export function renderMessage(templateBody: string, vars: string[]): string {
  return String(templateBody ?? '').replace(/\{\{\s*(\d+)\s*\}\}/g, (raw, pos: string) => {
    const value = vars[Number(pos) - 1]
    return value === undefined ? raw : value
  })
}

/** Placeholders que sobreviveram ao render — o lead receberia `{{...}}` literal.
 *  Não pega tudo: ver o defeito 7 no cabeçalho. */
export function unresolvedPlaceholders(message: string): string[] {
  return message.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []
}
