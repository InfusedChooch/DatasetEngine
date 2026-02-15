import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { BarChart3, Merge, Target, Image as ImageIcon } from 'lucide-react'
import DatasetViewerPage from './pages/DatasetViewerPage'
import AnalyzerPage from './pages/AnalyzerPage'
import MergerPage from './pages/MergerPage'
import ImprovementSetup from './pages/ImprovementSetup'
import InferenceViewer from './pages/InferenceViewer'
import AnnotationEditor from './pages/AnnotationEditor'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-950 text-white">
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
    <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center">
              <span className="text-xl font-bold">DE</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">Dataset Engine</h1>
              <p className="text-xs text-slate-400">Complete System</p>
            </div>
          </Link>
          
          <div className="flex gap-3">
            <NavLink to="/" icon={<ImageIcon size={18} />} active={isActive('/')}>
              Viewer
            </NavLink>
            <NavLink to="/analyze" icon={<BarChart3 size={18} />} active={isActive('/analyze')}>
              Analyzer
            </NavLink>
            <NavLink to="/merger" icon={<Merge size={18} />} active={isActive('/merger')}>
              Merger
            </NavLink>
            <NavLink to="/improve" icon={<Target size={18} />} active={isActive('/improve')}>
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
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-blue-600 text-white' : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50'
      }`}
    >
      {icon}
      <span>{children}</span>
    </Link>
  )
}