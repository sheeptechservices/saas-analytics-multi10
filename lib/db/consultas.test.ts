import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { and, eq, sql } from 'drizzle-orm'
import { bancoDeTeste, usarComoBancoDoApp, soltarBancoDoApp, type BancoDeTeste } from '@/test-support/pglite'

/* Consultas de PRODUÇÃO rodando contra Postgres de verdade.
 *
 * A diferença para postgres-tipos.test.ts é proposital: lá o teste escreve o seu
 * próprio SQL para prender uma decisão de tipo; AQUI ele chama as funções que o
 * app chama — upsertBatch, reconcile, listarCampanhas, filtroDeContatos,
 * contagensDeMensagens. Numa passada anterior desta migração, os testes de
 * GREATEST/`->>`/ilike eram cópias do SQL, e por isso não pegaram um GROUP BY
 * inválido nem a inversão da ordem dos NULL. Trocar `GREATEST` por `LEAST` no
 * runner precisa quebrar um teste de COMPORTAMENTO.
 *
 * O `usarComoBancoDoApp` preenche o `globalThis.__pgDb` que lib/db/index.ts já
 * usa como cache — o `??=` devolve o que está lá e nem chega a criar o Pool do
 * `pg`. Nenhuma linha de produção mudou para isto ser possível. */

let banco: BancoDeTeste
let db: BancoDeTeste['db']

// Importados depois do harness estar de pé (são módulos de produção que pegam
// `db` de @/lib/db; a fachada é preguiçosa, então a ordem não é crítica — mas
// deixa claro que é o código real).
let upsertBatch: typeof import('@/lib/sync/runner')['upsertBatch']
let reconcile: typeof import('@/lib/blast/reconcile')['reconcile']
let listarCampanhas: typeof import('@/lib/blast/campanhas')['listarCampanhas']
let filtroDeContatos: typeof import('@/lib/contacts-busca')['filtroDeContatos']
let ordemDeContatos: typeof import('@/lib/contacts-busca')['ordemDeContatos']
let contagensDeMensagens: typeof import('@/lib/bi/whatsapp-mensagens')['contagensDeMensagens']
let descNulosPorUltimo: typeof import('@/lib/db/ordem')['descNulosPorUltimo']
let ascNulosPrimeiro: typeof import('@/lib/db/ordem')['ascNulosPrimeiro']
let esquema: typeof import('@/lib/db/schema')

const TENANT = 't1'
const FONTE = 'ycloud-whatsapp'

before(async () => {
  banco = await bancoDeTeste()
  db = banco.db
  usarComoBancoDoApp(db)

  esquema = await import('@/lib/db/schema')
  ;({ upsertBatch } = await import('@/lib/sync/runner'))
  ;({ reconcile } = await import('@/lib/blast/reconcile'))
  ;({ listarCampanhas } = await import('@/lib/blast/campanhas'))
  ;({ filtroDeContatos, ordemDeContatos } = await import('@/lib/contacts-busca'))
  ;({ contagensDeMensagens } = await import('@/lib/bi/whatsapp-mensagens'))
  ;({ descNulosPorUltimo, ascNulosPrimeiro } = await import('@/lib/db/ordem'))

  await db.insert(esquema.tenants).values({
    id: TENANT, name: 'Teste', slug: 'teste', createdAt: new Date(),
  })
  await db.insert(esquema.dataSources).values({
    id: 'ds1', tenantId: TENANT, providerKey: 'ycloud-whatsapp',
    createdAt: new Date(), updatedAt: new Date(),
  })
})

after(async () => {
  soltarBancoDoApp()
  await banco.fechar()
})

// ─── upsertBatch: deduplicação dentro do lote ────────────────────────────────

/* O Postgres proíbe que um único comando toque a mesma linha duas vezes: um lote
 * com id repetido estoura com 21000 "cannot affect row a second time". O SQLite
 * aplicava em silêncio, o último vencendo. Como o id sai de dado do provedor
 * (telefone, período+etapa), UMA página com número repetido faria o chunk inteiro
 * falhar, `runSync` gravar last_sync_error e aquela fonte PARAR de sincronizar. */
