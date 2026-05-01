import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { salesTeams, teamMembers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { tenantId } = session.user

  const teams = await db
    .select()
    .from(salesTeams)
    .where(eq(salesTeams.tenantId, tenantId))

  const members = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.tenantId, tenantId))

  const result = teams.map(t => ({
    ...t,
    members: members.filter(m => m.teamId === t.id).map(m => m.responsibleName),
  }))

  return NextResponse.json({ teams: result })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { tenantId } = session.user

  const { name, color } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })

  const id = uid()
  await db.insert(salesTeams).values({
    id,
    tenantId,
    name: name.trim(),
    color: color ?? '#FFB400',
    createdAt: new Date(),
  })

  return NextResponse.json({ id })
}
