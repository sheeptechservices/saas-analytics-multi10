import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getEnabledModuleKeys } from '@/lib/entitlements'
import { firstAllowedPath } from '@/lib/modules'

/** Destino das telas ocultas (HIDDEN_MODULE_KEYS em lib/modules.ts): quem chega
 *  por link antigo ou digitando a URL cai na primeira tela liberada do tenant.
 *  Roda na própria página, e não só no layout de (app), porque o layout não é
 *  refeito na navegação do cliente — só a página é. */
export async function redirectFromHiddenRoute(): Promise<never> {
  const session = await auth()
  if (!session) redirect('/login')
  redirect(firstAllowedPath(await getEnabledModuleKeys(session.user.tenantId)))
}
