export type ModuleType = 'sidebar' | 'dashboard-tab' | 'integration'

export interface ModuleDef {
  key: string
  label: string
  type: ModuleType
  path: string
}

export const MODULES: ModuleDef[] = [
  { key: 'pipeline',               label: 'Pipeline',          type: 'sidebar',       path: '/pipeline' },
  { key: 'sdr.dashboard',          label: 'SDR / Disparos',    type: 'sidebar',       path: '/sdr-ia/disparos' },
  { key: 'sdr.parametros',         label: 'Parâmetros SDR',    type: 'sidebar',       path: '/settings?tab=campanha-sdr' },
  { key: 'dashboard.overview',     label: 'Visão Geral',       type: 'dashboard-tab', path: '/dashboard' },
  { key: 'dashboard.ranking',      label: 'Ranking',           type: 'dashboard-tab', path: '/dashboard/ranking' },
  { key: 'dashboard.marketing',    label: 'Marketing',         type: 'dashboard-tab', path: '/dashboard/marketing' },
  { key: 'integration.sdr-source', label: 'Fonte de Dados SDR', type: 'integration', path: '/settings/integrations/sdr-source' },
  { key: 'integration.google-ads', label: 'Google Ads',        type: 'integration',   path: '/settings/integrations/google-ads' },
  { key: 'integration.meta-ads',   label: 'Meta Ads',          type: 'integration',   path: '/settings/integrations/meta-ads' },
  { key: 'integration.tiktok-ads', label: 'TikTok Ads',        type: 'integration',   path: '/settings/integrations/tiktok-ads' },
  { key: 'integration.ai',         label: 'IA / Assistente',   type: 'integration',   path: '/settings/integrations/ai' },
  { key: 'integration.ycloud-whatsapp', label: 'YCloud (WhatsApp)', type: 'integration', path: '/settings/integrations/ycloud' },
]

export const ALL_MODULE_KEYS: string[] = MODULES.map(m => m.key)

// Telas que eram montadas só com os dados do CRM que saiu do produto. Ficam
// fora do menu e das abas, e a rota redireciona (lib/hidden-route.ts), até serem
// refeitas sobre os dados do SDR (issues #135/#136). As chaves
// continuam em MODULES porque serão reaproveitadas. Tirar a chave daqui não
// reabre nada: a tela precisa ser refeita (a página hoje só redireciona) e
// voltar ao Sidebar (navItems) ou às abas do dashboard (TABS em dashboard/layout).
export const HIDDEN_MODULE_KEYS: string[] = ['pipeline', 'dashboard.ranking']

export function isModuleHidden(key: string): boolean {
  return HIDDEN_MODULE_KEYS.includes(key)
}

// Extra path → module-key mappings for sub-routes that don't have their own
// MODULES entry (avoids duplicate keys in ALL_MODULE_KEYS / backfill scripts).
const PATH_MODULE_OVERRIDES: Record<string, string> = {
  '/sdr-ia/contatos':  'integration.ycloud-whatsapp',
  '/sdr-ia/conversas': 'integration.ycloud-whatsapp',
  '/sdr-ia/leads':     'sdr.parametros',
  // A tela de Credenciais só edita as URLs/segredos de n8n da campanha, e toda
  // a sua API é /api/sdr/settings — a mesma chave que já esconde o cartão dela
  // em Configurações › Integrações. Sem esta linha a rota ficava aberta e
  // quem chegasse por link direto batia num 403 em vez de ser redirecionado.
  '/settings/integrations/credenciais': 'sdr.parametros',
}

export function moduleKeyForPath(pathname: string): string | null {
  if (PATH_MODULE_OVERRIDES[pathname]) return PATH_MODULE_OVERRIDES[pathname]
  const sorted = [...MODULES].sort((a, b) => b.path.length - a.path.length)
  for (const m of sorted) {
    if (pathname === m.path || pathname.startsWith(m.path + '/')) return m.key
  }
  return null
}

export const ADS_PROVIDER_MODULE: Record<string, string> = {
  google_ads: 'integration.google-ads',
  meta_ads:   'integration.meta-ads',
  tiktok_ads: 'integration.tiktok-ads',
}

/** Maps a data_source.providerKey to the tenant module key that gates it. */
export const PROVIDER_MODULE: Record<string, string> = {
  'supabase-n8n':    'integration.sdr-source',
  'ycloud-whatsapp': 'integration.ycloud-whatsapp',
}

export function getModuleKeyForProvider(providerKey: string): string | null {
  return PROVIDER_MODULE[providerKey] ?? null
}

