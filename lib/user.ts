import { cache } from 'react'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { comFallback } from '@/lib/db/fallback'

export type UserProfile = { name: string; photoUrl: string | null }

export const PERFIL_PADRAO: UserProfile = { name: '', photoUrl: null }

async function consultarPerfil(userId: string): Promise<UserProfile> {
  const [user] = await db
    .select({ name: users.name, photoUrl: users.photoUrl })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return { name: user?.name ?? '', photoUrl: user?.photoUrl ?? null }
}

/* Nome vazio é o sinal combinado com quem chama: em app/(app)/layout.tsx o
 * UserInit recebe `profile.name || name!`, então o padrão daqui escorrega para o
 * nome que já veio na sessão. A foto some por uma navegação; a tela não.
 *
 * Em cache() como getTenantBranding: o layout e o generateMetadata rodam na
 * mesma requisição, e sem isto a mesma linha seria buscada duas vezes. */
export const getUserProfile = cache((userId: string): Promise<UserProfile> =>
  userId
    ? comFallback(() => consultarPerfil(userId), PERFIL_PADRAO, 'user')
    : Promise.resolve(PERFIL_PADRAO))
