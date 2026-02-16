import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { BarChart3, Merge, Target, Image as ImageIcon, Github, Coffee } from 'lucide-react'
import AnalyzerPage from './pages/AnalyzerPage'
import MergerPage from './pages/MergerPage'
import ImprovementSetup from './pages/ImprovementSetup'
import InferenceViewer from './pages/InferenceViewer'
import AnnotationEditor from './pages/AnnotationEditor'
import DatasetViewerPage from './pages/DatasetViewerPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-950 text-white relative">
        <Navigation />
        
        <main className="max-w-7xl mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<DatasetViewerPage />} />
            <Route path="/analyze" element={<AnalyzerPage />} />
            <Route path="/merger" element={<MergerPage />} />
            <Route path="/improve" element={<ImprovementSetup />} />
            <Route path="/improve/viewer" element={<InferenceViewer />} />
            <Route path="/improve/editor" element={<AnnotationEditor />} />
          </Routes>
        </main>

        {/* SUPPORT BUTTON (bottom-left) */}
        <div className="fixed bottom-6 left-6 z-[9999]">
          <a 
            href="https://buymeacoffee.com/spappalard" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex items-center gap-2 px-4 py-2 bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-full shadow-2xl hover:border-yellow-500/50 hover:bg-slate-800 transition-all duration-300 hover:-translate-y-1 group text-xs font-mono text-slate-400 hover:text-yellow-400"
            title="Support the project"
          >
            <Coffee size={14} className="group-hover:animate-bounce" />
            <span className="font-bold">Buy me a coffee</span>
          </a>
        </div>

        {/* FLOATING DOCK: REPO + FIRMA (bottom-right) */}
        <div className="fixed bottom-6 right-6 z-[9999] flex items-center bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-full shadow-2xl hover:border-slate-500 transition-all duration-300 hover:-translate-y-1">
          
          {/* Link to the Repository */}
          <a 
            href="https://github.com/sPappalard/DatasetEngine" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex items-center gap-2 px-4 py-2 text-xs font-mono text-slate-300 hover:bg-slate-800 hover:text-white transition-colors border-r border-slate-700/50 group rounded-l-full"
            title="View Source on GitHub"
          >
            <Github size={14} className="text-slate-400 group-hover:text-white transition-colors" />
            <span className="font-bold">DatasetEngine</span>
          </a>

          {/* Link to the Author Profile */}
          <a 
            href="https://github.com/sPappalard" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="px-4 py-2 text-xs font-mono text-slate-400 hover:bg-slate-800 hover:text-white transition-colors rounded-r-full"
            title="View Developer Profile"
          >
            Built by <span className="font-bold text-blue-400">sPappalard</span>
          </a>

        </div>
      </div>
    </BrowserRouter>
  )
}

function Navigation() {
  const location = useLocation()
  
  const isActive = (path) => {
    if (path === '/improve') return location.pathname.startsWith('/improve')
    return location.pathname === path
  }

  return (
    <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          
          {/* logo and title */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="transform group-hover:scale-105 transition-transform duration-300">
              {/* LOGO SVG MINIMAL */}
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="6" y="6" width="22" height="22" rx="4" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" className="text-blue-500/60"/>
                <rect x="14" y="14" width="20" height="20" rx="4" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="2" className="text-purple-500"/>
                <circle cx="24" cy="14" r="3" fill="currentColor" className="text-pink-500"/>
                <circle cx="14" cy="24" r="3" fill="currentColor" className="text-pink-500"/>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
                Dataset Engine
              </h1>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Complete System</p>
            </div>
          </Link>
          
          {/* navigation menu */}
          <div className="flex gap-2 bg-slate-950/50 p-1.5 rounded-xl border border-slate-800">
            <NavLink to="/" icon={<ImageIcon size={16} />} active={isActive('/')}>
              Viewer
            </NavLink>
            <NavLink to="/analyze" icon={<BarChart3 size={16} />} active={isActive('/analyze')}>
              Analyzer
            </NavLink>
            <NavLink to="/merger" icon={<Merge size={16} />} active={isActive('/merger')}>
              Merger
            </NavLink>
            <NavLink to="/improve" icon={<Target size={16} />} active={isActive('/improve')}>
              Improver
            </NavLink>
          </div>
        </div>
      </div>
    </nav>
  )
}

function NavLink({ to, icon, children, active }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${
        active 
          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/20 border border-blue-500/50' 
          : 'bg-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
      }`}
    >
      {icon}
      <span>{children}</span>
    </Link>
  )
}