// Nunca devolve uma tela oculta nem uma cujo módulo o tenant não tem: o layout
// de (app) redireciona para cá, então qualquer uma das duas viraria um laço de
// redirecionamento (lib/modules.test.ts cobre todas as combinações de módulos).
export function firstAllowedPath(modules: string[]): string {
  const dashTabs = ['dashboard.overview', 'dashboard.ranking', 'dashboard.marketing'].filter(k => !isModuleHidden(k))
  const firstDash = MODULES.find(m => dashTabs.includes(m.key) && modules.includes(m.key))
  if (firstDash) return firstDash.path
  if (modules.includes('sdr.dashboard')) return '/sdr-ia/disparos'
  // /sdr-ia/disparos exige sdr.dashboard: só com sdr.parametros, o destino é o Novo disparo
  if (modules.includes('sdr.parametros')) return '/sdr-ia/leads'
  if (modules.includes('pipeline') && !isModuleHidden('pipeline')) return '/pipeline'
  return '/settings'
}

// ─── Endpoint da API → módulo ────────────────────────────────────────────────
//
// Espelho, no cliente, do que cada rota exige no servidor (assertEntitlement em
// app/api/**). O servidor continua sendo quem decide: isto aqui só evita montar
// a requisição que ele responderia com 403 — e dá à tela a palavra certa para
// dizer por que não há dado. Ao mexer numa rota da API, mexa também aqui; o
// teste de lib/modules.test.ts varre app/ e components/ e quebra se aparecer um
// endpoint que nenhuma das duas listas declara.
//
// A chave é o prefixo do caminho: vale para ele e para tudo abaixo dele
// ('/api/sdr/leads' cobre '/api/sdr/leads/import'). Na dúvida entre dois, vence
// o mais longo.
export const API_MODULE: Record<string, string> = {
  '/api/ads/insights':        'dashboard.marketing',
  '/api/ai-chat':             'integration.ai',
  '/api/ai-settings':         'integration.ai',
  '/api/bi/sdr':              'sdr.dashboard',
  '/api/contacts':            'integration.ycloud-whatsapp',
  '/api/sdr/blast/campaigns': 'sdr.parametros',
  '/api/sdr/dispatch':        'sdr.parametros',
  '/api/sdr/enroll':          'sdr.parametros',
  '/api/sdr/leads':           'sdr.parametros',
  '/api/sdr/settings':        'sdr.parametros',
  '/api/sdr/source':          'integration.sdr-source',
  // A sincronização puxa as conversas da YCloud — é o módulo do WhatsApp que a
  // libera, não o da fonte SDR. Ver app/api/sdr/sync/route.ts.
  '/api/sdr/sync':            'integration.ycloud-whatsapp',
  '/api/sdr/templates':       'sdr.parametros',
  '/api/ycloud':              'integration.ycloud-whatsapp',
}

// Rotas que qualquer usuário autenticado do tenant acessa: não passam por
// assertEntitlement, então não há o que esconder no cliente. Estão declaradas
// só para o teste de varredura saber que não foram esquecidas.
export const UNGATED_API_ENDPOINTS: string[] = [
  '/api/audit-logs',
  '/api/auth',
  '/api/me',
  '/api/settings',
  '/api/users',
]

function normalizeEndpoint(endpoint: string): string {
  const semQuery = endpoint.split('?')[0].split('#')[0]
  return semQuery.length > 1 && semQuery.endsWith('/') ? semQuery.slice(0, -1) : semQuery
}

function matchPrefix(path: string, prefixes: string[]): string | null {
  let melhor: string | null = null
  for (const p of prefixes) {
    if (path === p || path.startsWith(p + '/')) {
      if (melhor === null || p.length > melhor.length) melhor = p
    }
  }
  return melhor
}

/** Módulo que o servidor exige no endpoint, ou null quando a rota é aberta a
 *  todo usuário do tenant. Aceita a URL já montada, com query string. */
export function moduleKeyForEndpoint(endpoint: string): string | null {
  const path = normalizeEndpoint(endpoint)
  const prefixo = matchPrefix(path, Object.keys(API_MODULE))
  if (prefixo) return API_MODULE[prefixo]
  // /api/ads/<provider> é rota dinâmica: o módulo sai do provider. Vem depois
  // do mapa porque /api/ads/insights ocupa o mesmo formato e não é provider.
  const ads = /^\/api\/ads\/([^/]+)$/.exec(path)
  if (ads) return ADS_PROVIDER_MODULE[ads[1]] ?? null
  return null
}

/** O endpoint está declarado numa das duas listas? Usado só pelo teste de
 *  varredura — uma rota nova que ninguém classificou tem de falhar ali, e não
 *  em produção, em silêncio, como se fosse aberta. */
export function isDeclaredEndpoint(endpoint: string): boolean {
  const path = normalizeEndpoint(endpoint)
  if (!path.startsWith('/api')) return false
  if (/^\/api\/ads(\/|$)/.test(path)) return true
  const declarados = [...Object.keys(API_MODULE), ...UNGATED_API_ENDPOINTS]
  if (matchPrefix(path, declarados)) return true
  // Prefixo estático de um template literal ('/api/sdr/' de `/api/sdr/${x}`):
  // basta que alguma rota declarada comece por ele.
  return declarados.some(d => d.startsWith(path))
}
