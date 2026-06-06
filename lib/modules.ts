export type ModuleType = 'sidebar' | 'dashboard-tab' | 'integration'

export interface ModuleDef {
  key: string
  label: string
  type: ModuleType
  path: string
}

export const MODULES: ModuleDef[] = [
  { key: 'pipeline',               label: 'Pipeline',        type: 'sidebar',       path: '/pipeline' },
  { key: 'prospeccao-ia',          label: 'SDR IA',          type: 'sidebar',       path: '/prospeccao-ia' },
  { key: 'dashboard.overview',     label: 'Visão Geral',     type: 'dashboard-tab', path: '/dashboard' },
  { key: 'dashboard.ranking',      label: 'Ranking',         type: 'dashboard-tab', path: '/dashboard/ranking' },
  { key: 'dashboard.marketing',    label: 'Marketing',       type: 'dashboard-tab', path: '/dashboard/marketing' },
  { key: 'dashboard.sdr-ia',       label: 'SDR IA',          type: 'dashboard-tab', path: '/dashboard/sdr-ia' },
  { key: 'integration.kommo',      label: 'Kommo (CRM)',     type: 'integration',   path: '/settings/integrations/kommo' },
  { key: 'integration.google-ads', label: 'Google Ads',      type: 'integration',   path: '/settings/integrations/google-ads' },
  { key: 'integration.meta-ads',   label: 'Meta Ads',        type: 'integration',   path: '/settings/integrations/meta-ads' },
  { key: 'integration.tiktok-ads', label: 'TikTok Ads',      type: 'integration',   path: '/settings/integrations/tiktok-ads' },
  { key: 'integration.ai',         label: 'IA / Assistente', type: 'integration',   path: '/settings/integrations/ai' },
]

export const ALL_MODULE_KEYS: string[] = MODULES.map(m => m.key)

export function moduleKeyForPath(pathname: string): string | null {
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

export function firstAllowedPath(modules: string[]): string {
  const dashTabs = ['dashboard.overview', 'dashboard.ranking', 'dashboard.marketing', 'dashboard.sdr-ia']
  const firstDash = MODULES.find(m => dashTabs.includes(m.key) && modules.includes(m.key))
  if (firstDash) return firstDash.path
  if (modules.includes('pipeline')) return '/pipeline'
  return '/settings'
}
