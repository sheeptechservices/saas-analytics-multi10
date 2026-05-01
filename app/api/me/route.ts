import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, avatarColor: users.avatarColor, avatarBg: users.avatarBg, photoUrl: users.photoUrl })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ user })
}

export async function PUT(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, photoUrl } = await request.json() as { name?: string; photoUrl?: string | null }

  await db
    .update(users)
    .set({
      ...(name?.trim() && { name: name.trim() }),
      photoUrl: photoUrl ?? null,
    })
    .where(eq(users.id, session.user.id))

  return NextResponse.json({ ok: true })
}
