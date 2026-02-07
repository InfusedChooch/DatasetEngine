import { useState, useRef, useEffect } from 'react'
import { api } from '../lib/api'
import { createPortal } from 'react-dom' // IMPORTANTE: Importato createPortal
import { 
    GitMerge, FolderOpen, Plus, ArrowRight, Trash2, 
    AlertCircle, CheckCircle2, Database, Settings2, X, Terminal, Target
} from 'lucide-react'

export default function MergerPage() {
    // --- STATE ---
    const [master, setMaster] = useState(null)
    const [clients, setClients] = useState([]) 
    const [outputDir, setOutputDir] = useState('')
    
    // Split Configuration
    const [split, setSplit] = useState({ train: 70, val: 20, test: 10 })
    
    // Target Classes
    const [targetClasses, setTargetClasses] = useState([])
    
    // Mappings
    const [mappings, setMappings] = useState({})
    
    // UI States
    const [loading, setLoading] = useState(false) // Loader semplice per caricamento file
    const [merging, setMerging] = useState(false) // Loader WOW per il merge
    
    // PROGRESS STATE
    const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 })
    const [logs, setLogs] = useState([])
    const logsEndRef = useRef(null)

    const [result, setResult] = useState(null)
    const [error, setError] = useState(null)
    const [notification, setNotification] = useState(null)
    
    const [showClassModal, setShowClassModal] = useState(false)
    const [newClassName, setNewClassName] = useState('')

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [logs])

    const showToast = (msg, type = 'error') => {
        setNotification({ msg, type })
        setTimeout(() => setNotification(null), 3000)
    }

    // --- HANDLERS ---
    const handleBrowseMaster = async () => {
        try {
            const { data } = await api.browseFile()
            if(!data.path) return;
            loadDataset(data.path, true)
        } catch (err) { console.error(err) }
    }

    const handleAddClient = async () => {
        try {
            const { data } = await api.browseFile()
            if(!data.path) return;
            if(clients.find(c => c.path === data.path) || master?.path === data.path) {
                showToast("Dataset already in list!", "error")
                return;
            }
            loadDataset(data.path, false)
        } catch (err) { console.error(err) }
    }

    const loadDataset = async (path, isMaster) => {
        setLoading(true); setError(null);
        try {
            const res = await api.getDatasetInfo(path)
            const info = res.data
            
            if(isMaster) {
                setMaster(info)
                const initialTargets = Object.values(info.classes).map((name, i) => ({ id: i, name }))
                setTargetClasses(initialTargets)
                
                if(info.total_images > 0) {
                    const s = info.split_stats
                    const tr = Math.round((s.train / info.total_images) * 100)
                    const val = Math.round((s.val / info.total_images) * 100)
                    const te = 100 - tr - val
                    const diff = 100 - (tr + val + te)
                    setSplit({ train: tr, val: val, test: te + diff })
                }
                
                const masterMap = {}
                Object.keys(info.classes).forEach(k => {
                    masterMap[k] = { action: 'map', targetId: parseInt(k) }
                })
                setMappings(prev => ({ ...prev, 0: masterMap }))

            } else {
                setClients(prev => [...prev, info])
                const clientIdx = clients.length + 1 
                const clientMap = {}
                Object.entries(info.classes).forEach(([cid, cname]) => {
                    const match = targetClasses.find(t => t.name.toLowerCase() === cname.toLowerCase())
                    if(match) clientMap[cid] = { action: 'map', targetId: match.id }
                    else clientMap[cid] = { action: 'exclude', targetId: -1 }
                })
                setMappings(prev => ({ ...prev, [clientIdx]: clientMap }))
            }
        } catch (err) { setError("Error loading dataset info. Is backend running?") } 
        finally { setLoading(false) }
    }

    const handleBrowseOutput = async () => {
        try {
            const res = await api.browseFolder()
            if(res.data.path) setOutputDir(res.data.path)
        } catch(e) { console.error(e) }
    }

    // --- MAPPING LOGIC ---
    const confirmAddClass = () => {
        if(!newClassName.trim()) return;
        if(targetClasses.find(t => t.name === newClassName)) return showToast("Class name already exists!", "error")
        setTargetClasses(prev => [...prev, { id: prev.length, name: newClassName }])
        setNewClassName('')
        setShowClassModal(false)
        showToast("New output class created!", "success")
    }

    const updateMapping = (datasetIdx, srcId, action, targetId) => {
        setMappings(prev => ({
            ...prev,
            [datasetIdx]: { ...prev[datasetIdx], [srcId]: { action, targetId: parseInt(targetId) } }
        }))
    }

    // --- SPLIT LOGIC ---
    const handleSplitChange = (field, value) => {
        let v = parseInt(value);
        if (isNaN(v)) v = 0;
        v = Math.max(0, Math.min(100, v));
        setSplit(prev => ({ ...prev, [field]: v }))
    }

    const totalSplit = split.train + split.val + split.test;
    const isSplitValid = totalSplit === 100;

    // --- EXECUTION ---
    const handleMerge = async () => {
        if(!outputDir) return showToast("Please select an output folder.", "error")
        if(!isSplitValid) return showToast(`Split ratios must sum to 100% (Current: ${totalSplit}%)`, "error")

        setMerging(true)
        setLogs(["🚀 Initializing merge..."])
        setProgress({ current: 0, total: 0, percent: 0 })
        setError(null)
        
        const datasetsList = [master, ...clients]
        const flatMappings = []
        Object.entries(mappings).forEach(([dsIdx, classMap]) => {
            Object.entries(classMap).forEach(([srcId, rule]) => {
                flatMappings.push({
                    dataset_index: parseInt(dsIdx),
                    source_class_id: parseInt(srcId),
                    target_class_id: rule.action === 'exclude' ? -1 : rule.targetId
                })
            })
        })

        const payload = {
            datasets: datasetsList,
            target_classes: targetClasses.map(t => t.name),
            mappings: flatMappings,
            output_path: outputDir,
            split_ratios: [split.train/100, split.val/100, split.test/100]
        }

        try {
            const response = await fetch('http://localhost:8000/api/merge/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
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
                        else if (data.type === 'progress') {
                            setProgress({ current: data.current, total: data.total, percent: data.percent })
                        }
                        else if (data.type === 'complete') {
                            setResult(data.data)
                            setMerging(false)
                        }
                    } catch (e) { console.error("Parse error", e) }
                }
            }
        } catch (err) {
            setError("Connection failed.")
            setMerging(false)
        }
    }

    const renderClassRow = (dsIdx, srcId, srcName) => {
        const currentRule = mappings[dsIdx]?.[srcId] || { action: 'exclude' }
        return (
            <div key={`${dsIdx}-${srcId}`} className="grid grid-cols-12 gap-2 items-center bg-slate-800/50 p-2 rounded mb-1 text-sm border border-slate-700">
                <div className="col-span-3 text-slate-300 font-medium truncate" title={srcName}>{srcName}</div>
                <div className="col-span-1 flex justify-center"><ArrowRight size={16} className="text-slate-500"/></div>
                <div className="col-span-3">
                    <select 
                        className={`w-full bg-slate-900 border rounded px-2 py-1 outline-none ${currentRule.action === 'exclude' ? 'text-red-400 border-red-900' : 'text-emerald-400 border-emerald-900'}`}
                        value={currentRule.action}
                        onChange={(e) => {
                            const newAction = e.target.value
                            const newTarget = newAction === 'map' ? (currentRule.targetId > -1 ? currentRule.targetId : 0) : -1
                            updateMapping(dsIdx, srcId, newAction, newTarget)
                        }}
                    >
                        <option value="map">Map to...</option>
                        <option value="exclude">Exclude</option>
                    </select>
                </div>
                <div className="col-span-5">
                    {currentRule.action === 'map' && (
                        <select 
                            className="w-full bg-slate-700 text-white rounded px-2 py-1 border border-slate-600 outline-none"
                            value={currentRule.targetId}
                            onChange={(e) => updateMapping(dsIdx, srcId, 'map', e.target.value)}
                        >
                            {targetClasses.map(t => <option key={t.id} value={t.id}>{t.name} (ID: {t.id})</option>)}
                        </select>
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-8 pb-20 max-w-6xl mx-auto relative min-h-screen">
            
            {/* NOTIFICATIONS */}
            {notification && (
                <div className={`fixed top-4 right-4 z-[9999] px-6 py-4 rounded-lg shadow-2xl border flex items-center gap-3 animate-in slide-in-from-right duration-300 ${
                    notification.type === 'error' ? 'bg-red-900/90 border-red-500 text-white' : 'bg-emerald-900/90 border-emerald-500 text-white'
                }`}>
                    {notification.type === 'error' ? <AlertCircle /> : <CheckCircle2 />}
                    <span className="font-bold">{notification.msg}</span>
                </div>
            )}

            {/* HEADER */}
            <div>
                <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">Dataset Merger</h1>
                <p className="text-slate-400 mt-2">Combine datasets, remap classes, and regenerate splits.</p>
            </div>

            {error && <div className="bg-red-500/10 p-4 rounded-lg text-red-200 border border-red-500/30 flex items-center gap-2"><AlertCircle/> {error}</div>}

            {/* STEP 1: DATASETS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* MASTER */}
                <div className="bg-slate-800/60 backdrop-blur border border-slate-700 rounded-xl p-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Database size={100} /></div>
                    <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><div className="w-3 h-8 bg-purple-500 rounded-full"/> Master Dataset</h3>
                    {!master ? (
                        <button onClick={handleBrowseMaster} disabled={loading} className="w-full py-8 border-2 border-dashed border-slate-600 rounded-lg hover:border-purple-500 hover:bg-slate-800/50 transition-all flex flex-col items-center gap-2 text-slate-400">
                            <FolderOpen size={32} />
                            <span>{loading ? 'Loading...' : 'Load Master data.yaml'}</span>
                        </button>
                    ) : (
                        <div>
                            <div className="flex justify-between items-start mb-4 relative z-20">
                                <div>
                                    <div className="text-lg font-bold text-purple-300">{master.name}</div>
                                    <div className="text-sm text-slate-400 truncate max-w-[250px]">{master.path}</div>
                                </div>
                                <button onClick={(e) => {e.stopPropagation(); setMaster(null); setClients([]); setMappings({});}} className="p-2 bg-slate-700 hover:bg-red-600 text-white rounded shadow-lg transition-colors cursor-pointer relative z-50">
                                    <Trash2 size={18}/>
                                </button>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center text-sm relative z-10">
                                <div className="bg-slate-900/50 p-2 rounded border border-slate-700">
                                    <div className="text-slate-400 text-xs">Images</div>
                                    <div className="font-bold text-white">{master.total_images}</div>
                                </div>
                                <div className="bg-slate-900/50 p-2 rounded border border-slate-700">
                                    <div className="text-slate-400 text-xs">Classes</div>
                                    <div className="font-bold text-white">{Object.keys(master.classes).length}</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* CLIENTS */}
                <div className={`bg-slate-800/60 backdrop-blur border border-slate-700 rounded-xl p-6 ${!master ? 'opacity-40 pointer-events-none' : ''}`}>
                    <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><div className="w-3 h-8 bg-pink-500 rounded-full"/> Client Datasets</h3>
                    <div className="space-y-3 mb-4 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                        {clients.map((c, i) => (
                            <div key={i} className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 flex justify-between items-center animate-in slide-in-from-right-2">
                                <div>
                                    <div className="font-bold text-white">{c.name}</div>
                                    <div className="text-xs text-slate-400">{c.total_images} imgs • {Object.keys(c.classes).length} cls</div>
                                </div>
                                <button onClick={() => {
                                    const newC = [...clients]; newC.splice(i,1); setClients(newC);
                                    const newM = {...mappings}; delete newM[i+1]; setMappings(newM);
                                }} className="text-slate-500 hover:text-red-400"><Trash2 size={16}/></button>
                            </div>
                        ))}
                    </div>
                    <button onClick={handleAddClient} className="w-full py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium text-white flex items-center justify-center gap-2 transition-colors">
                        <Plus size={18} /> Add Client Dataset
                    </button>
                </div>
            </div>

            {/* MAPPING & CONFIG SECTIONS */}
            {master && (
                <>
                    {/* MAPPING */}
                    <div className="bg-slate-800/60 backdrop-blur border border-slate-700 rounded-xl p-6 animate-in fade-in slide-in-from-bottom-4">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2"><Settings2 /> Class Mapping Matrix</h3>
                            <button onClick={() => setShowClassModal(true)} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-bold flex items-center gap-2">
                                <Plus size={16}/> New Output Class
                            </button>
                        </div>

                        {/* NEW: Final Output Classes Preview */}
                        <div className="mb-6 bg-slate-900/30 p-4 rounded-lg border border-slate-700">
                            <div className="text-xs text-slate-400 uppercase font-bold mb-2 flex items-center gap-2"><Target size={14}/> Final Output Classes (Targets)</div>
                            <div className="flex flex-wrap gap-2">
                                {targetClasses.map(t => (
                                    <span key={t.id} className="px-3 py-1 bg-purple-900/50 border border-purple-500/30 text-purple-200 text-xs rounded-full font-mono">
                                        {t.id}: {t.name}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <div>
                                <h4 className="text-sm font-bold text-purple-400 uppercase mb-3">Source: {master.name} (Master)</h4>
                                <div className="space-y-1">{Object.entries(master.classes).map(([id, name]) => renderClassRow(0, id, name))}</div>
                            </div>
                            <div className="space-y-6">
                                {clients.map((c, i) => (
                                    <div key={i}>
                                        <h4 className="text-sm font-bold text-pink-400 uppercase mb-3">Source: {c.name}</h4>
                                        <div className="space-y-1">{Object.entries(c.classes).map(([id, name]) => renderClassRow(i+1, id, name))}</div>
                                    </div>
                                ))}
                                {clients.length === 0 && <div className="text-slate-500 italic text-sm p-4 text-center border border-dashed border-slate-700 rounded">Add client datasets to see mapping options...</div>}
                            </div>
                        </div>
                    </div>

                    {/* CONFIG & EXECUTE */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-8">
                        <div className="lg:col-span-2 bg-slate-800/60 backdrop-blur border border-slate-700 rounded-xl p-6">
                            <h3 className="text-lg font-bold text-white mb-4">Re-Split Strategy</h3>
                            <div className="space-y-6">
                                <div>
                                    <div className="flex justify-between text-sm mb-2">
                                        <span className="text-emerald-400 font-bold">Train: {split.train}%</span>
                                        <span className="text-blue-400 font-bold">Val: {split.val}%</span>
                                        <span className="text-amber-400 font-bold">Test: {split.test}%</span>
                                    </div>
                                    <div className={`h-4 bg-slate-700 rounded-full flex overflow-hidden border ${!isSplitValid ? 'border-red-500' : 'border-transparent'}`}>
                                        <div style={{width: `${split.train}%`}} className="bg-emerald-500 transition-all duration-300"/>
                                        <div style={{width: `${split.val}%`}} className="bg-blue-500 transition-all duration-300"/>
                                        <div style={{width: `${split.test}%`}} className="bg-amber-500 transition-all duration-300"/>
                                    </div>
                                    {!isSplitValid && <div className="text-red-400 text-xs font-bold mt-1 text-right">Total: {totalSplit}% (Must be 100%)</div>}
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <label className="block"><span className="text-xs text-slate-400">Train %</span><input type="number" min="0" max="100" value={split.train} onChange={e => handleSplitChange('train', e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white outline-none focus:border-purple-500"/></label>
                                    <label className="block"><span className="text-xs text-slate-400">Val %</span><input type="number" min="0" max="100" value={split.val} onChange={e => handleSplitChange('val', e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white outline-none focus:border-purple-500"/></label>
                                    <label className="block"><span className="text-xs text-slate-400">Test %</span><input type="number" min="0" max="100" value={split.test} onChange={e => handleSplitChange('test', e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white outline-none focus:border-purple-500"/></label>
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-800/60 backdrop-blur border border-slate-700 rounded-xl p-6 flex flex-col justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-white mb-2">Output Location</h3>
                                <button onClick={handleBrowseOutput} className="w-full py-2 bg-slate-700 hover:bg-slate-600 rounded border border-slate-600 text-xs text-slate-300 truncate mb-4">
                                    {outputDir || "Select Folder..."}
                                </button>
                            </div>
                            <button onClick={handleMerge} disabled={merging || !outputDir || !isSplitValid} className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-black text-lg rounded-xl shadow-lg shadow-purple-500/20 disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
                                <GitMerge /> {merging ? 'MERGING...' : 'EXECUTE MERGE'}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* CLASS MODAL */}
            {showClassModal && (
                <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
                    <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 w-full max-w-sm animate-in zoom-in-95">
                        <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold text-white">New Output Class</h3><button onClick={() => setShowClassModal(false)}><X className="text-slate-400 hover:text-white"/></button></div>
                        <input autoFocus type="text" placeholder="Class Name (e.g. 'Ball')" value={newClassName} onChange={(e) => setNewClassName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmAddClass()} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white mb-4 outline-none focus:border-purple-500"/>
                        <div className="flex justify-end gap-2"><button onClick={() => setShowClassModal(false)} className="px-4 py-2 text-slate-300 hover:text-white">Cancel</button><button onClick={confirmAddClass} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold">Create</button></div>
                    </div>
                </div>
            )}

            {/* MERGE PROGRESS OVERLAY - USING PORTAL FOR FULL SCREEN */}
            {merging && createPortal(
                <div 
                    className="fixed inset-0 w-full h-full z-[99999] bg-slate-900/95 backdrop-blur-xl flex flex-col items-center justify-center p-8"
                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
                >
                    <div className="w-full max-w-2xl bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"/>
                            <div>
                                <h2 className="text-2xl font-bold text-white">Merging Datasets...</h2>
                                <p className="text-purple-300 font-mono">Mixing images, remapping labels...</p>
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="mb-2 flex justify-between text-sm font-bold text-slate-300">
                            <span>Processing...</span>
                            <span>{progress.current} / {progress.total} ({progress.percent}%)</span>
                        </div>
                        <div className="w-full h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-700 mb-6">
                            <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300 ease-out" style={{ width: `${progress.percent}%` }} />
                        </div>

                        {/* Log Terminal */}
                        <div className="bg-black rounded-lg p-4 font-mono text-xs h-40 overflow-y-auto border border-slate-700 text-slate-400 custom-scrollbar shadow-inner">
                            {logs.map((log, i) => <div key={i} className="mb-1 border-l-2 border-slate-700 pl-2">{log}</div>)}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* RESULT SUCCESS MODAL */}
            {result && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 border border-emerald-500/50 rounded-2xl p-8 max-w-lg w-full shadow-2xl animate-in zoom-in-95">
                        <div className="flex flex-col items-center text-center">
                            <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400 mb-4"><CheckCircle2 size={40} /></div>
                            <h2 className="text-3xl font-bold text-white mb-2">Merge Complete!</h2>
                            <code className="bg-black/50 p-3 rounded text-sm text-emerald-300 font-mono break-all w-full mb-6">{result.output_path}</code>
                            <div className="grid grid-cols-2 gap-4 w-full mb-6">
                                <div className="bg-slate-900 p-3 rounded border border-slate-700"><div className="text-xs text-slate-500 uppercase">Processed</div><div className="text-xl font-bold text-white">{result.total_processed}</div></div>
                                <div className="bg-slate-900 p-3 rounded border border-slate-700"><div className="text-xs text-slate-500 uppercase">Final Classes</div><div className="text-xl font-bold text-white">{result.classes.length}</div></div>
                            </div>
                            <button onClick={() => setResult(null)} className="px-8 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}