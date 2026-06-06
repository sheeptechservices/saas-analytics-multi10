import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function getUserProfile(userId: string) {
  const [user] = await db
    .select({ name: users.name, photoUrl: users.photoUrl })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return { name: user?.name ?? '', photoUrl: user?.photoUrl ?? null }
}