test('upsertBatch aguenta id repetido dentro do mesmo lote, com o último vencendo', async () => {
  const contas = await upsertBatch(
    {
      contacts: [
        { externalId: '5511999990000', name: 'Primeiro', phone: '5511999990000' },
        { externalId: '5511999990000', name: 'Ultimo',   phone: '5511999990000' },
      ],
    },
    TENANT, 'ds1', FONTE,
  )
  assert.equal(contas.contacts, 1, 'o relatório conta linhas gravadas, não linhas recebidas')

  const linhas = await db.select().from(esquema.contacts)
    .where(eq(esquema.contacts.externalId, '5511999990000'))
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].name, 'Ultimo', 'último vence, como no SQLite')
})

/* A premissa: sem deduplicar, o comando inteiro morre — não é "uma linha perdida",
 * é o chunk de 150 que não entra e a fonte que para de sincronizar. */
test('sem deduplicar, o lote inteiro estoura com 21000 — a premissa', async () => {
  const linha = (nome: string) => ({
    id: 'dup-cru', tenantId: TENANT, source: FONTE, externalId: 'dup-cru',
    name: nome, tags: '[]', metadata: '{}', extra: '{}',
  })
  await assert.rejects(
    db.insert(esquema.contacts).values([linha('a'), linha('b')]).onConflictDoUpdate({
      target: esquema.contacts.id,
      set: { name: sql`excluded.name` },
    }),
    (e: unknown) => {
      // 21000 = cardinality_violation ("cannot affect row a second time")
      assert.equal((e as { cause?: { code?: string } }).cause?.code, '21000')
      return true
    },
  )
})

test('upsertBatch dedupa também métricas, eventos, conversas e funil', async () => {
  const contas = await upsertBatch(
    {
      metrics: [
        { metricKey: 'k', value: 1, date: '2026-05' },
        { metricKey: 'k', value: 9, date: '2026-05' },
      ],
      events: [
        { sourceId: 'ev-dup', eventType: 'x', occurredAt: 1_760_000_000_000, payload: { v: 1 } },
        { sourceId: 'ev-dup', eventType: 'x', occurredAt: 1_760_000_000_000, payload: { v: 2 } },
      ],
      conversations: [
        { sourceId: 'cv-dup', sessionId: 's', role: 'human', content: 'a', occurredAt: 1_760_000_000_000 },
        { sourceId: 'cv-dup', sessionId: 's', role: 'human', content: 'b', occurredAt: 1_760_000_000_000 },
      ],
      funnel: [
        { period: '2026-05', stageKey: 'e1', stageName: 'Etapa', count: 1 },
        { period: '2026-05', stageKey: 'e1', stageName: 'Etapa', count: 7 },
      ],
    },
    TENANT, 'ds1', FONTE,
  )
  assert.deepEqual(
    { m: contas.metrics, e: contas.events, c: contas.conversations, f: contas.funnel },
    { m: 1, e: 1, c: 1, f: 1 },
  )
  const [m] = await db.select().from(esquema.metrics).where(eq(esquema.metrics.metricKey, 'k'))
  assert.equal(m.value, 9)
  const [f] = await db.select().from(esquema.funnelSnapshots)
    .where(eq(esquema.funnelSnapshots.stageKey, 'e1'))
  assert.equal(f.count, 7)
})

async function ultimaInteracao(externalId: string) {
  const [c] = await db.select().from(esquema.contacts)
    .where(eq(esquema.contacts.id, `${TENANT}:${FONTE}:${externalId}`))
  return c.lastInteractionAt
}

/* A deduplicação de `contacts` NÃO pode ser "a última vence".
 *
 * O ON CONFLICT dela acumula — GREATEST na data, COALESCE no nome/telefone/e-mail
 * —, então dobrar o lote com "última vence" jogaria fora exatamente o que o SQL
 * preservaria. E é o caso para o qual a deduplicação foi escrita: uma página da
 * YCloud listando o mesmo número duas vezes.
 *
 * Os testes de GREATEST logo abaixo usam DUAS chamadas de upsertBatch, então a
 * fusão intra-lote passa por eles sem ser vista. Estes aqui mandam as duas linhas
 * na MESMA chamada, que é onde o defeito aparece. */

