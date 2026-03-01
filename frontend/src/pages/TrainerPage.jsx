import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Terminal, Play, Square, FolderOpen, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'
import { api } from '../lib/api'

const COMMANDS = ['train', 'export', 'validate', 'split']

const INITIAL_FORM = {
  train: {
    data: '',
    model: 'yolov8s.pt',
    imgsz: 640,
    epochs: 100,
    batch: -1,
    device: 'auto',
    name: '',
    patience: 30,
    workers: 8,
    seed: 42,
    resume: false,
    export_formats: 'onnx,engine',
    publish: true,
    publish_dir: ''
  },
  export: {
    weights: '',
    imgsz: 640,
    formats: 'onnx,engine',
    name: '',
    publish: true,
    publish_dir: ''
  },
  validate: {
    weights: '',
    data: '',
    imgsz: 640,
    device: 'auto',
    batch: -1
  },
  split: {
    dataset: '',
    val_fraction: 0.2,
    seed: 42,
    copy: false,
    update_yaml: true,
    dry_run: false
  }
}

export default function TrainerPage() {
  const [command, setCommand] = useState('train')
  const [form, setForm] = useState(INITIAL_FORM)
  const [pickers, setPickers] = useState({ configs: [], models: [], weights: [], datasets: [], config_status: [], default_paths: {} })
  const [status, setStatus] = useState({ active: false, job: null, last_result: null })
  const [history, setHistory] = useState([])

  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState([])
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const logsEndRef = useRef(null)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    refreshAll()
  }, [])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => refreshStatus(), 2500)
    return () => clearInterval(id)
  }, [running])

  const activeState = useMemo(() => {
    if (status.active) return 'Running'
    if (status.last_result?.status) return status.last_result.status
    return 'Idle'
  }, [status])

  const configStatusMap = useMemo(() => {
    const map = new Map()
    for (const item of pickers.config_status || []) {
      map.set(item.config_path, item)
    }
    return map
  }, [pickers.config_status])

  const selectedConfigStatus = useMemo(() => {
    if (command !== 'train' && command !== 'validate') return null
    const selected = form[command]?.data
    if (!selected) return null
    return configStatusMap.get(selected) || null
  }, [command, form, configStatusMap])

  const selectedConfigIssue = useMemo(() => {
    if (!selectedConfigStatus) return ''
    if (selectedConfigStatus.exists) return ''
    if (selectedConfigStatus.normalized_path) {
      return `Config dataset path is invalid: ${selectedConfigStatus.dataset_path}. Suggested path: ${selectedConfigStatus.normalized_path}.`
    }
    return `Config dataset path is invalid: ${selectedConfigStatus.dataset_path || '(missing path)'}.`
  }, [selectedConfigStatus])

  async function refreshAll() {
    await Promise.all([refreshPickers(), refreshStatus(), refreshHistory()])
  }

  async function refreshPickers() {
    try {
      const { data } = await api.getTrainingPickers()
      setPickers(data || {})

      const defaults = data?.default_paths || {}
      setForm(prev => ({
        ...prev,
        train: { ...prev.train, publish_dir: prev.train.publish_dir || defaults.publish_dir || '' },
        export: { ...prev.export, publish_dir: prev.export.publish_dir || defaults.publish_dir || '' }
      }))
    } catch (err) {
      console.error(err)
    }
  }

  async function refreshStatus() {
    try {
      const { data } = await api.getTrainingStatus()
      setStatus(data)
    } catch (err) {
      console.error(err)
    }
  }

  async function refreshHistory() {
    try {
      const { data } = await api.getTrainingHistory(20)
      setHistory(data?.items || [])
    } catch (err) {
      console.error(err)
    }
  }

  function setCommandField(cmd, key, value) {
    setForm(prev => ({
      ...prev,
      [cmd]: { ...prev[cmd], [key]: value }
    }))
  }

  async function browse(kind, cmd, field) {
    try {
      const { data } = await api.browseTraining(kind)
      if (data?.path) setCommandField(cmd, field, data.path)
    } catch (err) {
      console.error(err)
    }
  }

  function buildPayload() {
    return {
      command,
      params: form[command],
      dry_run: false
    }
  }

  async function runCommand() {
    if (selectedConfigIssue) {
      setError(`Cannot run with invalid config. ${selectedConfigIssue}`)
      return
    }

    setError('')
    setNotice('')
    setLogs([`Starting ${command} command...`])
    setProgress({ current: 0, total: 0, percent: 0 })
    setRunning(true)

    try {
      const response = await api.createTrainingStream(buildPayload())
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}))
        throw new Error(errorPayload.detail || `Request failed with status ${response.status}`)
      }
      if (!response.body) throw new Error('No stream body returned by backend.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line)
          handleEvent(event)
        }
      }

      if (buffer.trim()) {
        handleEvent(JSON.parse(buffer))
      }
    } catch (err) {
      setError(err.message || 'Failed to run command.')
      setRunning(false)
    } finally {
      await Promise.all([refreshStatus(), refreshHistory()])
    }
  }

  function handleEvent(event) {
    if (event.type === 'log') {
      setLogs(prev => [...prev, event.msg || ''])
      return
    }

    if (event.type === 'progress') {
      setProgress({
        current: event.current || 0,
        total: event.total || 0,
        percent: Number(event.percent || 0)
      })
      if (event.log) setLogs(prev => [...prev, event.log])
      return
    }

    if (event.type === 'status' && event.job) {
      setStatus(prev => ({ ...prev, active: true, job: event.job }))
      return
    }

    if (event.type === 'error') {
      setError(`Command failed (code ${event.return_code ?? 'unknown'})`)
      setRunning(false)
      return
    }

    if (event.type === 'complete') {
      setNotice(`Command ${event.status} (code ${event.return_code})`)
      setRunning(false)
    }
  }

  async function stopJob() {
    try {
      await api.stopTrainingJob()
      setNotice('Stop requested.')
      setRunning(false)
      await Promise.all([refreshStatus(), refreshHistory()])
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Stop failed')
    }
  }

  return (
    <div className="space-y-6 pb-20 min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-300">
            Trainer
          </h2>
          <p className="text-slate-400 mt-1 font-medium">Train, export, validate and split datasets from DatasetEngine.</p>
        </div>
        <button
          onClick={refreshAll}
          className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 flex items-center gap-2"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatusCard label="State" value={activeState} />
        <StatusCard label="Last Artifact Dir" value={status?.last_result?.artifact_dir || '-'} mono />
        <StatusCard label="Last Publish Dir" value={status?.last_result?.publish_dir || '-'} mono />
        <StatusCard label="Last Exit Code" value={String(status?.last_result?.return_code ?? '-')} />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-lg px-4 py-3 text-red-200 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-lg px-4 py-3 text-emerald-200 flex items-center gap-2">
          <CheckCircle2 size={16} /> {notice}
        </div>
      )}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap gap-2">
          {COMMANDS.map(cmd => (
            <button
              key={cmd}
              onClick={() => setCommand(cmd)}
              className={`px-4 py-2 rounded-lg border text-sm font-bold uppercase ${
                command === cmd
                  ? 'bg-amber-600 border-amber-500 text-white'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {cmd}
            </button>
          ))}
        </div>

        {command === 'train' && (
          <TrainForm
            data={form.train}
            pickers={pickers}
            configStatusMap={configStatusMap}
            setField={(k, v) => setCommandField('train', k, v)}
            browse={browse}
          />
        )}
        {command === 'export' && (
          <ExportForm data={form.export} pickers={pickers} setField={(k, v) => setCommandField('export', k, v)} browse={browse} />
        )}
        {command === 'validate' && (
          <ValidateForm
            data={form.validate}
            pickers={pickers}
            configStatusMap={configStatusMap}
            setField={(k, v) => setCommandField('validate', k, v)}
            browse={browse}
          />
        )}
        {command === 'split' && (
          <SplitForm data={form.split} pickers={pickers} setField={(k, v) => setCommandField('split', k, v)} browse={browse} />
        )}

        {selectedConfigIssue && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg px-4 py-3 text-amber-200 text-sm">
            {selectedConfigIssue} Fix the YAML `path:` before running.
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={runCommand}
            disabled={running || Boolean(selectedConfigIssue)}
            className="px-6 py-3 rounded-lg bg-gradient-to-r from-orange-600 to-amber-500 text-white font-black disabled:opacity-50 flex items-center gap-2"
          >
            <Play size={16} /> Run
          </button>
          <button
            onClick={stopJob}
            disabled={!running}
            className="px-6 py-3 rounded-lg bg-slate-700 border border-slate-600 text-white font-black disabled:opacity-50 flex items-center gap-2"
          >
            <Square size={16} /> Stop
          </button>
        </div>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
        <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
          <Terminal size={18} className="text-orange-300" />
          Recent Jobs
        </h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {history.length === 0 && <div className="text-slate-400 text-sm">No history yet.</div>}
          {history.map(item => (
            <div key={item.job_id} className="bg-slate-900/70 border border-slate-700 rounded-lg p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase text-slate-200">{item.command}</span>
                <span className="text-slate-400">{item.status}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono">exit={item.return_code} run={item.run_name || '-'}</div>
            </div>
          ))}
        </div>
      </div>

      {running && createPortal(
        <div className="fixed inset-0 z-[99999] bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-8">
          <div className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-2xl p-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
              <div>
                <h2 className="text-2xl font-bold text-white">Running {command}</h2>
                <p className="text-orange-300 font-mono">Streaming backend logs...</p>
              </div>
            </div>

            <div className="mb-2 flex justify-between text-sm font-bold text-slate-300">
              <span>Progress</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="w-full h-4 bg-slate-950 rounded-full overflow-hidden border border-slate-700 mb-6">
              <div
                className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300"
                style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
              />
            </div>

            <div className="bg-black rounded-lg p-4 font-mono text-xs h-64 overflow-y-auto border border-slate-700 text-slate-300">
              {logs.map((line, idx) => (
                <div key={idx} className="mb-1 border-l-2 border-slate-700 pl-2">{line}</div>
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

function StatusCard({ label, value, mono = false }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
      <div className="text-xs text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={`text-sm mt-2 text-white ${mono ? 'font-mono break-all' : 'font-bold'}`}>{value}</div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wider text-slate-400 font-bold">{label}</span>
      {children}
    </label>
  )
}

function Row({ children }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
}

function PathInput({ value, onChange, onBrowse, browseLabel = 'Browse' }) {
  return (
    <div className="flex gap-2">
      <input value={value} onChange={e => onChange(e.target.value)} className="flex-1" />
      <button type="button" onClick={onBrowse} className="px-3 bg-slate-700 border border-slate-600 rounded text-white flex items-center gap-1">
        <FolderOpen size={14} /> {browseLabel}
      </button>
    </div>
  )
}

function TrainForm({ data, pickers, configStatusMap, setField, browse }) {
  return (
    <div className="space-y-4">
      <Row>
        <Field label="Data YAML">
          <PathInput value={data.data} onChange={v => setField('data', v)} onBrowse={() => browse('yaml', 'train', 'data')} />
        </Field>
        <Field label="Model">
          <PathInput value={data.model} onChange={v => setField('model', v)} onBrowse={() => browse('model', 'train', 'model')} />
        </Field>
      </Row>
      <Row>
        <Field label="Image Size"><input type="number" value={data.imgsz} onChange={e => setField('imgsz', Number(e.target.value))} /></Field>
        <Field label="Epochs"><input type="number" value={data.epochs} onChange={e => setField('epochs', Number(e.target.value))} /></Field>
      </Row>
      <Row>
        <Field label="Batch"><input type="number" value={data.batch} onChange={e => setField('batch', Number(e.target.value))} /></Field>
        <Field label="Device"><input value={data.device} onChange={e => setField('device', e.target.value)} /></Field>
      </Row>
      <Row>
        <Field label="Run Name"><input value={data.name} onChange={e => setField('name', e.target.value)} /></Field>
        <Field label="Export Formats"><input value={data.export_formats} onChange={e => setField('export_formats', e.target.value)} /></Field>
      </Row>
      <Row>
        <Field label="Publish Dir">
          <PathInput value={data.publish_dir} onChange={v => setField('publish_dir', v)} onBrowse={() => browse('dir', 'train', 'publish_dir')} />
        </Field>
        <Field label="Known Configs">
          <select onChange={e => setField('data', e.target.value)} value="">
            <option value="">Select...</option>
            {(pickers.configs || []).map(item => {
              const status = configStatusMap.get(item)
              const invalid = Boolean(status && !status.exists)
              const label = invalid ? `[INVALID] ${item}` : item
              return <option key={item} value={item}>{label}</option>
            })}
          </select>
        </Field>
      </Row>
      <div className="flex gap-6 pt-2">
        <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={data.publish} onChange={e => setField('publish', e.target.checked)} /> Publish</label>
        <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={data.resume} onChange={e => setField('resume', e.target.checked)} /> Resume</label>
      </div>
    </div>
  )
}

function ExportForm({ data, pickers, setField, browse }) {
  return (
    <div className="space-y-4">
      <Row>
        <Field label="Weights (.pt)">
          <PathInput value={data.weights} onChange={v => setField('weights', v)} onBrowse={() => browse('weights', 'export', 'weights')} />
        </Field>
        <Field label="Known Weights">
          <select onChange={e => setField('weights', e.target.value)} value="">
            <option value="">Select...</option>
            {(pickers.weights || []).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
      </Row>
      <Row>
        <Field label="Image Size"><input type="number" value={data.imgsz} onChange={e => setField('imgsz', Number(e.target.value))} /></Field>
        <Field label="Formats"><input value={data.formats} onChange={e => setField('formats', e.target.value)} /></Field>
      </Row>
      <Row>
        <Field label="Name (optional)"><input value={data.name} onChange={e => setField('name', e.target.value)} /></Field>
        <Field label="Publish Dir">
          <PathInput value={data.publish_dir} onChange={v => setField('publish_dir', v)} onBrowse={() => browse('dir', 'export', 'publish_dir')} />
        </Field>
      </Row>
      <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={data.publish} onChange={e => setField('publish', e.target.checked)} /> Publish</label>
    </div>
  )
}

function ValidateForm({ data, pickers, configStatusMap, setField, browse }) {
  return (
    <div className="space-y-4">
      <Row>
        <Field label="Weights">
          <PathInput value={data.weights} onChange={v => setField('weights', v)} onBrowse={() => browse('weights', 'validate', 'weights')} />
        </Field>
        <Field label="Data YAML">
          <PathInput value={data.data} onChange={v => setField('data', v)} onBrowse={() => browse('yaml', 'validate', 'data')} />
        </Field>
      </Row>
      <Row>
        <Field label="Image Size"><input type="number" value={data.imgsz} onChange={e => setField('imgsz', Number(e.target.value))} /></Field>
        <Field label="Device"><input value={data.device} onChange={e => setField('device', e.target.value)} /></Field>
      </Row>
      <Field label="Batch"><input type="number" value={data.batch} onChange={e => setField('batch', Number(e.target.value))} /></Field>
      <Field label="Known Configs">
        <select onChange={e => setField('data', e.target.value)} value="">
          <option value="">Select...</option>
          {(pickers.configs || []).map(item => {
            const status = configStatusMap.get(item)
            const invalid = Boolean(status && !status.exists)
            const label = invalid ? `[INVALID] ${item}` : item
            return <option key={item} value={item}>{label}</option>
          })}
        </select>
      </Field>
    </div>
  )
}

function SplitForm({ data, pickers, setField, browse }) {
  return (
    <div className="space-y-4">
      <Row>
        <Field label="Dataset Root">
          <PathInput value={data.dataset} onChange={v => setField('dataset', v)} onBrowse={() => browse('dataset', 'split', 'dataset')} />
        </Field>
        <Field label="Known Datasets">
          <select onChange={e => setField('dataset', e.target.value)} value="">
            <option value="">Select...</option>
            {(pickers.datasets || []).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
      </Row>
      <Row>
        <Field label="Validation Fraction">
          <input type="number" min="0.01" max="0.99" step="0.01" value={data.val_fraction} onChange={e => setField('val_fraction', Number(e.target.value))} />
        </Field>
        <Field label="Seed"><input type="number" value={data.seed} onChange={e => setField('seed', Number(e.target.value))} /></Field>
      </Row>
      <div className="flex gap-6 pt-2">
        <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={data.copy} onChange={e => setField('copy', e.target.checked)} /> Copy Mode</label>
        <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={data.update_yaml} onChange={e => setField('update_yaml', e.target.checked)} /> Update YAML</label>
        <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={data.dry_run} onChange={e => setField('dry_run', e.target.checked)} /> Dry Run</label>
      </div>
    </div>
  )
}
