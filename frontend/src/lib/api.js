import axios from 'axios'

const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').trim()
const BASE_URL = rawBaseUrl.replace(/\/+$/, '')
const API_URL = `${BASE_URL}/api`

const client = axios.create({
  baseURL: API_URL
})

const toApiUrl = (path) => `${API_URL}${path}`

const toStorageUrl = (relativePath) => {
  if (!relativePath) return ''
  const clean = String(relativePath).replace(/^[\\/]+/, '').replace(/\\/g, '/')
  return `${BASE_URL}/storage/${clean}`
}

const toWebSocketBase = () => {
  const wsProto = BASE_URL.startsWith('https://') ? 'wss://' : 'ws://'
  return `${wsProto}${BASE_URL.replace(/^https?:\/\//, '')}`
}

export const api = {
  BASE_URL,
  API_URL,

  // Analyzer
  browseFile: () => client.get('/analyze/browse'),
  browseAnalyzeOutputFolder: () => client.get('/analyze/browse_folder'),
  analyzeLocalDataset: (path) => client.post('/analyze/local', { path }),
  createAnalyzeLocalStream: (payload) =>
    fetch(toApiUrl('/analyze/local'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }),
  createAnalyzeResplitStream: (payload) =>
    fetch(toApiUrl('/analyze/resplit'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }),
  cleanupDataset: (data) => client.post('/analyze/cleanup', data),
  getImageUrl: (localPath) =>
    localPath ? `${API_URL}/analyze/image?path=${encodeURIComponent(localPath)}` : '',

  // Viewer
  browseViewerYaml: () => client.get('/viewer/browse_yaml'),
  loadViewerDataset: (path) => client.post('/viewer/load', { path }),
  queryViewerImages: (payload) => client.post('/viewer/query', payload),
  getViewerImageUrl: (localPath) =>
    localPath ? `${API_URL}/viewer/image?path=${encodeURIComponent(localPath)}` : '',

  // Merger
  getDatasetInfo: (path) => client.post('/merge/info', { path }),
  browseFolder: () => client.get('/merge/browse_folder'),
  executeMerge: (data) => client.post('/merge/execute', data),
  createMergeStream: (payload) =>
    fetch(toApiUrl('/merge/execute'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }),

  // Model Improvement
  browseImprovementModel: () => client.get('/improve/browse_model'),
  browseImprovementVideo: () => client.get('/improve/browse_video'),
  browseImprovementFolder: () => client.get('/improve/browse_folder'),
  createImprovementStream: (payload) =>
    fetch(toApiUrl('/improve/create_stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }),
  filterFrames: (data) => client.post('/improve/filter', data),
  getImprovementStats: (projectId) => client.get(`/improve/stats/${projectId}`),
  getImprovementFrame: (projectId, frameId) => client.get(`/improve/frame/${projectId}/${frameId}`),
  updateImprovementAnnotation: (projectId, data) =>
    client.put(`/improve/annotate?project_id=${projectId}`, data),
  bulkMarkImprovement: (projectId, frameIds, include = true) =>
    client.post(`/improve/bulk-mark?project_id=${projectId}&include=${include}`, frameIds),
  exportImprovement: (data) => client.post('/improve/export', data),
  listImprovementProjects: () => client.get('/improve/list'),
  getStorageUrl: (relativePath) => toStorageUrl(relativePath),

  // Trainer
  getTrainingPickers: () => client.get('/training/pickers'),
  browseTraining: (kind) => client.get('/training/browse', { params: { kind } }),
  createTrainingStream: (payload) =>
    fetch(toApiUrl('/training/create_stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }),
  stopTrainingJob: () => client.post('/training/stop'),
  getTrainingStatus: () => client.get('/training/status'),
  getTrainingHistory: (limit = 50) => client.get('/training/history', { params: { limit } }),

  // Live Inference
  startLiveSession: (payload) => client.post('/live/session/start', payload),
  stopLiveSession: (sessionId = '') => client.post('/live/session/stop', { session_id: sessionId }),
  getLiveStatus: () => client.get('/live/session/status'),
  captureLiveFrame: (payload) => client.post('/live/session/capture', payload),
  sendLiveScreenFrame: (payload) => client.post('/live/session/frame', payload),
  getLiveEventsWsUrl: (sessionId) =>
    `${toWebSocketBase()}/api/live/session/${encodeURIComponent(sessionId)}/events`
}
