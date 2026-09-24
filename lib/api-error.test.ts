import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  ApiError, classificarFalha, classificarStatus, fetchJson, textoDaFalha, textoDeLeituraPerdida,
  textoDeModuloDesligado,
} from '@/lib/api-error'

// ─── Classificação ───────────────────────────────────────────────────────────

test('cada faixa de status vira um tipo de falha diferente', () => {
  assert.equal(classificarStatus(401), 'sem-sessao')
  assert.equal(classificarStatus(403), 'sem-modulo')
  assert.equal(classificarStatus(400), 'requisicao')
  assert.equal(classificarStatus(404), 'requisicao')
  assert.equal(classificarStatus(409), 'requisicao')
  assert.equal(classificarStatus(500), 'servidor')
  assert.equal(classificarStatus(502), 'servidor')
  assert.equal(classificarStatus(0),   'rede')
})

test('403 e 500 nunca produzem o mesmo texto', () => {
  const semModulo = textoDaFalha(new ApiError(403, 'sem-modulo'))
  const servidor  = textoDaFalha(new ApiError(500, 'servidor'))
  const rede      = textoDaFalha(new ApiError(0, 'rede'))
  assert.notEqual(semModulo.titulo, servidor.titulo)
  assert.notEqual(semModulo.detalhe, servidor.detalhe)
  assert.notEqual(servidor.detalhe, rede.detalhe)
})

test('insistir só é oferecido quando adianta', () => {
  // 403 é o plano do cliente: o botão "Tentar novamente" seria uma mentira.
  assert.equal(textoDaFalha(new ApiError(403, 'sem-modulo')).podeTentarDeNovo, false)
  assert.equal(textoDaFalha(new ApiError(401, 'sem-sessao')).podeTentarDeNovo, false)
  assert.equal(textoDeModuloDesligado('sdr.parametros').podeTentarDeNovo, false)
  assert.equal(textoDaFalha(new ApiError(500, 'servidor')).podeTentarDeNovo, true)
  assert.equal(textoDaFalha(new ApiError(0, 'rede')).podeTentarDeNovo, true)
})

test('erro que não é ApiError cai em rede, e não passa por permissão', () => {
  assert.equal(classificarFalha(new TypeError('Failed to fetch')), 'rede')
  assert.equal(classificarFalha('403'), 'rede')
  assert.equal(classificarFalha(undefined), 'rede')
  assert.notEqual(classificarFalha(new Error('x')), 'sem-modulo')
})

test('o assunto entra na frase, e todo texto está em português', () => {
  const t = textoDaFalha(new ApiError(500, 'servidor'), 'os contatos')
  assert.match(t.titulo, /Não foi possível carregar os contatos/)
  for (const texto of [
    textoDaFalha(new ApiError(403, 'sem-modulo')),
    textoDaFalha(new ApiError(401, 'sem-sessao')),
    textoDaFalha(new ApiError(400, 'requisicao')),
    textoDaFalha(new ApiError(500, 'servidor')),
    textoDaFalha(new ApiError(0, 'rede')),
    textoDeModuloDesligado('integration.ycloud-whatsapp'),
  ]) {
    assert.ok(texto.titulo.length > 0 && texto.detalhe.length > 0)
    // Nenhum resto de inglês nem de código cru na tela.
    assert.doesNotMatch(`${texto.titulo} ${texto.detalhe}`, /module_disabled|Unauthorized|Failed|undefined/)
  }
})

test('o texto do módulo desligado nomeia o módulo quando ele existe no catálogo', () => {
  assert.match(textoDeModuloDesligado('integration.ycloud-whatsapp').detalhe, /YCloud \(WhatsApp\)/)
  assert.match(textoDeModuloDesligado('sdr.dashboard').detalhe, /SDR \/ Disparos/)
  // Chave desconhecida não pode virar "undefined" na frase.
  assert.doesNotMatch(textoDeModuloDesligado('integration.inexistente').detalhe, /undefined/)
})

// ─── fetchJson ───────────────────────────────────────────────────────────────

const fetchOriginal = globalThis.fetch
afterEach(() => { globalThis.fetch = fetchOriginal })

