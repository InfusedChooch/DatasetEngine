import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2, Save, Download, Check, X } from 'lucide-react'
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva'
import { api } from '../lib/api'
import { useProjectStore } from '../hooks/useProject'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useImage from 'use-image'

export default function AnnotationEditor() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { currentProject, filteredFrames, currentFrameIndex } = useProjectStore()
  const { setCurrentFrameIndex, nextFrame, prevFrame } = useProjectStore()
  
  const [currentFrame, setCurrentFrame] = useState(null)
  const [boxes, setBoxes] = useState([])
  const [selectedBoxId, setSelectedBoxId] = useState(null)
  const [includeInTraining, setIncludeInTraining] = useState(false)

  useEffect(() => {
    const frameParam = searchParams.get('frame')
    if (frameParam && currentProject) {
      const frameId = parseInt(frameParam)
      loadFrame(frameId)
    } else if (filteredFrames.length > 0) {
      loadFrame(filteredFrames[currentFrameIndex].frame_id)
    }
  }, [currentFrameIndex, searchParams, currentProject])

  const loadFrame = async (frameId) => {
    if (!currentProject) return
    
    try {
      const { data } = await api.getImprovementFrame(currentProject.project_id, frameId)
      setCurrentFrame(data)
      setBoxes(data.boxes)
      setIncludeInTraining(data.include_in_training)
    } catch (err) {
      console.error('Failed to load frame:', err)
    }
  }

  const saveAnnotation = async () => {
    if (!currentFrame || !currentProject) return
    
    try {
      await api.updateImprovementAnnotation(currentProject.project_id, {
        frame_id: currentFrame.frame_id,
        boxes: boxes,
        include_in_training: includeInTraining
      })
      alert('Saved!')
    } catch (err) {
      console.error('Failed to save:', err)
    }
  }

  const deleteBox = (index) => {
    setBoxes(boxes.filter((_, i) => i !== index))
    setSelectedBoxId(null)
  }

  const handleExport = async () => {
    if (!currentProject) return
    
    const outputName = prompt('Enter dataset name:', `${currentProject.name}_improved`)
    if (!outputName) return
    
    try {
      const { data } = await api.exportImprovement({
        project_id: currentProject.project_id,
        output_name: outputName,
        include_all: false
      })
      alert(data.message)
    } catch (err) {
      alert(err.response?.data?.detail || 'Export failed')
    }
  }

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight') nextFrame()
      else if (e.key === 'ArrowLeft') prevFrame()
      else if (e.key === 's' && e.ctrlKey) {
        e.preventDefault()
        saveAnnotation()
      }
      else if (e.key === 'Delete' && selectedBoxId !== null) {
        deleteBox(selectedBoxId)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedBoxId, boxes])

  if (!currentProject) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-400">No project loaded</p>
        <button
          onClick={() => navigate('/improve')}
          className="mt-4 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg"
        >
          Go to Project Setup
        </button>
      </div>
    )
  }

  if (!currentFrame) {
    return <div className="text-center py-20 text-slate-400">Loading frame...</div>
  }

  const imagePath = `http://localhost:8000/storage/projects/${currentProject.project_id}/${currentFrame.frame_path}`

  return (
    <div className="h-[calc(100vh-120px)] flex gap-6">
      <div className="flex-1 flex flex-col">
        <div className="bg-slate-800/50 rounded-lg p-4 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Frame {currentFrame.frame_id}</h3>
            <div className="flex gap-2">
              <button
                onClick={saveAnnotation}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-2"
              >
                <Save size={16} />
                Save (Ctrl+S)
              </button>
              <button
                onClick={handleExport}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-2"
              >
                <Download size={16} />
                Export Dataset
              </button>
            </div>
          </div>

          <div className="flex-1 bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center">
            <AnnotationCanvas
              imagePath={imagePath}
              boxes={boxes}
              selectedBoxId={selectedBoxId}
              onSelectBox={setSelectedBoxId}
            />
          </div>

          <div className="flex items-center gap-4 mt-4">
            <button
              onClick={prevFrame}
              disabled={currentFrameIndex === 0}
              className="p-2 bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-30"
            >
              <ChevronLeft size={20} />
            </button>
            
            <div className="flex-1 text-center text-sm text-slate-400">
              Frame {currentFrameIndex + 1} of {filteredFrames.length}
            </div>
            
            <button
              onClick={nextFrame}
              disabled={currentFrameIndex === filteredFrames.length - 1}
              className="p-2 bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-30"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="w-80 space-y-4">
        <div className="bg-slate-800/50 rounded-lg p-4">
          <h3 className="font-semibold mb-3">Training Status</h3>
          <button
            onClick={() => setIncludeInTraining(!includeInTraining)}
            className={`w-full py-3 rounded-lg flex items-center justify-center gap-2 font-medium ${
              includeInTraining
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-slate-700 hover:bg-slate-600'
            }`}
          >
            {includeInTraining ? <Check size={18} /> : <X size={18} />}
            {includeInTraining ? 'Include in Training' : 'Excluded'}
          </button>
        </div>

        <div className="bg-slate-800/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Detections ({boxes.length})</h3>
            <button
              className="p-1 bg-blue-600 hover:bg-blue-700 rounded"
              title="Add detection (coming soon)"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {boxes.map((box, i) => (
              <div
                key={i}
                onClick={() => setSelectedBoxId(i)}
                className={`p-3 rounded-lg cursor-pointer ${
                  selectedBoxId === i
                    ? 'bg-blue-600'
                    : 'bg-slate-700/50 hover:bg-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{box.class_name}</div>
                    <div className="text-xs text-slate-400">
                      Conf: {(box.confidence * 100).toFixed(1)}%
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteBox(i)
                    }}
                    className="p-1 hover:bg-red-500/20 rounded"
                  >
                    <Trash2 size={14} className="text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-800/50 rounded-lg p-4 text-sm">
          <h3 className="font-semibold mb-2">Shortcuts</h3>
          <div className="space-y-1 text-slate-400">
            <div>← → Navigate frames</div>
            <div>Ctrl+S Save</div>
            <div>Delete Remove box</div>
            <div>Click Select box</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AnnotationCanvas({ imagePath, boxes, selectedBoxId, onSelectBox }) {
  const stageRef = useRef(null)
  const [image] = useImage(imagePath)
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })

  useEffect(() => {
    if (image) {
      const aspectRatio = image.width / image.height
      const maxWidth = 800
      const width = maxWidth
      const height = width / aspectRatio
      setStageSize({ width, height })
    }
  }, [image])

  return (
    <Stage ref={stageRef} width={stageSize.width} height={stageSize.height}>
      <Layer>
        {image && <KonvaImage image={image} width={stageSize.width} height={stageSize.height} />}
        
        {boxes.map((box, i) => {
          const x = (box.x_center - box.width / 2) * stageSize.width
          const y = (box.y_center - box.height / 2) * stageSize.height
          const w = box.width * stageSize.width
          const h = box.height * stageSize.height

          return (
            <Rect
              key={i}
              x={x}
              y={y}
              width={w}
              height={h}
              stroke={selectedBoxId === i ? '#3b82f6' : '#10b981'}
              strokeWidth={2}
              onClick={() => onSelectBox(i)}
            />
          )
        })}
      </Layer>
    </Stage>
  )
}