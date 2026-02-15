import axios from 'axios'

const API_URL = 'http://localhost:8000/api'

export const api = {
  // --- ANALYZER (LOCAL) ---
  
  // Analyze the local dataset
  analyzeLocalDataset: (path) => {
    return axios.post(`${API_URL}/analyze/local`, { path })
  },
  
  // Opens Windows file selector
  browseFile: () => {
    return axios.get(`${API_URL}/analyze/browse`)
  },
  
  // Cleans duplicates
  cleanupDataset: (data) => {
    return axios.post(`${API_URL}/analyze/cleanup`, data)
  },
  
  // Helper to get the local image URL (not an axios call, returns string)
  getImageUrl: (localPath) => {
    if (!localPath) return '';
    return `${API_URL}/analyze/image?path=${encodeURIComponent(localPath)}`
  },

  // --- MERGER ---
// Retrieve dataset info (Master or Client)
  getDatasetInfo: (path) => axios.post(`${API_URL}/merge/info`, { path }),
  
  // Opens the folder selector for output
  browseFolder: () => axios.get(`${API_URL}/merge/browse_folder`),
  
  // Performs merge
  executeMerge: (data) => axios.post(`${API_URL}/merge/execute`, data),
  
  // --- MODEL IMPROVEMENT ---
  createImprovementProject: (formData) => 
    axios.post(`${API_URL}/improve/create`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }),
  
  runInference: (data) => 
    axios.post(`${API_URL}/improve/inference`, data),
  
  filterFrames: (data) => 
    axios.post(`${API_URL}/improve/filter`, data),
  
  getImprovementStats: (projectId) => 
    axios.get(`${API_URL}/improve/stats/${projectId}`),
  
  getImprovementFrame: (projectId, frameId) => 
    axios.get(`${API_URL}/improve/frame/${projectId}/${frameId}`),
  
  updateImprovementAnnotation: (projectId, data) => 
    axios.put(`${API_URL}/improve/annotate?project_id=${projectId}`, data),
  
  bulkMarkImprovement: (projectId, frameIds, include = true) => 
    axios.post(`${API_URL}/improve/bulk-mark?project_id=${projectId}&include=${include}`, frameIds),
  
  exportImprovement: (data) => 
    axios.post(`${API_URL}/improve/export`, data),
  
  listImprovementProjects: () => 
    axios.get(`${API_URL}/improve/list`),
  
  // --- VIDEO TO DATASET ---
  uploadVideo: (videoFile, modelFile) => {
    const formData = new FormData()
    formData.append('video', videoFile)
    formData.append('model', modelFile)
    return axios.post(`${API_URL}/video/upload`, formData)
  },
  
  processVideo: (data) => 
    axios.post(`${API_URL}/video/process`, data),
  
  getVideoFrame: (sessionId, frameId) => 
    axios.get(`${API_URL}/video/frame/${sessionId}/${frameId}`),
  
  updateVideoAnnotation: (data) => 
    axios.put(`${API_URL}/video/annotate`, data),
  
  exportVideo: (data) => 
    axios.post(`${API_URL}/video/export`, data),
  
  getVideoSession: (sessionId) => 
    axios.get(`${API_URL}/video/session/${sessionId}`)
}