import { useQuery } from '@tanstack/react-query'

interface MeData { user?: { role?: string } }

const DISPATCH_ROLES = ['master', 'admin', 'manager']

/**
 * Returns whether the current user has permission to trigger WhatsApp sends
 * (blast / enroll / dispatch). Reuses the shared ['me'] cache so there is
 * no extra network request when the settings page has already fetched it.
 *
 * Defaults to false while loading — intentionally fail-closed for a
 * permission check.
 */
export function useCanDispatch(): { canDispatch: boolean } {
  const { data } = useQuery<MeData>({
    queryKey: ['me'],
    queryFn:  () => fetch('/api/me').then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  })
  return { canDispatch: DISPATCH_ROLES.includes(data?.user?.role ?? '') }
}
