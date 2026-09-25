import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { and, eq, getTableName, ilike, like, sql } from 'drizzle-orm'
import type { PGlite } from '@electric-sql/pglite'
import { bancoDeTeste, type BancoDeTeste } from '@/test-support/pglite'
import {
  aiSettings, aiUsageLogs, contacts, conversations, dataSources, events,
  funnelSnapshots, jobLocks, leads, metrics, passwordResetTokens, pipelines,
  stages, tenantModules, tenants, users,
} from '@/lib/db/schema'
import * as schemaCompleto from '@/lib/db/schema'

/* Postgres de verdade (PGlite) contra o schema migrado. Cada teste aqui prende
 * uma das decisões de tipo da migração SQLite → Postgres. Sem isto, as trocas de
 * tipo passam no `tsc` e voltam linha errada em produção — que é o modo de falha
 * caro desta migração.
 *
 * O schema é aplicado a partir dos .sql de `drizzle/`, os mesmos que rodam na
 * Railway: todo teste daqui também prova que a migração de baseline é Postgres
 * válido.
 *
 * ESCOPO: aqui o teste escreve o próprio SQL, de propósito — o objetivo é prender
 * o COMPORTAMENTO DO TIPO (o que volta, em que formato, com que valor). O
 * comportamento das CONSULTAS do app (upsertBatch, reconcile, listarCampanhas,
 * filtroDeContatos, contagensDeMensagens, ordenação) é provado em
 * lib/db/consultas.test.ts, chamando o código de produção — é lá que uma troca de
 * GREATEST por LEAST, ou de ilike por like, quebra. */

let banco: BancoDeTeste
let db: BancoDeTeste['db']
let pg: PGlite

const TENANT = 't1'

// 7 eventos de status, mas só 3 mensagens distintas.
const PAYLOADS = [
  { id: 'w1', eventType: 'whatsapp_status_sent',      messageId: 'msg-a' },
  { id: 'w2', eventType: 'whatsapp_status_delivered', messageId: 'msg-a' },
  { id: 'w3', eventType: 'whatsapp_status_read',      messageId: 'msg-a' },
  { id: 'w4', eventType: 'whatsapp_status_sent',      messageId: 'msg-b' },
  { id: 'w5', eventType: 'whatsapp_status_delivered', messageId: 'msg-b' },
  { id: 'w6', eventType: 'whatsapp_status_sent',      messageId: 'msg-c' },
  { id: 'w7', eventType: 'whatsapp_status_failed',    messageId: 'msg-c' },
]

before(async () => {
  banco = await bancoDeTeste()
  db = banco.db
  pg = banco.pg
  await db.insert(tenants).values({ id: TENANT, name: 'Teste', slug: 'teste', createdAt: new Date() })
  await db.insert(events).values(PAYLOADS.map(p => ({
    id: p.id, tenantId: TENANT, source: 'ycloud-whatsapp', eventType: p.eventType,
    occurredAt: new Date('2026-05-01T12:00:00Z'),
    payload: JSON.stringify({ messageId: p.messageId, errorCode: 'E1' }),
  })))
})

after(async () => { await banco.fechar() })

// ─── Baseline ────────────────────────────────────────────────────────────────

