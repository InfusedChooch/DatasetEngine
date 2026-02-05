import { create } from 'zustand'

export const useDatasetStore = create((set) => ({
  currentDataset: null,
  stats: null,
  datasets: [],
  mappings: [],
  
  setCurrentDataset: (dataset) => set({ currentDataset: dataset }),
  setStats: (stats) => set({ stats }),
  
  addDataset: (dataset) => set((state) => ({
    datasets: [...state.datasets, dataset]
  })),
  
  setMappings: (mappings) => set({ mappings }),
  
  reset: () => set({
    currentDataset: null,
    stats: null,
    datasets: [],
    mappings: []
  })
}))