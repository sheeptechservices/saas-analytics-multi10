// Testes de lib/sdr/telefone — as quatro funções que decidem PARA QUEM a mensagem vai e
// O QUE está escrito nela.
//
// Não há banco aqui, e isso é o ponto: são funções puras, e o que precisa de prova não é
// integração nenhuma, é a TABELA DE CASOS. A numeração brasileira é cheia de armadilha
// (nono dígito, DDI implícito, fixo x móvel) e o template do WhatsApp é substituição
// posicional crua; os dois erram calados. Um teste que só passa o caminho feliz deixaria
// passar qualquer uma das oito armadilhas listadas no cabeçalho do módulo.
//
// A DISCIPLINA DESTE ARQUIVO: ele prende o comportamento de HOJE, inclusive o errado.
// Onde o módulo tem defeito conhecido — e tem nove, numerados lá —, existe aqui um teste
// que AFIRMA o defeito, com o número dele no nome. Isso é de propósito: mudar a lógica é
// mudar para qual número pessoas reais recebem mensagem, e essa conta é do dono do
// produto. O dia em que alguém decidir consertar, o teste vermelho é o inventário do que
// muda — não um obstáculo, um recibo.
//
// Um censo de leitura na base real (25/09/2026, 60.170 leads) mostrou o tamanho de cada
// armadilha: 314 leads sairiam para número ESTRANGEIRO (defeito 1) — incluindo +999 e
// +981, que não são país nenhum —, 1.198 ganhariam o nono dígito por palpite (defeito 5)
// e 125 não têm telefone utilizável. O defeito 2 (`phone_adjusted` vazio) não tem vítima
// nessa base: zero linhas.
//
// AQUI EXISTIU UM BLOCO DE PINAGEM que lia a rota de blast e a régua do disco e comparava
// os corpos das funções, porque por um tempo a mesma lógica viveu em três lugares. Foi
// apagado junto com as cópias, no lote que fez os dois chamadores importarem este módulo.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  E164_RE,
  POSICIONAL_RE,
  ensureBr9,
  renderMessage,
  toE164,
  unresolvedPlaceholders,
} from '@/lib/sdr/telefone'

// ─── toE164 ───────────────────────────────────────────────────────────────────

test('toE164: phone já em E.164 vence phone_adjusted', () => {
  // A precedência que os dois chamadores dependem: quando `phone` JÁ está pronto, é ele
  // que sai, mesmo com uma `phone_adjusted` de outro número inteiramente.
  assert.equal(toE164('+5511987654321', '5521999999999'), '+5511987654321')
})

test('toE164: phone SEM o + perde para phone_adjusted', () => {
  // A outra metade da precedência, e ela surpreende: basta faltar o `+` para o `phone`
  // ser ignorado em favor da coluna ajustada — que pode ser um número diferente.
  assert.equal(toE164('5511987654321', '5521999999999'), '+5521999999999')
})

test('toE164: phone_adjusted em BRANCO apaga um phone bom (defeito 2)', () => {
  // `phoneAdjusted ?? phone` só cai para o segundo com null/undefined. String vazia não é
  // nula, então ela ganha — e o lead é pulado como "sem telefone" tendo telefone.
  assert.equal(toE164('5511987654321', ''), null)
  assert.equal(toE164('+55 11 98765-4321', ''), null)
})

test('toE164: phone_adjusted NULA devolve a vez ao phone', () => {
  assert.equal(toE164('5511987654321', null), '+5511987654321')
})

test('toE164: só phone_adjusted, com phone nulo', () => {
  assert.equal(toE164(null, '5511987654321'), '+5511987654321')
  assert.equal(toE164('', '5511987654321'), '+5511987654321')
})

test('toE164: pontuação, espaço, parêntese e traço são descartados', () => {
  assert.equal(toE164('+55 (11) 98765-4321', null), '+5511987654321')
  assert.equal(toE164('55.11.98765.4321', null), '+5511987654321')
  assert.equal(toE164(null, '+55 11 9 8765 4321'), '+5511987654321')
  // Inclusive letras no meio: a limpeza é `\D`, não um validador.
  assert.equal(toE164('tel 5511987654321', null), '+5511987654321')
})

