import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cadeiaDeCausas, comFallback, resumoDoErro } from '@/lib/db/fallback'

/** Erro de rede com a forma que o fetch do Node entrega: TypeError com `cause`. */
function falhaDeRede(codigo: string) {
  const causa = Object.assign(new Error(codigo), { code: codigo })
  return Object.assign(new TypeError('fetch failed'), { cause: causa })
}

test('a cadeia de causas não entra em laço', () => {
  const a: { cause?: unknown } = new Error('a')
  const b = Object.assign(new Error('b'), { cause: a })
  a.cause = b
  assert.equal(cadeiaDeCausas(a).length, 2)
})

test('o resumo de log leva o código e nunca a URL', () => {
  assert.equal(resumoDoErro(falhaDeRede('ENOTFOUND')), 'ENOTFOUND')
  assert.equal(resumoDoErro(new DOMException('x', 'TimeoutError')), 'TimeoutError')
  assert.equal(resumoDoErro(undefined), 'erro desconhecido')
})

test('comFallback devolve o valor da consulta quando ela funciona', async () => {
  const linhas: string[] = []
  const v = await comFallback(async () => 'real', 'padrão', 'teste', l => linhas.push(l))
  assert.equal(v, 'real')
  assert.equal(linhas.length, 0)
})

test('comFallback devolve o padrão e registra quando a consulta falha', async () => {
  const linhas: string[] = []
  const v = await comFallback(
    async () => { throw falhaDeRede('ENOTFOUND') },
    'padrão',
    'tenant',
    l => linhas.push(l),
  )
  assert.equal(v, 'padrão')
  assert.equal(linhas.length, 1)
  assert.match(linhas[0], /\[tenant\].*ENOTFOUND/)
  assert.doesNotMatch(linhas[0], /http|token|auth/i)
})
