import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ADS_PROVIDER_MODULE, ALL_MODULE_KEYS, API_MODULE, HIDDEN_MODULE_KEYS, MODULES,
  firstAllowedPath, isDeclaredEndpoint, isModuleHidden, moduleKeyForEndpoint, moduleKeyForPath,
} from '@/lib/modules'

// Rotas que só redirecionam: as telas ocultas (lib/hidden-route.ts).
const HIDDEN_PATHS = MODULES.filter(m => isModuleHidden(m.key)).map(m => m.path)

// Todas as combinações de módulos — mais uma chave fora do catálogo: módulos que
// saíram do produto seguem gravados em tenant_modules de tenants antigos e não
// podem atrapalhar.
const LEGADA = 'integration.removida'
function* subsets(keys: string[]): Generator<string[]> {
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    yield keys.filter((_, i) => mask & (1 << i))
  }
}
const KEYS = [...ALL_MODULE_KEYS, LEGADA]

test('Pipeline e Ranking estão ocultos, com as chaves mantidas para a reconstrução', () => {
  assert.deepEqual([...HIDDEN_MODULE_KEYS].sort(), ['dashboard.ranking', 'pipeline'])
  assert.ok(ALL_MODULE_KEYS.includes('pipeline'))
  assert.ok(ALL_MODULE_KEYS.includes('dashboard.ranking'))
  assert.deepEqual([...HIDDEN_PATHS].sort(), ['/dashboard/ranking', '/pipeline'])
})

test('firstAllowedPath nunca devolve tela oculta nem rota que o layout redirecionaria', () => {
  let casos = 0
  for (const modules of subsets(KEYS)) {
    const path = firstAllowedPath(modules)
    const onde = `módulos [${modules.join(', ')}] → ${path}`
    assert.ok(!HIDDEN_PATHS.includes(path), `tela oculta: ${onde}`)
    // o layout de (app) redireciona quando o módulo da rota não está liberado —
    // e redireciona para firstAllowedPath de novo: seria um laço
    const required = moduleKeyForPath(path)
    assert.ok(required === null || modules.includes(required), `exige ${required}: ${onde}`)
    casos++
  }
  assert.equal(casos, 2 ** KEYS.length)
})

test('tenant cuja única tela era Pipeline ou Ranking cai em Configurações', () => {
  assert.equal(firstAllowedPath(['pipeline']), '/settings')
  assert.equal(firstAllowedPath(['dashboard.ranking']), '/settings')
  assert.equal(firstAllowedPath(['pipeline', 'dashboard.ranking', LEGADA]), '/settings')
  assert.equal(firstAllowedPath([]), '/settings')
})

test('as demais telas continuam com a mesma prioridade', () => {
  assert.equal(firstAllowedPath(['dashboard.ranking', 'dashboard.overview']), '/dashboard')
  assert.equal(firstAllowedPath(['dashboard.ranking', 'dashboard.marketing']), '/dashboard/marketing')
  assert.equal(firstAllowedPath(['pipeline', 'sdr.dashboard']), '/sdr-ia/disparos')
  assert.equal(firstAllowedPath(['sdr.dashboard', 'sdr.parametros']), '/sdr-ia/disparos')
  // só sdr.parametros: /sdr-ia/disparos exigiria sdr.dashboard (antes, laço)
  assert.equal(firstAllowedPath(['sdr.parametros']), '/sdr-ia/leads')
})

test('as rotas ocultas continuam mapeadas ao seu módulo', () => {
  assert.equal(moduleKeyForPath('/pipeline'), 'pipeline')
  assert.equal(moduleKeyForPath('/dashboard/ranking'), 'dashboard.ranking')
})

// ─── Endpoint → módulo (issue #98) ───────────────────────────────────────────