test('toE164: espaço em volta de um E.164 já pronto é aparado', () => {
  assert.equal(toE164('  +5511987654321  ', null), '+5511987654321')
})

test('toE164: SEM código de país o número vira estrangeiro (defeito 1)', () => {
  // '11987654321' é um celular de São Paulo sem o 55. Sai '+1 1987654321', que é NANP.
  // Não é recusa: é um número plausível, aceito, e para o qual `ensureBr9` nem olha.
  assert.equal(toE164('11987654321', null), '+11987654321')
  assert.equal(ensureBr9(toE164('11987654321', null) ?? ''), '+11987654321')
  assert.equal(toE164('1187654321', null), '+1187654321')
})

test('toE164: prefixo de tronco 0 é recusa (defeito 4)', () => {
  // A E164_RE exige [1-9] logo depois do `+`; '011…' cai fora inteiro.
  assert.equal(toE164('011 98765-4321', null), null)
  assert.equal(toE164(null, '0'), null)
})

test('toE164: vazio e nulo nas duas pontas', () => {
  assert.equal(toE164(null, null), null)
  assert.equal(toE164('', ''), null)
  assert.equal(toE164('   ', null), null)
  assert.equal(toE164('', null), null)
  assert.equal(toE164(null, ''), null)
})

test('toE164: o que não dá para salvar volta null', () => {
  assert.equal(toE164('não tem', null), null)
  assert.equal(toE164('(  ) -', null), null)
  assert.equal(toE164('123456', null), null)            // 6 dígitos: curto demais
  assert.equal(toE164('1234567890123456', null), null)  // 16 dígitos: longo demais
})

test('toE164: lixo colado no fim entra na conta (defeito 3)', () => {
  // Um ramal vira mais dígitos do número, e enquanto couber em 15 o resultado é ACEITO:
  // um E.164 bem formado, para um telefone que não existe.
  assert.equal(toE164('5511987654321 r2', null), '+55119876543212')
  assert.equal(toE164('5511987654321 ramal 22', null), '+551198765432122')
  // Só o teto da E.164 barra — 16 dígitos. Não há validação nenhuma antes disso.
  assert.equal(toE164('5511987654321 ramal 222', null), null)
})

test('toE164: as bordas de tamanho, pela porta de cima', () => {
  assert.equal(toE164('1234567', null), '+1234567')                   // 7 dígitos: mínimo
  assert.equal(toE164('123456789012345', null), '+123456789012345')   // 15: máximo
})

// ─── ensureBr9 ────────────────────────────────────────────────────────────────

test('ensureBr9: celular de 10 dígitos ganha o nono', () => {
  assert.equal(ensureBr9('+551187654321'), '+5511987654321')
  assert.equal(ensureBr9('+552176543210'), '+5521976543210')
  // Toda a faixa móvel do corte da Anatel: 6, 7, 8 e 9.
  for (const d of ['6', '7', '8', '9']) {
    assert.equal(ensureBr9(`+5511${d}7654321`), `+55119${d}7654321`, `faixa ${d}`)
  }
})

test('ensureBr9: celular que JÁ tem o nono não ganha outro', () => {
  assert.equal(ensureBr9('+5511987654321'), '+5511987654321')
})

test('ensureBr9: é idempotente — aplicar duas vezes não muda nada', () => {
  for (const n of ['+551187654321', '+5511987654321', '+551132654321', '+12125551234']) {
    assert.equal(ensureBr9(ensureBr9(n)), ensureBr9(n), n)
  }
})

test('ensureBr9: fixo (primeiro dígito 2-5) NÃO é tocado — a faixa ambígua', () => {
  // O corte é `firstDigit < '6'`. É o palpite do defeito 5: assume-se fixo. Um celular
  // legado nessa faixa ficaria sem o 9 e a mensagem iria para um telefone fixo.
  for (const d of ['2', '3', '4', '5']) {
    assert.equal(ensureBr9(`+5511${d}7654321`), `+5511${d}7654321`, `faixa ${d}`)
  }
  assert.equal(ensureBr9('+551132654321'), '+551132654321')
})