test('a migração de baseline é Postgres válido e cria as 31 tabelas do schema', async () => {
  const rs = await pg.query<{ n: number | string }>(
    `SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  )
  // 31 desde `dispatch_claims` (drizzle/0001_dispatch_claims) — ver lib/sdr/reservas.
  assert.equal(Number(rs.rows[0].n), 31)
})

test('nenhuma coluna de data ficou como número — todas viraram timestamptz', async () => {
  const rs = await pg.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name IN ('created_at','updated_at','occurred_at','synced_at',
                            'last_sync_at','last_interaction_at','last_status_at','expires_at')
      ORDER BY table_name, column_name`,
  )
  const porTipo = new Map<string, string[]>()
  for (const r of rs.rows) {
    const chave = `${r.table_name}.${r.column_name}`
    porTipo.set(r.data_type, [...(porTipo.get(r.data_type) ?? []), chave])
  }
  // As 29 colunas que eram integer mode:'timestamp' são timestamptz.
  assert.equal(porTipo.get('timestamp with time zone')?.length, 29)
  // Sobram, de propósito: os epoch-ms que continuam numéricos (bigint) e os
  // synced_at das tabelas de anúncio, que sempre foram texto ISO.
  assert.deepEqual(porTipo.get('bigint')?.sort(), [
    'ai_settings.created_at', 'ai_settings.updated_at', 'ai_usage_logs.created_at',
    'password_reset_tokens.created_at', 'password_reset_tokens.expires_at',
  ])
  assert.equal(porTipo.get('integer'), undefined, 'nenhum epoch sobrou num int4')
})

// ─── Timestamps ──────────────────────────────────────────────────────────────

test('timestamptz devolve Date, com o mesmo instante em milissegundos', async () => {
  const quando = new Date('2026-03-14T15:09:26.535Z')
  await db.insert(events).values({
    id: 'e-ts', tenantId: TENANT, source: 's', eventType: 'x', occurredAt: quando,
  })
  const [linha] = await db.select({ occurredAt: events.occurredAt }).from(events).where(eq(events.id, 'e-ts'))
  assert.ok(linha.occurredAt instanceof Date, 'o app inteiro faz .getTime() em cima disto')
  assert.equal(linha.occurredAt.getTime(), quando.getTime())
})

test('timestamptz nulo continua nulo — não vira epoch 0', async () => {
  await db.insert(conversations).values({
    id: 'c-null', tenantId: TENANT, source: 's', sessionId: 'sess', role: 'human',
  })
  const [linha] = await db.select().from(conversations).where(eq(conversations.id, 'c-null'))
  assert.equal(linha.occurredAt, null)
})

test('comparação de data no WHERE usa o instante, não a representação', async () => {
  const corte = new Date('2026-03-14T00:00:00.000Z')
  const achados = await db.select({ id: events.id }).from(events)
    .where(and(eq(events.tenantId, TENANT), sql`${events.occurredAt} >= ${corte}`))
  assert.ok(achados.some(r => r.id === 'e-ts'))
})

// ─── Booleanos ───────────────────────────────────────────────────────────────

test('boolean é booleano de verdade, não 0/1', async () => {
  await db.insert(tenantModules).values([
    { tenantId: TENANT, moduleKey: 'ligado', enabled: true },
    { tenantId: TENANT, moduleKey: 'desligado', enabled: false },
  ])
  const linhas = await db.select().from(tenantModules).where(eq(tenantModules.tenantId, TENANT))
  const mapa = new Map(linhas.map(l => [l.moduleKey, l.enabled]))
  assert.strictEqual(mapa.get('ligado'), true)
  assert.strictEqual(mapa.get('desligado'), false)

  // É assim que app/api/cron/all e lib/entitlements filtram.
  const so = await db.select({ k: tenantModules.moduleKey }).from(tenantModules)
    .where(and(eq(tenantModules.tenantId, TENANT), eq(tenantModules.enabled, true)))
  assert.deepEqual(so.map(r => r.k), ['ligado'])
})

test('o default do pipelines.is_archived continua false', async () => {
  await db.insert(pipelines).values({ id: 'p1', tenantId: TENANT, name: 'Funil' })
  const [p] = await db.select().from(pipelines).where(eq(pipelines.id, 'p1'))
  assert.strictEqual(p.isArchived, false)
})

// ─── Números fracionários (as ex-`real`) ─────────────────────────────────────

test('doublePrecision volta como number, com a fração intacta', async () => {
  await db.insert(aiUsageLogs).values({
    id: 'u1', tenantId: TENANT, model: 'm', inputTokens: 10, outputTokens: 20,
    costUsd: 0.0001234, createdAt: Date.now(),
  })
  const [l] = await db.select().from(aiUsageLogs).where(eq(aiUsageLogs.id, 'u1'))
  assert.equal(typeof l.costUsd, 'number', 'numeric voltaria STRING no node-postgres e quebraria as somas')
  assert.equal(l.costUsd, 0.0001234)
})