test('moduleKeyForEndpoint devolve o módulo que a própria rota exige', () => {
  // Cada par abaixo foi conferido no assertEntitlement da rota correspondente.
  const esperado: Record<string, string | null> = {
    '/api/ads/insights':              'dashboard.marketing',
    '/api/ads/google_ads':            'integration.google-ads',
    '/api/ads/meta_ads':              'integration.meta-ads',
    '/api/ads/tiktok_ads':            'integration.tiktok-ads',
    '/api/ai-chat':                   'integration.ai',
    '/api/ai-settings':               'integration.ai',
    '/api/ai-settings/usage':         'integration.ai',
    '/api/ai-settings/validate':      'integration.ai',
    '/api/bi/sdr':                    'sdr.dashboard',
    '/api/contacts':                  'integration.ycloud-whatsapp',
    '/api/sdr/blast/campaigns':       'sdr.parametros',
    '/api/sdr/blast/campaigns/abc-1': 'sdr.parametros',
    '/api/sdr/dispatch':              'sdr.parametros',
    '/api/sdr/enroll':                'sdr.parametros',
    '/api/sdr/leads':                 'sdr.parametros',
    '/api/sdr/leads/blast':           'sdr.parametros',
    '/api/sdr/leads/import':          'sdr.parametros',
    '/api/sdr/leads/manual':          'sdr.parametros',
    '/api/sdr/leads/template':        'sdr.parametros',
    '/api/sdr/settings':              'sdr.parametros',
    '/api/sdr/source':                'integration.sdr-source',
    '/api/sdr/source/test':           'integration.sdr-source',
    '/api/sdr/templates':             'sdr.parametros',
    '/api/ycloud/conversations':      'integration.ycloud-whatsapp',
    '/api/ycloud/conversations/x-9':  'integration.ycloud-whatsapp',
    '/api/ycloud/messages':           'integration.ycloud-whatsapp',
    '/api/ycloud/source':             'integration.ycloud-whatsapp',
    '/api/ycloud/source/test':        'integration.ycloud-whatsapp',
    '/api/ycloud/templates':          'integration.ycloud-whatsapp',
    '/api/ycloud/test-send':          'integration.ycloud-whatsapp',
    // Aberto a todo usuário do tenant: nenhuma delas chama assertEntitlement.
    '/api/audit-logs':                null,
    '/api/me':                        null,
    '/api/settings':                  null,
    '/api/users':                     null,
    '/api/users/u-1':                 null,
  }
  for (const [endpoint, chave] of Object.entries(esperado)) {
    assert.equal(moduleKeyForEndpoint(endpoint), chave, endpoint)
  }
})

test('a sincronização é do WhatsApp, não da fonte SDR', () => {
  // Erro fácil de cometer pelo nome: /api/sdr/sync fica sob /api/sdr mas o
  // assertEntitlement dela é 'integration.ycloud-whatsapp'.
  assert.equal(moduleKeyForEndpoint('/api/sdr/sync'), 'integration.ycloud-whatsapp')
  assert.notEqual(moduleKeyForEndpoint('/api/sdr/sync'), 'integration.sdr-source')
})

test('moduleKeyForEndpoint ignora query string e barra final', () => {
  assert.equal(moduleKeyForEndpoint('/api/bi/sdr?period=30d'), 'sdr.dashboard')
  assert.equal(moduleKeyForEndpoint('/api/contacts?page=2&q=ana'), 'integration.ycloud-whatsapp')
  assert.equal(moduleKeyForEndpoint('/api/sdr/leads/'), 'sdr.parametros')
  assert.equal(moduleKeyForEndpoint('/api/sdr/blast/campaigns?kind=manual'), 'sdr.parametros')
})

test('o prefixo mais longo vence, e um nome parecido não é prefixo', () => {
  // '/api/sdr/settings' não pode ser capturado por '/api/sdr/source' nem o
  // contrário, e '/api/contacts-x' não é '/api/contacts'.
  assert.equal(moduleKeyForEndpoint('/api/sdr/settings'), 'sdr.parametros')
  assert.equal(moduleKeyForEndpoint('/api/sdr/source'), 'integration.sdr-source')
  assert.equal(moduleKeyForEndpoint('/api/contacts-x'), null)
  assert.equal(moduleKeyForEndpoint('/api/ycloudzinho'), null)
})

test('todo módulo citado no mapa de endpoints existe no catálogo', () => {
  for (const [endpoint, chave] of Object.entries(API_MODULE)) {
    assert.ok(ALL_MODULE_KEYS.includes(chave), `${endpoint} → ${chave} fora de MODULES`)
  }
  for (const chave of Object.values(ADS_PROVIDER_MODULE)) {
    assert.ok(ALL_MODULE_KEYS.includes(chave), `${chave} fora de MODULES`)
  }
})

test('nenhum endpoint gatilhado aponta para um módulo oculto', () => {
  // Pipeline e Ranking estão fora do produto: se uma rota passasse a exigir uma
  // dessas chaves, a tela ficaria bloqueada para todo mundo, sem saída.
  for (const [endpoint, chave] of Object.entries(API_MODULE)) {
    assert.ok(!isModuleHidden(chave), `${endpoint} exige módulo oculto ${chave}`)
  }
})

