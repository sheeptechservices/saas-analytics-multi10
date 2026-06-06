'use client'
import { useEffect } from 'react'
import { useUser } from '@/stores/userStore'

interface Props {
  name: string
  photoUrl: string | null
}

export function UserInit({ name, photoUrl }: Props) {
  const init = useUser((s) => s.init)
  useEffect(() => {
    init(name, photoUrl)
  }, [name, photoUrl, init])
  return null
}
