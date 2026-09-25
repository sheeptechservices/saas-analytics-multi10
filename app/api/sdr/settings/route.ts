import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { campaignSettings } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { assertEntitlement } from '@/lib/entitlements'
import { isStaleVersion, mergeSdrSettings } from '@/lib/sdr/settings-merge'
import { conexaoDoTenant, type FonteDoTenant } from '@/lib/sdr/conexao-tenant'
import { CREDENCIAL_SDR_ILEGIVEL } from '@/lib/sdr/mensagens'
import {
  ConfigCampanhaInvalida,
  gravarConfigCampanha,
  validarConfigCampanha,
  type SaveDeCampanha,
} from '@/lib/sdr/config-write'
import { mapSdrDbError } from '@/lib/sdr/pg'
import { randomUUID } from 'crypto'

const SOURCE = 'sdr-n8n'

const DEFAULT_SETTINGS = {
  tom: 'consultivo',
  objetivo: '',
  delay: 24,
  limiteDiario: 100,
  horario: { inicio: '08:00', fim: '18:00' },
  diasAtivos: [1, 2, 3, 4, 5],
  templates: [''],
  remetente: '',
  numToques: 10,
  intervaloDias: 3,
}

const E164_RE = /^\+[1-9]\d{6,14}$/

/**
 * O que a resposta conta sobre a segunda gravação — a da `campaign_config`, na base
 * do cliente. `null` é "não há base de campanha configurada"; o resto é o que deu.
 *
 * `semMudanca` é a gravação que não precisou acontecer — o save não mexeu em nada
 * de campanha — e `ativo` é o interruptor que foi escrito, com `null` para "a coluna
 * ficou fora do INSERT e continua valendo o que já valia". Os dois campos são novos;
 * a tela lê `ok` e `error`, que seguem com o mesmo sentido de antes.
 *
 * `credencialIlegivel` marca a falha em que a fonte ESTÁ cadastrada e não abre. Ela
 * não pode virar `null`: a tela leria "não configurada" e mandaria cadastrar uma
 * fonte que já existe. Falha de verdade, então — com a frase que diz o que fazer.
 */
type ResultadoConfigCampanha =
  | { ok: true;  semMudanca?: true; ativo?: boolean | null }
  | { ok: false; error: string; credencialIlegivel?: true }
  | null

// Anti-SSRF: rejeita localhost e ranges de IP privados (mesma lógica do supabase-n8n provider).
// Apenas http/https são aceitos.
//
// `chave` entra só nas mensagens: elas diziam "n8nWebhookUrl" para qualquer URL
// recusada, inclusive a de disparo. Com o par do write-back fora do ar, o texto
// passaria a nomear uma configuração que a tela nem mostra mais.
function validateWebhookUrl(raw: unknown, chave: string): string {
  if (typeof raw !== 'string' || !raw) {
    throw new Error(`${chave} deve ser uma string não vazia`)
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${chave} inválida: URL malformada`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${chave} inválida: apenas http/https são aceitos`)
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (hostname === 'localhost' || hostname === '::1') {
    throw new Error(`${chave} inválida: host privado/local bloqueado`)
  }
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      throw new Error(`${chave} inválida: IP privado bloqueado`)
    }
  }
  return raw
}

/**
 * Segundo passo do save: levar a configuração para a `campaign_config` da base do
 * cliente, que é de onde o fluxo de disparo lê. Antes isto era um POST para um
 * webhook do n8n, que fazia o mapa e o INSERT; agora a app faz os dois (ver
 * lib/sdr/config-write).
 *
 * Não relança: o resultado vira resposta. Quem chama já gravou as settings da app e
 * precisa contar as DUAS verdades — ver o comentário na volta do PUT.
 */
