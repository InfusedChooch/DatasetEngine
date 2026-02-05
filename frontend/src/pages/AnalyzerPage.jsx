// frontend/src/pages/AnalyzerPage.jsx
import { useState, useEffect } from 'react'
import { Search, BarChart3, AlertCircle, FolderOpen, FileSearch, PieChart as PieIcon, Layers, Image as ImageIcon } from 'lucide-react'
import { api } from '../lib/api'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { useDatasetStore } from '../hooks/useDatasetStore'

// Colori per il grafico a torta
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

export default function AnalyzerPage() {
  const { stats, setStats, setCurrentDataset } = useDatasetStore()
  
  const [pathInput, setPathInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  // Stato per i messaggi di caricamento dinamici
  const [loadingMsg, setLoadingMsg] = useState('Inizializzazione...')

  // Effetto per ruotare i messaggi durante il caricamento
  useEffect(() => {
    if (!loading) return;
    const messages = [
        "🔍 Scansione cartelle immagini...",
        "📄 Lettura file annotazioni...",
        "🧮 Calcolo statistiche classi...",
        "📐 Analisi dimensioni bounding box...",
        "📊 Generazione report finale..."
    ];
    let i = 0;
    setLoadingMsg(messages[0]);
    const interval = setInterval(() => {
        i = (i + 1) % messages.length;
        setLoadingMsg(messages[i]);
    }, 1500); // Cambia messaggio ogni 1.5 secondi
    return () => clearInterval(interval);
  }, [loading]);

  const handleBrowse = async () => {
    try {
      const { data } = await api.browseFile()
      if (data.path) setPathInput(data.path)
    } catch (err) {
      console.error(err)
    }
  }

  const handleAnalyze = async (e) => {
    e.preventDefault()
    if (!pathInput.trim()) return
    setLoading(true)
    setError(null)
    const cleanPath = pathInput.replace(/"/g, '')

    try {
      const { data } = await api.analyzeLocalDataset(cleanPath)
      setStats(data)
      setCurrentDataset(data)
    } catch (err) {
      console.error(err)
      setError(err.response?.data?.detail || 'Errore durante l\'analisi del dataset')
    } finally {
      setLoading(false)
    }
  }

  // Preparazione dati grafici
  const barData = stats ? Object.entries(stats.class_distribution).map(([name, count]) => ({ name, count })) : []
  
  const pieData = stats ? [
    { name: 'Small', value: stats.box_size_distribution.Small },
    { name: 'Medium', value: stats.box_size_distribution.Medium },
    { name: 'Large', value: stats.box_size_distribution.Large },
  ].filter(d => d.value > 0) : []

  return (
    <div className="space-y-6 relative min-h-screen">
      
      {/* Intestazione */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold text-white">Dataset Analyzer</h2>
      </div>

      {/* Input Section */}
      <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700">
        <form onSubmit={handleAnalyze} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Seleziona Dataset (data.yaml)</label>
                <div className="flex gap-2">
                    <button type="button" onClick={handleBrowse} className="bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white px-4 rounded-lg transition-colors flex items-center justify-center" title="Sfoglia file">
                        <FolderOpen size={20} />
                    </button>
                    <div className="relative flex-1">
                        <FileSearch className="absolute left-3 top-3 text-slate-500" size={20} />
                        <input type="text" value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder="Es: C:\Datasets\Coco\data.yaml" className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <button type="submit" disabled={loading || !pathInput} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2">
                        {loading ? 'Analisi...' : 'Analizza'}
                        {!loading && <Search size={20} />}
                    </button>
                </div>
            </div>
        </form>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500 mb-6"></div>
            <h3 className="text-2xl font-bold text-white mb-2">Analisi in corso</h3>
            <p className="text-blue-300 font-mono text-lg animate-pulse">{loadingMsg}</p>
            <p className="text-slate-500 text-sm mt-4">Potrebbe richiedere qualche secondo per dataset grandi</p>
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-500 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="text-red-500" size={20} />
          <p className="text-red-300">{error}</p>
        </div>
      )}

      {/* DASHBOARD DATI */}
      {stats && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard label="Immagini Totali" value={stats.total_images} icon={<ImageIcon size={18} />} />
                <StatCard label="Etichette Totali" value={stats.total_labels} icon={<Layers size={18} />} />
                <StatCard label="Classi" value={Object.keys(stats.classes).length} icon={<PieIcon size={18} />} />
                <StatCard label="Avg Label/Img" value={stats.avg_labels_per_image} icon={<BarChart3 size={18} />} color="text-emerald-400" />
                <StatCard label="Background Imgs" value={stats.background_images} icon={<AlertCircle size={18} />} color="text-amber-400" subtext="senza annotazioni" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Grafico Distribuzione Classi */}
                <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700 h-[400px]">
                    <div className="flex items-center gap-2 mb-6">
                        <BarChart3 size={20} className="text-blue-400" />
                        <h3 className="text-xl font-semibold text-white">Distribuzione Classi</h3>
                    </div>
                    <ResponsiveContainer width="100%" height="85%">
                        <BarChart data={barData} margin={{ top: 0, right: 10, left: 0, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                            <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} interval={0} angle={-15} textAnchor="end" />
                            <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8' }} />
                            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }} cursor={{ fill: '#334155', opacity: 0.4 }} />
                            <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Grafico Dimensioni Oggetti */}
                <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700 h-[400px]">
                    <div className="flex items-center gap-2 mb-6">
                        <PieIcon size={20} className="text-emerald-400" />
                        <h3 className="text-xl font-semibold text-white">Dimensione Oggetti</h3>
                    </div>
                    <div className="flex h-[85%]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={100}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                {/* MODIFICA QUI: Aggiunti itemStyle e labelStyle per forzare il testo bianco */}
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }} 
                                    itemStyle={{ color: '#fff' }}
                                    labelStyle={{ color: '#fff' }}
                                />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                        
                        {/* Summary laterale */}
                        <div className="flex flex-col justify-center gap-4 text-sm w-1/3">
                            <div className="space-y-1">
                                <span className="text-slate-400 block">Small ({'<'}0.3%)</span>
                                <span className="text-xl font-bold text-white">{stats.box_size_distribution.Small}</span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-slate-400 block">Medium</span>
                                <span className="text-xl font-bold text-white">{stats.box_size_distribution.Medium}</span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-slate-400 block">Large ({'>'}3%)</span>
                                <span className="text-xl font-bold text-white">{stats.box_size_distribution.Large}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon, color = "text-blue-400", subtext }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-slate-400 uppercase font-semibold tracking-wider">{label}</div>
        <div className={`text-slate-500`}>{icon}</div>
      </div>
      <div>
        <div className={`text-2xl font-bold ${color}`}>{value.toLocaleString()}</div>
        {subtext && <div className="text-xs text-slate-500 mt-1">{subtext}</div>}
      </div>
    </div>
  )
}