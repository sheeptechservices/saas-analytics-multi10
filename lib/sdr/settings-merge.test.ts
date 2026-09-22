import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  N8N_CREDENTIAL_PAIRS,
  isStaleVersion,
  mergeSdrSettings,
  readN8nSecret,
  sameWebhookTarget,
  type N8nSecretKey,
} from '@/lib/sdr/settings-merge'

// Chave descartável só para os testes — nunca a do .env.local.
const CHAVE = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const original = process.env.ENCRYPTION_SECRET

before(() => { process.env.ENCRYPTION_SECRET = CHAVE })
after(() => {
  if (original === undefined) delete process.env.ENCRYPTION_SECRET
  else process.env.ENCRYPTION_SECRET = original
})

const URL_ANTIGA = 'https://n8n.exemplo.com/webhook/abc'
const URL_NOVA   = 'https://n8n-do-atacante.exemplo/webhook/abc'

const cifrado = (valor: unknown) => typeof valor === 'string' && /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/i.test(valor)

// ─── Regra 1: o segredo é do par, não do tenant ───────────────────────────────

for (const { urlKey, secretKey } of N8N_CREDENTIAL_PAIRS) {
  test(`${secretKey}: segredo omitido sobrevive quando a URL não muda`, () => {
    const guardado = mergeSdrSettings(null, { [urlKey]: URL_ANTIGA, [secretKey]: 'segredo-antigo' })
    const merged   = mergeSdrSettings(guardado, { [urlKey]: URL_ANTIGA })

    assert.equal(merged[urlKey], URL_ANTIGA)
    assert.equal(readN8nSecret(merged, secretKey), 'segredo-antigo')
  })

  test(`${secretKey}: segredo omitido CAI FORA quando a URL muda`, () => {
    const guardado = mergeSdrSettings(null, { [urlKey]: URL_ANTIGA, [secretKey]: 'segredo-antigo' })
    const merged   = mergeSdrSettings(guardado, { [urlKey]: URL_NOVA })

    assert.equal(merged[urlKey], URL_NOVA)
    assert.equal(merged[secretKey], undefined)
    assert.equal(readN8nSecret(merged, secretKey), null)
  })

  test(`${secretKey}: segredo novo sempre vence`, () => {
    const guardado = mergeSdrSettings(null, { [urlKey]: URL_ANTIGA, [secretKey]: 'segredo-antigo' })

    // ...com a mesma URL
    const mesmaUrl = mergeSdrSettings(guardado, { [urlKey]: URL_ANTIGA, [secretKey]: 'segredo-novo' })
    assert.equal(readN8nSecret(mesmaUrl, secretKey), 'segredo-novo')

    // ...e com URL trocada no mesmo PUT
    const outraUrl = mergeSdrSettings(guardado, { [urlKey]: URL_NOVA, [secretKey]: 'segredo-novo' })
    assert.equal(outraUrl[urlKey], URL_NOVA)
    assert.equal(readN8nSecret(outraUrl, secretKey), 'segredo-novo')
  })

  test(`${urlKey}: URL omitida no PUT mantém a guardada — e o segredo junto (issue #94)`, () => {
    const guardado = mergeSdrSettings(null, { [urlKey]: URL_ANTIGA, [secretKey]: 'segredo-antigo' })
    const merged   = mergeSdrSettings(guardado, { tom: 'direto', limiteDiario: 50 })

    assert.equal(merged[urlKey], URL_ANTIGA)
    assert.equal(readN8nSecret(merged, secretKey), 'segredo-antigo')
    assert.equal(merged.tom, 'direto')
  })
}

