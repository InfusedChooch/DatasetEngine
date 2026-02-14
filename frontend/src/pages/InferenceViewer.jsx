import { useState, useEffect, useMemo, useCallback } from 'react'
import { Filter, XCircle, AlertTriangle, CheckCircle, Grid3x3, Check, Maximize, EyeOff, Eye, ArrowRight } from 'lucide-react'
import { api } from '../lib/api'
import { useProjectStore } from '../hooks/useProject'
import { useNavigate } from 'react-router-dom'

export default function InferenceViewer() {
  const navigate = useNavigate()
  const { currentProject, filteredFrames, stats, selectedFrameIds } = useProjectStore()
  const { setFilteredFrames, setStats, toggleFrameSelection, clearSelection } = useProjectStore()
  
  const [filterMode, setFilterMode] = useState('all')
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.50)
  const [loading, setLoading] = useState(false)
  
  // Fast Review States
  const [viewMode, setViewMode] = useState('grid') // 'grid' | 'single'
  const [currentIndex, setCurrentIndex] = useState(0)
  const [hiddenClasses, setHiddenClasses] = useState(new Set())

  // Estrai tutte le classi uniche presenti nei frame filtrati
  const availableClasses = useMemo(() => {
    const classes = new Set()
    filteredFrames.forEach(f => f.boxes.forEach(b => classes.add(b.class_name)))
    return Array.from(classes).sort()
  }, [filteredFrames])

  const toggleClassVisibility = (className) => {
    setHiddenClasses(prev => {
      const next = new Set(prev)
      if (next.has(className)) next.delete(className)
      else next.add(className)
      return next
    })
  }

  // Keyboard Shortcuts (Solo in Single Mode)
  const handleKeyDown = useCallback((e) => {
    if (viewMode !== 'single') return;
    if (e.key === 'ArrowRight') {
      setCurrentIndex(p => Math.min(filteredFrames.length - 1, p + 1));
    } else if (e.key === 'ArrowLeft') {
      setCurrentIndex(p => Math.max(0, p - 1));
    } else if (e.key === ' ') {
      e.preventDefault(); // Evita scroll
      if(filteredFrames[currentIndex]) {
          toggleFrameSelection(filteredFrames[currentIndex].frame_id);
      }
    }
  }, [viewMode, filteredFrames, currentIndex, toggleFrameSelection]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => { if (currentProject) { loadStats(); loadFrames('all'); } }, [currentProject])

  const loadStats = async () => {
    try { const { data } = await api.getImprovementStats(currentProject.project_id); setStats(data); } catch (err) {}
  }

  const loadFrames = async (mode) => {
    if (!currentProject) return
    setLoading(true)
    try {
      const { data } = await api.filterFrames({ project_id: currentProject.project_id, mode: mode, confidence_threshold: confidenceThreshold })
      setFilteredFrames(data.frames, mode)
      setFilterMode(mode)
      setCurrentIndex(0) // Resetta indice fast review
    } catch (err) {} finally { setLoading(false) }
  }

  if (!currentProject) return <div className="text-center py-20 text-slate-400">No project loaded</div>

  return (
    <div className="space-y-6">
      {/* HEADER & STATS */}
      <div className="flex items-center justify-between">
        <div><h2 className="text-3xl font-bold">{currentProject.name}</h2><p className="text-slate-400">Fast Triage: Flag bad frames for correction</p></div>
        <div className="flex gap-3">
            <button onClick={() => setViewMode('grid')} className={`px-4 py-2 rounded-lg flex items-center gap-2 ${viewMode === 'grid' ? 'bg-blue-600' : 'bg-slate-700'}`}><Grid3x3 size={18}/> Grid</button>
            <button onClick={() => setViewMode('single')} className={`px-4 py-2 rounded-lg flex items-center gap-2 ${viewMode === 'single' ? 'bg-purple-600' : 'bg-slate-700'}`}><Maximize size={18}/> Fast Review</button>
            {selectedFrameIds.size > 0 && (
            <button onClick={() => navigate('/improve/editor')} className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-bold flex items-center gap-2 shadow-lg shadow-green-500/20">
                Fix {selectedFrameIds.size} Flagged Frames <ArrowRight size={18}/>
            </button>
            )}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Total" value={stats.total_frames} icon={<Grid3x3 />} color="slate" onClick={() => loadFrames('all')} active={filterMode==='all'} />
          <StatCard label="No Detect" value={stats.no_detection} icon={<XCircle />} color="red" onClick={() => loadFrames('no_detection')} active={filterMode==='no_detection'}/>
          <StatCard label="Low Conf" value={stats.low_confidence} icon={<AlertTriangle />} color="yellow" onClick={() => loadFrames('low_confidence')} active={filterMode==='low_confidence'}/>
          <StatCard label="High Conf" value={stats.high_confidence} icon={<CheckCircle />} color="green" onClick={() => loadFrames('high_confidence')} active={filterMode==='high_confidence'}/>
        </div>
      )}

      {/* FILTER & CLASS TOGGLES */}
      <div className="bg-slate-800/50 rounded-xl p-4 flex flex-wrap items-center gap-4 border border-slate-700">
        <Filter size={20} className="text-slate-400" />
        {filterMode === 'low_confidence' && (
          <div className="flex items-center gap-2 bg-slate-900 px-3 py-1 rounded">
            <span className="text-sm text-slate-400">Threshold:</span>
            <input type="range" min="0.1" max="0.9" step="0.05" value={confidenceThreshold} onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))} className="w-24 accent-yellow-500"/>
            <span className="text-sm font-mono text-yellow-400">{confidenceThreshold.toFixed(2)}</span>
            <button onClick={() => loadFrames('low_confidence')} className="ml-2 text-xs bg-slate-700 px-2 rounded hover:bg-slate-600">Apply</button>
          </div>
        )}
        <div className="h-6 w-px bg-slate-700 mx-2"></div>
        <div className="flex flex-wrap gap-2">
            <span className="text-sm text-slate-400 flex items-center">Classes:</span>
            {availableClasses.map(cls => (
                <button key={cls} onClick={() => toggleClassVisibility(cls)} className={`text-xs px-3 py-1 rounded-full flex items-center gap-1 border transition-colors ${hiddenClasses.has(cls) ? 'border-slate-600 text-slate-500 bg-transparent' : 'border-blue-500/50 bg-blue-900/20 text-blue-300'}`}>
                    {hiddenClasses.has(cls) ? <EyeOff size={12}/> : <Eye size={12}/>} {cls}
                </button>
            ))}
        </div>
      </div>

      {/* VIEWPORT */}
      {loading ? (
        <div className="py-20 text-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div><p className="mt-4 text-slate-400">Loading frames...</p></div>
      ) : filteredFrames.length === 0 ? (
        <div className="py-20 text-center text-slate-500 font-medium border border-dashed border-slate-700 rounded-xl">No frames found for this filter.</div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredFrames.map((frame) => (
            <FrameCard key={frame.frame_id} frame={frame} projectId={currentProject.project_id} isSelected={selectedFrameIds.has(frame.frame_id)} onToggleSelect={() => toggleFrameSelection(frame.frame_id)} hiddenClasses={hiddenClasses} />
          ))}
        </div>
      ) : (
        /* FAST REVIEW SINGLE MODE */
        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden flex flex-col h-[70vh]">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
                <div className="flex gap-2">
                    <button onClick={()=>setCurrentIndex(p=>Math.max(0,p-1))} disabled={currentIndex===0} className="px-3 bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-30">← Prev</button>
                    <span className="font-mono text-sm px-4 py-1 bg-black rounded border border-slate-700">{currentIndex + 1} / {filteredFrames.length}</span>
                    <button onClick={()=>setCurrentIndex(p=>Math.min(filteredFrames.length-1,p+1))} disabled={currentIndex===filteredFrames.length-1} className="px-3 bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-30">Next →</button>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-400">
                    <span className="flex items-center gap-1 border border-slate-700 px-2 py-1 rounded bg-black"><kbd className="bg-slate-800 px-1 rounded text-xs text-white">SPACE</kbd> Flag Error</span>
                    <span className="flex items-center gap-1 border border-slate-700 px-2 py-1 rounded bg-black"><kbd className="bg-slate-800 px-1 rounded text-xs text-white">→</kbd> Skip (Correct)</span>
                </div>
                <button 
                    onClick={() => toggleFrameSelection(filteredFrames[currentIndex].frame_id)}
                    className={`px-6 py-2 font-bold rounded flex items-center gap-2 transition-all ${selectedFrameIds.has(filteredFrames[currentIndex].frame_id) ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-red-900/50 hover:text-red-400'}`}
                >
                    {selectedFrameIds.has(filteredFrames[currentIndex].frame_id) ? <><XCircle size={18}/> FLAGGED FOR FIX</> : <><CheckCircle size={18}/> FLAG ERROR</>}
                </button>
            </div>
            
            <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden p-4">
                <div className="relative inline-block h-full">
                    {/* W-auto e H-full fa in modo che l'immagine scali mantenendo le proporzioni e le div assolute siano esatte */}
                    <img src={`http://localhost:8000/storage/projects/${currentProject.project_id}/${filteredFrames[currentIndex].frame_path}`} className="h-full w-auto object-contain pointer-events-none" />
                    
                    {/* DRAW BOXES IN PERCENTAGE OVER IMAGE */}
                    {filteredFrames[currentIndex].boxes.map((box, i) => {
                        if (hiddenClasses.has(box.class_name)) return null;
                        return (
                            <div key={i} className="absolute border-2 border-emerald-500 bg-emerald-500/10 flex items-start justify-start group" style={{
                                left: `${(box.x_center - box.width/2)*100}%`,
                                top: `${(box.y_center - box.height/2)*100}%`,
                                width: `${box.width*100}%`,
                                height: `${box.height*100}%`
                            }}>
                                <span className="absolute -top-5 left-[-2px] bg-emerald-500 text-black text-[10px] font-bold px-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                    {box.class_name} {(box.confidence*100).toFixed(0)}%
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon, color, onClick, active }) {
  const colors = {
    slate: 'bg-slate-800/50 border-slate-700 text-slate-300',
    red: 'bg-red-900/20 border-red-500/30 text-red-400',
    yellow: 'bg-yellow-900/20 border-yellow-500/30 text-yellow-400',
    green: 'bg-green-900/20 border-green-500/30 text-emerald-400'
  }
  return (
    <button onClick={onClick} className={`rounded-xl p-4 text-left transition-all border ${colors[color]} ${active ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-500/20' : 'hover:bg-slate-700/50'}`}>
      <div className="flex items-center justify-between mb-2"><span className="text-sm font-semibold opacity-80">{label}</span>{icon}</div>
      <div className="text-3xl font-black">{value}</div>
    </button>
  )
}

function FrameCard({ frame, projectId, isSelected, onToggleSelect, hiddenClasses }) {
  return (
    <div onClick={onToggleSelect} className={`relative group cursor-pointer bg-black rounded-lg overflow-hidden border-2 transition-all ${isSelected ? 'border-red-500 shadow-lg shadow-red-500/30' : 'border-transparent hover:border-slate-600'}`}>
      <div className="relative w-full aspect-video">
          <img src={`http://localhost:8000/storage/projects/${projectId}/${frame.frame_path}`} className="w-full h-full object-cover" />
          {/* Mini overlay boxes on grid */}
          {frame.boxes.map((b,i) => {
              if(hiddenClasses.has(b.class_name)) return null;
              return <div key={i} className="absolute border border-emerald-500/50 bg-emerald-500/10 pointer-events-none" style={{ left:`${(b.x_center-b.width/2)*100}%`, top:`${(b.y_center-b.height/2)*100}%`, width:`${b.width*100}%`, height:`${b.height*100}%`}}/>
          })}
      </div>
      {isSelected && <div className="absolute top-2 right-2 bg-red-600 text-white p-1 rounded-full"><AlertTriangle size={14}/></div>}
    </div>
  )
}