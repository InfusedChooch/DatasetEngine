import { useState } from 'react'
import { Upload, Youtube, Play, Target } from 'lucide-react'
import { api } from '../lib/api'
import { useProjectStore } from '../hooks/useProject'
import { useNavigate } from 'react-router-dom'

export default function ImprovementSetup() {
  const navigate = useNavigate()
  const setCurrentProject = useProjectStore(s => s.setCurrentProject)
  
  const [formData, setFormData] = useState({
    name: '',
    model: null,
    video: null,
    youtubeUrl: '',
    samplingRate: 30,
    sourceType: 'video'
  })
  
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setProgress('Creating project...')

    try {
      const formDataToSend = new FormData()
      formDataToSend.append('name', formData.name)
      formDataToSend.append('model', formData.model)
      formDataToSend.append('sampling_rate', formData.samplingRate)
      
      if (formData.sourceType === 'youtube') {
        formDataToSend.append('youtube_url', formData.youtubeUrl)
      } else {
        formDataToSend.append('video', formData.video)
      }

      setProgress('Uploading and extracting frames...')
      const { data: project } = await api.createImprovementProject(formDataToSend)
      
      setProgress('Running model inference...')
      await api.runInference({
        project_id: project.project_id,
        confidence: 0.25,
        sampling_rate: formData.samplingRate
      })
      
      setCurrentProject(project)
      setProgress('Complete!')
      
      setTimeout(() => navigate('/improve/viewer'), 1000)
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to create project')
      setProgress(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 mb-4">
          <Target size={32} />
        </div>
        <h2 className="text-4xl font-bold mb-3">Model Improvement</h2>
        <p className="text-lg text-slate-400">
          Find where your model fails, fix it with human expertise
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <InfoCard 
          emoji="❌" 
          label="Find Failures"
          description="No detections"
        />
        <InfoCard 
          emoji="⚠️" 
          label="Review Uncertain"
          description="Low confidence"
        />
        <InfoCard 
          emoji="✅" 
          label="Verify Correct"
          description="High confidence"
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-slate-800/50 rounded-lg p-6">
          <label className="block text-sm font-medium mb-2">Project Name</label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Basketball Detection v2"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3"
          />
        </div>

        <div className="bg-slate-800/50 rounded-lg p-6">
          <label className="block text-sm font-medium mb-2">YOLO Model (.pt)</label>
          <label className="cursor-pointer w-full flex items-center justify-center gap-3 py-12 border-2 border-dashed border-slate-700 rounded-lg hover:border-blue-500 transition-colors">
            <Upload size={24} />
            <span>{formData.model ? formData.model.name : 'Choose model file'}</span>
            <input
              type="file"
              required
              accept=".pt,.onnx"
              onChange={(e) => setFormData({ ...formData, model: e.target.files[0] })}
              className="hidden"
            />
          </label>
        </div>

        <div className="bg-slate-800/50 rounded-lg p-6">
          <label className="block text-sm font-medium mb-4">Test Data Source</label>
          
          <div className="flex gap-4 mb-4">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, sourceType: 'video' })}
              className={`flex-1 py-3 rounded-lg flex items-center justify-center gap-2 ${
                formData.sourceType === 'video' 
                  ? 'bg-blue-600' 
                  : 'bg-slate-700/50'
              }`}
            >
              <Upload size={18} />
              Video File
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, sourceType: 'youtube' })}
              className={`flex-1 py-3 rounded-lg flex items-center justify-center gap-2 ${
                formData.sourceType === 'youtube' 
                  ? 'bg-red-600' 
                  : 'bg-slate-700/50'
              }`}
            >
              <Youtube size={18} />
              YouTube URL
            </button>
          </div>

          {formData.sourceType === 'video' ? (
            <label className="cursor-pointer w-full flex items-center justify-center gap-3 py-8 border-2 border-dashed border-slate-700 rounded-lg hover:border-blue-500 transition-colors">
              <Play size={20} />
              <span>{formData.video ? formData.video.name : 'Choose video file'}</span>
              <input
                type="file"
                accept=".mp4,.avi,.mov,.mkv"
                onChange={(e) => setFormData({ ...formData, video: e.target.files[0] })}
                className="hidden"
              />
            </label>
          ) : (
            <input
              type="url"
              value={formData.youtubeUrl}
              onChange={(e) => setFormData({ ...formData, youtubeUrl: e.target.value })}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3"
            />
          )}
        </div>

        <div className="bg-slate-800/50 rounded-lg p-6">
          <label className="block text-sm font-medium mb-2">
            Frame Sampling (1 frame every {formData.samplingRate} frames)
          </label>
          <input
            type="range"
            min="10"
            max="60"
            step="10"
            value={formData.samplingRate}
            onChange={(e) => setFormData({ ...formData, samplingRate: parseInt(e.target.value) })}
            className="w-full"
          />
          <div className="flex justify-between text-sm text-slate-400 mt-2">
            <span>More frames</span>
            <span>Fewer frames</span>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !formData.model || (!formData.video && !formData.youtubeUrl)}
          className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 rounded-lg font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              {progress}
            </span>
          ) : (
            'Start Analysis'
          )}
        </button>
      </form>

      <div className="mt-8 bg-blue-900/20 border border-blue-500/30 rounded-lg p-6">
        <h3 className="font-semibold text-blue-300 mb-3">📋 What happens next?</h3>
        <ol className="text-sm text-slate-300 space-y-2">
          <li className="flex gap-2">
            <span className="text-blue-400">1.</span>
            <span>Extract frames from your test video</span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-400">2.</span>
            <span>Run your model inference on all frames</span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-400">3.</span>
            <span>Categorize results by confidence (no detection / low / high)</span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-400">4.</span>
            <span>Review and annotate problematic frames</span>
          </li>
          <li className="flex gap-2">
            <span className="text-blue-400">5.</span>
            <span>Export curated dataset for retraining</span>
          </li>
        </ol>
      </div>
    </div>
  )
}

function InfoCard({ emoji, label, description }) {
  return (
    <div className="bg-slate-800/30 rounded-lg p-4 text-center">
      <div className="text-3xl mb-2">{emoji}</div>
      <div className="font-semibold text-sm">{label}</div>
      <div className="text-xs text-slate-400">{description}</div>
    </div>
  )
}