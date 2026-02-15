import { useState, useEffect, useRef, useCallback } from 'react'
import { FolderOpen, Filter, Layers, SquareSquare, Maximize, Target, RotateCcw, X, ZoomIn, Info, MousePointer2, Image as ImageIcon } from 'lucide-react'
import { CLASS_COLORS } from './InferenceViewer'
import { createPortal } from 'react-dom'

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

  // Intersection Observer per lo scroll infinito (Migliorato per fluidità)
  const observer = useRef()
  const lastImageElementRef = useCallback(node => {
    if (loading) return
    if (observer.current) observer.current.disconnect()
    
    // Aggiunto rootMargin: inizia a caricare 500px PRIMA che l'utente arrivi alla fine
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) setPage(prev => prev + 1)
    }, { rootMargin: '500px' })
    
    if (node) observer.current.observe(node)
  }, [loading, hasMore])

  const handleBrowse = async () => {
      try {
          const res = await fetch('http://localhost:8000/api/viewer/browse_yaml')
          const data = await res.json()
          if(data.path) setYamlPath(data.path)
      } catch(e) {}
  }

  const loadDataset = async () => {
      if(!yamlPath) return alert("Select a YAML first")
      setIsInitializing(true) 
      try {
          const res = await fetch('http://localhost:8000/api/viewer/load', {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({path: yamlPath})
          })
          const data = await res.json()
          setDatasetInfo(data)
          resetFilters(false) // Reset filtri ma non cancellare yaml
          await fetchImages(1, true)
      } catch(e) { alert("Failed to load dataset") }
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
          const res = await fetch('http://localhost:8000/api/viewer/query', {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify(body)
          })
          const data = await res.json()
          setImages(prev => reset ? data.data : [...prev, ...data.data])
          setHasMore(data.has_more)
          setTotalMatches(data.total_matches)
      } catch(e) { console.error(e) }
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
    <div className="flex gap-6 h-[calc(100vh-100px)]">
        
      {/* SIDEBAR FILTRI */}
      <div className="w-80 flex flex-col gap-5 bg-slate-900/50 border border-slate-800 rounded-2xl p-5 overflow-y-auto custom-scrollbar shadow-inner">
          
          <div className="mb-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">1. Load Dataset</label>
              <button onClick={handleBrowse} className="w-full py-3 border border-dashed border-slate-600 rounded-lg hover:border-blue-500 hover:bg-slate-800/50 flex items-center justify-center gap-2 text-slate-300 transition-colors">
                  <FolderOpen size={18} /> Select data.yaml
              </button>
              <button onClick={loadDataset} disabled={!yamlPath || isInitializing} className="w-full mt-2 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-bold transition-all shadow-lg shadow-blue-500/20">
                  {isInitializing ? 'Loading...' : 'Load Dataset'}
              </button>
          </div>

          {datasetInfo && (
          <div className="flex flex-col gap-6">
              
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2"><Filter size={16} className="text-blue-500"/> Filters</h3>
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

              {/* BOX COUNTS */}
              <div className="space-y-3">
                  <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><SquareSquare size={14}/> Objects Count</label>
                      <span className="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded-md">100 = Any</span>
                  </div>
                  <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-700 focus-within:border-blue-500 transition-colors">
                      <div className="flex-1 flex flex-col px-3 border-r border-slate-800">
                          <span className="text-[10px] text-slate-500 font-bold uppercase">Min</span>
                          <input type="number" min="0" value={boxRange.min} onChange={e => setBoxRange({...boxRange, min: parseInt(e.target.value)||0})} className="w-full bg-transparent text-white font-mono text-sm outline-none" />
                      </div>
                      <div className="flex-1 flex flex-col px-3">
                          <span className="text-[10px] text-slate-500 font-bold uppercase">Max</span>
                          <input type="number" min="0" value={boxRange.max} onChange={e => setBoxRange({...boxRange, max: parseInt(e.target.value)||0})} className="w-full bg-transparent text-white font-mono text-sm outline-none" />
                      </div>
                  </div>
              </div>

              {/* BOX AREAS */}
              <div className="space-y-3">
                  <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Maximize size={14}/> Object Area Size</label>
                      <span className="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded-md">% of image</span>
                  </div>
                  <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-700 focus-within:border-blue-500 transition-colors">
                      <div className="flex-1 flex flex-col px-3 border-r border-slate-800 relative">
                          <span className="text-[10px] text-slate-500 font-bold uppercase">Min Area</span>
                          <div className="flex items-center">
                              <input type="number" min="0" max="100" value={Math.round(areaRange.min*100)} onChange={e => setAreaRange({...areaRange, min: (parseInt(e.target.value)||0)/100})} className="w-full bg-transparent text-white font-mono text-sm outline-none" />
                              <span className="text-slate-500 text-xs font-mono">%</span>
                          </div>
                      </div>
                      <div className="flex-1 flex flex-col px-3 relative">
                          <span className="text-[10px] text-slate-500 font-bold uppercase">Max Area</span>
                          <div className="flex items-center">
                              <input type="number" min="0" max="100" value={Math.round(areaRange.max*100)} onChange={e => setAreaRange({...areaRange, max: (parseInt(e.target.value)||0)/100})} className="w-full bg-transparent text-white font-mono text-sm outline-none" />
                              <span className="text-slate-500 text-xs font-mono">%</span>
                          </div>
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
          
          <div className="bg-slate-900/80 backdrop-blur-xl p-4 border-b border-slate-800 flex justify-between items-center z-10 shadow-lg">
              <div className="flex items-center gap-4">
                  <h2 className="text-xl font-black text-white flex items-center gap-2"><ImageIcon className="text-blue-500"/> Dataset Viewer</h2>
                  {datasetInfo && <span className="bg-emerald-900/30 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold border border-emerald-500/30 tracking-wider uppercase">{totalMatches} Results</span>}
              </div>
          </div>

          {/* Sostituito columns-* (Masonry) con una CSS Grid vera per fluidità assoluta */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar relative">
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
    const encodePath = encodeURIComponent(img.path);
    const src = `http://localhost:8000/api/viewer/image?path=${encodePath}`;

    return (
        // Il contenitore principale NON ha overflow-hidden così il tooltip può uscire
        <div ref={innerRef} className="relative group cursor-pointer" onClick={onClick}>
            
            {/* Box Immagine: si solleva e si ingrandisce al passaggio del mouse */}
            <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-black border-2 border-slate-800 shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:z-50 group-hover:border-blue-500 group-hover:shadow-2xl group-hover:shadow-blue-500/30">
                <img src={src} loading="lazy" className="w-full h-full object-cover transition-all duration-500 group-hover:brightness-75" />
                
                {/* Bounding Boxes */}
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

                {/* Icona Zoom (visibile solo in hover) */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                    <div className="bg-black/60 backdrop-blur-sm p-3 rounded-full text-white shadow-lg">
                        <ZoomIn size={24} />
                    </div>
                </div>
            </div>

            {/* Tooltip Esterno Fluttuante (Apple-style) */}
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

// --- MODAL FULLSCREEN CON ZOOM E PAN ---
function ImageModal({ img, datasetInfo, onClose }) {
    const encodePath = encodeURIComponent(img.path);
    const src = `http://localhost:8000/api/viewer/image?path=${encodePath}`;
    
    // Zoom & Pan State
    const [scale, setScale] = useState(1);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    const handleWheel = (e) => {
        const scaleBy = 1.1;
        const newScale = e.deltaY < 0 ? scale * scaleBy : scale / scaleBy;
        setScale(Math.max(0.5, Math.min(newScale, 10)));
    };

    const handleMouseDown = (e) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y });
    };

    const handleMouseMove = (e) => {
        if (!isDragging) return;
        setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    };

    const handleMouseUp = () => setIsDragging(false);

    // Esc to close
    useEffect(() => {
        const handleKeyDown = (e) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [onClose])

    return (
        <div className="fixed inset-0 z-[999999] bg-slate-950 flex animate-in fade-in duration-200">
            
            {/* Pulsante Chiusura */}
            <button onClick={onClose} className="absolute top-4 right-4 z-50 bg-slate-800 hover:bg-red-600 text-white p-2 rounded-full shadow-xl transition-colors">
                <X size={24} />
            </button>

            {/* Area Immagine (Sinistra) */}
            <div className="flex-1 relative overflow-hidden bg-black/90 cursor-grab active:cursor-grabbing flex items-center justify-center"
                onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            >
                <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-700 flex flex-col gap-1">
                    <span className="text-xs text-slate-400 font-mono flex items-center gap-2"><MousePointer2 size={12}/> Scroll to Zoom</span>
                    <span className="text-xs text-slate-400 font-mono flex items-center gap-2"><MousePointer2 size={12}/> Drag to Pan</span>
                    <span className="text-xs text-blue-400 font-mono flex items-center gap-2"><ZoomIn size={12}/> {(scale * 100).toFixed(0)}%</span>
                </div>

                <div className="relative inline-block transition-transform duration-75 origin-center" style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}>
                    <img src={src} className="max-w-[80vw] max-h-[90vh] object-contain pointer-events-none" />
                    {img.boxes.map((box, i) => {
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

            {/* Pannello Info (Destra) */}
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

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-3">Detected Classes</label>
                        {img.boxes.length === 0 ? (
                            <div className="text-center py-8 bg-slate-800/30 rounded-xl border border-dashed border-slate-700 text-slate-500 text-sm">
                                Background Image (No detections)
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {Object.entries(img.counts).map(([cId, count]) => {
                                    const className = datasetInfo.classes[cId];
                                    const color = CLASS_COLORS[cId % CLASS_COLORS.length];
                                    return (
                                        <div key={cId} className="flex items-center justify-between bg-black p-3 rounded-xl border border-slate-800">
                                            <div className="flex items-center gap-3">
                                                <div className="w-4 h-4 rounded-full shadow-inner" style={{backgroundColor: color}}></div>
                                                <span className="font-bold text-slate-200">{className}</span>
                                            </div>
                                            <span className="bg-slate-800 text-slate-300 font-mono text-xs px-2 py-1 rounded">Qty: {count}</span>
                                        </div>
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