function stubFetch(resposta: Partial<Response> & { jsonValue?: unknown; jsonThrows?: boolean }) {
  globalThis.fetch = (async () => ({
    ok:     resposta.ok ?? true,
    status: resposta.status ?? 200,
    json:   async () => {
      if (resposta.jsonThrows) throw new SyntaxError('Unexpected token <')
      return resposta.jsonValue
    },
  })) as unknown as typeof fetch
}

test('fetchJson devolve o corpo quando a resposta é 200', async () => {
  stubFetch({ ok: true, status: 200, jsonValue: { items: [1, 2] } })
  assert.deepEqual(await fetchJson<{ items: number[] }>('/api/contacts'), { items: [1, 2] })
})

test('fetchJson estoura no 403 em vez de devolver o corpo do erro como dado', async () => {
  // Este é o defeito da issue #98: `{ error: 'module_disabled' }` chegava às
  // telas e o `?? []` seguinte transformava o 403 em "nada para mostrar".
  stubFetch({ ok: false, status: 403, jsonValue: { error: 'module_disabled', module: 'sdr.parametros' } })
  const erro = await fetchJson('/api/sdr/leads').then(() => null, (e: unknown) => e)
  assert.ok(erro instanceof ApiError)
  assert.equal(erro.status, 403)
  assert.equal(erro.kind, 'sem-modulo')
  assert.equal(erro.codigo, 'module_disabled')
})

test('fetchJson estoura no 500 com corpo vazio ou HTML', async () => {
  stubFetch({ ok: false, status: 500, jsonThrows: true })
  const erro = await fetchJson('/api/bi/sdr').then(() => null, (e: unknown) => e)
  assert.ok(erro instanceof ApiError)
  assert.equal(erro.kind, 'servidor')
  assert.equal(erro.codigo, undefined)
})

test('fetchJson trata 200 com corpo inválido como falha, não como dado', async () => {
  stubFetch({ ok: true, status: 200, jsonThrows: true })
  const erro = await fetchJson('/api/settings').then(() => null, (e: unknown) => e)
  assert.ok(erro instanceof ApiError)
  assert.equal(erro.kind, 'rede')
})

test('fetchJson transforma a queda de rede em ApiError, não em TypeError solto', async () => {
  globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
  const erro = await fetchJson('/api/me').then(() => null, (e: unknown) => e)
  assert.ok(erro instanceof ApiError)
  assert.equal(erro.kind, 'rede')
  assert.equal(erro.status, 0)
})

// ─── Leitura destrutiva (issues #94 e #98) ───────────────────────────────────

test('o aviso de "nada pode ser salvo" entra em toda falha, inclusive no 403', () => {
  // A tentação, ao separar 403 de 500, é tratar o 403 como "só leitura, sem
  // risco" e soltar o Salvar. Não é: o PUT continua disponível na tela, e um
  // Salvar sem leitura apaga as URLs e os segredos de n8n para sempre.
  const perdido = 'as URLs e os segredos já configurados'
  for (const erro of [
    new ApiError(403, 'sem-modulo'),
    new ApiError(401, 'sem-sessao'),
    new ApiError(500, 'servidor'),
    new ApiError(0, 'rede'),
    new TypeError('Failed to fetch'),
  ]) {
    const t = textoDeLeituraPerdida(erro, perdido)
    assert.match(t.detalhe, /Nada pode ser salvo até a leitura dar certo/)
    assert.match(t.detalhe, /apagaria as URLs e os segredos já configurados/)
    assert.equal(t.podeTentarDeNovo, true, 'recarregar é sempre o caminho de saída')
  }
})

test('a causa da falha continua visível dentro do aviso de leitura perdida', () => {
  const trezentos = textoDeLeituraPerdida(new ApiError(403, 'sem-modulo'), 'x')
  const quinhentos = textoDeLeituraPerdida(new ApiError(500, 'servidor'), 'x')
  assert.notEqual(trezentos.detalhe, quinhentos.detalhe)
  assert.match(quinhentos.detalhe, /servidor/)
  assert.match(trezentos.detalhe, /plano contratado/)
})
