// Testes do tradutor de recusas da fonte de dados SDR (lib/sdr/mensagens).
//
// O que está sob teste não é o texto — é QUAIS códigos esta função aceita. Ela
// existe porque duas credenciais diferentes (a fonte de dados SDR e a da YCloud)
// quebram do mesmo jeito e se resolvem em telas diferentes; aceitar um código a mais
// é mandar metade dos operadores para a tela que não resolve.
//
// Por isso o teste de `config_invalid` é uma asserção NEGATIVA: esse código hoje é só
// da YCloud (app/api/ycloud/*, app/api/sdr/templates), que tem tradutor próprio na
// tela de leads. Ele já foi aceito aqui, como ramo de compatibilidade enquanto
// import, enroll e template ainda o emitiam para a fonte SDR — se voltar a passar,
// a ambiguidade voltou junto.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CODIGO_CREDENCIAL_SDR_ILEGIVEL,
  CREDENCIAL_SDR_ILEGIVEL,
  FONTE_SDR_NAO_CONFIGURADA,
  mensagemDeFonteSdr,
} from '@/lib/sdr/mensagens'

test('os dois estados da credencial do SDR têm frases diferentes', () => {
  assert.equal(mensagemDeFonteSdr('fonte_sdr_nao_configurada'), FONTE_SDR_NAO_CONFIGURADA)
  assert.equal(mensagemDeFonteSdr(CODIGO_CREDENCIAL_SDR_ILEGIVEL), CREDENCIAL_SDR_ILEGIVEL)

  // Mandar cadastrar o que já está cadastrado é beco sem saída: as frases não podem
  // convergir, mesmo que um dia alguém ache que dizem a mesma coisa.
  assert.notEqual(FONTE_SDR_NAO_CONFIGURADA, CREDENCIAL_SDR_ILEGIVEL)
})

test('`config_invalid` NÃO é traduzido aqui — é o código da YCloud', () => {
  assert.equal(mensagemDeFonteSdr('config_invalid'), null)
})

test('código desconhecido volta null, e não uma frase genérica de credencial', () => {
  // `null` é o que deixa cada tela dona dos códigos que só ela conhece (db_error,
  // ycloud_error, telefone_invalido…). Uma frase genérica aqui inventaria a causa.
  assert.equal(mensagemDeFonteSdr('db_error'), null)
  assert.equal(mensagemDeFonteSdr(''), null)
})
