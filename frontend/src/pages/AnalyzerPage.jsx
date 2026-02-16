// frontend/src/pages/AnalyzerPage.jsx
import { useState, useEffect, useRef } from 'react'
import { Search, AlertCircle, FolderOpen, FileSearch, PieChart as PieIcon, Layers, Image as ImageIcon, Copy, AlertTriangle, Trash2, ArrowRight, ArrowLeft, CheckCircle2, RefreshCw, BarChart3, Terminal } from 'lucide-react'
import { api } from '../lib/api'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, ComposedChart } from 'recharts'
import { useDatasetStore } from '../hooks/useDatasetStore'
import { createPortal } from 'react-dom'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1'];

export default function AnalyzerPage() {
  const { stats, setStats, setCurrentDataset } = useDatasetStore()
  
  const [pathInput, setPathInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  // States for upload (Streaming)
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 })
  const [logs, setLogs] = useState([])
  const logsEndRef = useRef(null)
  
  // States for the Duplicate Inspector
  const [currentDupIndex, setCurrentDupIndex] = useState(0)
  
  // States for Modal and Clean
  const [modalOpen, setModalOpen] = useState(false)
  const [modalConfig, setModalConfig] = useState({ type: '', title: '', msg: '' })
  const [successMsg, setSuccessMsg] = useState(null)

  // Log auto-scroll
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  const handleBrowse = async () => {
    try {
      const { data } = await api.browseFile()
      if (data.path) setPathInput(data.path)
    } catch (err) { console.error(err) }
  }

  
  const runAnalysis = async (path) => {
    setLoading(true); 
    setError(null); 
    setSuccessMsg(null); 
    setCurrentDupIndex(0);
    setLogs(["🚀 Initializing Deep Analysis..."]);
    setProgress({ current: 0, total: 0, percent: 0 });

    const cleanPath = path.replace(/"/g, '')

    try {
        // native fetch to read the NDJSON stream
        const response = await fetch('http://localhost:8000/api/analyze/local', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: cleanPath })
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
                    
                    if (data.type === 'log') {
                        setLogs(prev => [...prev, data.msg])
                    } 
                    else if (data.type === 'progress') {
                        setProgress({
                            current: data.current,
                            total: data.total,
                            percent: data.percent
                        })
                    }
                    else if (data.type === 'complete') {
                        setStats(data.data)
                        setCurrentDataset(data.data)
                        setLoading(false)
                    }
                    else if (data.type === 'error') {
                        setError(data.msg)
                        setLoading(false)
                    }
                } catch (e) { console.error("Parse error", e) }
            }
        }
    } catch (err) { 
        setError("Connection failed. Check backend.")
        setLoading(false)
    }
  }

  const handleAnalyzeSubmit = (e) => {
    e?.preventDefault()
    if (!pathInput.trim()) return
    runAnalysis(pathInput)
  }

  // Modal Configuration Cleaning
  const promptCleanup = (type) => {
    if (type === 'images') {
        setModalConfig({
            type: 'images',
            title: 'Remove Duplicate Images?',
            msg: `${stats.duplicate_images} duplicate images will be permanently deleted from disk. Only the first copy found for each group will be kept.`
        })
    } else if (type === 'labels') {
        const dupLabelCount = Object.values(stats.duplicate_labels || {}).reduce((a,b)=>a+b,0)
        setModalConfig({
            type: 'labels',
            title: 'Fix Duplicate Labels?',
            msg: `${dupLabelCount} duplicate boxes (same class, same coordinates) will be removed from annotation files.`
        })
    }
    setModalOpen(true)
  }

  const executeCleanup = async () => {
    setModalOpen(false)
    setLoading(true) 
    setLogs(["🧹 Cleaning up disk...", "Applying changes..."])
    
    try {
        const result = await api.cleanupDataset({
            dataset_path: stats.path,
            duplicate_groups: stats.duplicate_groups,
            clean_images: modalConfig.type === 'images',
            clean_labels: modalConfig.type === 'labels'
        })
        
        // success
        setSuccessMsg(`Cleanup Completed: Deleted ${result.deleted_images} images and fixed ${result.fixed_labels} labels.`)
        
        // Auto-Refresh
        setTimeout(() => {
            runAnalysis(pathInput)
        }, 1500)

    } catch (err) {
        setError("Critical error during cleanup: " + err.message)
        setLoading(false)
    }
  }

  // --- DATA PREPARATION  ---
  const barData = stats?.class_distribution ? Object.entries(stats.class_distribution)
    .sort((a,b) => b[1] - a[1]) 
    .map(([name, count]) => ({ name, count })) : []

  const pieData = stats?.box_size_distribution ? [
    { name: 'Small (<0.3%)', value: stats.box_size_distribution?.Small || 0 },
    { name: 'Medium (0.3-3%)', value: stats.box_size_distribution?.Medium || 0 },
    { name: 'Large (>3%)', value: stats.box_size_distribution?.Large || 0 },
  ].filter(d => d.value > 0) : []
  
  const dupGroups = stats?.duplicate_groups || []
  const hasDupImages = dupGroups.length > 0
  const totalDupLabels = stats?.duplicate_labels ? Object.values(stats.duplicate_labels).reduce((a,b)=>a+b,0) : 0

  return (
    <div className="space-y-6 relative min-h-screen pb-20">
      
      {/* HEADER */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-700/50 flex items-center justify-center shadow-inner relative overflow-hidden group">
              <div className="absolute inset-0 bg-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors"></div>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 relative z-10">
                  <path d="M3 3v18h18"/>
                  <rect x="7" y="10" width="4" height="7" rx="1" fill="currentColor" fillOpacity="0.2"/>
                  <rect x="14" y="5" width="4" height="12" rx="1" fill="currentColor" fillOpacity="0.2"/>
                  <circle cx="16" cy="5" r="2" fill="currentColor" className="text-blue-400"/>
              </svg>
          </div>
          <div>
              <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">
                  Dataset Analyzer
              </h2>
              <p className="text-slate-400 mt-1 font-medium">Deep inspection & automated cleaning tool</p>
          </div>
        </div>
      </div>

      {/* INPUT SECTION */}
      <div className="bg-slate-800/80 backdrop-blur-sm rounded-xl p-6 border border-slate-700 shadow-xl">
        <form onSubmit={handleAnalyzeSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2 uppercase tracking-wide">Dataset Location (data.yaml)</label>
                <div className="flex gap-3">
                    <button type="button" onClick={handleBrowse} className="bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white px-5 rounded-lg transition-all hover:shadow-lg flex items-center justify-center"><FolderOpen size={20} /></button>
                    <div className="relative flex-1">
                        <FileSearch className="absolute left-4 top-3.5 text-slate-500" size={20} />
                        <input type="text" value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder="C:\Users\Name\Datasets\Project\data.yaml" className="w-full bg-slate-900/50 border border-slate-600 rounded-lg py-3 pl-12 pr-4 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" />
                    </div>
                    <button type="submit" disabled={loading || !pathInput} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg font-bold transition-all shadow-lg hover:shadow-blue-500/30 flex items-center gap-2">
                        {loading ? 'Analyzing...' : 'Analyze'} {!loading && <Search size={20} />}
                    </button>
                </div>
            </div>
        </form>
      </div>

      {/* --- FEEDBACK MESSAGES --- */}
      {error && <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-200 flex items-center gap-3 animate-in fade-in slide-in-from-top-2"><AlertCircle size={24} /> <span className="font-medium">{error}</span></div>}
      
      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/50 rounded-lg p-4 text-emerald-200 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
            <CheckCircle2 size={24} className="text-emerald-400" /> 
            <span className="font-bold">{successMsg}</span>
        </div>
      )}

      {/* --- DASHBOARD --- */}
      {stats && !loading && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            
            {/* KPI CARDS */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard label="Images" value={stats.total_images} icon={<ImageIcon size={20} />} delay={0} />
                <StatCard label="Labels" value={stats.total_labels} icon={<Layers size={20} />} delay={100} />
                <StatCard label="Classes" value={stats.classes ? Object.keys(stats.classes).length : 0} icon={<PieIcon size={20} />} delay={200} />
                <StatCard label="Dup Images" value={stats.duplicate_images} icon={<Copy size={20} />} color={stats.duplicate_images > 0 ? "text-red-400" : "text-slate-400"} delay={300} />
                <StatCard label="Dup Labels" value={totalDupLabels} icon={<AlertTriangle size={20} />} color={totalDupLabels > 0 ? "text-amber-400" : "text-slate-400"} delay={400} />
            </div>
            
            {/* CHARTS */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* CLASS DISTRIBUTION CHART */}
                <div className="lg:col-span-2 bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-slate-700 shadow-xl">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <BarChart3 className="text-blue-400" /> Class Distribution
                        </h3>
                        <span className="text-xs text-slate-400 bg-slate-900 px-2 py-1 rounded border border-slate-700">Sorted by Frequency</span>
                    </div>
                    <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={barData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.2}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 12}} interval={0} angle={-15} textAnchor="end" height={60}/>
                                <YAxis stroke="#94a3b8" />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                    formatter={(value) => [value.toLocaleString(), 'Instances']}
                                />
                                <Bar dataKey="count" fill="url(#colorCount)" radius={[6, 6, 0, 0]} barSize={40} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* OBJECT SIZE DONUT CHART */}
                <div className="bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-slate-700 shadow-xl">
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <PieIcon className="text-emerald-400" /> Object Sizes
                    </h3>
                    <p className="text-xs text-slate-400 mb-6">Based on bounding box area relative to image</p>
                    
                    <div className="h-[300px] w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie 
                                    data={pieData} 
                                    cx="50%" cy="50%" 
                                    innerRadius={60} 
                                    outerRadius={90} 
                                    paddingAngle={5} 
                                    dataKey="value"
                                    stroke="none"
                                >
                                    {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                </Pie>
                                <Tooltip
                                  offset={20}
                                  wrapperStyle={{ zIndex: 1000 }}
                                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                                  labelStyle={{ color: '#fff' }}
                                  itemStyle={{ color: '#fff' }}
                                />
                                <Legend verticalAlign="bottom" height={36} iconType="circle" />
                            </PieChart>
                        </ResponsiveContainer>
                        {/* Center Text */}
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-[60%] text-center pointer-events-none">
                            <span className="text-3xl font-bold text-white">{stats.total_labels.toLocaleString()}</span>
                            <span className="block text-xs text-slate-400 uppercase tracking-wider">Objects</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* --- DATA CLEANING SECTION --- */}
            {(hasDupImages || totalDupLabels > 0) && (
                <div className="mt-10 pt-10 border-t border-slate-700">
                    <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                        <RefreshCw className="text-purple-400" /> Data Health Center
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        
                        {/* DUPLICATE IMAGES CLEANER */}
                        <div className={`rounded-xl border p-6 transition-all ${hasDupImages ? 'bg-red-900/10 border-red-500/30' : 'bg-slate-800/50 border-slate-700 opacity-50'}`}>
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <Copy size={18} className={hasDupImages ? "text-red-400" : "text-slate-400"} /> 
                                        Duplicate Images
                                    </h3>
                                    <p className="text-slate-400 text-sm mt-1">Identical files found in dataset</p>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-sm font-bold ${hasDupImages ? 'bg-red-500/20 text-red-300' : 'bg-slate-700 text-slate-400'}`}>
                                    {stats.duplicate_images} Issues
                                </span>
                            </div>

                            {hasDupImages && (
                                <>
                                    <div className="bg-slate-900/50 rounded-lg p-4 mb-4 border border-slate-800">
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="text-xs text-slate-400 font-mono">Preview Group {currentDupIndex + 1}/{dupGroups.length}</span>
                                            <div className="flex gap-1">
                                                <button onClick={() => setCurrentDupIndex(p => Math.max(0, p - 1))} className="p-1 hover:bg-slate-700 rounded"><ArrowLeft size={16} /></button>
                                                <button onClick={() => setCurrentDupIndex(p => Math.min(dupGroups.length-1, p + 1))} className="p-1 hover:bg-slate-700 rounded"><ArrowRight size={16} /></button>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 overflow-x-auto pb-2">
                                            {dupGroups[currentDupIndex]?.map((path, idx) => (
                                                <div key={idx} className={`relative flex-shrink-0 w-24 h-24 rounded border-2 overflow-hidden ${idx===0 ? 'border-emerald-500' : 'border-red-500'}`}>
                                                    <img src={api.getImageUrl(path)} className="w-full h-full object-cover" />
                                                    {idx===0 && <div className="absolute top-0 left-0 bg-emerald-600 text-[8px] text-white px-1">KEEP</div>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => promptCleanup('images')}
                                        className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-red-900/40"
                                    >
                                        <Trash2 size={18} /> Clean {stats.duplicate_images} Images
                                    </button>
                                </>
                            )}
                        </div>

                        {/* DUPLICATE LABELS CLEANER */}
                        <div className={`rounded-xl border p-6 transition-all ${totalDupLabels > 0 ? 'bg-amber-900/10 border-amber-500/30' : 'bg-slate-800/50 border-slate-700 opacity-50'}`}>
                             <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <AlertTriangle size={18} className={totalDupLabels > 0 ? "text-amber-400" : "text-slate-400"} /> 
                                        Duplicate Labels
                                    </h3>
                                    <p className="text-slate-400 text-sm mt-1">Overlapping boxes (same class & coords)</p>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-sm font-bold ${totalDupLabels > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-400'}`}>
                                    {totalDupLabels} Issues
                                </span>
                            </div>

                            {totalDupLabels > 0 ? (
                                <>
                                    <div className="bg-slate-900/50 rounded-lg p-4 mb-4 border border-slate-800 max-h-[140px] overflow-y-auto custom-scrollbar">
                                        <table className="w-full text-left text-sm">
                                            <thead>
                                                <tr className="text-slate-500 border-b border-slate-800">
                                                    <th className="pb-2">Class</th>
                                                    <th className="pb-2 text-right">Duplicates</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {Object.entries(stats.duplicate_labels).map(([cls, count]) => (
                                                    <tr key={cls} className="border-b border-slate-800/50">
                                                        <td className="py-2 text-slate-300">{cls}</td>
                                                        <td className="py-2 text-right text-amber-400 font-mono">{count}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <button 
                                        onClick={() => promptCleanup('labels')}
                                        className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-amber-900/40"
                                    >
                                        <CheckCircle2 size={18} /> Fix {totalDupLabels} Labels
                                    </button>
                                </>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-500 pb-6">
                                    <CheckCircle2 size={40} className="text-emerald-500/50 mb-2" />
                                    <p>All annotations appear consistent.</p>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            )}
        </div>
      )}

      {/* --- MODAL CONFIRMS --- */}
      {modalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setModalOpen(false)}></div>
            <div className="bg-slate-800 rounded-xl border border-red-500/50 shadow-2xl w-full max-w-md relative z-10 overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="bg-red-500/10 p-6 border-b border-red-500/20 flex items-center gap-4">
                    <div className="p-3 bg-red-500/20 rounded-full text-red-400">
                        <AlertTriangle size={32} />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-white">Attention Required</h3>
                        <p className="text-red-300 text-sm">Destructive disk operation</p>
                    </div>
                </div>
                <div className="p-6">
                    <h4 className="text-lg font-semibold text-white mb-2">{modalConfig.title}</h4>
                    <p className="text-slate-400 leading-relaxed mb-6">
                        {modalConfig.msg}
                        <br/><br/>
                        <span className="text-red-400 font-bold">This operation is irreversible.</span>
                    </p>
                    <div className="flex gap-3 justify-end">
                        <button 
                            onClick={() => setModalOpen(false)}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={executeCleanup}
                            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold shadow-lg transition-colors flex items-center gap-2"
                        >
                            <Trash2 size={18} /> Proceed with Cleanup
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* --- LOADER: TERMINAL STYLE + PROGRESS --- */}
      {loading && createPortal(
        <div 
          className="fixed inset-0 w-full h-full z-[99999] bg-slate-900/95 backdrop-blur-xl flex flex-col items-center justify-center p-8"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <div className="w-full max-w-2xl bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
              <div>
                <h2 className="text-2xl font-bold text-white">Analyzing Dataset...</h2>
                <p className="text-blue-300 font-mono">Deep scanning structure, hashing files, checking integrity.</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mb-2 flex justify-between text-sm font-bold text-slate-300">
              <span>Progress</span>
              <span>{progress.current} / {progress.total} ({progress.percent}%)</span>
            </div>
            <div className="w-full h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-700 mb-6">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all duration-300 ease-out"
                style={{ width: `${progress.percent}%` }}
              />
            </div>

            {/* Log Terminal */}
            <div className="bg-black rounded-lg p-4 font-mono text-xs h-40 overflow-y-auto border border-slate-700 text-slate-400 custom-scrollbar shadow-inner">
              {logs.map((log, i) => (
                <div key={i} className="mb-1 border-l-2 border-slate-700 pl-2">{log}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}

function StatCard({ label, value = 0, icon, color = "text-blue-400", subtext, delay }) {
    const safeValue = (value === undefined || value === null) ? 0 : value;
    return (
      <div 
        className="bg-slate-800/60 backdrop-blur-sm border border-slate-700 rounded-xl p-5 flex flex-col justify-between shadow-lg hover:border-blue-500/30 transition-all duration-300 hover:-translate-y-1 animate-in fade-in slide-in-from-bottom-4"
        style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-slate-400 uppercase font-bold tracking-widest">{label}</div>
          <div className={`p-2 rounded-lg bg-slate-900/50 ${color.replace('text-', 'text-opacity-80 ')}`}>{icon}</div>
        </div>
        <div>
          <div className={`text-3xl font-black ${color}`}>
              {safeValue.toLocaleString()}
          </div>
          {subtext && <div className="text-xs text-slate-500 mt-1 font-medium">{subtext}</div>}
        </div>
      </div>
    )
  }