async function gravarNaBaseDaCampanha(
  tenantId: string,
  save: SaveDeCampanha,
): Promise<ResultadoConfigCampanha> {
  // A fonte do tenant sai do banco DA APP, e essa leitura falha como qualquer
  // outra. Ela também fica no try: a esta altura as settings JÁ estão gravadas, e
  // deixar a exceção subir daria 500 sobre um save que deu certo — o usuário veria
  // "falha ao salvar", ficaria com o `version` velho na tela e levaria 409 no save
  // seguinte. É o mesmo motivo do comentário da volta do PUT, lá embaixo.
  let fonte: FonteDoTenant
  try {
    fonte = await conexaoDoTenant(tenantId)
  } catch (err) {
    // Só o tipo do erro no log: a leitura envolve credencial cifrada.
    console.error('[sdr settings → campaign_config] fonte do tenant:', err instanceof Error ? err.name : typeof err)
    return {
      ok: false,
      error: 'Não foi possível ler a fonte de dados do SDR agora. As configurações foram salvas; salve outra vez para publicar a campanha.',
    }
  }
  if (fonte.estado === 'nao_configurada') return null
  // Credencial cadastrada que não abre. Continua NÃO sendo 500: as settings já foram
  // gravadas lá em cima, e derrubar a resposta aqui é justamente o que esta rota
  // deixou de fazer. Vira falha nomeada — quem já logou que não deu para decifrar foi
  // lib/sdr/conexao-tenant; aqui só sobra contar ao usuário.
  if (fonte.estado === 'ilegivel') {
    // A frase sai de lib/sdr/mensagens: é a mesma que a tela de leads mostra quando
    // a importação ou a inscrição esbarram nesta credencial.
    return { ok: false, credencialIlegivel: true, error: CREDENCIAL_SDR_ILEGIVEL }
  }

  try {
    const resultado = await gravarConfigCampanha(fonte.connectionString, save)
    return resultado.gravado
      ? { ok: true, ativo: resultado.config.ativo ?? null }
      : { ok: true, semMudanca: true }
  } catch (err) {
    // Settings impossíveis não são erro de banco — nem chegaram a abrir conexão —
    // e a mensagem delas já é a do usuário.
    if (err instanceof ConfigCampanhaInvalida) {
      console.error('[sdr settings → campaign_config]', err.code)
      return { ok: false, error: err.message }
    }
    // `mapSdrDbError` devolve mensagem em português já segura: sem host, sem
    // usuário, sem senha. O erro cru fica no `cause`, e no log só vai o código.
    const erro = mapSdrDbError(err)
    console.error('[sdr settings → campaign_config]', erro.code)
    return { ok: false, error: erro.message }
  }
}

/**
 * O que a auditoria guarda da segunda gravação. `ativo` é o interruptor que liga e
 * desliga mensagem para dezenas de milhares de pessoas: trilha que não registra
 * quem mexeu nele não serve para responder "por que a campanha parou ontem?".
 */
function auditoriaDaCampanha(resultado: ResultadoConfigCampanha): Record<string, unknown> {
  if (resultado === null)        return { campaignConfig: 'nao_configurada', ativo: null }
  // `credencial_ilegivel` separado de `falhou` porque a trilha responde perguntas
  // diferentes: uma é a base do cliente recusando, a outra é a chave de cifra da
  // NOSSA app — e essa costuma atingir todos os tenants ao mesmo tempo.
  if (!resultado.ok && resultado.credencialIlegivel) {
    return { campaignConfig: 'credencial_ilegivel', ativo: null, erro: resultado.error }
  }
  if (!resultado.ok)             return { campaignConfig: 'falhou', ativo: null, erro: resultado.error }
  if (resultado.semMudanca)      return { campaignConfig: 'sem_mudanca', ativo: null }
  // `ativo: null` aqui é a coluna omitida — o interruptor do cliente ficou como estava.
  return { campaignConfig: 'gravada', ativo: resultado.ativo ?? null }
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  const [row] = await db
    .select()
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  if (!row) {
    return NextResponse.json({ configured: false, status: 'draft', version: 0, settings: DEFAULT_SETTINGS })
  }

  let parsed: Record<string, unknown> = {}
  try { parsed = JSON.parse(row.settings) } catch {}

  // Omit secrets from GET response; URLs are returned for UI display.
  //
  // Os CINCO continuam saindo daqui, e essa lista não encolhe: os três aposentados
  // (`n8nWebhook*`, `n8nEnroll*`, `n8nImport*`) seguem GRAVADOS no JSON do tenant —
  // ver CHAVES_APOSENTADAS em lib/sdr/settings-merge —, então tirá-los deste objeto é
  // o que impede o VALOR de chegar ao cliente. Quem saiu foi só o booleano deles, no
  // `secretsSet` abaixo.
  //
  // O `disable` cobre exatamente esses três. Eles perderam o booleano que os lia e
  // viraram nomes sem uso — mas apagar o nome é apagar a chave do recorte, e aí o
  // VALOR volta a sair no GET. O nome existe para o valor não sair.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { n8nWebhookSecret: _omitWS, n8nDispatchSecret: _omitDS, n8nEnrollSecret: _omitES, n8nImportSecret: _omitIS, n8nBlastSecret: _omitBS, ...settingsForClient } = parsed

  return NextResponse.json({
    configured: true,
    status: row.status,
    version: row.version,
    settings: settingsForClient,
    // Só os dois que alguma tela lê: os cartões de disparo e de disparo de lista em
    // app/(app)/settings/integrations/credenciais usam estes dois no `isSecretSet`.
    // Os três aposentados viravam booleano que nenhuma tela buscava.
    secretsSet: {
      n8nDispatchSecret: !!_omitDS,
      n8nBlastSecret:    !!_omitBS,
    },
  })
}