test('os cinco pares são independentes num único PUT', () => {
  const guardado = mergeSdrSettings(null, Object.fromEntries(
    N8N_CREDENTIAL_PAIRS.flatMap(({ urlKey, secretKey }) => [
      [urlKey, `${URL_ANTIGA}/${urlKey}`],
      [secretKey, `segredo-${secretKey}`],
    ]),
  ))

  // Só a URL do blast muda; o PUT não traz segredo nenhum.
  const merged = mergeSdrSettings(guardado, Object.fromEntries(
    N8N_CREDENTIAL_PAIRS.map(({ urlKey }) => [
      urlKey,
      urlKey === 'n8nBlastUrl' ? URL_NOVA : `${URL_ANTIGA}/${urlKey}`,
    ]),
  ))

  assert.equal(readN8nSecret(merged, 'n8nBlastSecret'), null, 'o segredo do blast tinha de cair')
  for (const { secretKey } of N8N_CREDENTIAL_PAIRS) {
    if (secretKey === 'n8nBlastSecret') continue
    assert.equal(readN8nSecret(merged, secretKey), `segredo-${secretKey}`, `${secretKey} não podia ser afetado`)
  }
})

test('URL apagada no PUT também derruba o segredo', () => {
  const guardado = mergeSdrSettings(null, { n8nBlastUrl: URL_ANTIGA, n8nBlastSecret: 'segredo-antigo' })
  const merged   = mergeSdrSettings(guardado, { n8nBlastUrl: '' })

  assert.equal(merged.n8nBlastUrl, undefined)
  assert.equal(merged.n8nBlastSecret, undefined)
})

// ─── Regra 2: o que conta como "mesma URL" ────────────────────────────────────

test('sameWebhookTarget ignora barra final, caixa do host, porta padrão, query e fragmento', () => {
  assert.equal(sameWebhookTarget('https://n8n.exemplo.com/webhook/abc', 'https://n8n.exemplo.com/webhook/abc/'), true)
  assert.equal(sameWebhookTarget('https://N8N.Exemplo.COM/webhook/abc', 'https://n8n.exemplo.com/webhook/abc'), true)
  assert.equal(sameWebhookTarget('https://n8n.exemplo.com:443/webhook/abc', 'https://n8n.exemplo.com/webhook/abc'), true)
  assert.equal(sameWebhookTarget('https://n8n.exemplo.com/webhook/abc?x=1', 'https://n8n.exemplo.com/webhook/abc#y'), true)
  assert.equal(sameWebhookTarget('', ''), true)
})

test('sameWebhookTarget separa host, caminho, esquema e porta diferentes', () => {
  assert.equal(sameWebhookTarget('https://n8n.exemplo.com/webhook/abc', 'https://outro.exemplo.com/webhook/abc'), false)
  assert.equal(sameWebhookTarget('https://n8n.exemplo.com/webhook/abc', 'https://n8n.exemplo.com/webhook/xyz'), false)
  assert.equal(sameWebhookTarget('https://n8n.exemplo.com/webhook/abc', 'http://n8n.exemplo.com/webhook/abc'), false)
  assert.equal(sameWebhookTarget('https://n8n.exemplo.com:8443/webhook/abc', 'https://n8n.exemplo.com/webhook/abc'), false)
  assert.equal(sameWebhookTarget('https://n8n.exemplo.com/webhook/abc', ''), false)
  // URL malformada cai na comparação literal, e não em "tudo é igual".
  assert.equal(sameWebhookTarget('nao-é-url', 'nao-é-url'), true)
  assert.equal(sameWebhookTarget('nao-é-url', 'outra-coisa'), false)
})

// ─── Regra 3: cifrado em repouso, sem migração ────────────────────────────────

test('o segredo persistido nunca fica em texto puro', () => {
  const merged = mergeSdrSettings(null, { n8nBlastUrl: URL_ANTIGA, n8nBlastSecret: 'segredo-em-claro' })

  assert.notEqual(merged.n8nBlastSecret, 'segredo-em-claro')
  assert.ok(cifrado(merged.n8nBlastSecret), 'deveria estar no formato iv:tag:ciphertext')
  assert.equal(readN8nSecret(merged, 'n8nBlastSecret'), 'segredo-em-claro')
})