test('lote com o mesmo contato duas vezes não faz a última interação andar para trás', async () => {
  const junho   = Date.UTC(2026, 5, 1)
  const janeiro = Date.UTC(2026, 0, 1)
  await upsertBatch(
    {
      contacts: [
        { externalId: 'lote-data', name: 'X', phone: '1', lastInteractionAt: junho },
        { externalId: 'lote-data', name: 'X', phone: '1', lastInteractionAt: janeiro },
      ],
    },
    TENANT, 'ds1', FONTE,
  )
  assert.equal(
    (await ultimaInteracao('lote-data'))?.getTime(), junho,
    'a data mais recente do lote tem de vencer, como o GREATEST faria',
  )
})

test('lote com o mesmo contato duas vezes não apaga nome e telefone', async () => {
  await upsertBatch(
    {
      contacts: [
        { externalId: 'lote-nome', name: 'Maria', phone: '5511999990001' },
        { externalId: 'lote-nome', name: '',      phone: '' },
      ],
    },
    TENANT, 'ds1', FONTE,
  )
  const [c] = await db.select().from(esquema.contacts)
    .where(eq(esquema.contacts.id, `${TENANT}:${FONTE}:lote-nome`))
  assert.deepEqual([c.name, c.phone], ['Maria', '5511999990001'],
    'o COALESCE(NULLIF(...)) do SQL preserva; a fusão em JS tem de preservar igual')
})

test('dentro do lote, o valor preenchido mais recente vence o anterior', async () => {
  await upsertBatch(
    {
      contacts: [
        { externalId: 'lote-ordem', name: 'Antigo', phone: '1', email: 'a@e.com' },
        { externalId: 'lote-ordem', name: 'Novo',   phone: '',  email: '' },
        { externalId: 'lote-ordem', name: '',       phone: '2', email: '' },
      ],
    },
    TENANT, 'ds1', FONTE,
  )
  const [c] = await db.select().from(esquema.contacts)
    .where(eq(esquema.contacts.id, `${TENANT}:${FONTE}:lote-ordem`))
  assert.deepEqual([c.name, c.phone, c.email], ['Novo', '2', 'a@e.com'])
})

test('a fusão intra-lote dá o MESMO resultado que mandar as linhas separadas', async () => {
  const junho   = Date.UTC(2026, 5, 1)
  const janeiro = Date.UTC(2026, 0, 1)

  // Caminho A: as duas na mesma chamada — a fusão acontece em JS.
  await upsertBatch(
    {
      contacts: [
        { externalId: 'par-a', name: 'Ana', phone: '11', lastInteractionAt: junho },
        { externalId: 'par-a', name: '',    phone: '',   lastInteractionAt: janeiro },
      ],
    },
    TENANT, 'ds1', FONTE,
  )
  // Caminho B: uma chamada cada — a fusão acontece no SQL. É a referência.
  await upsertBatch({ contacts: [{ externalId: 'par-b', name: 'Ana', phone: '11', lastInteractionAt: junho }] },
    TENANT, 'ds1', FONTE)
  await upsertBatch({ contacts: [{ externalId: 'par-b', name: '', phone: '', lastInteractionAt: janeiro }] },
    TENANT, 'ds1', FONTE)

  const pegar = async (ext: string) => {
    const [c] = await db.select().from(esquema.contacts)
      .where(eq(esquema.contacts.id, `${TENANT}:${FONTE}:${ext}`))
    return { name: c.name, phone: c.phone, quando: c.lastInteractionAt?.getTime() }
  }
  assert.deepEqual(await pegar('par-a'), await pegar('par-b'),
    'dedup em JS e ON CONFLICT em SQL têm de concordar')
})

/* O caso que faltava, e que é metade do `GREATEST`: uma das duplicatas vem SEM
 * data. O SQL ignora o nulo e mantém a data que existe; uma dobra que deixasse o
 * nulo vencer apagaria a data do contato — e nenhum dos casos acima pegava isso,
 * porque todos mandam data nas duas linhas ou em nenhuma.
 *
 * As duas ordens importam: o ramo `a == null` e o ramo `b == null` de `maiorData`
 * são linhas diferentes, e inverter só uma delas passaria despercebido. */