export async function PUT(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = session.user
  const denied = await assertEntitlement(tenantId, 'sdr.parametros')
  if (denied) return denied

  let body: { settings?: unknown; status?: string; version?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const VALID_STATUS = ['draft', 'active', 'paused'] as const
  type ValidStatus = typeof VALID_STATUS[number]
  if (!VALID_STATUS.includes(body.status as ValidStatus)) {
    return NextResponse.json({ error: 'status inválido' }, { status: 400 })
  }

  const rawSettings = (typeof body.settings === 'object' && body.settings !== null
    ? body.settings
    : {}) as Record<string, unknown>
  const payloadKeys = Object.keys(rawSettings)

  // As DUAS URLs que ainda saem desta app: a do disparo e a do disparo de lista.
  // As outras três (write-back da configuração, importação e inscrição) saíram
  // junto com os webhooks que alimentavam — a app escreve direto na base do cliente.
  // Validar o que ninguém mais lê só recusaria um save por causa de um valor que
  // outra tela guardou em outro dia. O que está no banco continua lá: ver
  // CHAVES_APOSENTADAS em lib/sdr/settings-merge.
  // (empty string = not configured, skip)
  for (const chave of ['n8nDispatchUrl', 'n8nBlastUrl'] as const) {
    const valor = rawSettings[chave]
    if (valor === undefined || valor === '') continue
    try {
      validateWebhookUrl(valor, chave)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : `${chave} inválida` },
        { status: 400 },
      )
    }
  }

  // Validate remetente E.164 if provided and non-empty
  if (rawSettings.remetente !== undefined && rawSettings.remetente !== '') {
    if (typeof rawSettings.remetente !== 'string' || !E164_RE.test(rawSettings.remetente)) {
      return NextResponse.json(
        { error: 'remetente inválido: use formato E.164 (ex: +5511999990000)' },
        { status: 400 },
      )
    }
  }

  // Os campos que viram coluna na `campaign_config` do cliente. Recusar aqui é o
  // que impede `limiteDiario: ' '` de virar `0` — campanha que não dispara nada,
  // com a tela verde — e `3.7`/`5e9` de chegarem ao Postgres só para ele recusar o
  // INSERT inteiro como erro genérico. Antes de gravar qualquer coisa, então nada
  // fica salvo pela metade. A regra mora em lib/sdr/config-write, com os testes.
  const invalida = validarConfigCampanha(rawSettings)
  if (invalida) {
    return NextResponse.json({ error: invalida.code, message: invalida.message }, { status: 400 })
  }

  const status = body.status as ValidStatus
  const now = new Date()

  const [existing] = await db
    .select({
      id:       campaignSettings.id,
      version:  campaignSettings.version,
      settings: campaignSettings.settings,
      // O status guardado é metade da trava do interruptor: sem ele não dá para
      // saber se este save MUDOU o status ou só repetiu o que já estava valendo.
      status:   campaignSettings.status,
    })
    .from(campaignSettings)
    .where(and(eq(campaignSettings.tenantId, tenantId), eq(campaignSettings.source, SOURCE)))
    .limit(1)

  // Concorrência otimista: `version` é opcional (cliente legado não manda), mas
  // quem manda um número diferente do guardado escreveu em cima de uma leitura
  // velha e leva 409 — ver lib/sdr/settings-merge.
  if (existing && isStaleVersion(existing.version, body.version)) {
    return NextResponse.json(
      {
        error: 'versao_conflito',
        message: 'As configurações foram alteradas em outro lugar — os valores em tela foram recarregados. Confira e refaça as alterações.',
        currentVersion: existing.version,
      },
      { status: 409 },
    )
  }

  // JSON guardado corrompido: o merge segue sem base e este PUT reescreve.
  let stored: Record<string, unknown> | null = null
  if (existing) { try { stored = JSON.parse(existing.settings) as Record<string, unknown> } catch {} }

  // URL omitida no PUT mantém a guardada; segredo só sobrevive enquanto a URL
  // dele não muda; os cinco segredos vão cifrados para o banco.
  const mergedSettings = mergeSdrSettings(stored, rawSettings)
  const settingsJson = JSON.stringify(mergedSettings)

  let newVersion: number
  if (existing) {
    newVersion = existing.version + 1
    await db
      .update(campaignSettings)
      .set({ settings: settingsJson, status, version: newVersion, updatedAt: now })
      .where(eq(campaignSettings.id, existing.id))
  } else {
    newVersion = 1
    await db.insert(campaignSettings).values({
      id: randomUUID(),
      tenantId,
      source: SOURCE,
      settings: settingsJson,
      status,
      version: newVersion,
      createdAt: now,
      updatedAt: now,
    })
  }

  // As settings da app já estão gravadas acima. Agora a segunda gravação, na base
  // do cliente. Nenhum segredo precisa ser retirado do objeto: o mapa de
  // lib/sdr/config-write lê só as chaves de campanha, e nada sai deste processo.
  //
  // O "antes" vai junto porque é dele que saem as duas travas do módulo: save que
  // não mexeu em nada de campanha não gera linha, e status que não mudou não
  // encosta no `ativo`. Sem isso, o replay que a tela de Credenciais manda a cada
  // save de webhook pausaria uma campanha em andamento.
  const configCampanha = await gravarNaBaseDaCampanha(tenantId, {
    settings:       mergedSettings,
    anteriores:     stored,
    status,
    statusAnterior: existing?.status ?? null,
  })

  // Depois da segunda gravação, e não antes: é aqui que a trilha registra o que
  // aconteceu com a `campaign_config` e com o `ativo`. `logAudit` nunca lança.
  await logAudit({
    req: request,
    session,
    action: 'settings.update',
    metadata: { changedKeys: payloadKeys, status, ...auditoriaDaCampanha(configCampanha) },
  })

  /* Sucesso parcial, e não 500, quando a `campaign_config` falha.
   *
   * A linha da app JÁ foi gravada e o `version` novo JÁ é o que vale — derrubar a
   * resposta esconderia as duas coisas do cliente: ele veria "falha ao salvar"
   * sobre dados que foram salvos, ficaria com o `version` velho na tela e levaria
   * 409 no save seguinte. Não há transação possível entre dois bancos diferentes,
   * então a honestidade tem de estar na resposta: `ok` é o save da app,
   * `configCampanha` é a base da campanha, e cada um fala por si.
   *
   * `n8nDelivery` continua aqui como APELIDO do mesmo resultado, com o formato que
   * a tela (app/(app)/sdr-ia/parametros/CampaignConfig.tsx) já lê: os três estados
   * dela — não configurado, atualizado, falhou — continuam corretos agora que quem
   * está do outro lado é a base da campanha. Tirar o campo sem tocar na tela seria
   * o pior resultado: ela deixaria de mostrar qualquer aviso e todo save pareceria
   * ter dado certo. Some quando a tela passar a ler `configCampanha`. */
  return NextResponse.json({
    ok: true,
    version: newVersion,
    configCampanha,
    n8nDelivery: configCampanha,
  })
}
