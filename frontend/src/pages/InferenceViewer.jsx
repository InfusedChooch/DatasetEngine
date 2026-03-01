import { useState, useEffect, useMemo, useCallback } from 'react'
import { Filter, XCircle, AlertTriangle, CheckCircle, Grid3x3, Check, Maximize, EyeOff, Eye, ArrowRight, Database } from 'lucide-react'
import { api } from '../lib/api'
import { useProjectStore } from '../hooks/useProject'
import { useNavigate } from 'react-router-dom'

// COLOR PALETTE (YOLO Style)
export const CLASS_COLORS = [
    '#FF3838', '#FF9D97', '#FF701F', '#FFB21D', '#CFD231', '#48F90A',
    '#92CC17', '#3DDB86', '#1A9334', '#00D4BB', '#2C99A8', '#00C2FF',
    '#344593', '#6473FF', '#0018EC', '#8438FF', '#520085', '#CB38FF',
    '#FF95C8', '#FF37C7'
]

export default function InferenceViewer() {
  const navigate = useNavigate()
  const { currentProject, filteredFrames, stats, selectedFrameIds } = useProjectStore()
  const { setFilteredFrames, setStats, toggleFrameSelection, clearSelection } = useProjectStore()
  
  const [filterMode, setFilterMode] = useState('all')
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.50)
  const [loading, setLoading] = useState(false)
  
  const [viewMode, setViewMode] = useState('grid') 
  const [currentIndex, setCurrentIndex] = useState(0)
  const [hiddenClasses, setHiddenClasses] = useState(new Set())

  // CONFIDENCE THRESHOLDS BY CLASS
  const [classThresholds, setClassThresholds] = useState(() => {
    const saved = localStorage.getItem('classThresholds');
    return saved ? JSON.parse(saved) : {};
  });

  const updateThreshold = (cls, val) => {
    const next = { ...classThresholds, [cls]: val };
    setClassThresholds(next);
    localStorage.setItem('classThresholds', JSON.stringify(next));
  };

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

  const handleKeyDown = useCallback((e) => {
    if (viewMode !== 'single') return;
    // Ignore shortcuts if the user is typing into an input
    if (e.target.tagName.toLowerCase() === 'input') return;

    if (e.key === 'ArrowRight') {
      setCurrentIndex(p => Math.min(filteredFrames.length - 1, p + 1));
    } else if (e.key === 'ArrowLeft') {
      setCurrentIndex(p => Math.max(0, p - 1));
    } else if (e.key === ' ') {
      e.preventDefault(); 
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
      setCurrentIndex(0) 
    } catch (err) {} finally { setLoading(false) }
  }

  const handleBulkMark = async () => {
    if (selectedFrameIds.size === 0) return
    try {
      await api.bulkMarkImprovement(currentProject.project_id, Array.from(selectedFrameIds), true)
      clearSelection()
      loadStats()
    } catch (err) {
      console.error('Failed to mark frames:', err)
    }
  }

  if (!currentProject) return <div className="text-center py-20 text-slate-400">No project loaded</div>

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-700/50 flex items-center justify-center shadow-inner relative overflow-hidden group">
                <div className="absolute inset-0 bg-red-500/10 group-hover:bg-red-500/20 transition-colors"></div>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 relative z-10">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <path d="M3 9h18M9 21V9"/>
                    <path d="M13 13.5l2-1.5 2 1.5v-4l-2 1.5-2-1.5v4z" fill="currentColor" className="text-orange-400"/>
                </svg>
            </div>
            <div>
                <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-orange-400">{currentProject.name}</h2>
                <p className="text-slate-400 mt-1 font-medium">Fast Triage: Flag bad frames for correction</p>
            </div>
        </div>
        <div className="flex gap-3 items-center">
            
            <div className="flex items-center gap-2 bg-emerald-900/30 border border-emerald-500/30 text-emerald-400 px-4 py-2 rounded-lg font-bold">
                <Database size={18}/> {stats?.included_frames || 0} In Dataset
            </div>

            <button onClick={() => setViewMode('grid')} className={`px-4 py-2 rounded-lg flex items-center gap-2 ${viewMode === 'grid' ? 'bg-blue-600' : 'bg-slate-700'}`}><Grid3x3 size={18}/> Grid</button>
            <button onClick={() => setViewMode('single')} className={`px-4 py-2 rounded-lg flex items-center gap-2 ${viewMode === 'single' ? 'bg-purple-600' : 'bg-slate-700'}`}><Maximize size={18}/> Fast Review</button>
            
            {selectedFrameIds.size > 0 && (
                <button onClick={handleBulkMark} className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-bold flex items-center gap-2 shadow-lg shadow-green-500/20">
                    <Check size={18}/> Mark {selectedFrameIds.size} for Training
                </button>
            )}
            
            <button onClick={() => navigate('/improve/editor')} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-bold flex items-center gap-2 shadow-lg shadow-blue-500/20">
                Go to Editor <ArrowRight size={18}/>
            </button>
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

      {/* DASHBOARD FILTERS */}
      <div className="bg-slate-800/40 rounded-2xl p-5 border border-slate-700/60 shadow-inner">
        <div className="flex items-center gap-2 text-slate-300 font-bold uppercase text-xs tracking-wider mb-5">
            <Filter size={18} className="text-blue-500" /> Visibility & Confidence Thresholds
        </div>
        
        {/* GLOBAL THRESHOLD (If in Low Conf mode) */}
        {filterMode === 'low_confidence' && (
          <div className="flex items-center gap-4 bg-slate-900/80 px-5 py-3 rounded-xl border border-yellow-500/30 mb-6 shadow-lg">
            <AlertTriangle size={20} className="text-yellow-500" />
            <span className="text-sm font-bold text-slate-200">Global Threshold:</span>
            <input 
                type="range" min="0.00" max="1.00" step="0.01" 
                value={confidenceThreshold} 
                onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))} 
                className="w-48 accent-yellow-500"
            />
            <div className="flex items-center bg-black/50 rounded-lg px-2 py-1.5 border border-slate-600 focus-within:border-yellow-500">
                <input 
                    type="text" 
                    value={Math.round(confidenceThreshold * 100)} 
                    onChange={(e) => {
                        let val = parseInt(e.target.value.replace(/\D/g,'')) || 0;
                        setConfidenceThreshold(Math.max(0, Math.min(100, val)) / 100);
                    }} 
                    className="w-12 bg-transparent text-sm font-mono text-yellow-400 text-center outline-none"
                />
                <span className="text-sm font-mono text-yellow-600">%</span>
            </div>
            <button onClick={() => loadFrames('low_confidence')} className="ml-auto text-sm bg-yellow-600 hover:bg-yellow-500 px-4 py-2 rounded-lg font-bold text-white transition-colors">Apply Filter</button>
          </div>
        )}

        {/* CARD GRID BY CLASS */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {availableClasses.map(cls => {
                const classId = currentProject.class_names.indexOf(cls)
                const color = classId >= 0 ? CLASS_COLORS[classId % CLASS_COLORS.length] : '#888'
                const currentThresh = classThresholds[cls] ?? 0.50
                const isHidden = hiddenClasses.has(cls)
                
                return (
                <div key={cls} className={`bg-slate-900/60 rounded-xl p-3 border transition-all duration-200 ${isHidden ? 'border-slate-800 opacity-50 bg-slate-900/30' : 'border-slate-600 shadow-md hover:border-slate-500'}`}>
                    
                    {/* Header: Toggle and Text Input */}
                    <div className="flex justify-between items-center mb-3 gap-2">
                        <button 
                            onClick={() => toggleClassVisibility(cls)} 
                            className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-1 min-w-0"
                            title={`Toggle visibility for ${cls}`}
                        >
                            <div className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: isHidden ? '#475569' : color }}></div>
                            <span className={`text-sm font-bold truncate ${isHidden ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                                {cls}
                            </span>
                        </button>

                        <div className={`flex items-center justify-end bg-black/60 border ${isHidden ? 'border-slate-800' : 'border-slate-600'} rounded-md px-2 py-1 focus-within:border-blue-500 transition-colors shrink-0`}>
                            <input 
                                type="text" 
                                value={Math.round(currentThresh * 100)}
                                onChange={(e) => {
                                    let val = parseInt(e.target.value.replace(/\D/g,''));
                                    if(isNaN(val)) val = 0;
                                    updateThreshold(cls, Math.max(0, Math.min(100, val)) / 100);
                                }}
                                disabled={isHidden}
                                className="w-10 bg-transparent font-mono text-sm text-right outline-none text-slate-200 disabled:text-slate-600 p-0 m-0"
                            />
                            <span className={`text-xs font-mono ml-0.5 ${isHidden ? 'text-slate-600' : 'text-slate-400'}`}>%</span>
                        </div>
                    </div>

                    {/* Slider Full Width */}
                    <input 
                        type="range" min="0.00" max="1.00" step="0.01" 
                        value={currentThresh} 
                        onChange={(e) => updateThreshold(cls, parseFloat(e.target.value))} 
                        disabled={isHidden}
                        className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer transition-colors ${isHidden ? 'bg-slate-800' : 'bg-slate-700'}`} 
                        style={{ accentColor: isHidden ? '#475569' : color }}
                    />
                </div>
            )})}
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div><p className="mt-4 text-slate-400">Loading frames...</p></div>
      ) : filteredFrames.length === 0 ? (
        <div className="py-20 text-center text-slate-500 font-medium border border-dashed border-slate-700 rounded-xl">No frames found for this filter.</div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredFrames.map((frame) => (
            <FrameCard 
                key={frame.frame_id} 
                frame={frame} 
                projectId={currentProject.project_id} 
                isSelected={selectedFrameIds.has(frame.frame_id)} 
                onToggleSelect={() => toggleFrameSelection(frame.frame_id)} 
                hiddenClasses={hiddenClasses} 
                classThresholds={classThresholds} 
            />
          ))}
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden flex flex-col h-[70vh]">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
                <div className="flex gap-2">
                    <button onClick={()=>setCurrentIndex(p=>Math.max(0,p-1))} disabled={currentIndex===0} className="px-3 bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-30">← Prev</button>
                    <span className="font-mono text-sm px-4 py-1 bg-black rounded border border-slate-700">{currentIndex + 1} / {filteredFrames.length}</span>
                    <button onClick={()=>setCurrentIndex(p=>Math.min(filteredFrames.length-1,p+1))} disabled={currentIndex===filteredFrames.length-1} className="px-3 bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-30">Next →</button>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-400">
                    <span className="flex items-center gap-1 border border-slate-700 px-2 py-1 rounded bg-black"><kbd className="bg-slate-800 px-1 rounded text-xs text-white">SPACE</kbd> Flag</span>
                    <span className="flex items-center gap-1 border border-slate-700 px-2 py-1 rounded bg-black"><kbd className="bg-slate-800 px-1 rounded text-xs text-white">→</kbd> Skip</span>
                </div>
                <button 
                    onClick={() => toggleFrameSelection(filteredFrames[currentIndex].frame_id)}
                    className={`px-6 py-2 font-bold rounded flex items-center gap-2 transition-all ${selectedFrameIds.has(filteredFrames[currentIndex].frame_id) ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-red-900/50 hover:text-red-400'}`}
                >
                    {selectedFrameIds.has(filteredFrames[currentIndex].frame_id) ? <><XCircle size={18}/> FLAGGED</> : <><CheckCircle size={18}/> FLAG FRAME</>}
                </button>
            </div>
            
            <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden p-4">
                <div className="relative inline-block h-full">
                    <img
                      src={api.getStorageUrl(`projects/${currentProject.project_id}/${filteredFrames[currentIndex].frame_path}`)}
                      className="h-full w-auto object-contain pointer-events-none"
                    />
                    {filteredFrames[currentIndex].boxes.map((box, i) => {
                        if (hiddenClasses.has(box.class_name)) return null;
                        const thresh = classThresholds[box.class_name] ?? 0.50;
                        if (box.confidence < thresh) return null; 

                        const boxColor = CLASS_COLORS[box.class_id % CLASS_COLORS.length];
                        
                        return (
                            <div key={i} className="absolute border-2 flex items-start justify-start group" style={{
                                left: `${(box.x_center - box.width/2)*100}%`, top: `${(box.y_center - box.height/2)*100}%`, width: `${box.width*100}%`, height: `${box.height*100}%`,
                                borderColor: boxColor,
                                backgroundColor: `${boxColor}33`
                            }}>
                                <span className="absolute -top-5 left-[-2px] text-black text-[10px] font-bold px-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10" style={{backgroundColor: boxColor}}>
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

function FrameCard({ frame, projectId, isSelected, onToggleSelect, hiddenClasses, classThresholds }) {
  return (
    <div onClick={onToggleSelect} className={`relative group cursor-pointer bg-black rounded-lg overflow-hidden border-2 transition-all ${isSelected ? 'border-red-500 shadow-lg shadow-red-500/30' : 'border-transparent hover:border-slate-600'}`}>
      <div className="relative w-full aspect-video">
          <img src={api.getStorageUrl(`projects/${projectId}/${frame.frame_path}`)} className="w-full h-full object-cover" />
          {frame.boxes.map((b,i) => {
              if(hiddenClasses.has(b.class_name)) return null;
              const thresh = classThresholds[b.class_name] ?? 0.50;
              if (b.confidence < thresh) return null;

              const boxColor = CLASS_COLORS[b.class_id % CLASS_COLORS.length];
              return <div key={i} className="absolute border pointer-events-none" style={{ left:`${(b.x_center-b.width/2)*100}%`, top:`${(b.y_center-b.height/2)*100}%`, width:`${b.width*100}%`, height:`${b.height*100}%`, borderColor: boxColor, backgroundColor: `${boxColor}33`}}/>
          })}
      </div>
      {isSelected && <div className="absolute top-2 right-2 bg-red-600 text-white p-1 rounded-full"><AlertTriangle size={14}/></div>}
    </div>
  )
}
