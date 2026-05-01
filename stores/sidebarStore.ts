'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarState {
  open: boolean
  pinned: boolean
  toggle: () => void
  setOpen: (v: boolean) => void
  setPinned: (v: boolean) => void
}

export const useSidebar = create<SidebarState>()(
  persist(
    (set) => ({
      open: true,
      pinned: true,
      toggle: () => set(s => ({ open: !s.open })),
      setOpen: (v) => set({ open: v }),
      setPinned: (v) => set({ pinned: v }),
    }),
    { name: 'sidebar-prefs' }
  )
)
