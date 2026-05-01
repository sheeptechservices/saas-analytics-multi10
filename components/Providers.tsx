'use client'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { SessionProvider } from 'next-auth/react'
import { useState, useEffect } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1, networkMode: 'always' } },
  }))

  useEffect(() => {
    focusManager.setFocused(true)
    return () => focusManager.setFocused(undefined)
  }, [])

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </SessionProvider>
  )
}