test('ensureBr9: número de fora do Brasil passa intacto', () => {
  assert.equal(ensureBr9('+12125551234'), '+12125551234')       // EUA, 10 nacionais
  assert.equal(ensureBr9('+351912345678'), '+351912345678')     // Portugal
  assert.equal(ensureBr9('+5491123456789'), '+5491123456789')   // Argentina
  assert.equal(ensureBr9('+5411234567'), '+5411234567')         // começa com 54, não 55
})

test('ensureBr9: só o caso de EXATAMENTE 10 dígitos nacionais é mexido', () => {
  assert.equal(ensureBr9('+55118765432'), '+55118765432')          // 9 nacionais
  assert.equal(ensureBr9('+5511876543210'), '+5511876543210')      // 11 nacionais
  assert.equal(ensureBr9('+551187654321098'), '+551187654321098')  // 13 nacionais
})

test('ensureBr9: 11 dígitos corrompidos saem como entraram (defeito 6)', () => {
  // Celular válido é `9XXXXXXXX` depois do DDD. Este não é celular nem fixo, tem 11
  // dígitos e por isso escapa do conserto: vai para o disparo exatamente assim.
  assert.equal(ensureBr9('+5511812345678'), '+5511812345678')
})

test('ensureBr9: não valida a própria entrada (defeito 6)', () => {
  // Ela confia em estar recebendo saída de toE164. Chamada fora dessa composição, faz
  // aritmética de string com o que vier — inclusive letras.
  assert.equal(ensureBr9('+55abcdefghij'), '+55ab9cdefghij')
  assert.equal(ensureBr9('+55'), '+55')
  assert.equal(ensureBr9('+5'), '+5')
})

test('ensureBr9: string vazia volta vazia — é o sentinela dos chamadores', () => {
  // Os dois chamadores escrevem `ensureBr9(toE164(...) ?? '')` e testam `if (!phone)`.
  // Se isto lançasse, ou devolvesse qualquer coisa verdadeira, o lead sem telefone
  // deixaria de ser pulado.
  assert.equal(ensureBr9(''), '')
  assert.equal(ensureBr9(toE164(null, null) ?? ''), '')
})

test('composição: o caminho inteiro que os chamadores percorrem', () => {
  assert.equal(ensureBr9(toE164('551187654321', null) ?? ''), '+5511987654321')
  assert.equal(ensureBr9(toE164(null, '55 11 8765-4321') ?? ''), '+5511987654321')
  assert.equal(ensureBr9(toE164('+5511987654321', null) ?? ''), '+5511987654321')
  assert.equal(ensureBr9(toE164('sem telefone', null) ?? ''), '')
})

// ─── E164_RE ──────────────────────────────────────────────────────────────────

test('E164_RE: as bordas de comprimento, 7 e 15 dígitos', () => {
  assert.equal(E164_RE.test('+1234567'), true)           // 7: o mínimo
  assert.equal(E164_RE.test('+123456'), false)           // 6: um a menos
  assert.equal(E164_RE.test('+123456789012345'), true)   // 15: o máximo da E.164
  assert.equal(E164_RE.test('+1234567890123456'), false) // 16: um a mais
})

test('E164_RE: exige o + e um primeiro dígito de 1 a 9', () => {
  assert.equal(E164_RE.test('1234567'), false)
  assert.equal(E164_RE.test('+0123456'), false)
  assert.equal(E164_RE.test('++1234567'), false)
  assert.equal(E164_RE.test('+'), false)
  assert.equal(E164_RE.test(''), false)
})