for (const [nome, comData, primeiro] of [
  ['data na primeira, ausente na segunda', 0, true],
  ['ausente na primeira, data na segunda', 1, false],
] as const) {
  test(`equivalência com data ausente — ${nome}`, async () => {
    const quando = Date.UTC(2026, 3, 1)
    const linhas = [
      { name: 'Ana', phone: '11' },
      { name: 'Ana', phone: '11' },
    ].map((base, i) => (i === comData ? { ...base, lastInteractionAt: quando } : base))

    const sufixo = primeiro ? 'pri' : 'seg'
    // Caminho A: mesma chamada — a fusão acontece em JS.
    await upsertBatch(
      { contacts: linhas.map(l => ({ ...l, externalId: `ausente-a-${sufixo}` })) },
      TENANT, 'ds1', FONTE,
    )
    // Caminho B: uma chamada por linha — a fusão acontece no SQL. É a referência.
    for (const l of linhas) {
      await upsertBatch(
        { contacts: [{ ...l, externalId: `ausente-b-${sufixo}` }] },
        TENANT, 'ds1', FONTE,
      )
    }

    const pegar = async (ext: string) => {
      const [c] = await db.select().from(esquema.contacts)
        .where(eq(esquema.contacts.id, `${TENANT}:${FONTE}:${ext}`))
      return c.lastInteractionAt?.getTime() ?? null
    }
    const a = await pegar(`ausente-a-${sufixo}`)
    const b = await pegar(`ausente-b-${sufixo}`)

    assert.equal(a, b, 'dedup em JS e ON CONFLICT em SQL têm de concordar')
    // E a referência é a data, não o nulo — senão os dois caminhos estariam
    // errados do mesmo jeito e a igualdade acima não diria nada.
    assert.equal(b, quando, 'o SQL ignora o nulo e mantém a data existente')
  })
}

/* E o contraponto: nas outras quatro tabelas "a última vence" é a regra certa,
 * porque o ON CONFLICT delas é só `excluded.*`. */
test('nas tabelas de excluded.* puro, a última do lote vence mesmo', async () => {
  await upsertBatch(
    {
      metrics: [
        { metricKey: 'ultima-vence', value: 1, date: '2026-07' },
        { metricKey: 'ultima-vence', value: 2, date: '2026-07' },
      ],
    },
    TENANT, 'ds1', FONTE,
  )
  const [m] = await db.select().from(esquema.metrics)
    .where(eq(esquema.metrics.metricKey, 'ultima-vence'))
  assert.equal(m.value, 2)
})

// ─── upsertBatch: GREATEST (o MAX(a,b) do SQLite não existe no Postgres) ─────

async function sincronizarContato(externalId: string, lastInteractionAt: number | undefined) {
  await upsertBatch({ contacts: [{ externalId, name: '', phone: '', lastInteractionAt }] },
    TENANT, 'ds1', FONTE)
}

test('upsertBatch nunca retrocede a última interação — troca por LEAST quebra aqui', async () => {
  const velha = Date.UTC(2026, 0, 1)
  const nova  = Date.UTC(2026, 5, 1)
  await sincronizarContato('g1', nova)
  await sincronizarContato('g1', velha)
  assert.equal((await ultimaInteracao('g1'))?.getTime(), nova)
})

test('upsertBatch preserva a data quando a nova linha vem sem data', async () => {
  const tinha = Date.UTC(2026, 5, 1)
  await sincronizarContato('g2', tinha)
  await sincronizarContato('g2', undefined)
  assert.equal((await ultimaInteracao('g2'))?.getTime(), tinha)
})

test('upsertBatch mantém nulo quando nunca houve data — e nunca epoch 0', async () => {
  await sincronizarContato('g3', undefined)
  await sincronizarContato('g3', undefined)
  assert.equal(await ultimaInteracao('g3'), null)
})

test('upsertBatch preserva nome/telefone quando a nova linha vem vazia', async () => {
  await upsertBatch({ contacts: [{ externalId: 'g4', name: 'Maria', phone: '5511988887777' }] },
    TENANT, 'ds1', FONTE)
  await upsertBatch({ contacts: [{ externalId: 'g4', name: '', phone: '' }] },
    TENANT, 'ds1', FONTE)
  const [c] = await db.select().from(esquema.contacts)
    .where(eq(esquema.contacts.id, `${TENANT}:${FONTE}:g4`))
  assert.deepEqual([c.name, c.phone], ['Maria', '5511988887777'])
})

// ─── NUL no payload: o cast ::jsonb morreria com 22P05 ───────────────────────