test('valor legado em texto puro continua legível — e sobe para cifrado no primeiro save', () => {
  // Como estava no banco antes deste lote: JSON com o segredo cru.
  const legado = { n8nBlastUrl: URL_ANTIGA, n8nBlastSecret: 'legado-em-texto-puro' }

  assert.equal(readN8nSecret(legado, 'n8nBlastSecret'), 'legado-em-texto-puro')

  const merged = mergeSdrSettings(legado, { n8nBlastUrl: URL_ANTIGA })
  assert.ok(cifrado(merged.n8nBlastSecret), 'o save tinha de reescrever cifrado')
  assert.equal(readN8nSecret(merged, 'n8nBlastSecret'), 'legado-em-texto-puro')
})

test('salvar duas vezes não re-embrulha o valor já cifrado', () => {
  const um   = mergeSdrSettings(null, { n8nBlastUrl: URL_ANTIGA, n8nBlastSecret: 'estável' })
  const dois = mergeSdrSettings(um, { n8nBlastUrl: URL_ANTIGA })

  assert.equal(dois.n8nBlastSecret, um.n8nBlastSecret)
  assert.equal(readN8nSecret(dois, 'n8nBlastSecret'), 'estável')
})

test('readN8nSecret devolve null para ausente, vazio e não-string', () => {
  assert.equal(readN8nSecret({}, 'n8nBlastSecret'), null)
  assert.equal(readN8nSecret({ n8nBlastSecret: '' }, 'n8nBlastSecret'), null)
  assert.equal(readN8nSecret({ n8nBlastSecret: 42 }, 'n8nBlastSecret'), null)
})

test('cifrado com outra chave não derruba a rota: devolve null e não lança', (t) => {
  t.mock.method(console, 'error', () => {})
  const merged = mergeSdrSettings(null, { n8nBlastUrl: URL_ANTIGA, n8nBlastSecret: 'segredo' })
  process.env.ENCRYPTION_SECRET = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100'
  try {
    assert.doesNotThrow(() => readN8nSecret(merged, 'n8nBlastSecret'))
    assert.equal(readN8nSecret(merged, 'n8nBlastSecret'), null)
  } finally {
    process.env.ENCRYPTION_SECRET = CHAVE
  }
})

test('o merge não registra segredo nenhum no console', (t) => {
  const linhas: unknown[] = []
  t.mock.method(console, 'log',   (...args: unknown[]) => { linhas.push(...args) })
  t.mock.method(console, 'error', (...args: unknown[]) => { linhas.push(...args) })
  t.mock.method(console, 'warn',  (...args: unknown[]) => { linhas.push(...args) })

  const merged = mergeSdrSettings(null, { n8nBlastUrl: URL_ANTIGA, n8nBlastSecret: 'nao-pode-aparecer' })
  readN8nSecret(merged, 'n8nBlastSecret')

  const tudo = linhas.map(String).join('\n')
  assert.equal(tudo.includes('nao-pode-aparecer'), false)
  assert.equal(tudo.includes(String(merged.n8nBlastSecret)), false)
})

// ─── Regra 4: trava otimista de version ───────────────────────────────────────

test('version ausente ou não numérica não bloqueia (compatibilidade com cliente antigo)', () => {
  assert.equal(isStaleVersion(7, undefined), false)
  assert.equal(isStaleVersion(7, null), false)
  assert.equal(isStaleVersion(7, '7'), false)
  assert.equal(isStaleVersion(7, 7.5), false)
  assert.equal(isStaleVersion(7, NaN), false)
})

test('version diferente da guardada é conflito', () => {
  assert.equal(isStaleVersion(7, 7), false)
  assert.equal(isStaleVersion(7, 6), true)
  assert.equal(isStaleVersion(7, 8), true)
  assert.equal(isStaleVersion(0, 0), false)
})

// ─── O cenário completo do incidente ──────────────────────────────────────────

