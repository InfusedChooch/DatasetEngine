import { useState } from 'react'
import { Upload, ChevronLeft, ChevronRight, Check, X, Download } from 'lucide-react'
import { api } from '../lib/api'

export default function VideoEditorPage() {
  const [sessionId, setSessionId] = useState(null)
  const [frames, setFrames] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [annotations, setAnnotations] = useState({})
  const [loading, setLoading] = useState(false)
  const [videoInfo, setVideoInfo] = useState(null)

  const handleUpload = async (e) => {
    const files = e.target.files
    if (files.length < 2) {
      alert('Please select both video and model files')
      return
    }

    const videoFile = Array.from(files).find(f => f.name.match(/\.(mp4|avi|mov)$/i))
    const modelFile = Array.from(files).find(f => f.name.match(/\.(pt|onnx)$/i))

    if (!videoFile || !modelFile) {
      alert('Please select a video file and a model file')
      return
    }

    setLoading(true)
    try {
      const { data: upload } = await api.uploadVideo(videoFile, modelFile)
      setSessionId(upload.session_id)
      setVideoInfo(upload)
      
      const { data: result } = await api.processVideo({
        session_id: upload.session_id,
        model_path: upload.model_path,
        sampling_rate: 10,
        confidence: 0.25
      })
      
      setFrames(result.preview)
      
      const initAnnotations = {}
      result.preview.forEach(frame => {
        initAnnotations[frame.frame_id] = {
          boxes: frame.boxes,
          included: frame.included
        }
      })
      setAnnotations(initAnnotations)
    } catch (err) {
      console.error('Upload failed:', err)
      alert('Failed to process video')
    } finally {
      setLoading(false)
    }
  }

  const currentFrame = frames[currentIndex]
  const currentAnnotation = currentFrame ? annotations[currentFrame.frame_id] : null

  const toggleFrameInclusion = async () => {
    if (!currentFrame) return
    
    const newIncluded = !currentAnnotation.included
    const updated = {
      ...annotations,
      [currentFrame.frame_id]: {
        ...currentAnnotation,
        included: newIncluded
      }
    }
    setAnnotations(updated)

    try {
      await api.updateVideoAnnotation({
        frame_id: currentFrame.frame_id,
        session_id: sessionId,
        boxes: currentAnnotation.boxes,
        included: newIncluded
      })
    } catch (err) {
      console.error('Failed to update:', err)
    }
  }

  const deleteBox = (boxIndex) => {
    if (!currentFrame) return
    const newBoxes = currentAnnotation.boxes.filter((_, i) => i !== boxIndex)
    const updated = {
      ...annotations,
      [currentFrame.frame_id]: {
        ...currentAnnotation,
        boxes: newBoxes
      }
    }
    setAnnotations(updated)

    api.updateVideoAnnotation({
      frame_id: currentFrame.frame_id,
      session_id: sessionId,
      boxes: newBoxes,
      included: currentAnnotation.included
    }).catch(err => console.error('Failed to update:', err))
  }

  const handleExport = async () => {
    if (!sessionId) return
    
    const outputName = prompt('Enter dataset name:', 'video_dataset')
    if (!outputName) return

    try {
      const { data } = await api.exportVideo({
        session_id: sessionId,
        output_name: outputName
      })
      alert(data.message)
    } catch (err) {
      alert(err.response?.data?.detail || 'Export failed')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Video-to-Dataset Editor</h2>
          <p className="text-slate-400">Create training datasets from videos with AI assistance</p>
        </div>
        {!sessionId && (
          <label className="cursor-pointer px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-medium transition-colors flex items-center gap-2">
            <Upload size={20} />
            Upload Video + Model
            <input 
              type="file" 
              multiple 
              accept=".mp4,.avi,.mov,.pt,.onnx" 
              onChange={handleUpload} 
              className="hidden" 
            />
          </label>
        )}
      </div>

      {loading && (
        <div className="bg-slate-800/50 rounded-lg p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto"></div>
          <p className="mt-4 text-slate-400">Processing video...</p>
        </div>
      )}

      {currentFrame && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-9 bg-slate-800/50 rounded-lg p-4 space-y-4">
            <div className="aspect-video bg-slate-900 rounded-lg flex items-center justify-center overflow-hidden">
              <img
                src={`http://localhost:8000/storage/temp/${sessionId}/frames/frame_${currentFrame.frame_id.toString().padStart(6, '0')}.jpg`}
                alt={`Frame ${currentFrame.frame_id}`}
                className="max-w-full max-h-full object-contain"
              />
            </div>
            
            <div className="flex items-center gap-4">
              <button
                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0}
                className="p-2 bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-30"
              >
                <ChevronLeft size={20} />
              </button>
              
              <div className="flex-1 flex gap-1 overflow-x-auto">
                {frames.map((frame, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    className={`flex-shrink-0 w-12 h-12 rounded transition-colors ${
                      i === currentIndex ? 'bg-blue-600' :
                      annotations[frame.frame_id]?.included ? 'bg-green-600/30' : 'bg-slate-700'
                    }`}
                  />
                ))}
              </div>
              
              <button
                onClick={() => setCurrentIndex(Math.min(frames.length - 1, currentIndex + 1))}
                disabled={currentIndex === frames.length - 1}
                className="p-2 bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-30"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="text-center text-sm text-slate-400">
              Frame {currentFrame.frame_id} • {currentIndex + 1} of {frames.length}
            </div>
          </div>

          <div className="col-span-3 space-y-4">
            <div className="bg-slate-800/50 rounded-lg p-4">
              <h3 className="font-semibold mb-3">Frame Status</h3>
              <button
                onClick={toggleFrameInclusion}
                className={`w-full py-2 rounded-lg flex items-center justify-center gap-2 transition-colors ${
                  currentAnnotation?.included 
                    ? 'bg-green-600 hover:bg-green-700' 
                    : 'bg-slate-700 hover:bg-slate-600'
                }`}
              >
                {currentAnnotation?.included ? <Check size={18} /> : <X size={18} />}
                {currentAnnotation?.included ? 'Included' : 'Excluded'}
              </button>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-4">
              <h3 className="font-semibold mb-3">Detections ({currentAnnotation?.boxes.length || 0})</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {currentAnnotation?.boxes.map((box, i) => (
                  <div key={i} className="bg-slate-700/50 rounded p-2 flex items-center justify-between">
                    <div className="text-sm">
                      <div className="font-medium">{box.class_name}</div>
                      <div className="text-xs text-slate-400">{(box.confidence * 100).toFixed(1)}%</div>
                    </div>
                    <button
                      onClick={() => deleteBox(i)}
                      className="p-1 hover:bg-red-500/20 rounded transition-colors"
                    >
                      <X size={16} className="text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {sessionId && (
              <button
                onClick={handleExport}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <Download size={20} />
                Export Dataset
              </button>
            )}

            {videoInfo && (
              <div className="bg-slate-800/30 rounded-lg p-4 text-sm space-y-1">
                <div className="text-slate-400">Total Frames: {videoInfo.total_frames}</div>
                <div className="text-slate-400">FPS: {videoInfo.fps.toFixed(2)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}