/* A razão concreta de não ter virado numeric: estes dois somam SEM Number().
 * app/api/ai-settings/usage/route.ts:53 e app/api/ai-chat/route.ts:130. */
test('somar em JavaScript os valores lidos dá número, não concatenação', async () => {
  await db.insert(aiUsageLogs).values({
    id: 'u2', tenantId: TENANT, model: 'm', inputTokens: 1, outputTokens: 1,
    costUsd: 0.25, createdAt: Date.now(),
  })
  const linhas = await db.select().from(aiUsageLogs).where(eq(aiUsageLogs.tenantId, TENANT))
  const total = linhas.reduce((s, l) => s + l.costUsd, 0)
  assert.equal(typeof total, 'number')
  assert.ok(Math.abs(total - 0.2501234) < 1e-9, `somou ${total}`)
})

test('dinheiro (leads.price, ai_settings) também é double precision e soma certo', async () => {
  await db.insert(stages).values({ id: 's1', pipelineId: 'p1', name: 'Etapa' })
  await db.insert(leads).values({
    id: 'l1', tenantId: TENANT, pipelineId: 'p1', stageId: 's1', name: 'Lead',
    price: 1234.56, createdAt: new Date(), updatedAt: new Date(),
  })
  const [l] = await db.select().from(leads).where(eq(leads.id, 'l1'))
  assert.equal(l.price, 1234.56)

  await db.insert(aiSettings).values({
    id: 'a1', tenantId: TENANT, monthlyBudgetBrl: 500.5, cachedSpendUsd: 12.25,
  })
  const [a] = await db.select().from(aiSettings).where(eq(aiSettings.id, 'a1'))
  assert.equal((a.cachedSpendUsd ?? 0) + 1, 13.25, 'string daria "12.251"')
  assert.equal(a.monthlyBudgetBrl, 500.5)
  assert.strictEqual(a.isActive, 0, 'is_active segue inteiro 0/1 — app/api/ai-chat compara com === 0')
})

// ─── Epoch em milissegundos (as `integer` que viraram bigint) ────────────────

test('as colunas de epoch-ms aguentam Date.now() e voltam como number', async () => {
  const agora = Date.now()
  assert.ok(agora > 2_147_483_647, 'a premissa: não cabe num int4')

  await db.insert(users).values({
    id: 'u-epoch', tenantId: TENANT, name: 'U', email: 'u@e.com',
    passwordHash: 'x', role: 'admin', createdAt: new Date(),
  })
  await db.insert(passwordResetTokens).values({
    id: 'prt1', userId: 'u-epoch', token: 'tk',
    expiresAt: agora + 3_600_000, createdAt: agora,
  })
  const [t] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.id, 'prt1'))
  assert.equal(typeof t.expiresAt, 'number', 'bigint mode:number normaliza os dois drivers')
  assert.equal(t.expiresAt, agora + 3_600_000)
  assert.equal(t.createdAt, agora)

  await db.insert(jobLocks).values({ name: 'epoch', lockedUntil: agora })
  const [j] = await db.select().from(jobLocks).where(eq(jobLocks.name, 'epoch'))
  assert.equal(j.lockedUntil, agora)

  await db.update(aiSettings).set({ createdAt: agora, updatedAt: agora })
    .where(eq(aiSettings.id, 'a1'))
  const [a] = await db.select().from(aiSettings).where(eq(aiSettings.id, 'a1'))
  assert.equal(a.updatedAt, agora, 'ai_settings guarda Date.now() — era o que estouraria num int4')
})

// ─── events.payload: tipo da coluna e semântica do operador ─────────────────