/* `JSON.stringify` escreve U+0000 como a sequência de seis caracteres `\u0000`.
 * Coluna `text` guarda; `payload::jsonb` recusa com 22P05 — e o cast roda em TODAS
 * as linhas da varredura, então uma linha ruim derruba o painel do SDR e todo
 * reconcile() daquele cliente, para sempre. */
test('upsertBatch grava payload com NUL de um jeito que ::jsonb ainda lê', async () => {
  await upsertBatch(
    {
      events: [{
        sourceId: 'nul-1', eventType: 'whatsapp_status_sent', occurredAt: 1_760_000_000_000,
        payload: { messageId: 'msg-nul', nota: 'antes\u0000depois' },
      }],
    },
    TENANT, 'ds1', FONTE,
  )
  const [linha] = await db
    .select({ id: esquema.events.id, m: sql<string>`(${esquema.events.payload})::jsonb ->> 'messageId'` })
    .from(esquema.events)
    .where(eq(esquema.events.id, `${TENANT}:${FONTE}:nul-1`))
  assert.equal(linha.m, 'msg-nul')

  const [cru] = await db.select({ payload: esquema.events.payload }).from(esquema.events)
    .where(eq(esquema.events.id, `${TENANT}:${FONTE}:nul-1`))
  assert.ok(!cru.payload.includes('\\u0000'), 'o escape não pode ter sobrado no texto')
  assert.equal(JSON.parse(cru.payload).nota, 'antesdepois')
})

test('com NUL no payload, a varredura inteira morreria — a premissa do teste', async () => {
  await db.insert(esquema.events).values({
    id: 'veneno', tenantId: TENANT, source: FONTE, eventType: 'whatsapp_status_sent',
    occurredAt: new Date(), payload: JSON.stringify({ messageId: 'x\u0000y' }),
  })
  await assert.rejects(
    db.select({ m: sql<string>`(${esquema.events.payload})::jsonb ->> 'messageId'` })
      .from(esquema.events).where(eq(esquema.events.tenantId, TENANT)),
    (e: unknown) => {
      // 22P05 = untranslatable_character ("unsupported Unicode escape sequence")
      assert.equal((e as { cause?: { code?: string } }).cause?.code, '22P05')
      return true
    },
  )
  await db.delete(esquema.events).where(eq(esquema.events.id, 'veneno'))
})

/* Metade dois do mesmo buraco. Desde o ES2019 o JSON.stringify emite surrogate
 * sem par como escape (um `\ud83d` sozinho), e o jsonb recusa isso com 22P02 —
 * mesmo raio de estrago do NUL. Acontece quando um texto do provedor foi cortado
 * no meio de um emoji: prévia de mensagem, legenda truncada. */
test('com surrogate solto no payload, a varredura inteira morreria — a premissa', async () => {
  await db.insert(esquema.events).values({
    id: 'veneno-2', tenantId: TENANT, source: FONTE, eventType: 'whatsapp_status_sent',
    occurredAt: new Date(), payload: JSON.stringify({ messageId: 'x\uDC00y' }),
  })
  await assert.rejects(
    db.select({ m: sql<string>`(${esquema.events.payload})::jsonb ->> 'messageId'` })
      .from(esquema.events).where(eq(esquema.events.tenantId, TENANT)),
    (e: unknown) => {
      // 22P02 = invalid_text_representation (surrogate baixo sem um alto antes)
      assert.equal((e as { cause?: { code?: string } }).cause?.code, '22P02')
      return true
    },
  )
  await db.delete(esquema.events).where(eq(esquema.events.id, 'veneno-2'))
})

test('upsertBatch grava payload com surrogate solto de um jeito que ::jsonb ainda lê', async () => {
  await upsertBatch(
    {
      events: [{
        sourceId: 'sur-1', eventType: 'whatsapp_status_sent', occurredAt: 1_760_000_000_000,
        payload: { messageId: 'msg-sur', previa: 'oi \uD83D', legenda: 'tchau \uDE00' },
      }],
    },
    TENANT, 'ds1', FONTE,
  )
  const [linha] = await db
    .select({ m: sql<string>`(${esquema.events.payload})::jsonb ->> 'messageId'` })
    .from(esquema.events)
    .where(eq(esquema.events.id, `${TENANT}:${FONTE}:sur-1`))
  assert.equal(linha.m, 'msg-sur')
})

