import { useState, useEffect, useRef, useCallback } from 'react'
import { FolderOpen, Filter, Layers, SquareSquare, Maximize, Target, RotateCcw, X, ZoomIn, Info, MousePointer2, Image as ImageIcon, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { CLASS_COLORS } from './InferenceViewer'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'

export default function DatasetViewerPage() {
  const [yamlPath, setYamlPath] = useState('')
  const [datasetInfo, setDatasetInfo] = useState(null)
  
  // States - Filters
  const [splits, setSplits] = useState(['all'])
  const [selectedClasses, setSelectedClasses] = useState([])
  const [boxRange, setBoxRange] = useState({ min: 0, max: 100 })
  const [areaRange, setAreaRange] = useState({ min: 0.0, max: 1.0 })

  // States - Pagination & Data
  const [images, setImages] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false) 
  const [isInitializing, setIsInitializing] = useState(false) 
  const [totalMatches, setTotalMatches] = useState(0)

  // Modal State
  const [selectedImage, setSelectedImage] = useState(null)

  // Intersection Observer for infinite scroll
  const observer = useRef()
  const lastImageElementRef = useCallback(node => {
    if (loading) return
    if (observer.current) observer.current.disconnect()
    
    // Start loading 500px BEFORE the end for a perfectly smooth scroll
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) setPage(prev => prev + 1)
    }, { rootMargin: '500px' })
    
    if (node) observer.current.observe(node)
  }, [loading, hasMore])

  const handleBrowse = async () => {
      try {
          const { data } = await api.browseViewerYaml()
          if(data.path) setYamlPath(data.path)
      } catch(e) {}
  }

  const loadDataset = async () => {
      if(!yamlPath) return alert("Select a YAML first")
      setIsInitializing(true) 
      try {
          const { data } = await api.loadViewerDataset(yamlPath)
          setDatasetInfo(data)
          resetFilters(false)
          await fetchImages(1, true)
      } catch(e) { alert(`Failed to load dataset: ${e.response?.data?.detail || e.message || e}`) }
      setIsInitializing(false) 
  }

  const fetchImages = async (pageNum, reset = false) => {
      setLoading(true)
      try {
          const body = {
              splits,
              classes: selectedClasses.length > 0 ? selectedClasses : null,
              min_boxes: boxRange.min,
              max_boxes: boxRange.max < 100 ? boxRange.max : null,
              min_area: areaRange.min,
              max_area: areaRange.max,
              page: pageNum,
              limit: 20
          }
          const { data } = await api.queryViewerImages(body)
          setImages(prev => reset ? data.data : [...prev, ...data.data])
          setHasMore(data.has_more)
          setTotalMatches(data.total_matches)
      } catch(e) { console.error('Failed to query images:', e) }
      setLoading(false)
  }

  useEffect(() => {
      if(!datasetInfo) return;
      setImages([]); setPage(1);
      fetchImages(1, true);
  }, [splits, selectedClasses, boxRange, areaRange])

  useEffect(() => {
      if(page > 1) fetchImages(page, false)
  }, [page])

  const toggleSplit = (s) => {
      if(s === 'all') setSplits(['all'])
      else {
          let next = splits.filter(x => x !== 'all')
          if(next.includes(s)) next = next.filter(x => x !== s)
          else next.push(s)
          setSplits(next.length === 0 ? ['all'] : next)
      }
  }

  const toggleClass = (id) => {
      if(selectedClasses.includes(id)) setSelectedClasses(selectedClasses.filter(x => x !== id))
      else setSelectedClasses([...selectedClasses, id])
  }

  const resetFilters = (fetchAfter = true) => {
      setSplits(['all'])
      setSelectedClasses([])
      setBoxRange({ min: 0, max: 100 })
      setAreaRange({ min: 0.0, max: 1.0 })
      if(fetchAfter) {
          setImages([]); setPage(1);
      }
  }

  return (
    <div className="h-[calc(100vh-100px)] flex flex-col gap-6">
        
      {/* CSS INJECTED FOR APPLE-STYLE SCROLLBAR */}
      <style>{`
        .modern-scrollbar::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .modern-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .modern-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(71, 85, 105, 0.4); 
          border-radius: 10px;
          border: 3px solid transparent;
          background-clip: padding-box;
        }
        .modern-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(100, 116, 139, 0.8);
        }
      `}</style>

      {/* HEADER  */}
      <div className="shrink-0 flex items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-700/50 flex items-center justify-center shadow-inner relative overflow-hidden group">
            <div className="absolute inset-0 bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors"></div>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 relative z-10">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
        </div>
        <div>
          <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
            Dataset Viewer
          </h2>
          <p className="text-slate-400 font-medium mt-1">Visually explore datasets, apply advanced filters, and inspect bounding boxes.</p>
        </div>
      </div>

      {/* main content */}
      <div className="flex gap-6 flex-1 min-h-0">
          
          {/* SIDEBAR FILTERS */}
          <div className="w-80 flex flex-col gap-5 bg-slate-900/50 border border-slate-800 rounded-2xl p-5 overflow-y-auto modern-scrollbar shadow-inner">
              
              <div className="mb-2">
                  <div className="flex items-center gap-2 mb-3">
                      <div className="w-1.5 h-5 bg-blue-500 rounded-full"></div>
                      <h3 className="font-bold text-white tracking-wider">Load Dataset</h3>
                  </div>
                  
                  {/* YAML BUTTON WITH VISUAL FEEDBACK */}
                  <button 
                      onClick={handleBrowse} 
                      className={`w-full py-3 border border-dashed rounded-lg flex items-center justify-center gap-2 transition-all duration-300 ${
                          yamlPath 
                          ? 'border-emerald-500/50 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
                          : 'border-slate-600 hover:border-blue-500 hover:bg-slate-800/50 text-slate-300'
                      }`}
                      title={yamlPath || 'Select data.yaml'}
                  >
                      {yamlPath ? <CheckCircle2 size={18} className="shrink-0" /> : <FolderOpen size={18} className="shrink-0" />}
                      <span className="truncate px-2 text-sm font-medium">
                          {yamlPath ? 'data.yaml Selected' : 'Select data.yaml'}
                      </span>
                  </button>

                  <button onClick={loadDataset} disabled={!yamlPath || isInitializing} className="w-full mt-2 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-bold transition-all shadow-lg shadow-blue-500/20">
                      {isInitializing ? 'Loading...' : 'Load Dataset'}
                  </button>
              </div>

              {datasetInfo && (
              <div className="flex flex-col gap-6">
                  
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 mt-2">
                      <div className="flex items-center gap-2">
                          <div className="w-1.5 h-5 bg-blue-500 rounded-full"></div>
                          <h3 className="font-bold text-white tracking-wider flex items-center gap-2"><Filter size={16} className="text-blue-500"/> Filters</h3>
                      </div>
                      <button onClick={resetFilters} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 font-medium transition-colors"><RotateCcw size={12}/> Reset All</button>
                  </div>

                  {/* SPLITS */}
                  <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Layers size={14}/> Splits</label>
                      <div className="flex flex-wrap gap-2">
                          <button onClick={()=>toggleSplit('all')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all border ${splits.includes('all') ? 'bg-blue-600 border-blue-500 text-white shadow-md' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}>All</button>
                          {datasetInfo.splits.map(s => (
                              <button key={s} onClick={()=>toggleSplit(s)} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all border ${splits.includes(s) ? 'bg-purple-600 border-purple-500 text-white shadow-md' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}>{s.toUpperCase()}</button>
                          ))}
                      </div>
                  </div>

                  {/* BOX COUNTS - MODERN SLIDERS */}
                  <div className="space-y-3">
                      <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><SquareSquare size={14}/> Objects Count</label>
                          <span className="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded-md">100 = Any</span>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 space-y-3">
                          <div className="flex items-center gap-3">
                              <span className="text-[10px] font-bold text-slate-500 uppercase w-6">Min</span>
                              <input type="range" min="0" max="100" value={boxRange.min} onChange={e => setBoxRange({...boxRange, min: parseInt(e.target.value)})} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                              <input type="text" value={boxRange.min} onChange={e => setBoxRange({...boxRange, min: parseInt(e.target.value.replace(/\D/g,''))||0})} className="w-12 bg-black/50 border border-slate-700 rounded-md py-1 text-center text-xs font-mono text-slate-300 outline-none focus:border-blue-500 transition-colors" />
                          </div>
                          <div className="flex items-center gap-3">
                              <span className="text-[10px] font-bold text-slate-500 uppercase w-6">Max</span>
                              <input type="range" min="0" max="100" value={boxRange.max} onChange={e => setBoxRange({...boxRange, max: parseInt(e.target.value)})} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                              <input type="text" value={boxRange.max} onChange={e => setBoxRange({...boxRange, max: parseInt(e.target.value.replace(/\D/g,''))||0})} className="w-12 bg-black/50 border border-slate-700 rounded-md py-1 text-center text-xs font-mono text-slate-300 outline-none focus:border-blue-500 transition-colors" />
                          </div>
                      </div>
                  </div>

                  {/* BOX AREAS - PERFECT MATCH */}
                  <div className="space-y-3">
                      <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Maximize size={14}/> Object Area Size</label>
                          <span className="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded-md">% of image</span>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 space-y-3">
                          <div className="flex items-center gap-3">
                              <span className="text-[10px] font-bold text-slate-500 uppercase w-6">Min</span>
                              <input type="range" min="0" max="100" value={Math.round(areaRange.min*100)} onChange={e => setAreaRange({...areaRange, min: (parseInt(e.target.value)||0)/100})} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500" />
                              <input type="text" value={Math.round(areaRange.min*100)} onChange={e => setAreaRange({...areaRange, min: (parseInt(e.target.value.replace(/\D/g,''))||0)/100})} className="w-12 bg-black/50 border border-slate-700 rounded-md py-1 text-center text-xs font-mono text-slate-300 outline-none focus:border-purple-500 transition-colors" />
                          </div>
                          <div className="flex items-center gap-3">
                              <span className="text-[10px] font-bold text-slate-500 uppercase w-6">Max</span>
                              <input type="range" min="0" max="100" value={Math.round(areaRange.max*100)} onChange={e => setAreaRange({...areaRange, max: (parseInt(e.target.value)||0)/100})} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500" />
                              <input type="text" value={Math.round(areaRange.max*100)} onChange={e => setAreaRange({...areaRange, max: (parseInt(e.target.value.replace(/\D/g,''))||0)/100})} className="w-12 bg-black/50 border border-slate-700 rounded-md py-1 text-center text-xs font-mono text-slate-300 outline-none focus:border-purple-500 transition-colors" />
                          </div>
                      </div>
                  </div>

                  {/* CLASSES */}
                  <div className="space-y-3 flex-1">
                      <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Target size={14}/> Must Contain</label>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                          {datasetInfo.classes.map((cls, i) => {
                              const isSel = selectedClasses.includes(i);
                              const color = CLASS_COLORS[i % CLASS_COLORS.length];
                              return (
                                  <button 
                                      key={i} onClick={()=>toggleClass(i)}
                                      className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${isSel ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-600'}`}
                                      style={{borderColor: isSel ? color : '', backgroundColor: isSel ? `${color}20` : ''}}
                                  >
                                      {cls}
                                  </button>
                              )
                          })}
                      </div>
                  </div>
              </div>
              )}
          </div>

          {/* GALLERY AREA */}
          <div className="flex-1 bg-slate-900/30 rounded-2xl border border-slate-800 overflow-hidden flex flex-col relative shadow-inner">
              
              {/* HEADER GALLERY */}
              <div className="bg-slate-900/80 backdrop-blur-xl p-4 border-b border-slate-800 flex justify-between items-center z-10 shadow-lg">
                  <div className="flex items-center gap-3">
                      <ImageIcon size={20} className="text-slate-500"/>
                      <span className="text-slate-300 font-medium">Gallery View</span>
                  </div>
                  {datasetInfo && (
                      <div className="bg-emerald-900/30 border border-emerald-500/30 px-4 py-1.5 rounded-full flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                          <span className="text-emerald-400 text-xs font-bold tracking-wider uppercase">{totalMatches} Results</span>
                      </div>
                  )}
              </div>

              {/* IMAGE GRID */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 modern-scrollbar relative">
                  {!datasetInfo && !isInitializing ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-500">
                          <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-6 shadow-inner border border-slate-700">
                            <FolderOpen size={40} className="text-slate-400"/>
                          </div>
                          <h3 className="text-xl font-bold text-slate-300 mb-2">No Dataset Loaded</h3>
                          <p className="text-sm">Select and load a YAML file from the sidebar to start exploring your images.</p>
                      </div>
                  ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                          {images.map((img, index) => {
                              const ref = images.length === index + 1 ? lastImageElementRef : null;
                              return <ImageCard key={img.id} img={img} datasetInfo={datasetInfo} innerRef={ref} onClick={() => setSelectedImage(img)} />
                          })}
                      </div>
                  )}
                  
                  {loading && !isInitializing && datasetInfo && <div className="py-12 text-center font-bold text-blue-400 animate-pulse flex items-center justify-center gap-3"><div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/> Loading more images...</div>}
                  {!hasMore && images.length > 0 && <div className="py-12 text-center font-bold text-slate-600 flex items-center justify-center gap-2"><div className="h-px bg-slate-800 w-12"/> End of results <div className="h-px bg-slate-800 w-12"/></div>}
              </div>
          </div>
      </div>

      {/* TERMINAL LOADER */}
      {isInitializing && createPortal(
        <div className="fixed inset-0 z-[99999] bg-slate-950/90 backdrop-blur-xl flex flex-col items-center justify-center p-8">
            <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl p-8 shadow-2xl">
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"/>
                    <div>
                        <h2 className="text-2xl font-bold text-white">Parsing Dataset...</h2>
                        <p className="text-blue-400 font-mono text-sm mt-1">Scanning directories and mapping annotations</p>
                    </div>
                </div>
                <div className="bg-black rounded-lg p-4 font-mono text-xs h-32 overflow-y-auto border border-slate-800 text-slate-400 shadow-inner flex flex-col justify-end">
                    <div className="animate-pulse flex items-center gap-2">
                        <span className="w-2 h-2 bg-blue-500 rounded-full"></span> Reading dataset structure...
                    </div>
                    <div className="animate-pulse flex items-center gap-2 mt-2">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full"></span> Calculating bounding box statistics...
                    </div>
                </div>
            </div>
        </div>,
        document.body
      )}

      {/* FULLSCREEN IMAGE MODAL */}
      {selectedImage && createPortal(
          <ImageModal img={selectedImage} datasetInfo={datasetInfo} onClose={() => setSelectedImage(null)} />,
          document.body
      )}

    </div>
  )
}

// --- CARD COMPONENT (HOVER ZOOM POP-OUT APPLE STYLE) ---
function ImageCard({ img, datasetInfo, innerRef, onClick }) {
    const src = api.getViewerImageUrl(img.path);

    return (
        <div ref={innerRef} className="relative group cursor-pointer" onClick={onClick}>
            
            <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-black border-2 border-slate-800 shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:z-50 group-hover:border-blue-500 group-hover:shadow-2xl group-hover:shadow-blue-500/30">
                <img src={src} loading="lazy" className="w-full h-full object-cover transition-all duration-500 group-hover:brightness-75" />
                
                {img.boxes.map((box, i) => {
                    const color = CLASS_COLORS[box.c % CLASS_COLORS.length];
                    return (
                        <div key={i} className="absolute border-[1.5px] pointer-events-none transition-all duration-300" style={{
                            left: `${(box.x - box.w/2)*100}%`, top: `${(box.y - box.h/2)*100}%`,
                            width: `${box.w*100}%`, height: `${box.h*100}%`,
                            borderColor: color, backgroundColor: `${color}10`
                        }}/>
                    )
                })}

                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                    <div className="bg-black/60 backdrop-blur-sm p-3 rounded-full text-white shadow-lg">
                        <ZoomIn size={24} />
                    </div>
                </div>
            </div>

            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-4 w-max max-w-[200px] opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none z-[60] group-hover:translate-y-0 translate-y-2">
                <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-700 p-3 rounded-xl shadow-2xl flex flex-col items-center">
                    <span className="bg-slate-800 text-white text-[10px] font-black px-2 py-0.5 rounded border border-slate-600 uppercase tracking-wider mb-2">{img.split}</span>
                    <div className="flex flex-wrap justify-center gap-1.5">
                        {Object.entries(img.counts).map(([cId, count]) => {
                            const className = datasetInfo.classes[cId];
                            const color = CLASS_COLORS[cId % CLASS_COLORS.length];
                            return (
                                <div key={cId} className="flex items-center gap-1 bg-black/50 px-1.5 py-0.5 rounded border" style={{borderColor: `${color}40`}}>
                                    <div className="w-1.5 h-1.5 rounded-full" style={{backgroundColor: color}}/>
                                    <span className="text-[10px] text-slate-300 font-medium">{count}x {className}</span>
                                </div>
                            )
                        })}
                        {Object.keys(img.counts).length === 0 && <span className="text-[10px] text-slate-500 italic">Background Image</span>}
                    </div>
                </div>
            </div>

        </div>
    )
}

// --- FULLSCREEN MODAL WITH ZOOM (LOCKED) AND PAN ---
function ImageModal({ img, datasetInfo, onClose }) {
    const src = api.getViewerImageUrl(img.path);
    
    const [scale, setScale] = useState(1);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    
    const [hiddenClasses, setHiddenClasses] = useState(new Set());

    const toggleClassVisibility = (cId) => {
        setHiddenClasses(prev => {
            const next = new Set(prev);
            if (next.has(cId)) next.delete(cId);
            else next.add(cId);
            return next;
        });
    };

    const handleWheel = (e) => {
        const scaleBy = 1.1;
        const newScale = e.deltaY < 0 ? scale * scaleBy : scale / scaleBy;
        const finalScale = Math.max(1, Math.min(newScale, 15));
        setScale(finalScale);
        if (finalScale === 1) setPos({ x: 0, y: 0 });
    };

    const handleMouseDown = (e) => {
        if (scale === 1) return;
        setIsDragging(true);
        setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y });
    };

    const handleMouseMove = (e) => {
        if (!isDragging || scale === 1) return;
        setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    };

    const handleMouseUp = () => setIsDragging(false);

    useEffect(() => {
        const handleKeyDown = (e) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose])

    return (
        <div className="fixed inset-0 z-[999999] bg-slate-950 flex animate-in fade-in duration-200">
            
            <button onClick={onClose} className="absolute top-4 right-4 z-50 bg-slate-800 hover:bg-red-600 text-white p-2 rounded-full shadow-xl transition-colors">
                <X size={24} />
            </button>

            {/* Image Area (Left) */}
            <div className={`flex-1 relative overflow-hidden bg-black/90 flex items-center justify-center ${scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            >
                <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-700 flex flex-col gap-1">
                    <span className="text-xs text-slate-400 font-mono flex items-center gap-2"><MousePointer2 size={12}/> Scroll to Zoom In</span>
                    <span className="text-xs text-slate-400 font-mono flex items-center gap-2"><MousePointer2 size={12}/> Drag to Pan (When Zoomed)</span>
                    <span className="text-xs text-blue-400 font-mono flex items-center gap-2"><ZoomIn size={12}/> {(scale * 100).toFixed(0)}%</span>
                </div>

                <div className="relative inline-block transition-transform duration-75 origin-center" style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}>
                    <img src={src} className="max-w-[80vw] max-h-[90vh] object-contain pointer-events-none" />
                    {img.boxes.map((box, i) => {
                        if (hiddenClasses.has(box.c)) return null;

                        const className = datasetInfo.classes[box.c];
                        const color = CLASS_COLORS[box.c % CLASS_COLORS.length];
                        return (
                            <div key={i} className="absolute border-[2px] pointer-events-none group/box" style={{
                                left: `${(box.x - box.w/2)*100}%`, top: `${(box.y - box.h/2)*100}%`,
                                width: `${box.w*100}%`, height: `${box.h*100}%`,
                                borderColor: color, backgroundColor: `${color}20`
                            }}>
                                <span className="absolute -top-6 left-[-2px] text-black text-[10px] font-bold px-1.5 py-0.5 whitespace-nowrap z-10 opacity-0 group-hover/box:opacity-100 transition-opacity" style={{backgroundColor: color}}>
                                    {className}
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Info Panel (Right) */}
            <div className="w-96 bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl">
                <div className="p-6 border-b border-slate-800 bg-slate-900/50">
                    <h2 className="text-xl font-bold flex items-center gap-2"><Info className="text-blue-500"/> Image Details</h2>
                </div>
                
                <div className="p-6 flex-1 overflow-y-auto space-y-6">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Location</label>
                        <div className="bg-black p-3 rounded-lg border border-slate-800 font-mono text-xs text-slate-300 break-all leading-relaxed">
                            {img.path}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Split</label>
                            <span className="text-lg font-black uppercase text-white">{img.split}</span>
                        </div>
                        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Total Objects</label>
                            <span className="text-lg font-black text-white">{img.boxes.length}</span>
                        </div>
                    </div>

                    {/* CLASSES SECTION AND TOGGLE VISIBLE */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-3">Toggle Detections</label>
                        {img.boxes.length === 0 ? (
                            <div className="text-center py-8 bg-slate-800/30 rounded-xl border border-dashed border-slate-700 text-slate-500 text-sm">
                                Background Image (No detections)
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {Object.entries(img.counts).map(([cId, count]) => {
                                    const numCId = Number(cId);
                                    const isHidden = hiddenClasses.has(numCId);
                                    const className = datasetInfo.classes[numCId];
                                    const color = CLASS_COLORS[numCId % CLASS_COLORS.length];
                                    
                                    return (
                                        <button 
                                            key={numCId} 
                                            onClick={() => toggleClassVisibility(numCId)}
                                            className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors ${isHidden ? 'bg-slate-900/50 border-slate-800 opacity-60' : 'bg-black border-slate-700 hover:border-slate-500'}`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="text-slate-400">
                                                    {isHidden ? <EyeOff size={16}/> : <Eye size={16}/>}
                                                </div>
                                                <div className="w-3 h-3 rounded-full shadow-inner" style={{backgroundColor: isHidden ? '#334155' : color}}></div>
                                                <span className={`font-bold ${isHidden ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{className}</span>
                                            </div>
                                            <span className={`font-mono text-xs px-2 py-1 rounded ${isHidden ? 'bg-slate-800 text-slate-600' : 'bg-slate-800 text-slate-300'}`}>Qty: {count}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

        </div>
    )
}
