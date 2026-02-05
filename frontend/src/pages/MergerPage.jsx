import { useState } from 'react'
import { Upload, Plus, ArrowRight, Download } from 'lucide-react'
import { api } from '../lib/api'

export default function MergerPage() {
  const [datasets, setDatasets] = useState([])
  const [mappings, setMappings] = useState([])
  const [outputName, setOutputName] = useState('merged_dataset')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const handleAddDataset = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    try {
      const { data } = await api.uploadDataset(file)
      setDatasets([...datasets, data])
      
      const newMappings = Object.entries(data.classes).map(([id, name]) => ({
        source_dataset: data.dataset_id,
        source_class_id: parseInt(id),
        source_class_name: name,
        target_class_id: parseInt(id),
        target_class_name: name,
        action: 'map'
      }))
      setMappings([...mappings, ...newMappings])
    } catch (err) {
      console.error('Failed to add dataset:', err)
    }
  }

  const updateMapping = (index, field, value) => {
    const updated = [...mappings]
    updated[index][field] = value
    setMappings(updated)
  }

  const handleMerge = async () => {
    setLoading(true)
    try {
      const { data } = await api.executeMerge({
        dataset_ids: datasets.map(d => d.dataset_id),
        mappings,
        output_name: outputName
      })
      setResult(data)
    } catch (err) {
      console.error('Merge failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold">Dataset Merger</h2>
        <label className="cursor-pointer px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors flex items-center gap-2">
          <Plus size={20} />
          Add Dataset
          <input type="file" accept=".yaml,.yml" onChange={handleAddDataset} className="hidden" />
        </label>
      </div>

      {datasets.length > 0 && (
        <div className="bg-slate-800/50 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4">Loaded Datasets ({datasets.length})</h3>
          <div className="space-y-2">
            {datasets.map((ds, i) => (
              <div key={i} className="bg-slate-700/50 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">{ds.name}</div>
                  <div className="text-sm text-slate-400">
                    {ds.total_images} images · {Object.keys(ds.classes).length} classes
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mappings.length > 0 && (
        <div className="bg-slate-800/50 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4">Class Mappings</h3>
          <div className="space-y-3">
            {mappings.map((mapping, i) => (
              <div key={i} className="grid grid-cols-12 gap-4 items-center bg-slate-700/50 rounded-lg p-3">
                <div className="col-span-4">
                  <div className="text-sm text-slate-400">Source</div>
                  <div className="font-medium">{mapping.source_class_name}</div>
                </div>
                
                <div className="col-span-1 flex justify-center">
                  <ArrowRight size={20} className="text-slate-400" />
                </div>
                
                <div className="col-span-4">
                  <input
                    type="text"
                    value={mapping.target_class_name || ''}
                    onChange={(e) => updateMapping(i, 'target_class_name', e.target.value)}
                    placeholder="Target class name"
                    className="w-full bg-slate-800 rounded px-3 py-2 text-sm"
                  />
                </div>
                
                <div className="col-span-3">
                  <select
                    value={mapping.action}
                    onChange={(e) => updateMapping(i, 'action', e.target.value)}
                    className="w-full bg-slate-800 rounded px-3 py-2 text-sm"
                  >
                    <option value="map">Include</option>
                    <option value="exclude">Exclude</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {datasets.length > 1 && (
        <div className="bg-slate-800/50 rounded-lg p-6">
          <div className="flex items-center gap-4">
            <input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              placeholder="Output dataset name"
              className="flex-1 bg-slate-700 rounded-lg px-4 py-3"
            />
            <button
              onClick={handleMerge}
              disabled={loading}
              className="px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Download size={20} />
              {loading ? 'Merging...' : 'Merge Datasets'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="bg-green-900/20 border border-green-500 rounded-lg p-6">
          <h3 className="text-xl font-semibold text-green-400 mb-2">✓ Merge Complete</h3>
          <p className="text-slate-300">{result.message}</p>
          <p className="text-sm text-slate-400 mt-2">Path: {result.output_path}</p>
        </div>
      )}
    </div>
  )
}