test('trocar a URL sem mandar segredo: a entrega ao destino novo vai SEM Authorization', () => {
  const guardado = mergeSdrSettings(null, { n8nWebhookUrl: URL_ANTIGA, n8nWebhookSecret: 'token-do-n8n-real' })
  assert.equal(readN8nSecret(guardado, 'n8nWebhookSecret'), 'token-do-n8n-real')

  // O PUT do atacante: só a URL.
  const merged = mergeSdrSettings(guardado, { n8nWebhookUrl: URL_NOVA })

  const segredo = readN8nSecret(merged, 'n8nWebhookSecret') ?? undefined
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (segredo) headers['Authorization'] = `Bearer ${segredo}`

  assert.equal(merged.n8nWebhookUrl, URL_NOVA)
  assert.equal(segredo, undefined)
  assert.equal(headers.Authorization, undefined)
  // E o que ficou no banco não tem mais o segredo antigo em lugar nenhum.
  assert.equal(JSON.stringify(merged).includes('token-do-n8n-real'), false)
})

// O que a tela de Credenciais fazia quando o GET falhava: mandava as cinco URLs
// como '' e levava os segredos junto. Os dois lados do contrato ficam fixados
// aqui — a tela agora omite a URL que nunca carregou (ver credenciais/page.tsx).
test('PUT que omite as URLs preserva tudo; PUT que manda as cinco vazias apaga tudo', () => {
  const guardado = mergeSdrSettings(null, {
    tom: 'consultivo',
    n8nWebhookUrl: `${URL_ANTIGA}/wh`,
    n8nDispatchUrl: `${URL_ANTIGA}/di`,
    n8nEnrollUrl: `${URL_ANTIGA}/en`,
    n8nImportUrl: `${URL_ANTIGA}/im`,
    n8nBlastUrl: `${URL_ANTIGA}/bl`,
    n8nDispatchSecret: 'segredo-dispatch',
    n8nBlastSecret: 'segredo-blast',
  })

  // Tela que não carregou e OMITE as URLs: nada se perde.
  const omitindo = mergeSdrSettings(guardado, { tom: 'direto' })
  assert.equal(omitindo.n8nBlastUrl, `${URL_ANTIGA}/bl`)
  assert.equal(readN8nSecret(omitindo, 'n8nDispatchSecret'), 'segredo-dispatch')
  assert.equal(readN8nSecret(omitindo, 'n8nBlastSecret'), 'segredo-blast')

  // O PUT destrutivo que o loaded/disabled agora impede.
  const zerando = mergeSdrSettings(guardado, Object.fromEntries(
    [...N8N_CREDENTIAL_PAIRS.map(p => [p.urlKey, '']), ['tom', 'direto']],
  ))
  for (const { urlKey, secretKey } of N8N_CREDENTIAL_PAIRS) {
    assert.equal(zerando[urlKey], undefined)
    assert.equal(zerando[secretKey], undefined)
  }
})

test('helpers não mutam o objeto guardado nem o de entrada', () => {
  const guardado = Object.freeze({ n8nBlastUrl: URL_ANTIGA, n8nBlastSecret: 'guardado' })
  const entrada  = Object.freeze({ n8nBlastUrl: URL_NOVA, tom: 'formal' })

  assert.doesNotThrow(() => mergeSdrSettings(guardado, entrada))
  assert.equal(guardado.n8nBlastSecret, 'guardado')
  assert.equal(Object.keys(entrada).length, 2)
})

// Garantia de tipo: a lista de pares cobre exatamente os cinco segredos do lote.
test('os cinco pares estão na lista', () => {
  const esperados: N8nSecretKey[] = [
    'n8nWebhookSecret', 'n8nDispatchSecret', 'n8nEnrollSecret', 'n8nImportSecret', 'n8nBlastSecret',
  ]
  assert.deepEqual(N8N_CREDENTIAL_PAIRS.map(p => p.secretKey), esperados)
})
