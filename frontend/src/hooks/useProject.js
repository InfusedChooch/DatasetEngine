import { create } from 'zustand'

export const useProjectStore = create((set, get) => ({
  currentProject: null,
  frames: [],
  filteredFrames: [],
  currentFilterMode: 'all',
  stats: null,
  currentFrameIndex: 0,
  annotations: {},
  selectedFrameIds: new Set(),
  
  setCurrentProject: (project) => set({ currentProject: project }),
  
  setFrames: (frames) => set({ frames, filteredFrames: frames }),
  
  setFilteredFrames: (filtered, mode) => set({ 
    filteredFrames: filtered, 
    currentFilterMode: mode,
    currentFrameIndex: 0
  }),
  
  setStats: (stats) => set({ stats }),
  
  setCurrentFrameIndex: (index) => set({ currentFrameIndex: index }),
  
  nextFrame: () => {
    const { currentFrameIndex, filteredFrames } = get()
    if (currentFrameIndex < filteredFrames.length - 1) {
      set({ currentFrameIndex: currentFrameIndex + 1 })
    }
  },
  
  prevFrame: () => {
    const { currentFrameIndex } = get()
    if (currentFrameIndex > 0) {
      set({ currentFrameIndex: currentFrameIndex - 1 })
    }
  },
  
  updateAnnotation: (frameId, data) => set((state) => ({
    annotations: { ...state.annotations, [frameId]: data }
  })),
  
  toggleFrameSelection: (frameId) => set((state) => {
    const newSet = new Set(state.selectedFrameIds)
    if (newSet.has(frameId)) {
      newSet.delete(frameId)
    } else {
      newSet.add(frameId)
    }
    return { selectedFrameIds: newSet }
  }),
  
  selectAllVisible: () => set((state) => ({
    selectedFrameIds: new Set(state.filteredFrames.map(f => f.frame_id))
  })),
  
  clearSelection: () => set({ selectedFrameIds: new Set() }),
  
  reset: () => set({
    currentProject: null,
    frames: [],
    filteredFrames: [],
    currentFilterMode: 'all',
    stats: null,
    currentFrameIndex: 0,
    annotations: {},
    selectedFrameIds: new Set()
  })
}))