test('payload continua text: JSON.parse no código de aplicação segue valendo', async () => {
  const [e] = await db.select({ payload: events.payload }).from(events).where(eq(events.id, 'w1'))
  assert.equal(typeof e.payload, 'string', 'jsonb devolveria objeto e quebraria o JSON.parse do reconcile')
  assert.equal(JSON.parse(e.payload).messageId, 'msg-a')
})

test('`->>` desembrulha (como o json_extract) — `->` não', async () => {
  const rs = await pg.query<{ desembrulhado: string; embrulhado: string }>(
    `SELECT payload::jsonb ->> 'messageId' AS desembrulhado,
            (payload::jsonb ->  'messageId')::text AS embrulhado
       FROM events WHERE id = 'w1'`,
  )
  assert.equal(rs.rows[0].desembrulhado, 'msg-a', 'é o que o json_extract do SQLite devolvia')
  assert.equal(rs.rows[0].embrulhado, '"msg-a"', 'com `->` viria com aspas e nada casaria')
})
// ─── Upserts do lib/sync/runner.ts ───────────────────────────────────────────

test('o upsert de metrics roda: excluded.* sem aspas é SQL válido no Postgres', async () => {
  const linha = {
    id: 'm1', tenantId: TENANT, source: 's', metricKey: 'k', value: 1,
    date: '2026-05', dimensions: '{}', extra: '{}', syncedAt: new Date(),
  }
  await db.insert(metrics).values(linha)
  await db.insert(metrics).values({ ...linha, value: 42 }).onConflictDoUpdate({
    target: metrics.id,
    set: {
      value:      sql`excluded.value`,
      dimensions: sql`excluded.dimensions`,
      extra:      sql`excluded.extra`,
      syncedAt:   sql`excluded.synced_at`,
    },
  })
  const [m] = await db.select().from(metrics).where(eq(metrics.id, 'm1'))
  assert.equal(m.value, 42)
})

test('o upsert de funnel_snapshots roda: `order` é palavra do SQL e precisa de aspas', async () => {
  const linha = {
    id: 'f1', tenantId: TENANT, source: 's', period: '2026-05',
    stageKey: 'k', stageName: 'Nome', count: 1, order: 1, extra: '{}',
  }
  await db.insert(funnelSnapshots).values(linha)
  await db.insert(funnelSnapshots).values({ ...linha, stageName: 'Novo', count: 9, order: 3 })
    .onConflictDoUpdate({
      target: funnelSnapshots.id,
      set: {
        stageName: sql`excluded.stage_name`,
        count:     sql`excluded.count`,
        order:     sql`excluded."order"`,
        extra:     sql`excluded.extra`,
        syncedAt:  sql`excluded.synced_at`,
      },
    })
  const [f] = await db.select().from(funnelSnapshots).where(eq(funnelSnapshots.id, 'f1'))
  assert.deepEqual([f.stageName, f.count, f.order], ['Novo', 9, 3])
})

// ─── LIKE: a diferença de linguagem entre os dois bancos ────────────────────

test('LIKE do Postgres é sensível a maiúsculas — o do SQLite não era', async () => {
  await db.insert(contacts).values({
    id: 'busca', tenantId: TENANT, source: 'ycloud-whatsapp', externalId: 'busca',
    name: 'João Silva', phone: '5511988887777',
    tags: '[]', metadata: '{}', extra: '{}', createdAt: new Date(),
  })
  const comLike = await db.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.id, 'busca'), like(contacts.name, '%joão%')))
  assert.equal(comLike.length, 0, 'é ISTO que faria a busca do /api/contacts perder resultados em silêncio')

  const comIlike = await db.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.id, 'busca'), ilike(contacts.name, '%joão%')))
  assert.equal(comIlike.length, 1)
})

// ─── check-tables (lib/db/check-tables.ts) ───────────────────────────────────

/* O script trocou `SELECT name FROM sqlite_master` + `PRAGMA table_info(x)` por
 * information_schema. As duas consultas abaixo são as mesmas que ele executa;
 * aqui elas rodam contra Postgres de verdade e o resultado é conferido contra o
 * schema do drizzle — que é exatamente o trabalho do script. */
