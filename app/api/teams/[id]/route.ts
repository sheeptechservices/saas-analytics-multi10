import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { salesTeams, teamMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { tenantId } = session.user
  const { id } = await params

  const { name, color, members } = await request.json() as {
    name: string
    color: string
    members: string[]
  }

  await db
    .update(salesTeams)
    .set({ name: name.trim(), color })
    .where(and(eq(salesTeams.id, id), eq(salesTeams.tenantId, tenantId)))

  // Replace members: delete all then re-insert
  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, id), eq(teamMembers.tenantId, tenantId)))

  if (members.length > 0) {
    await db.insert(teamMembers).values(
      members.map(name => ({ id: uid(), teamId: id, tenantId, responsibleName: name }))
    )
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { tenantId } = session.user
  const { id } = await params

  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, id), eq(teamMembers.tenantId, tenantId)))

  await db
    .delete(salesTeams)
    .where(and(eq(salesTeams.id, id), eq(salesTeams.tenantId, tenantId)))

  return NextResponse.json({ ok: true })
}
