'use client'
import { create } from 'zustand'
import type { LeadWithExtras, StageWithLeads } from '@/types'

interface PipelineState {
  selectedLeadId: string | null
  selectedPipelineId: string | null
  searchQuery: string
  stages: StageWithLeads[]
  setSelectedLead: (id: string | null) => void
  setSelectedPipeline: (id: string | null) => void
  setSearchQuery: (q: string) => void
  setStages: (stages: StageWithLeads[]) => void
  updateLeadExtras: (leadId: string, extras: Partial<LeadWithExtras['extras']>) => void
}

export const usePipeline = create<PipelineState>((set) => ({
  selectedLeadId: null,
  selectedPipelineId: null,
  searchQuery: '',
  stages: [],
  setSelectedLead: (id) => set({ selectedLeadId: id }),
  setSelectedPipeline: (id) => set({ selectedPipelineId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setStages: (stages) => set({ stages }),
  updateLeadExtras: (leadId, extras) =>
    set((state) => ({
      stages: state.stages.map((stage) => ({
        ...stage,
        leads: stage.leads.map((lead) =>
          lead.id === leadId ? { ...lead, extras: { ...lead.extras, ...extras } as any } : lead
        ),
      })),
    })),
}))
