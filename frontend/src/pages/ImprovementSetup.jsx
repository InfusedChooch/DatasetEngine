import { useState, useRef, useEffect } from 'react'
import { Upload, FolderOpen, Target, Video } from 'lucide-react'
import { useProjectStore } from '../hooks/useProject'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'

export default function ImprovementSetup() {
  const navigate = useNavigate()
  const setCurrentProject = useProjectStore(s => s.setCurrentProject)
  
  const [formData, setFormData] = useState({
    name: '', modelPath: '', sourcePath: '', samplingRate: 30
  })
  
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 })
  const [logs, setLogs] = useState([])
  const logsEndRef = useRef(null)

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [logs])

  // SEPARATE CALLS FOR EACH FILE TYPE
  const handleBrowseModel = async () => {
      try { 
          const res = await fetch('http://localhost:8000/api/improve/browse_model');
          const data = await res.json();
          if(data.path) setFormData({...formData, modelPath: data.path});
      } catch(e) { console.error("Error browsing model:", e); }
  }

  const handleBrowseVideo = async () => {
      try { 
          const res = await fetch('http://localhost:8000/api/improve/browse_video');
          const data = await res.json();
          if(data.path) setFormData({...formData, sourcePath: data.path});
      } catch(e) { console.error("Error browsing video:", e); }
  }

  const handleBrowseFolder = async () => {
      try { 
          const res = await fetch('http://localhost:8000/api/improve/browse_folder');
          const data = await res.json();
          if(data.path) setFormData({...formData, sourcePath: data.path});
      } catch(e) { console.error("Error browsing folder:", e); }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if(!formData.modelPath || !formData.sourcePath) return alert("Select paths first!")
    
    setLoading(true)
    setLogs(["🚀 Starting Setup..."])
    
    try {
        const response = await fetch('http://localhost:8000/api/improve/create_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: formData.name,
                model_path: formData.modelPath,
                source_path: formData.sourcePath,
                sampling_rate: formData.samplingRate
            })
        })

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        
        while(true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n').filter(line => line.trim() !== '')
            
            for (const line of lines) {
                try {
                    const data = JSON.parse(line)
                    if (data.type === 'log') setLogs(prev => [...prev, data.msg])
                    else if (data.type === 'progress') setProgress(data)
                    else if (data.type === 'complete') {
                        setCurrentProject(data.data)
                        setTimeout(() => navigate('/improve/viewer'), 1000)
                    }
                } catch (e) { }
            }
        }
    } catch (err) {
      alert("Failed to connect.")
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8 pb-20 relative min-h-screen">
      {/* HEADER */}
      <div className="flex items-center gap-5 shrink-0">
        <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-700/50 flex items-center justify-center shadow-inner relative overflow-hidden group">
            <div className="absolute inset-0 bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors"></div>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 relative z-10">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity="0.2" className="text-purple-400"/>
            </svg>
        </div>
        <div className="text-left">
            <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">Model Improvement</h2>
            <p className="text-slate-400 mt-1 font-medium">Find where your model fails, fix it rapidly.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
          <label className="block text-sm font-bold text-slate-300 mb-2">Project Name</label>
          <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Drone Detection v2" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white outline-none focus:border-blue-500" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* COLUMN 1: MODEL */}
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
                <label className="block text-sm font-bold text-slate-300 mb-4">1. YOLO Model (.pt)</label>
                <button type="button" onClick={handleBrowseModel} className="w-full py-6 border-2 border-dashed border-slate-600 rounded-lg hover:border-blue-500 hover:bg-slate-800/50 flex flex-col items-center gap-2 text-slate-400 transition-all">
                    <Upload size={28} />
                    <span className="text-xs break-all px-2 text-center">Browse local .pt file</span>
                </button>
                {formData.modelPath && (
                    <div className="mt-4 p-3 bg-slate-900 border border-slate-700 rounded-lg text-xs text-blue-300 break-all font-mono">
                        {formData.modelPath}
                    </div>
                )}
            </div>

            {/* COLUMN 2: SOURCE */}
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
                <label className="block text-sm font-bold text-slate-300 mb-4">2. Test Source</label>
                <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={handleBrowseFolder} className="w-full py-4 border-2 border-dashed border-slate-600 rounded-lg hover:border-purple-500 hover:bg-slate-800/50 flex flex-col items-center gap-2 text-slate-400 transition-all">
                        <FolderOpen size={24} />
                        <span className="text-xs text-center">Folder (Images)</span>
                    </button>
                    <button type="button" onClick={handleBrowseVideo} className="w-full py-4 border-2 border-dashed border-slate-600 rounded-lg hover:border-purple-500 hover:bg-slate-800/50 flex flex-col items-center gap-2 text-slate-400 transition-all">
                        <Video size={24} />
                        <span className="text-xs text-center">Video File</span>
                    </button>
                </div>
                {formData.sourcePath && (
                    <div className="mt-4 p-3 bg-slate-900 border border-slate-700 rounded-lg text-xs text-purple-300 break-all font-mono">
                        {formData.sourcePath}
                    </div>
                )}
            </div>
        </div>

        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
          <label className="block text-sm font-bold text-slate-300 mb-4">Frame Sampling (Extract 1 frame every {formData.samplingRate} frames)</label>
          <input type="range" min="1" max="60" step="1" value={formData.samplingRate} onChange={(e) => setFormData({ ...formData, samplingRate: parseInt(e.target.value) })} className="w-full accent-blue-500" />
          <div className="flex justify-between text-xs text-slate-400 mt-2 font-mono"><span>1 (All frames)</span><span>60 (Sparse)</span></div>
        </div>

        <button type="submit" disabled={loading || !formData.modelPath || !formData.sourcePath || !formData.name} className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl font-black text-lg text-white disabled:opacity-50 transition-all shadow-lg shadow-blue-500/20">
          {loading ? 'INITIALIZING...' : 'START ANALYSIS'}
        </button>
      </form>

      {/* TERMINAL LOADER */}
      {loading && createPortal(
        <div className="fixed inset-0 z-[99999] bg-slate-900/95 backdrop-blur-xl flex flex-col items-center justify-center p-8">
            <div className="w-full max-w-2xl bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl">
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"/>
                    <div><h2 className="text-2xl font-bold text-white">Extracting & Analyzing...</h2><p className="text-blue-300 font-mono">Running YOLO inference on all frames</p></div>
                </div>
                <div className="mb-2 flex justify-between text-sm font-bold text-slate-300"><span>Progress</span><span>{progress.percent}%</span></div>
                <div className="w-full h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-700 mb-6"><div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out" style={{ width: `${progress.percent}%` }} /></div>
                <div className="bg-black rounded-lg p-4 font-mono text-xs h-40 overflow-y-auto border border-slate-700 text-slate-400 custom-scrollbar shadow-inner">
                    {logs.map((log, i) => <div key={i} className="mb-1 border-l-2 border-slate-700 pl-2">{log}</div>)}
                    <div ref={logsEndRef} />
                </div>
            </div>
        </div>,
        document.body
      )}
    </div>
  )
}