test('emoji COMPLETO sobrevive: o par válido não é lixo', async () => {
  await upsertBatch(
    {
      events: [{
        sourceId: 'sur-2', eventType: 'whatsapp_status_sent', occurredAt: 1_760_000_000_000,
        payload: { messageId: 'msg-emoji', texto: 'tudo certo \u{1F600}' },
      }],
    },
    TENANT, 'ds1', FONTE,
  )
  const [linha] = await db
    .select({ t: sql<string>`(${esquema.events.payload})::jsonb ->> 'texto'` })
    .from(esquema.events)
    .where(eq(esquema.events.id, `${TENANT}:${FONTE}:sur-2`))
  assert.equal(linha.t, 'tudo certo \u{1F600}')
})

// ─── reconcile: o `->>` dentro do IN (...) ───────────────────────────────────

test('reconcile promove o destinatário a partir dos eventos de status', async () => {
  await db.insert(esquema.blastCampaigns).values({
    id: 'c1', tenantId: TENANT, template: 't', totalSolicitado: 1, createdAt: new Date(),
  })
  await db.insert(esquema.blastRecipients).values({
    id: 'r1', campaignId: 'c1', leadId: 'l1', phone: '5511', firstName: 'A',
    messageBody: 'oi', ycloudMessageId: 'msg-entrega', status: 'pendente', createdAt: new Date(),
  })
  await upsertBatch(
    {
      events: [
        { sourceId: 'st-1', eventType: 'whatsapp_status_sent',      occurredAt: 1, payload: { messageId: 'msg-entrega' } },
        { sourceId: 'st-2', eventType: 'whatsapp_status_delivered', occurredAt: 2, payload: { messageId: 'msg-entrega' } },
      ],
    },
    TENANT, 'ds1', FONTE,
  )

  await reconcile(TENANT, 'c1')

  const [r] = await db.select().from(esquema.blastRecipients)
    .where(eq(esquema.blastRecipients.id, 'r1'))
  assert.equal(r.status, 'entregue', 'com `->` em vez de `->>` o IN não casaria e nada mudaria')
  const [c] = await db.select().from(esquema.blastCampaigns)
    .where(eq(esquema.blastCampaigns.id, 'c1'))
  assert.equal(c.started, 1)
  assert.equal(c.status, 'concluido')
})

// ─── /api/sdr/blast/campaigns: o GROUP BY que devolvia 500 ───────────────────

test('listarCampanhas roda — coluna de leftJoin exige estar no GROUP BY (42803)', async () => {
  await db.insert(esquema.users).values({
    id: 'u1', tenantId: TENANT, name: 'Ana', email: 'ana@e.com',
    passwordHash: 'x', role: 'admin', createdAt: new Date(),
  })
  await db.insert(esquema.blastCampaigns).values({
    id: 'c2', tenantId: TENANT, template: 't2', totalSolicitado: 2,
    createdBy: 'u1', createdAt: new Date(),
  })
  await db.insert(esquema.blastRecipients).values([
    { id: 'r2', campaignId: 'c2', leadId: 'l2', phone: '1', firstName: 'B', messageBody: 'x', status: 'lido',     createdAt: new Date() },
    { id: 'r3', campaignId: 'c2', leadId: 'l3', phone: '2', firstName: 'C', messageBody: 'x', status: 'pendente', createdAt: new Date() },
  ])

  const linhas = await listarCampanhas(TENANT, null)
  const c2 = linhas.find(l => l.id === 'c2')!
  assert.equal(c2.createdByName, 'Ana')
  assert.equal(c2.lido, 1)
  assert.equal(c2.pendente, 1)
  /* NÃO afirme aqui que `typeof c2.lido === 'number'`: isso seria uma afirmação
   * sobre o HARNESS, não sobre o código. O PGlite entrega bigint como number por
   * conta própria, então some com o `.mapWith(Number)` de campanhas.ts e a
   * asserção continuaria passando — enquanto em produção, no node-postgres,
   * viria string. Quem protege essa propriedade é lib/db/agregados.test.ts,
   * inspecionando o decodificador do fragmento em vez do resultado da consulta. */
})