test('as consultas do check-tables encontram todas as tabelas e colunas do schema', async () => {
  const tabelas = await pg.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  )
  const colunas = await pg.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  )

  const noBanco = new Map<string, Set<string>>()
  for (const r of tabelas.rows) noBanco.set(r.table_name, new Set())
  for (const c of colunas.rows) noBanco.get(c.table_name)?.add(c.column_name)

  let conferidas = 0
  for (const valor of Object.values(schemaCompleto)) {
    let nome: string
    try { nome = getTableName(valor as Parameters<typeof getTableName>[0]) } catch { continue }
    const colsNoBanco = noBanco.get(nome)
    assert.ok(colsNoBanco, `a tabela ${nome} do schema não existe no banco migrado`)
    for (const [, col] of Object.entries(valor as unknown as Record<string, unknown>)) {
      if (col && typeof col === 'object' && 'columnType' in col && 'name' in col) {
        const nomeDaColuna = (col as { name: string }).name
        assert.ok(colsNoBanco.has(nomeDaColuna), `falta ${nome}.${nomeDaColuna} no banco`)
      }
    }
    conferidas++
  }
  assert.equal(conferidas, 31, 'o schema exporta 31 tabelas')
  assert.equal(noBanco.size, 31, 'e o banco migrado não tem tabela órfã')
})

// ─── Índices e restrições ────────────────────────────────────────────────────

test('os índices e a unicidade do schema chegaram ao banco', async () => {
  const rs = await pg.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
  )
  const nomes = new Set(rs.rows.map(r => r.indexname))
  for (const esperado of [
    'events_lookup_idx', 'metrics_lookup_idx', 'contacts_lookup_idx',
    'conversations_session_idx', 'funnel_snapshots_period_idx',
    'data_sources_tenant_provider_idx', 'data_sources_webhook_token_idx',
    'blast_campaigns_tenant_created_at_idx', 'blast_recipients_campaign_idx',
    'blast_recipients_ycloud_message_idx', 'audit_logs_tenant_created_at_idx',
    'campaign_settings_tenant_source_unq',
  ]) {
    assert.ok(nomes.has(esperado), `faltou o índice ${esperado}`)
  }
})

test('a unicidade de data_sources.webhook_token continua valendo', async () => {
  const base = {
    tenantId: TENANT, providerKey: 'p', createdAt: new Date(), updatedAt: new Date(),
  }
  await db.insert(dataSources).values({ id: 'ds1', ...base, webhookToken: 'tok' })
  // O drizzle embrulha o erro do driver; o código do Postgres vem no `cause`.
  // 23505 = unique_violation.
  await assert.rejects(
    db.insert(dataSources).values({ id: 'ds2', ...base, webhookToken: 'tok' }),
    (e: unknown) => {
      const causa = (e as { cause?: { code?: string } }).cause
      assert.equal(causa?.code, '23505', 'a violação tem de ser de unicidade')
      return true
    },
  )
  // Nulo não colide com nulo — é o que permite fonte sem webhook.
  await db.insert(dataSources).values({ id: 'ds3', ...base, webhookToken: null })
  await db.insert(dataSources).values({ id: 'ds4', ...base, webhookToken: null })
})

test('os defaults de texto e JSON continuam os mesmos', async () => {
  await db.insert(events).values({
    id: 'e-def', tenantId: TENANT, source: 's', eventType: 'x', occurredAt: new Date(),
  })
  const [e] = await db.select().from(events).where(eq(events.id, 'e-def'))
  assert.equal(e.payload, '{}')
  assert.equal(e.extra, '{}')
  assert.equal(e.sentiment, null)

  const [ds] = await db.select().from(dataSources).where(eq(dataSources.id, 'ds3'))
  assert.equal(ds.status, 'pending')
  assert.equal(ds.label, '')
})
