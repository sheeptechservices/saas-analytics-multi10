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
  { key: 'sdr.parametros',         label: 'Parâmetros SDR',    type: 'sidebar',       path: '/sdr-ia/parametros' },
  { key: 'dashboard.overview',     label: 'Visão Geral',       type: 'dashboard-tab', path: '/dashboard' },
  { key: 'dashboard.ranking',      label: 'Ranking',           type: 'dashboard-tab', path: '/dashboard/ranking' },
  { key: 'dashboard.marketing',    label: 'Marketing',         type: 'dashboard-tab', path: '/dashboard/marketing' },
  { key: 'integration.sdr-source', label: 'Fonte de Dados SDR', type: 'integration', path: '/settings/integrations/sdr-source' },
  { key: 'integration.kommo',      label: 'Kommo (CRM)',       type: 'integration',   path: '/settings/integrations/kommo' },
  { key: 'integration.google-ads', label: 'Google Ads',        type: 'integration',   path: '/settings/integrations/google-ads' },
  { key: 'integration.meta-ads',   label: 'Meta Ads',          type: 'integration',   path: '/settings/integrations/meta-ads' },
  { key: 'integration.tiktok-ads', label: 'TikTok Ads',        type: 'integration',   path: '/settings/integrations/tiktok-ads' },
  { key: 'integration.ai',         label: 'IA / Assistente',   type: 'integration',   path: '/settings/integrations/ai' },
  { key: 'integration.ycloud-whatsapp', label: 'YCloud (WhatsApp)', type: 'integration', path: '/settings/integrations/ycloud' },
]

export const ALL_MODULE_KEYS: string[] = MODULES.map(m => m.key)

// Extra path → module-key mappings for sub-routes that don't have their own
// MODULES entry (avoids duplicate keys in ALL_MODULE_KEYS / backfill scripts).
const PATH_MODULE_OVERRIDES: Record<string, string> = {
  '/sdr-ia/contatos':  'integration.ycloud-whatsapp',
  '/sdr-ia/conversas': 'integration.ycloud-whatsapp',
  '/sdr-ia/leads':     'sdr.parametros',
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

export function firstAllowedPath(modules: string[]): string {
  const dashTabs = ['dashboard.overview', 'dashboard.ranking', 'dashboard.marketing']
  const firstDash = MODULES.find(m => dashTabs.includes(m.key) && modules.includes(m.key))
  if (firstDash) return firstDash.path
  if (modules.includes('sdr.dashboard') || modules.includes('sdr.parametros')) return '/sdr-ia/disparos'
  if (modules.includes('pipeline')) return '/pipeline'
  return '/settings'
}
