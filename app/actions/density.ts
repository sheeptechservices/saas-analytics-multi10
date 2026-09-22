'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { DENSITY_COOKIE, DENSITY_MAX_AGE, parseDensity, type Density } from '@/lib/density'

/**
 * Grava a densidade escolhida. O alternador do redesign chama isto; a próxima
 * resposta do servidor já sai com data-density novo no <html>.
 *
 * httpOnly fica falso de propósito: não há segredo aqui, e um alternador que
 * queira responder na hora precisa ler e escrever o mesmo cookie no cliente.
 */
export async function setDensity(density: Density) {
  const valor = parseDensity(density)
  if (!valor) return

  const jar = await cookies()
  jar.set(DENSITY_COOKIE, valor, {
    path: '/',
    maxAge: DENSITY_MAX_AGE,
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
  })

  revalidatePath('/', 'layout')
}
