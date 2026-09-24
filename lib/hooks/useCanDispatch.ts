import { useQuery } from '@tanstack/react-query'
import { canActInTenant } from '@/lib/roles'
import { fetchJson } from '@/lib/api-error'

interface MeData { user?: { role?: string } }

/**
 * Returns whether the current user has permission to trigger WhatsApp sends
 * (blast / enroll / dispatch). Reuses the shared ['me'] cache so there is
 * no extra network request when the settings page has already fetched it.
 *
 * Single-account model: every user of a tenant may send, whatever legacy value
 * sits in their `role` column. Mirrors requireTenantUser on the server side —
 * the button must not offer less than the route accepts.
 *
 * Defaults to false while loading — intentionally fail-closed for a
 * permission check.
 */
export function useCanDispatch(): { canDispatch: boolean } {
  const { data } = useQuery<MeData>({
    queryKey: ['me'],
    // fetchJson, e não `r.json()` cru: o corpo de um 401/500 não pode virar um
    // `user` de mentira. E tem de ser a mesma queryFn da tela de Configurações,
    // que divide esta queryKey — senão qual das duas vale passa a depender de
    // quem montar primeiro. Falhando, `data` fica undefined e canDispatch cai
    // em false: o padrão seguro já documentado acima.
    queryFn:  () => fetchJson<MeData>('/api/me'),
    staleTime: 5 * 60 * 1000,
  })
  return { canDispatch: canActInTenant(data?.user?.role) }
}
