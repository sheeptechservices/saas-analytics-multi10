'use client'
import { create } from 'zustand'

interface UserState {
  name: string
  photoUrl: string | null
  setName: (name: string) => void
  setPhotoUrl: (url: string | null) => void
  init: (name: string, photoUrl: string | null) => void
}

export const useUser = create<UserState>()((set) => ({
  name: '',
  photoUrl: null,
  setName: (name) => set({ name }),
  setPhotoUrl: (photoUrl) => set({ photoUrl }),
  init: (name, photoUrl) => set({ name, photoUrl }),
}))