/* Este era o modo de falha: erro de PLANO, então nem "zero linhas" escapava. */
test('sem o users.name no GROUP BY, o Postgres recusa mesmo sem linha nenhuma', async () => {
  await assert.rejects(
    db.select({ id: esquema.blastCampaigns.id, nome: esquema.users.name, n: sql<number>`count(*)` })
      .from(esquema.blastCampaigns)
      .leftJoin(esquema.users, eq(esquema.blastCampaigns.createdBy, esquema.users.id))
      .where(eq(esquema.blastCampaigns.tenantId, 'tenant-que-nao-existe'))
      .groupBy(esquema.blastCampaigns.id),
    (e: unknown) => {
      assert.equal((e as { cause?: { code?: string } }).cause?.code, '42803')
      return true
    },
  )
})

/* O contraponto: agrupar pela PK da PRÓPRIA tabela libera as outras colunas dela
 * (dependência funcional). É o que /api/master/tenants faz, e por isso ele está
 * correto sem mudança nenhuma. */
test('agrupar pela PK da própria tabela continua legal (/api/master/tenants)', async () => {
  const linhas = await db
    .select({
      id: esquema.tenants.id, name: esquema.tenants.name, slug: esquema.tenants.slug,
      userCount: sql<number>`count(${esquema.users.id})`.mapWith(Number),
    })
    .from(esquema.tenants)
    .leftJoin(esquema.users, eq(esquema.users.tenantId, esquema.tenants.id))
    .groupBy(esquema.tenants.id)
  assert.equal(linhas.find(l => l.id === TENANT)?.userCount, 1)
})

// ─── Ordenação de NULL ───────────────────────────────────────────────────────

/* Postgres põe NULL como o MAIOR valor; SQLite como o menor. Sem cláusula NULLS
 * explícita, toda ordenação por coluna anulável se inverteu nas pontas. */
test('DESC sem nulls last põe os nulos no TOPO — a premissa', async () => {
  await db.insert(esquema.contacts).values([
    { id: 'ord-com', tenantId: TENANT, source: FONTE, externalId: 'ord-com', name: 'Com data',
      lastInteractionAt: new Date('2026-06-01T00:00:00Z'), tags: '[]', metadata: '{}', extra: '{}' },
    { id: 'ord-sem', tenantId: TENANT, source: FONTE, externalId: 'ord-sem', name: 'Sem data',
      lastInteractionAt: null, tags: '[]', metadata: '{}', extra: '{}' },
  ])
  const cru = await db.select({ id: esquema.contacts.id }).from(esquema.contacts)
    .where(and(eq(esquema.contacts.tenantId, TENANT), sql`${esquema.contacts.id} like 'ord-%'`))
    .orderBy(sql`${esquema.contacts.lastInteractionAt} desc`)
  assert.equal(cru[0].id, 'ord-sem', 'é ISTO que a primeira página de /api/contacts mostraria')
})

test('a ordem de /api/contacts põe quem nunca interagiu no fim', async () => {
  const linhas = await db.select({ id: esquema.contacts.id }).from(esquema.contacts)
    .where(and(eq(esquema.contacts.tenantId, TENANT), sql`${esquema.contacts.id} like 'ord-%'`))
    .orderBy(ordemDeContatos)
  assert.deepEqual(linhas.map(l => l.id), ['ord-com', 'ord-sem'])
})

test('descNulosPorUltimo e ascNulosPrimeiro reproduzem o SQLite nos dois sentidos', async () => {
  const base = and(eq(esquema.contacts.tenantId, TENANT), sql`${esquema.contacts.id} like 'ord-%'`)
  const desc = await db.select({ id: esquema.contacts.id }).from(esquema.contacts)
    .where(base).orderBy(descNulosPorUltimo(esquema.contacts.lastInteractionAt))
  const asc = await db.select({ id: esquema.contacts.id }).from(esquema.contacts)
    .where(base).orderBy(ascNulosPrimeiro(esquema.contacts.lastInteractionAt))
  assert.deepEqual(desc.map(l => l.id), ['ord-com', 'ord-sem'])
  assert.deepEqual(asc.map(l => l.id),  ['ord-sem', 'ord-com'])
})

/* O comentário de /api/ycloud/conversations diz "a primeira ocorrência de cada
 * sessionId na ordem DESC é a mais recente". Sem `nulls last` isso vira mentira:
 * a mensagem SEM data seria eleita a última da sessão. */