test('E164_RE: nada além de dígitos, e a âncora vale de ponta a ponta', () => {
  assert.equal(E164_RE.test('+12345 67'), false)
  assert.equal(E164_RE.test('+12345-67'), false)
  assert.equal(E164_RE.test('tel +1234567'), false)
  assert.equal(E164_RE.test('+1234567 ramal'), false)
  // `$` sem a flag `m` não perdoa nem quebra de linha no fim.
  assert.equal(E164_RE.test('+1234567\n'), false)
  assert.equal(E164_RE.test('+1234567\nlixo'), false)
})

test('E164_RE e POSICIONAL_RE não são globais — regex de módulo com `g` mente', () => {
  // Uma regex global usada com `.test()` guarda `lastIndex` e alterna true/false para a
  // MESMA entrada. Numa constante de módulo isso seria um lead sim, outro não.
  assert.equal(E164_RE.flags, '')
  assert.equal(POSICIONAL_RE.flags, '')
  for (let i = 0; i < 3; i++) assert.equal(E164_RE.test('+5511987654321'), true, `volta ${i}`)
  for (let i = 0; i < 3; i++) assert.equal(POSICIONAL_RE.test('Oi {{1}}'), true, `volta ${i}`)
})

// ─── POSICIONAL_RE ────────────────────────────────────────────────────────────

test('POSICIONAL_RE: só chave dupla com número conta como posicional', () => {
  assert.equal(POSICIONAL_RE.test('Oi {{1}}'), true)
  assert.equal(POSICIONAL_RE.test('Oi {{ 1 }}'), true)
  assert.equal(POSICIONAL_RE.test('Oi {{12}}'), true)
  assert.equal(POSICIONAL_RE.test('Oi {{nome}}'), false)
  assert.equal(POSICIONAL_RE.test('Oi {1}'), false)
  assert.equal(POSICIONAL_RE.test('Oi, tudo bem?'), false)
})

// ─── renderMessage ────────────────────────────────────────────────────────────

test('renderMessage: substituição posicional', () => {
  assert.equal(renderMessage('Oi {{1}}!', ['Ana']), 'Oi Ana!')
  assert.equal(renderMessage('{{1}}, aqui é {{2}}', ['Ana', 'Bia']), 'Ana, aqui é Bia')
  // A mesma posição repetida é substituída todas as vezes.
  assert.equal(renderMessage('{{1}} e {{1}}', ['Ana']), 'Ana e Ana')
})

test('renderMessage: mais placeholders que valores — o resto fica literal', () => {
  // De propósito: é o que a guarda de placeholder pega depois.
  assert.equal(renderMessage('Oi {{1}}, {{2}}', ['Ana']), 'Oi Ana, {{2}}')
  assert.equal(renderMessage('Oi {{1}}', []), 'Oi {{1}}')
})

test('renderMessage: mais valores que placeholders — o excedente é ignorado', () => {
  assert.equal(renderMessage('Oi {{1}}', ['Ana', 'Bia', 'Cia']), 'Oi Ana')
  assert.equal(renderMessage('Oi, tudo bem?', ['Ana']), 'Oi, tudo bem?')
})

test('renderMessage: valor que PARECE placeholder não é reprocessado (defeito 8)', () => {
  // Não há recursão — o replace passa uma vez só. Mas a guarda roda na mensagem PRONTA e
  // vai achar ali o `{{2}}` que veio do NOME do lead, barrando o envio.
  assert.equal(renderMessage('Oi {{1}}', ['{{2}}']), 'Oi {{2}}')
  assert.deepEqual(unresolvedPlaceholders(renderMessage('Oi {{1}}', ['{{2}}'])), ['{{2}}'])
})

test('renderMessage: $& e $1 no valor entram literais', () => {
  // O replace recebe uma FUNÇÃO, então os padrões de substituição do `$` não valem —
  // um nome com cifrão não consegue reescrever a mensagem.
  assert.equal(renderMessage('Oi {{1}}', ['$& $1 $$']), 'Oi $& $1 $$')
  assert.equal(renderMessage('Oi {{1}}', ["R$ 100 & cia"]), 'Oi R$ 100 & cia')
})

