import { useState, useEffect } from 'react'
import { Filter, XCircle, AlertTriangle, CheckCircle, Grid3x3, Check } from 'lucide-react'
import { api } from '../lib/api'
import { useProjectStore } from '../hooks/useProject'
import { useNavigate } from 'react-router-dom'

export default function InferenceViewer() {
  const navigate = useNavigate()
  const { currentProject, filteredFrames, stats, selectedFrameIds } = useProjectStore()
  const { setFilteredFrames, setStats, toggleFrameSelection, selectAllVisible, clearSelection } = useProjectStore()
  
  const [filterMode, setFilterMode] = useState('all')
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.50)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (currentProject) {
      loadStats()
      loadFrames('all')
    }
  }, [currentProject])

  const loadStats = async () => {
    try {
      const { data } = await api.getImprovementStats(currentProject.project_id)
      setStats(data)
    } catch (err) {
      console.error('Failed to load stats:', err)
    }
  }

  const loadFrames = async (mode) => {
    if (!currentProject) return
    
    setLoading(true)
    try {
      const { data } = await api.filterFrames({
        project_id: currentProject.project_id,
        mode: mode,
        confidence_threshold: confidenceThreshold
      })
      setFilteredFrames(data.frames, mode)
      setFilterMode(mode)
    } catch (err) {
      console.error('Failed to filter frames:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleBulkMark = async () => {
    if (selectedFrameIds.size === 0) {
      alert('No frames selected')
      return
    }
    
    try {
      await api.bulkMarkImprovement(currentProject.project_id, Array.from(selectedFrameIds), true)
      alert(`Marked ${selectedFrameIds.size} frames for training`)
      clearSelection()
    } catch (err) {
      console.error('Failed to mark frames:', err)
    }
  }

  if (!currentProject) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-400 mb-4">No project loaded</p>
        <button
          onClick={() => navigate('/improve')}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg"
        >
          Create New Project
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">{currentProject.name}</h2>
          <p className="text-slate-400">Review model predictions and find issues</p>
        </div>
        {selectedFrameIds.size > 0 && (
          <button
            onClick={handleBulkMark}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-2"
          >
            <Check size={20} />
            Mark {selectedFrameIds.size} for Training
          </button>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Total Frames"
            value={stats.total_frames}
            icon={<Grid3x3 />}
            color="slate"
          />
          <StatCard
            label="No Detection"
            value={stats.no_detection}
            icon={<XCircle />}
            color="red"
            onClick={() => loadFrames('no_detection')}
          />
          <StatCard
            label="Low Confidence"
            value={stats.low_confidence}
            icon={<AlertTriangle />}
            color="yellow"
            onClick={() => loadFrames('low_confidence')}
          />
          <StatCard
            label="High Confidence"
            value={stats.high_confidence}
            icon={<CheckCircle />}
            color="green"
            onClick={() => loadFrames('high_confidence')}
          />
        </div>
      )}

      <div className="bg-slate-800/50 rounded-lg p-4 flex items-center gap-4">
        <Filter size={20} className="text-slate-400" />
        
        <div className="flex gap-2 flex-1">
          {['all', 'no_detection', 'low_confidence', 'high_confidence'].map((mode) => (
            <button
              key={mode}
              onClick={() => loadFrames(mode)}
              className={`px-4 py-2 rounded-lg transition-colors ${
                filterMode === mode
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {mode.replace('_', ' ').toUpperCase()}
            </button>
          ))}
        </div>

        {filterMode === 'low_confidence' && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Threshold:</span>
            <input
              type="range"
              min="0.2"
              max="0.8"
              step="0.05"
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
              className="w-32"
            />
            <span className="text-sm font-mono">{confidenceThreshold.toFixed(2)}</span>
          </div>
        )}

        <button
          onClick={selectedFrameIds.size > 0 ? clearSelection : selectAllVisible}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
        >
          {selectedFrameIds.size > 0 ? 'Clear' : 'Select All'}
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-slate-400">Loading frames...</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {filteredFrames.map((frame) => (
            <FrameCard
              key={frame.frame_id}
              frame={frame}
              projectId={currentProject.project_id}
              isSelected={selectedFrameIds.has(frame.frame_id)}
              onToggleSelect={() => toggleFrameSelection(frame.frame_id)}
              onEdit={() => navigate(`/improve/editor?frame=${frame.frame_id}`)}
            />
          ))}
        </div>
      )}

      {!loading && filteredFrames.length === 0 && (
        <div className="py-20 text-center text-slate-400">
          <p>No frames found with current filter</p>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon, color, onClick }) {
  const colors = {
    slate: 'bg-slate-800/50 hover:bg-slate-700/50',
    red: 'bg-red-900/20 hover:bg-red-900/30 border border-red-500/30',
    yellow: 'bg-yellow-900/20 hover:bg-yellow-900/30 border border-yellow-500/30',
    green: 'bg-green-900/20 hover:bg-green-900/30 border border-green-500/30'
  }

  return (
    <button
      onClick={onClick}
      className={`${colors[color]} rounded-lg p-4 text-left transition-colors`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-slate-400">{label}</span>
        {icon}
      </div>
      <div className="text-3xl font-bold">{value}</div>
    </button>
  )
}

function FrameCard({ frame, projectId, isSelected, onToggleSelect, onEdit }) {
  const imagePath = `http://localhost:8000/storage/projects/${projectId}/${frame.frame_path}`

  return (
    <div className={`relative group bg-slate-800/50 rounded-lg overflow-hidden ${
      isSelected ? 'ring-2 ring-blue-500' : ''
    }`}>
      <img
        src={imagePath}
        alt={`Frame ${frame.frame_id}`}
        className="w-full aspect-video object-cover"
      />
      
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono">Frame {frame.frame_id}</span>
            <div className="flex gap-2">
              <button
                onClick={onToggleSelect}
                className={`p-2 rounded ${isSelected ? 'bg-blue-600' : 'bg-slate-700'} hover:scale-110 transition-transform`}
              >
                <Check size={14} />
              </button>
              <button
                onClick={onEdit}
                className="p-2 bg-slate-700 hover:bg-slate-600 rounded hover:scale-110 transition-transform"
              >
                <Filter size={14} />
              </button>
            </div>
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {frame.boxes.length} detection{frame.boxes.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </div>
  )
}