// Varredura do código do cliente: um endpoint novo tem de aparecer em
// API_MODULE ou em UNGATED_API_ENDPOINTS. Sem isto, moduleKeyForEndpoint
// devolveria null em silêncio — e null quer dizer "rota aberta", o pior padrão
// possível para uma chamada que na verdade é de módulo pago.
test('todo endpoint chamado pelo cliente está declarado', () => {
  // Só o app do cliente. O console do master (app/(master)) fica fora do
  // ModulesProvider e as rotas dele (/api/master/**) são protegidas por papel,
  // não por módulo contratado — não há gating de plano a fazer lá.
  const raizes = ['app/(app)', 'components', 'lib/hooks']
  const arquivos: string[] = []
  const coletar = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name)
      if (entrada.isDirectory()) coletar(caminho)
      else if (/\.(ts|tsx)$/.test(entrada.name)) arquivos.push(caminho)
    }
  }
  for (const r of raizes) coletar(join(process.cwd(), r))

  const achados = new Map<string, string>()
  for (const arquivo of arquivos) {
    const fonte = readFileSync(arquivo, 'utf8')
    // Só o que é passado a fetch(): evita casar com os literais das próprias
    // rotas (app/api/**) e com URLs citadas em comentário.
    for (const m of fonte.matchAll(/\bfetch(?:Json)?(?:<[^>]*>)?\(\s*[`'"]([^`'"$]*)/g)) {
      const bruto = m[1]
      if (!bruto.startsWith('/api')) continue
      if (!achados.has(bruto)) achados.set(bruto, arquivo)
    }
  }

  assert.ok(achados.size >= 20, `a varredura achou só ${achados.size} endpoints — o regex quebrou?`)
  for (const [endpoint, arquivo] of achados) {
    assert.ok(
      isDeclaredEndpoint(endpoint),
      `${endpoint} (${arquivo}) não está em API_MODULE nem em UNGATED_API_ENDPOINTS`,
    )
  }
})

test('a tela de Credenciais é gated pela mesma chave da API que ela usa', () => {
  // Ela só edita /api/sdr/settings, e o cartão que leva até ela em
  // Configurações › Integrações já era escondido por sdr.parametros. Sem o
  // override, a rota ficava aberta e quem chegasse por link direto batia num
  // 403 em vez de ser redirecionado (issue #98).
  assert.equal(moduleKeyForPath('/settings/integrations/credenciais'), 'sdr.parametros')
  assert.equal(moduleKeyForEndpoint('/api/sdr/settings'), 'sdr.parametros')

  // As demais telas de integração continuam com a chave do próprio módulo.
  assert.equal(moduleKeyForPath('/settings/integrations/sdr-source'), 'integration.sdr-source')
  assert.equal(moduleKeyForPath('/settings/integrations/ycloud'), 'integration.ycloud-whatsapp')
  assert.equal(moduleKeyForPath('/settings/integrations/ai'), 'integration.ai')
  assert.equal(moduleKeyForPath('/settings/integrations/google-ads'), 'integration.google-ads')

  // /settings continua aberta: é ela que firstAllowedPath usa como último
  // destino, e um módulo exigido aqui viraria laço de redirecionamento.
  assert.equal(moduleKeyForPath('/settings'), null)
})

test('a rota e a API de cada tela pedem a mesma chave, ou a tela trata o resto', () => {
  // As telas cuja rota exige uma chave diferente da API que elas chamam são os
  // dois casos que a issue #98 arrumou no cliente. Documentados aqui para que
  // um terceiro caso não passe despercebido.
  const conhecidos: Record<string, { rota: string | null; endpoint: string | null }> = {
    // Visão Geral abre com dashboard.overview e lê /api/bi/sdr (sdr.dashboard)
    '/dashboard':         { rota: 'dashboard.overview', endpoint: moduleKeyForEndpoint('/api/bi/sdr') },
    // Disparos abre com sdr.dashboard e lê /api/sdr/blast/campaigns (sdr.parametros)
    '/sdr-ia/disparos':   { rota: 'sdr.dashboard',      endpoint: moduleKeyForEndpoint('/api/sdr/blast/campaigns') },
  }
  for (const [rota, { rota: chaveRota, endpoint }] of Object.entries(conhecidos)) {
    assert.equal(moduleKeyForPath(rota), chaveRota, rota)
    assert.notEqual(endpoint, chaveRota, `${rota} deixou de ser um caso divergente — reveja o gating da tela`)
  }

  // Estas, sim, batem: gating na tela é defesa em profundidade, não requisito.
  assert.equal(moduleKeyForPath('/sdr-ia/conversas'), moduleKeyForEndpoint('/api/ycloud/conversations'))
  assert.equal(moduleKeyForPath('/sdr-ia/contatos'),  moduleKeyForEndpoint('/api/contacts'))
  assert.equal(moduleKeyForPath('/sdr-ia/leads'),     moduleKeyForEndpoint('/api/sdr/leads'))
  assert.equal(moduleKeyForPath('/dashboard/marketing'), moduleKeyForEndpoint('/api/ads/insights'))
})