test('a última mensagem da sessão não pode ser uma mensagem sem data', async () => {
  await db.insert(esquema.conversations).values([
    { id: 'cv-1', tenantId: TENANT, source: FONTE, sessionId: 'sess', role: 'human',
      content: 'primeira', occurredAt: new Date('2026-05-01T10:00:00Z'), metadata: '{}' },
    { id: 'cv-2', tenantId: TENANT, source: FONTE, sessionId: 'sess', role: 'ai',
      content: 'ultima',   occurredAt: new Date('2026-05-01T11:00:00Z'), metadata: '{}' },
    { id: 'cv-3', tenantId: TENANT, source: FONTE, sessionId: 'sess', role: 'ai',
      content: 'sem data', occurredAt: null, metadata: '{}' },
  ])
  const linhas = await db.select({ content: esquema.conversations.content })
    .from(esquema.conversations)
    .where(eq(esquema.conversations.sessionId, 'sess'))
    .orderBy(descNulosPorUltimo(esquema.conversations.occurredAt))
  assert.equal(linhas[0].content, 'ultima')
})

// ─── Busca de contatos: ILIKE ────────────────────────────────────────────────

async function buscar(q: string) {
  const linhas = await db.select({ id: esquema.contacts.id }).from(esquema.contacts)
    .where(filtroDeContatos(TENANT, q))
  return linhas.map(l => l.id).sort()
}

test('a busca de /api/contacts ignora maiúsculas — trocar ilike por like quebra aqui', async () => {
  await db.insert(esquema.contacts).values({
    id: 'busca', tenantId: TENANT, source: FONTE, externalId: 'busca',
    name: 'João Silva', phone: '5511977776666', tags: '[]', metadata: '{}', extra: '{}',
  })
  assert.deepEqual(await buscar('SILVA'), ['busca'])
  assert.deepEqual(await buscar('silva'), ['busca'])
  assert.deepEqual(await buscar('joão'),  ['busca'])
  assert.deepEqual(await buscar('97777'), ['busca'])
  assert.deepEqual(await buscar('zzz'),   [])
})

test('sem busca, o filtro devolve só o tenant e a fonte certos', async () => {
  const ids = await buscar('')
  assert.ok(ids.includes('busca'))
  assert.ok(ids.every(id => id !== 'ord-nao-existe'))
})

/* Fecha o arquivo provando a premissa de TODOS os testes acima: o código de
 * produção rodou contra o PGlite, e não contra um Postgres de verdade. Se a
 * injeção do __pgDb tivesse falhado, lib/db/index.ts teria tentado criar o Pool —
 * e, sem DATABASE_URL no ambiente de teste, estourado na primeira consulta. */
test('nenhum Pool do `pg` foi criado: quem respondeu foi o PGlite', () => {
  const escopo = globalThis as typeof globalThis & { __pgPool?: unknown }
  assert.equal(escopo.__pgPool, undefined)
  assert.equal(process.env.DATABASE_URL, undefined, 'o ambiente de teste não tem banco real')
})

// ─── /api/bi/sdr: contagem de mensagens distintas ────────────────────────────

test('contagensDeMensagens conta mensagens, não eventos, e mantém a implicação do funil', async () => {
  await upsertBatch(
    {
      events: [
        { sourceId: 'q1', eventType: 'whatsapp_status_sent',      occurredAt: 1, payload: { messageId: 'a' } },
        { sourceId: 'q2', eventType: 'whatsapp_status_delivered', occurredAt: 2, payload: { messageId: 'a' } },
        { sourceId: 'q3', eventType: 'whatsapp_status_read',      occurredAt: 3, payload: { messageId: 'a' } },
        { sourceId: 'q4', eventType: 'whatsapp_status_sent',      occurredAt: 4, payload: { messageId: 'b' } },
        { sourceId: 'q5', eventType: 'whatsapp_status_failed',    occurredAt: 5, payload: { messageId: 'b' } },
      ],
    },
    TENANT, 'ds1', FONTE,
  )
  const [c] = await db.select(contagensDeMensagens).from(esquema.events)
    .where(and(
      eq(esquema.events.tenantId, TENANT),
      eq(esquema.events.source, FONTE),
      sql`${esquema.events.id} like '%:q%'`,
    ))
  assert.deepEqual({ ...c }, { sent: 2, delivered: 1, read: 1, failed: 1 })
  assert.ok(c.read <= c.delivered && c.delivered <= c.sent, 'taxa de leitura não pode passar de 100%')
})
