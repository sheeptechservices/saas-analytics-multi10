import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import type { Role } from '@/types'

export function requireRole(allowed: Role[], session: Session): NextResponse | null {
  if (!allowed.includes(session.user.role)) {
    return NextResponse.json({ error: 'insufficient_role' }, { status: 403 })
  }
  return null
}