test('renderMessage: espaço dentro das chaves, nas três posições', () => {
  assert.equal(renderMessage('{{ 1 }}', ['Ana']), 'Ana')
  assert.equal(renderMessage('{{1 }}', ['Ana']), 'Ana')
  assert.equal(renderMessage('{{ 1}}', ['Ana']), 'Ana')
  assert.equal(renderMessage('{{\t1\t}}', ['Ana']), 'Ana')
  assert.equal(renderMessage('{{\n1\n}}', ['Ana']), 'Ana')
  // Espaço ENTRE os dois pares de chaves não é placeholder.
  assert.equal(renderMessage('{ {1} }', ['Ana']), '{ {1} }')
})

test('renderMessage: {{0}} não existe e {{01}} é {{1}} (defeito 9)', () => {
  assert.equal(renderMessage('Oi {{0}}', ['Ana']), 'Oi {{0}}')
  assert.equal(renderMessage('Oi {{01}}', ['Ana']), 'Oi Ana')
})

test('renderMessage: valor vazio SUBSTITUI — não é o mesmo que ausente', () => {
  assert.equal(renderMessage('Oi {{1}}!', ['']), 'Oi !')
})

test('renderMessage: placeholder nomeado atravessa intacto', () => {
  assert.equal(renderMessage('Oi {{nome}}', ['Ana']), 'Oi {{nome}}')
  assert.equal(renderMessage('Oi {{{1}}}', ['Ana']), 'Oi {Ana}')
})

test('renderMessage: corpo vazio e corpo nulo viram string vazia', () => {
  assert.equal(renderMessage('', ['Ana']), '')
  // O `?? ''` é morto pelo tipo e vivo para chamador em JavaScript.
  assert.equal(renderMessage(null as unknown as string, ['Ana']), '')
})

// ─── unresolvedPlaceholders ───────────────────────────────────────────────────

test('unresolvedPlaceholders: acha o que sobrou', () => {
  assert.deepEqual(unresolvedPlaceholders('Oi Ana, {{2}}'), ['{{2}}'])
  assert.deepEqual(unresolvedPlaceholders('Oi {{nome}}'), ['{{nome}}'])
  assert.deepEqual(unresolvedPlaceholders('Oi {{lead.nome}}'), ['{{lead.nome}}'])
  assert.deepEqual(unresolvedPlaceholders('{{1}} {{ 2 }} {{nome}}'), ['{{1}}', '{{ 2 }}', '{{nome}}'])
})

test('unresolvedPlaceholders: mensagem inteira resolvida devolve lista vazia', () => {
  assert.deepEqual(unresolvedPlaceholders('Oi Ana!'), [])
  assert.deepEqual(unresolvedPlaceholders(''), [])
  assert.deepEqual(unresolvedPlaceholders(renderMessage('Oi {{1}}', ['Ana'])), [])
})

test('unresolvedPlaceholders: chave simples NÃO é falso positivo', () => {
  // É por isso que a regex é estreita: corpo de template com JSON, dinheiro ou chave
  // solta não pode derrubar um disparo inteiro.
  assert.deepEqual(unresolvedPlaceholders('Oi {1} e {nome}'), [])
  assert.deepEqual(unresolvedPlaceholders('use {"a":1} agora'), [])
  assert.deepEqual(unresolvedPlaceholders('valor { 1 } e }{ invertido'), [])
  assert.deepEqual(unresolvedPlaceholders('função() { return 1 }'), [])
})

test('unresolvedPlaceholders: as grafias que ESCAPAM da guarda (defeito 7)', () => {
  // Estas três chegam LITERAIS ao lead. São exatamente as que um humano cadastrando
  // template erra. Prender aqui é o inventário de quem consertar a regex um dia.
  assert.deepEqual(unresolvedPlaceholders('Oi {{}}'), [])
  assert.deepEqual(unresolvedPlaceholders('Oi {{primeiro nome}}'), [])
  assert.deepEqual(unresolvedPlaceholders('Oi {{nome-do-lead}}'), [])
  assert.deepEqual(unresolvedPlaceholders('Oi {{ }}'), [])
})

