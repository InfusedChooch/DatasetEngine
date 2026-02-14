import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2, Save, Download, Check, X, MousePointer2 } from 'lucide-react'
import { Stage, Layer, Image as KonvaImage, Rect, Transformer } from 'react-konva'
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
  const [saving, setSaving] = useState(false)

  // Load Frame Data
  useEffect(() => {
    const frameParam = searchParams.get('frame')
    if (frameParam && currentProject) {
      loadFrame(parseInt(frameParam))
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
      setSelectedBoxId(null)
    } catch (err) {
      console.error('Failed to load frame:', err)
    }
  }

  // Auto-Save Logic
  const saveAnnotation = async (silent = false) => {
    if (!currentFrame || !currentProject) return
    setSaving(true)
    try {
      await api.updateImprovementAnnotation(currentProject.project_id, {
        frame_id: currentFrame.frame_id,
        boxes: boxes,
        include_in_training: includeInTraining
      })
      if(!silent) alert('Annotations saved successfully!')
    } catch (err) {
      console.error('Failed to save:', err)
      if(!silent) alert('Failed to save annotations.')
    } finally {
      setSaving(false)
    }
  }

  const handleNext = async () => {
      await saveAnnotation(true); // Silent Auto-save
      nextFrame();
  }

  const handlePrev = async () => {
      await saveAnnotation(true); // Silent Auto-save
      prevFrame();
  }

  const deleteBox = (index) => {
    setBoxes(boxes.filter((_, i) => i !== index))
    setSelectedBoxId(null)
  }

  const handleExport = async () => {
    if (!currentProject) return
    const outputName = prompt('Enter final dataset folder name:', `${currentProject.name}_improved`)
    if (!outputName) return
    
    try {
      const { data } = await api.exportImprovement({
        project_id: currentProject.project_id,
        output_name: outputName,
        include_all: false
      })
      alert(`Success! ${data.message}\nSaved at: ${data.output_path}`)
    } catch (err) {
      alert(err.response?.data?.detail || 'Export failed')
    }
  }

  // Keyboard Shortcuts
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowRight') handleNext()
    else if (e.key === 'ArrowLeft') handlePrev()
    else if (e.key === 's' && e.ctrlKey) {
      e.preventDefault()
      saveAnnotation()
    }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBoxId !== null) {
      deleteBox(selectedBoxId)
    }
  }, [selectedBoxId, boxes, includeInTraining, currentFrame]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!currentProject) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-400">No project loaded</p>
        <button onClick={() => navigate('/improve')} className="mt-4 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-bold">Go to Setup</button>
      </div>
    )
  }

  if (!currentFrame) return <div className="text-center py-20 text-slate-400">Loading frame...</div>

  const imagePath = `http://localhost:8000/storage/projects/${currentProject.project_id}/${currentFrame.frame_path}`

  return (
    <div className="h-[calc(100vh-120px)] flex gap-6">
      {/* LEFT: CANVAS */}
      <div className="flex-1 flex flex-col">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex-1 flex flex-col shadow-xl">
          
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
                <h3 className="text-xl font-bold text-white">Frame {currentFrame.frame_id}</h3>
                {saving && <span className="text-xs text-blue-400 animate-pulse">Auto-saving...</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => saveAnnotation(false)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 font-bold transition-colors">
                <Save size={16} /> Save (Ctrl+S)
              </button>
              <button onClick={handleExport} className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white rounded-lg flex items-center gap-2 font-bold shadow-lg shadow-green-500/20">
                <Download size={16} /> Export Dataset
              </button>
            </div>
          </div>

          <div className="flex-1 bg-black rounded-lg border border-slate-700 overflow-hidden flex items-center justify-center relative">
            <AnnotationCanvas
              imagePath={imagePath}
              boxes={boxes}
              setBoxes={setBoxes}
              selectedBoxId={selectedBoxId}
              onSelectBox={setSelectedBoxId}
            />
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-4 mt-4 bg-slate-900 p-2 rounded-lg border border-slate-700">
            <button onClick={handlePrev} disabled={currentFrameIndex === 0} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 disabled:opacity-30 font-bold flex items-center gap-2">
              <ChevronLeft size={20} /> Prev
            </button>
            <div className="flex-1 text-center font-mono text-slate-400">
              {currentFrameIndex + 1} / {filteredFrames.length}
            </div>
            <button onClick={handleNext} disabled={currentFrameIndex === filteredFrames.length - 1} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 disabled:opacity-30 font-bold flex items-center gap-2">
              Next <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: SIDEBAR */}
      <div className="w-80 space-y-4">
        
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <h3 className="font-bold text-white mb-3 text-sm uppercase tracking-wider">Training Status</h3>
          <button
            onClick={() => setIncludeInTraining(!includeInTraining)}
            className={`w-full py-4 rounded-lg flex items-center justify-center gap-2 font-bold transition-all ${
              includeInTraining ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-slate-700 hover:bg-slate-600 text-slate-400'
            }`}
          >
            {includeInTraining ? <Check size={20} /> : <X size={20} />}
            {includeInTraining ? 'Included in Training' : 'Excluded (Skip)'}
          </button>
          <p className="text-xs text-slate-500 mt-2 text-center">Frames must be included to be exported.</p>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex-1">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-white text-sm uppercase tracking-wider">Detections ({boxes.length})</h3>
            <button onClick={() => alert("Drawing new boxes coming soon! For now, adjust existing ones.")} className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors" title="Add detection">
              <Plus size={16} />
            </button>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar pr-2">
            {boxes.map((box, i) => (
              <div
                key={i}
                onClick={() => setSelectedBoxId(i)}
                className={`p-3 rounded-lg cursor-pointer border transition-all ${
                  selectedBoxId === i ? 'bg-blue-900/40 border-blue-500' : 'bg-slate-900 border-slate-700 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-200">{box.class_name} <span className="text-xs font-normal text-slate-500">(ID: {box.class_id})</span></div>
                    <div className="text-xs font-mono mt-1 text-slate-400">Conf: {(box.confidence * 100).toFixed(1)}%</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteBox(i); }} className="p-2 hover:bg-red-500/20 rounded text-slate-500 hover:text-red-400 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {boxes.length === 0 && <div className="text-center text-slate-500 py-4 text-sm">No detections found.</div>}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm">
          <h3 className="font-bold text-slate-300 mb-3 flex items-center gap-2"><MousePointer2 size={16}/> Shortcuts</h3>
          <div className="space-y-2 text-slate-400 font-mono text-xs">
            <div className="flex justify-between"><span>← / →</span><span>Next/Prev Frame</span></div>
            <div className="flex justify-between"><span>Ctrl + S</span><span>Save</span></div>
            <div className="flex justify-between"><span>Delete</span><span>Remove Box</span></div>
            <div className="flex justify-between"><span>Click & Drag</span><span>Move/Resize Box</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Konva Canvas Component
function AnnotationCanvas({ imagePath, boxes, setBoxes, selectedBoxId, onSelectBox }) {
  const stageRef = useRef(null)
  const [image] = useImage(imagePath)
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })

  useEffect(() => {
    if (image) {
      const container = stageRef.current?.container()?.parentElement
      if (container) {
        const aspectRatio = image.width / image.height
        let width = container.clientWidth
        let height = width / aspectRatio
        if (height > container.clientHeight) {
            height = container.clientHeight
            width = height * aspectRatio
        }
        setStageSize({ width, height })
      }
    }
  }, [image])

  // Allows dragging to resize and move boxes
  const handleDragEnd = (e, index) => {
      const newBoxes = [...boxes];
      newBoxes[index].x_center = (e.target.x() + e.target.width() / 2) / stageSize.width;
      newBoxes[index].y_center = (e.target.y() + e.target.height() / 2) / stageSize.height;
      setBoxes(newBoxes);
  };

  const handleTransformEnd = (e, index) => {
      const node = e.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      
      const newBoxes = [...boxes];
      newBoxes[index].width = (node.width() * scaleX) / stageSize.width;
      newBoxes[index].height = (node.height() * scaleY) / stageSize.height;
      newBoxes[index].x_center = (node.x() + (node.width() * scaleX) / 2) / stageSize.width;
      newBoxes[index].y_center = (node.y() + (node.height() * scaleY) / 2) / stageSize.height;
      setBoxes(newBoxes);
  };

  return (
    <Stage ref={stageRef} width={stageSize.width} height={stageSize.height} onMouseDown={(e) => { if(e.target === e.target.getStage()) onSelectBox(null) }}>
      <Layer>
        {image && <KonvaImage image={image} width={stageSize.width} height={stageSize.height} />}
        
        {boxes.map((box, i) => {
          const x = (box.x_center - box.width / 2) * stageSize.width
          const y = (box.y_center - box.height / 2) * stageSize.height
          const w = box.width * stageSize.width
          const h = box.height * stageSize.height

          return (
            <BoundingBoxShape
                key={i}
                shapeProps={{ x, y, width: w, height: h }}
                isSelected={i === selectedBoxId}
                onSelect={() => onSelectBox(i)}
                onChange={(newProps) => {
                    // Update state is handled by drag/transform end for performance
                }}
                onDragEnd={(e) => handleDragEnd(e, i)}
                onTransformEnd={(e) => handleTransformEnd(e, i)}
            />
          )
        })}
      </Layer>
    </Stage>
  )
}

const BoundingBoxShape = ({ shapeProps, isSelected, onSelect, onDragEnd, onTransformEnd }) => {
  const shapeRef = useRef();
  const trRef = useRef();

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  return (
    <>
      <Rect
        onClick={onSelect}
        onTap={onSelect}
        ref={shapeRef}
        {...shapeProps}
        draggable={isSelected}
        onDragEnd={onDragEnd}
        onTransformEnd={onTransformEnd}
        stroke={isSelected ? '#3b82f6' : '#10b981'}
        strokeWidth={isSelected ? 3 : 2}
        fill={isSelected ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.05)'}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 5 || newBox.height < 5) return oldBox;
            return newBox;
          }}
        />
      )}
    </>
  );
};