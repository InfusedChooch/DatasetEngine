import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2, Save, Download, Check, X, MousePointer2, ZoomIn, ZoomOut, Move, Square, ArrowLeft, FolderOpen, CheckCircle2, AlertCircle } from 'lucide-react'
import { Stage, Layer, Image as KonvaImage, Rect, Transformer } from 'react-konva'
import { api } from '../lib/api'
import { useProjectStore } from '../hooks/useProject'
import { useNavigate } from 'react-router-dom'
import useImage from 'use-image'

export default function AnnotationEditor() {
  const navigate = useNavigate()
  const { currentProject, filteredFrames, selectedFrameIds } = useProjectStore()
  
  // --- SCOPE & NAVIGATION ---
  // Scegli tra "Solo Flaggate" o "Tutte"
  const [viewScope, setViewScope] = useState(selectedFrameIds.size > 0 ? 'flagged' : 'all')
  const activeFrames = useMemo(() => {
      return viewScope === 'flagged' 
        ? filteredFrames.filter(f => selectedFrameIds.has(f.frame_id))
        : filteredFrames;
  }, [viewScope, filteredFrames, selectedFrameIds])

  const [localIndex, setLocalIndex] = useState(0)
  
  // Ricarica frame se cambia scope o indice
  useEffect(() => {
      if(activeFrames.length > 0) {
          const validIndex = Math.min(localIndex, activeFrames.length - 1)
          if(localIndex !== validIndex) setLocalIndex(validIndex)
          else loadFrame(activeFrames[validIndex].frame_id)
      } else {
          setCurrentFrame(null)
          setBoxes([])
      }
  }, [localIndex, activeFrames])


  // --- STATE ---
  const [currentFrame, setCurrentFrame] = useState(null)
  const [boxes, setBoxes] = useState([])
  const [selectedBoxId, setSelectedBoxId] = useState(null)
  const [includeInTraining, setIncludeInTraining] = useState(false)
  
  // UI & Tools
  const [saving, setSaving] = useState(false)
  const [drawMode, setDrawMode] = useState(false)
  const [newBoxClassId, setNewBoxClassId] = useState(0)
  
  // Notifications & Modals
  const [notification, setNotification] = useState(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportPath, setExportPath] = useState('')

  const showToast = (msg, type = 'success') => {
      setNotification({ msg, type })
      setTimeout(() => setNotification(null), 3000)
  }

  // --- API LOGIC ---
  const loadFrame = async (frameId) => {
    if (!currentProject) return
    try {
      const { data } = await api.getImprovementFrame(currentProject.project_id, frameId)
      setCurrentFrame(data)
      setBoxes(data.boxes)
      setIncludeInTraining(data.include_in_training)
      setSelectedBoxId(null)
      setDrawMode(false) // Exit draw mode on new frame
    } catch (err) { console.error('Failed to load frame:', err) }
  }

  const saveAnnotation = async (silent = false) => {
    if (!currentFrame || !currentProject) return
    setSaving(true)
    try {
      await api.updateImprovementAnnotation(currentProject.project_id, {
        frame_id: currentFrame.frame_id,
        boxes: boxes,
        include_in_training: includeInTraining
      })
      if(!silent) showToast('Annotations saved successfully!')
    } catch (err) {
      if(!silent) showToast('Failed to save annotations.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleNext = async () => {
      if(activeFrames.length === 0) return;
      await saveAnnotation(true); 
      setLocalIndex(p => Math.min(activeFrames.length - 1, p + 1));
  }

  const handlePrev = async () => {
      if(activeFrames.length === 0) return;
      await saveAnnotation(true); 
      setLocalIndex(p => Math.max(0, p - 1));
  }

  const deleteBox = (index) => {
    setBoxes(boxes.filter((_, i) => i !== index))
    setSelectedBoxId(null)
    setIncludeInTraining(true) 
  }

  const handleBrowseExport = async () => {
      try { 
          const res = await fetch('http://localhost:8000/api/improve/browse_folder');
          const data = await res.json();
          if(data.path) setExportPath(data.path);
      } catch(e) { console.error(e); }
  }

  const handleExport = async () => {
    if (!currentProject || !exportPath) return showToast("Select an export folder.", "error")
    try {
      const { data } = await api.exportImprovement({
        project_id: currentProject.project_id,
        output_name: exportPath, // Inviato come path assoluto
        include_all: false
      })
      showToast(`Saved at: ${data.output_path}`, "success")
      setExportModalOpen(false)
    } catch (err) {
      showToast(err.response?.data?.detail || 'Export failed', 'error')
    }
  }

  // --- KEYBOARD SHORTCUTS ---
  const handleKeyDown = useCallback((e) => {
    if (exportModalOpen) return; // Disabilita shortcut se c'è la modale
    if (e.key === 'ArrowRight') handleNext()
    else if (e.key === 'ArrowLeft') handlePrev()
    else if (e.key === 's' && e.ctrlKey) {
      e.preventDefault()
      saveAnnotation()
    }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBoxId !== null) {
      deleteBox(selectedBoxId)
    }
    else if (e.key === 'd') setDrawMode(p => !p)
  }, [selectedBoxId, boxes, includeInTraining, currentFrame, exportModalOpen, localIndex, activeFrames]);

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

  const imagePath = currentFrame ? `http://localhost:8000/storage/projects/${currentProject.project_id}/${currentFrame.frame_path}` : null;

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col gap-4 relative">
      
      {/* TOAST NOTIFICATION */}
      {notification && (
          <div className={`fixed top-4 right-4 z-[9999] px-6 py-4 rounded-lg shadow-2xl border flex items-center gap-3 animate-in slide-in-from-right duration-300 ${
              notification.type === 'error' ? 'bg-red-900/90 border-red-500 text-white' : 'bg-emerald-900/90 border-emerald-500 text-white'
          }`}>
              {notification.type === 'error' ? <AlertCircle /> : <CheckCircle2 />}
              <span className="font-bold">{notification.msg}</span>
          </div>
      )}

      {/* TOP HEADER */}
      <div className="flex items-center justify-between bg-slate-800/80 p-4 rounded-xl border border-slate-700">
          <div className="flex items-center gap-6">
              <button onClick={() => navigate('/improve/viewer')} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                  <ArrowLeft size={20}/> Back to Fast Review
              </button>
              <div className="h-6 w-px bg-slate-700"></div>
              
              {/* SCOPE TOGGLE */}
              <div className="flex items-center gap-2 bg-slate-900 rounded-lg p-1 border border-slate-700">
                  <button onClick={()=>setViewScope('flagged')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${viewScope==='flagged' ? 'bg-red-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>
                      Fix Flagged ({selectedFrameIds.size})
                  </button>
                  <button onClick={()=>setViewScope('all')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${viewScope==='all' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>
                      All Frames ({filteredFrames.length})
                  </button>
              </div>
          </div>
          <div className="flex items-center gap-3">
              {saving && <span className="text-sm font-mono text-blue-400 animate-pulse mr-4">Auto-saving...</span>}
              <button onClick={() => saveAnnotation(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center gap-2 font-bold transition-colors">
                  <Save size={16} /> Save
              </button>
              <button onClick={() => setExportModalOpen(true)} className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white rounded-lg flex items-center gap-2 font-bold shadow-lg shadow-green-500/20">
                  <Download size={16} /> Export Dataset
              </button>
          </div>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
          {/* LEFT: CANVAS AREA */}
          <div className="flex-1 bg-black rounded-xl border border-slate-700 relative overflow-hidden flex flex-col shadow-inner">
              
              {/* Toolbar */}
              <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                  <div className="bg-slate-800/90 backdrop-blur border border-slate-600 rounded-lg p-2 flex flex-col gap-2 shadow-xl">
                      <button onClick={() => setDrawMode(false)} className={`p-2 rounded transition-colors ${!drawMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'}`} title="Select/Move/Pan (V)">
                          <MousePointer2 size={20} />
                      </button>
                      <button onClick={() => setDrawMode(true)} className={`p-2 rounded transition-colors ${drawMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'}`} title="Draw Box (D)">
                          <Square size={20} />
                      </button>
                  </div>
                  
                  {drawMode && (
                      <div className="bg-slate-800/90 backdrop-blur border border-blue-500 rounded-lg p-2 shadow-xl w-48">
                          <label className="text-xs font-bold text-blue-300 uppercase tracking-wider mb-1 block">New Box Class</label>
                          <select 
                              value={newBoxClassId} 
                              onChange={(e) => setNewBoxClassId(parseInt(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-sm text-white outline-none focus:border-blue-500"
                          >
                              {currentProject.class_names.map((name, idx) => (
                                  <option key={idx} value={idx}>{idx}: {name}</option>
                              ))}
                          </select>
                      </div>
                  )}
              </div>

              {activeFrames.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-slate-500">No frames in current scope.</div>
              ) : (
                  <AnnotationCanvas
                      imagePath={imagePath}
                      boxes={boxes}
                      setBoxes={(newBoxes) => {
                          setBoxes(newBoxes);
                          setIncludeInTraining(true); // <-- AGGIUNTO: Auto-include se disegni, muovi o ridimensioni
                      }}
                      selectedBoxId={selectedBoxId}
                      onSelectBox={setSelectedBoxId}
                      drawMode={drawMode}
                      newBoxClassId={newBoxClassId}
                      classNameMap={currentProject.class_names}
                  />
              )}

              {/* Navigation Bar */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-800/90 backdrop-blur border border-slate-600 rounded-full px-4 py-2 flex items-center gap-6 shadow-2xl">
                  <button onClick={handlePrev} disabled={localIndex === 0} className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-full disabled:opacity-30 transition-colors">
                      <ChevronLeft size={24} />
                  </button>
                  <div className="font-mono text-sm font-bold">
                      {activeFrames.length > 0 ? `${localIndex + 1} / ${activeFrames.length}` : '0 / 0'}
                  </div>
                  <button onClick={handleNext} disabled={localIndex >= activeFrames.length - 1} className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-full disabled:opacity-30 transition-colors">
                      <ChevronRight size={24} />
                  </button>
              </div>
          </div>

          {/* RIGHT: SIDEBAR */}
          <div className="w-80 space-y-4 flex flex-col h-full overflow-hidden">
            
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 shrink-0">
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
            </div>

            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <h3 className="font-bold text-white text-sm uppercase tracking-wider">Detections ({boxes.length})</h3>
              </div>

              <div className="space-y-2 overflow-y-auto custom-scrollbar pr-2 flex-1">
                {boxes.map((box, i) => (
                  <div
                    key={i}
                    onClick={() => { setSelectedBoxId(i); setDrawMode(false); }}
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

            <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm shrink-0">
              <h3 className="font-bold text-slate-300 mb-3 flex items-center gap-2"><MousePointer2 size={16}/> Shortcuts</h3>
              <div className="space-y-2 text-slate-400 font-mono text-xs">
                <div className="flex justify-between"><span>Wheel</span><span>Zoom In/Out</span></div>
                <div className="flex justify-between"><span>Drag (Not Draw)</span><span>Pan Image</span></div>
                <div className="flex justify-between"><span>D</span><span>Draw Mode Toggle</span></div>
                <div className="flex justify-between"><span>Del / Backspace</span><span>Remove Box</span></div>
              </div>
            </div>
          </div>
      </div>

      {/* EXPORT MODAL */}
      {exportModalOpen && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
              <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 w-full max-w-lg shadow-2xl animate-in zoom-in-95">
                  <h3 className="text-xl font-bold text-white mb-2">Export Dataset</h3>
                  <p className="text-slate-400 text-sm mb-6">Choose the destination folder. A clean dataset with images and YOLO annotations will be generated.</p>
                  
                  <div className="mb-6">
                      <label className="block text-sm font-bold text-slate-300 mb-2">Destination Folder</label>
                      <button type="button" onClick={handleBrowseExport} className="w-full py-4 border-2 border-dashed border-slate-600 rounded-lg hover:border-emerald-500 hover:bg-slate-800/50 flex flex-col items-center gap-2 text-slate-400 transition-all">
                          <FolderOpen size={24} />
                          <span className="text-xs break-all px-2 text-center">{exportPath || 'Browse local folder...'}</span>
                      </button>
                  </div>

                  <div className="flex justify-end gap-3">
                      <button onClick={() => setExportModalOpen(false)} className="px-4 py-2 text-slate-300 hover:text-white font-medium">Cancel</button>
                      <button onClick={handleExport} disabled={!exportPath} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-bold shadow-lg">Export Now</button>
                  </div>
              </div>
          </div>
      )}

    </div>
  )
}

// --- KONVA CANVAS COMPONENT ---
function AnnotationCanvas({ imagePath, boxes, setBoxes, selectedBoxId, onSelectBox, drawMode, newBoxClassId, classNameMap }) {
  const stageRef = useRef(null)
  const [image] = useImage(imagePath)
  
  // Konva State
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  
  // Drawing State
  const [isDrawing, setIsDrawing] = useState(false)
  const [newBoxPx, setNewBoxPx] = useState(null) // {x, y, w, h}

  // Handle Resize
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
        setScale(1)
        setPosition({ x: (container.clientWidth - width) / 2, y: (container.clientHeight - height) / 2 })
      }
    }
  }, [image])

  // --- ZOOM (WHEEL) ---
  const handleWheel = (e) => {
    e.evt.preventDefault();
    const scaleBy = 1.1;
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    setScale(newScale);

    setPosition({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const handleZoomIn = () => { setScale(p => p * 1.2) }
  const handleZoomOut = () => { setScale(p => p / 1.2) }
  const handleResetZoom = () => {
      setScale(1);
      const container = stageRef.current?.container()?.parentElement;
      if(container) setPosition({ x: (container.clientWidth - stageSize.width) / 2, y: (container.clientHeight - stageSize.height) / 2 });
  }

  // --- DRAWING LOGIC ---
  const getRelativePointerPosition = (stage) => {
      const transform = stage.getAbsoluteTransform().copy();
      transform.invert();
      return transform.point(stage.getPointerPosition());
  }

  const handleMouseDown = (e) => {
      if (!drawMode) {
          // If clicking on empty space in select mode, deselect
          if(e.target === e.target.getStage() || e.target instanceof KonvaImage) onSelectBox(null);
          return;
      }
      
      const pos = getRelativePointerPosition(e.target.getStage());
      setIsDrawing(true);
      setNewBoxPx({ startX: pos.x, startY: pos.y, width: 0, height: 0 });
      onSelectBox(null);
  }

  const handleMouseMove = (e) => {
      if (!drawMode || !isDrawing || !newBoxPx) return;
      const pos = getRelativePointerPosition(e.target.getStage());
      setNewBoxPx({
          ...newBoxPx,
          width: pos.x - newBoxPx.startX,
          height: pos.y - newBoxPx.startY
      });
  }

  const handleMouseUp = () => {
      if (!drawMode || !isDrawing || !newBoxPx) return;
      setIsDrawing(false);

      // Validate Box size
      if (Math.abs(newBoxPx.width) < 10 || Math.abs(newBoxPx.height) < 10) {
          setNewBoxPx(null);
          return;
      }

      // Convert to YOLO normalized format
      // Fix negative width/height if drawn backwards
      const xPx = newBoxPx.width < 0 ? newBoxPx.startX + newBoxPx.width : newBoxPx.startX;
      const yPx = newBoxPx.height < 0 ? newBoxPx.startY + newBoxPx.height : newBoxPx.startY;
      const wPx = Math.abs(newBoxPx.width);
      const hPx = Math.abs(newBoxPx.height);

      const x_center = (xPx + wPx / 2) / stageSize.width;
      const y_center = (yPx + hPx / 2) / stageSize.height;
      const width = wPx / stageSize.width;
      const height = hPx / stageSize.height;

      const newBox = {
          class_id: newBoxClassId,
          class_name: classNameMap[newBoxClassId],
          x_center: Math.max(0, Math.min(1, x_center)),
          y_center: Math.max(0, Math.min(1, y_center)),
          width: Math.min(1, width),
          height: Math.min(1, height),
          confidence: 1.0 // Manual
      };

      setBoxes([...boxes, newBox]);
      setNewBoxPx(null);
      // Auto-select newly created box
      onSelectBox(boxes.length); 
  }

  // --- EXISTING BOX TRANSFORMS ---
  const handleDragEnd = (e, index) => {
      if(drawMode) return;
      const newBoxes = [...boxes];
      newBoxes[index].x_center = (e.target.x() + e.target.width() / 2) / stageSize.width;
      newBoxes[index].y_center = (e.target.y() + e.target.height() / 2) / stageSize.height;
      setBoxes(newBoxes);
  };

  const handleTransformEnd = (e, index) => {
      if(drawMode) return;
      const node = e.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1); node.scaleY(1);
      
      const newBoxes = [...boxes];
      newBoxes[index].width = (node.width() * scaleX) / stageSize.width;
      newBoxes[index].height = (node.height() * scaleY) / stageSize.height;
      newBoxes[index].x_center = (node.x() + (node.width() * scaleX) / 2) / stageSize.width;
      newBoxes[index].y_center = (node.y() + (node.height() * scaleY) / 2) / stageSize.height;
      setBoxes(newBoxes);
  };

  return (
    <div className="w-full h-full relative bg-slate-950">
        
        {/* On-Screen Zoom Controls */}
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-slate-800/90 backdrop-blur border border-slate-600 rounded-lg p-2 shadow-xl">
            <button onClick={handleZoomIn} className="p-2 text-slate-300 hover:bg-slate-700 hover:text-white rounded"><ZoomIn size={18}/></button>
            <button onClick={handleResetZoom} className="p-2 text-slate-300 hover:bg-slate-700 hover:text-white rounded font-mono text-xs">1:1</button>
            <button onClick={handleZoomOut} className="p-2 text-slate-300 hover:bg-slate-700 hover:text-white rounded"><ZoomOut size={18}/></button>
        </div>

        <Stage 
            ref={stageRef} 
            width={window.innerWidth} // Full container width handles pan
            height={window.innerHeight} 
            scaleX={scale} 
            scaleY={scale} 
            x={position.x} 
            y={position.y}
            onWheel={handleWheel}
            draggable={!drawMode} // Pan when not drawing
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{ cursor: drawMode ? 'crosshair' : (scale > 1 ? 'grab' : 'default') }}
        >
            <Layer>
                {image && <KonvaImage image={image} width={stageSize.width} height={stageSize.height} />}
                
                {/* Drawn Boxes */}
                {boxes.map((box, i) => {
                    const x = (box.x_center - box.width / 2) * stageSize.width
                    const y = (box.y_center - box.height / 2) * stageSize.height
                    const w = box.width * stageSize.width
                    const h = box.height * stageSize.height

                    return (
                        <BoundingBoxShape
                            key={i}
                            shapeProps={{ x, y, width: w, height: h }}
                            isSelected={i === selectedBoxId && !drawMode}
                            onSelect={() => { if(!drawMode) onSelectBox(i) }}
                            onDragEnd={(e) => handleDragEnd(e, i)}
                            onTransformEnd={(e) => handleTransformEnd(e, i)}
                        />
                    )
                })}

                {/* Box being drawn */}
                {isDrawing && newBoxPx && (
                    <Rect
                        x={newBoxPx.width < 0 ? newBoxPx.startX + newBoxPx.width : newBoxPx.startX}
                        y={newBoxPx.height < 0 ? newBoxPx.startY + newBoxPx.height : newBoxPx.startY}
                        width={Math.abs(newBoxPx.width)}
                        height={Math.abs(newBoxPx.height)}
                        stroke="#eab308" // Yellow while drawing
                        strokeWidth={2}
                        dash={[5, 5]}
                    />
                )}
            </Layer>
        </Stage>
    </div>
  )
}

// BoundingBox Shape Component
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
        strokeWidth={isSelected ? 3 / (shapeRef.current?.getStage()?.scaleX() || 1) : 2 / (shapeRef.current?.getStage()?.scaleX() || 1)} // Keep stroke consistent on zoom
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