import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  Camera,
  Play,
  Radio,
  RefreshCw,
  Square,
  Video,
  Wifi
} from 'lucide-react'
import { api } from '../lib/api'
import { useProjectStore } from '../hooks/useProject'

const ENABLE_YOUTUBE = false

const SOURCE_TABS = [
  { key: 'screen', label: 'Window/Screen', icon: <Video size={14} /> },
  { key: 'webcam', label: 'Webcam', icon: <Camera size={14} /> },
  { key: 'udp', label: 'UDP', icon: <Wifi size={14} /> }
]

if (ENABLE_YOUTUBE) {
  SOURCE_TABS.push({ key: 'youtube_live', label: 'YouTube Live', icon: <Radio size={14} /> })
}

export default function LivePage() {
  const navigate = useNavigate()
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)

  const [source, setSource] = useState('screen')
  const [modelPath, setModelPath] = useState('')
  const [projectName, setProjectName] = useState('')
  const [targetFps, setTargetFps] = useState(15)
  const [imgsz, setImgsz] = useState(640)
  const [confidence, setConfidence] = useState(0.25)
  const [deviceIndex, setDeviceIndex] = useState(0)
  const [udpIp, setUdpIp] = useState('127.0.0.1')
  const [udpPort, setUdpPort] = useState(4958)
  const [udpFps, setUdpFps] = useState(60)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [autoCaptureInterval, setAutoCaptureInterval] = useState(0)
  const [autoCaptureMinConfidence, setAutoCaptureMinConfidence] = useState(0)

  const [pickers, setPickers] = useState({ models: [], default_paths: {} })
  const [activeSession, setActiveSession] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [detections, setDetections] = useState([])
  const [previewSrc, setPreviewSrc] = useState('')
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 })
  const [eventsLog, setEventsLog] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [screenStream, setScreenStream] = useState(null)
  const [screenReady, setScreenReady] = useState(false)

  const [drawingRoi, setDrawingRoi] = useState(false)
  const [roiStart, setRoiStart] = useState({ x: 0, y: 0 })
  const [roiNorm, setRoiNorm] = useState(null)

  const liveVideoRef = useRef(null)
  const captureCanvasRef = useRef(null)
  const overlayRef = useRef(null)
  const wsRef = useRef(null)
  const sendLoopRef = useRef(null)
  const frameInFlightRef = useRef(false)

  const hasActiveSession = Boolean(activeSession?.session_id)

  const roiStyle = useMemo(() => {
    if (!roiNorm) return null
    return {
      left: `${roiNorm.x * 100}%`,
      top: `${roiNorm.y * 100}%`,
      width: `${roiNorm.w * 100}%`,
      height: `${roiNorm.h * 100}%`
    }
  }, [roiNorm])

  const latestTopConfidence = useMemo(() => {
    if (!detections.length) return 0
    return Math.max(...detections.map((box) => Number(box.confidence || 0)))
  }, [detections])

  useEffect(() => {
    refreshDefaults()
    refreshStatus()
    return () => {
      cleanupWebSocket()
      stopScreenShare()
      stopSendLoop()
    }
  }, [])

  useEffect(() => {
    if (!screenStream || !liveVideoRef.current) return
    const video = liveVideoRef.current
    video.srcObject = screenStream
    video.play().catch(() => {})
  }, [screenStream])

  useEffect(() => {
    if (!hasActiveSession || source !== 'screen') {
      stopSendLoop()
      return
    }
    startScreenSendLoop()
    return () => stopSendLoop()
  }, [hasActiveSession, source, targetFps, roiNorm, screenReady])

  function appendLog(text) {
    setEventsLog((prev) => [...prev.slice(-149), `[${new Date().toLocaleTimeString()}] ${text}`])
  }

  async function refreshDefaults() {
    try {
      const { data } = await api.getTrainingPickers()
      setPickers(data || {})
      if (!modelPath) {
        const first = data?.models?.find((m) => String(m).toLowerCase().endsWith('.pt')) || data?.models?.[0] || ''
        setModelPath(first)
      }
    } catch (err) {
      appendLog(`Failed to load model pickers: ${err.message}`)
    }
  }

  async function refreshStatus() {
    try {
      const { data } = await api.getLiveStatus()
      if (data?.active && data?.session) {
        setActiveSession(data.session)
        if (data.session.session_id) {
          connectWebSocket(data.session.session_id)
        }
      }
    } catch (err) {
      appendLog(`Status check failed: ${err.message}`)
    }
  }

  function cleanupWebSocket() {
    if (wsRef.current) {
      try {
        wsRef.current.close()
      } catch (err) {}
      wsRef.current = null
    }
  }

  function connectWebSocket(sessionId) {
    cleanupWebSocket()
    const url = api.getLiveEventsWsUrl(sessionId)
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      appendLog(`Live WS connected (${sessionId})`)
    }

    ws.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data)
        handleEvent(event)
      } catch (err) {
        appendLog(`WS parse error: ${err.message}`)
      }
    }

    ws.onerror = () => {
      appendLog('Live WS error')
    }

    ws.onclose = () => {
      appendLog('Live WS closed')
    }
  }

  function handleEvent(event) {
    const type = event.type
    if (type === 'status') {
      if (event.state) appendLog(`Status: ${event.state}`)
      if (event.state === 'stopped' || event.state === 'closed') {
        setNotice(`Session ended (${event.reason || event.state})`)
        setActiveSession(null)
      }
      return
    }
    if (type === 'metrics') {
      setMetrics(event)
      return
    }
    if (type === 'detections') {
      setDetections(event.boxes || [])
      if (event.frame_width && event.frame_height) {
        setPreviewSize({ w: event.frame_width, h: event.frame_height })
      }
      return
    }
    if (type === 'preview_meta') {
      if (event.jpeg) setPreviewSrc(`data:image/jpeg;base64,${event.jpeg}`)
      if (event.frame_width && event.frame_height) {
        setPreviewSize({ w: event.frame_width, h: event.frame_height })
      }
      return
    }
    if (type === 'capture_saved') {
      setNotice(`Captured frame #${event.frame_id} (${event.reason})`)
      appendLog(`Capture saved to project ${event.project_id}`)
      return
    }
    if (type === 'error') {
      const msg = event.msg || 'Live runtime error'
      setError(msg)
      appendLog(`Error: ${msg}`)
    }
  }

  function stopSendLoop() {
    if (sendLoopRef.current) {
      clearInterval(sendLoopRef.current)
      sendLoopRef.current = null
    }
    frameInFlightRef.current = false
  }

  function getCurrentRoiPixels(video) {
    const vw = video.videoWidth || 0
    const vh = video.videoHeight || 0
    if (!roiNorm || vw <= 0 || vh <= 0) {
      return { x: 0, y: 0, w: vw, h: vh }
    }

    const x = Math.max(0, Math.floor(roiNorm.x * vw))
    const y = Math.max(0, Math.floor(roiNorm.y * vh))
    const w = Math.max(1, Math.floor(roiNorm.w * vw))
    const h = Math.max(1, Math.floor(roiNorm.h * vh))
    return {
      x,
      y,
      w: Math.min(w, vw - x),
      h: Math.min(h, vh - y)
    }
  }

  function startScreenSendLoop() {
    stopSendLoop()
    if (!hasActiveSession || !liveVideoRef.current || !screenReady) return

    sendLoopRef.current = setInterval(async () => {
      if (frameInFlightRef.current) return
      if (!activeSession?.session_id) return
      const video = liveVideoRef.current
      if (!video || !video.videoWidth || !video.videoHeight) return

      const canvas = captureCanvasRef.current
      if (!canvas) return
      const roi = getCurrentRoiPixels(video)
      canvas.width = roi.w
      canvas.height = roi.h
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h)
      const payload = canvas.toDataURL('image/jpeg', 0.7)

      frameInFlightRef.current = true
      try {
        await api.sendLiveScreenFrame({
          session_id: activeSession.session_id,
          image_jpeg_base64: payload
        })
      } catch (err) {
        appendLog(`Frame send failed: ${err?.response?.data?.detail || err.message}`)
      } finally {
        frameInFlightRef.current = false
      }
    }, Math.max(16, Math.floor(1000 / Math.max(1, targetFps))))
  }

  async function startScreenShare() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      })
      const track = stream.getVideoTracks()?.[0]
      if (track) {
        track.onended = () => {
          setScreenReady(false)
          setScreenStream(null)
          appendLog('Screen share ended')
        }
      }
      setScreenStream(stream)
      setScreenReady(true)
      appendLog('Screen/window source ready')
    } catch (err) {
      setError(`Screen share failed: ${err.message}`)
    }
  }

  function stopScreenShare() {
    if (screenStream) {
      for (const track of screenStream.getTracks()) {
        track.stop()
      }
    }
    setScreenReady(false)
    setScreenStream(null)
  }

  function buildStartPayload() {
    const payload = {
      source_type: source,
      model_path: modelPath,
      target_fps: Number(targetFps),
      imgsz: Number(imgsz),
      confidence: Number(confidence),
      project_name: projectName,
      device_index: Number(deviceIndex),
      auto_capture_interval: Number(autoCaptureInterval || 0),
      auto_capture_min_confidence: Number(autoCaptureMinConfidence || 0)
    }

    if (source === 'screen' && liveVideoRef.current) {
      const roi = getCurrentRoiPixels(liveVideoRef.current)
      if (roi.w > 0 && roi.h > 0) {
        payload.roi = roi
      }
    }
    if (source === 'udp') {
      payload.udp = {
        ip: udpIp,
        port: Number(udpPort),
        target_fps: Number(udpFps)
      }
    }
    if (source === 'youtube_live') {
      payload.youtube_url = youtubeUrl
    }

    return payload
  }

  async function handleStart() {
    setError('')
    setNotice('')
    if (!modelPath) {
      setError('Select a model path first.')
      return
    }
    if (source === 'screen' && !screenReady) {
      setError('Start screen/window share first.')
      return
    }

    setBusy(true)
    try {
      const { data } = await api.startLiveSession(buildStartPayload())
      setActiveSession(data)
      connectWebSocket(data.session_id)
      appendLog(`Session started (${data.session_id})`)
      setNotice('Live session started.')
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Failed to start live session')
    } finally {
      setBusy(false)
    }
  }

  async function handleStop() {
    setBusy(true)
    try {
      await api.stopLiveSession(activeSession?.session_id || '')
      setActiveSession(null)
      setMetrics(null)
      setDetections([])
      cleanupWebSocket()
      stopSendLoop()
      setNotice('Live session stopped.')
      appendLog('Session stopped')
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Failed to stop session')
    } finally {
      setBusy(false)
    }
  }

  async function handleCapture() {
    if (!activeSession?.session_id) return
    try {
      const { data } = await api.captureLiveFrame({
        session_id: activeSession.session_id,
        include_in_training: true
      })
      setNotice(`Saved frame #${data.frame_id}`)
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Capture failed')
    }
  }

  async function openImproverProject() {
    if (!activeSession?.project_id) return
    try {
      const { data } = await api.listImprovementProjects()
      const match = (data || []).find((p) => p.project_id === activeSession.project_id)
      if (!match) {
        setError('Project not found in improver list yet.')
        return
      }
      setCurrentProject(match)
      navigate('/improve/viewer')
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Failed to open improver project')
    }
  }

  function onRoiMouseDown(event) {
    if (source !== 'screen' || !screenReady || !overlayRef.current) return
    const rect = overlayRef.current.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    setDrawingRoi(true)
    setRoiStart({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) })
    setRoiNorm({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), w: 0, h: 0 })
  }

  function onRoiMouseMove(event) {
    if (!drawingRoi || !overlayRef.current) return
    const rect = overlayRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    const left = Math.min(roiStart.x, x)
    const top = Math.min(roiStart.y, y)
    const width = Math.abs(roiStart.x - x)
    const height = Math.abs(roiStart.y - y)
    setRoiNorm({ x: left, y: top, w: width, h: height })
  }

  function onRoiMouseUp() {
    if (!drawingRoi) return
    setDrawingRoi(false)
    if (roiNorm && (roiNorm.w < 0.01 || roiNorm.h < 0.01)) {
      setRoiNorm(null)
    }
  }

  return (
    <div className="space-y-6 pb-20 min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
            Live Inference
          </h2>
          <p className="text-slate-400 mt-1 font-medium">Real-time screen/webcam/udp detection with direct capture to improver.</p>
        </div>
        <button
          onClick={() => {
            refreshDefaults()
            refreshStatus()
          }}
          className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 flex items-center gap-2"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {SOURCE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSource(tab.key)}
            className={`px-4 py-2 rounded-lg border text-sm font-bold flex items-center gap-2 ${
              source === tab.key
                ? 'bg-cyan-600 border-cyan-500 text-white'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/40 rounded-lg px-4 py-3 text-red-200">{error}</div>}
      {notice && <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-lg px-4 py-3 text-emerald-200">{notice}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-slate-800/50 border border-slate-700 rounded-xl p-5 space-y-4">
          <Field label="Model">
            <input value={modelPath} onChange={(e) => setModelPath(e.target.value)} />
            <select value="" onChange={(e) => setModelPath(e.target.value)} className="mt-2">
              <option value="">Select known model...</option>
              {(pickers.models || []).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Project Name">
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="optional" />
          </Field>
          <Field label="Target FPS">
            <input type="number" min="1" max="60" value={targetFps} onChange={(e) => setTargetFps(Number(e.target.value))} />
          </Field>
          <Field label="Confidence">
            <input type="number" min="0.01" max="0.99" step="0.01" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
          </Field>
          <Field label="Image Size">
            <input type="number" min="64" max="2048" step="32" value={imgsz} onChange={(e) => setImgsz(Number(e.target.value))} />
          </Field>
          <Field label="Auto Capture Interval (sec)">
            <input type="number" min="0" step="0.5" value={autoCaptureInterval} onChange={(e) => setAutoCaptureInterval(Number(e.target.value))} />
          </Field>
          <Field label="Auto Capture Min Confidence">
            <input type="number" min="0" max="1" step="0.01" value={autoCaptureMinConfidence} onChange={(e) => setAutoCaptureMinConfidence(Number(e.target.value))} />
          </Field>

          {source === 'webcam' && (
            <Field label="Webcam Device Index">
              <input type="number" min="0" value={deviceIndex} onChange={(e) => setDeviceIndex(Number(e.target.value))} />
            </Field>
          )}

          {source === 'udp' && (
            <>
              <Field label="UDP IP">
                <input value={udpIp} onChange={(e) => setUdpIp(e.target.value)} />
              </Field>
              <Field label="UDP Port">
                <input type="number" min="1" max="65535" value={udpPort} onChange={(e) => setUdpPort(Number(e.target.value))} />
              </Field>
              <Field label="UDP Target FPS">
                <input type="number" min="1" max="240" value={udpFps} onChange={(e) => setUdpFps(Number(e.target.value))} />
              </Field>
            </>
          )}

          {source === 'youtube_live' && (
            <Field label="YouTube URL">
              <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} />
            </Field>
          )}

          {source === 'screen' && (
            <div className="space-y-2">
              <button
                onClick={startScreenShare}
                className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white hover:bg-slate-600"
              >
                Share Screen/Window
              </button>
              <button
                onClick={() => setRoiNorm(null)}
                className="w-full px-4 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Clear ROI
              </button>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleStart}
              disabled={busy || hasActiveSession}
              className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Play size={16} /> Start
            </button>
            <button
              onClick={handleStop}
              disabled={busy || !hasActiveSession}
              className="flex-1 px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Square size={16} /> Stop
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCapture}
              disabled={!hasActiveSession}
              className="flex-1 px-4 py-2 rounded-lg bg-emerald-700 border border-emerald-600 text-white font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Camera size={16} /> Capture
            </button>
            <button
              onClick={openImproverProject}
              disabled={!activeSession?.project_id}
              className="flex-1 px-4 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 font-bold disabled:opacity-50"
            >
              Open Improver
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-bold flex items-center gap-2">
                <Activity size={16} className="text-cyan-300" />
                Session Metrics
              </h3>
              <span className="text-xs font-mono text-slate-400">
                {activeSession?.session_id || 'No active session'}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <Metric label="Capture FPS" value={metrics?.capture_fps ?? '-'} />
              <Metric label="Inference FPS" value={metrics?.inference_fps ?? '-'} />
              <Metric label="Queue Depth" value={metrics?.queue_depth ?? '-'} />
              <Metric label="Dropped" value={metrics?.dropped_frames ?? '-'} />
              <Metric label="Top Conf" value={latestTopConfidence ? `${(latestTopConfidence * 100).toFixed(1)}%` : '-'} />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-700 rounded-xl p-3">
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
              {source === 'screen' ? 'Screen Preview (draw ROI)' : 'Source Preview'}
            </div>
            <div
              ref={overlayRef}
              className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-slate-700"
              onMouseDown={onRoiMouseDown}
              onMouseMove={onRoiMouseMove}
              onMouseUp={onRoiMouseUp}
            >
              {source === 'screen' && (
                <video ref={liveVideoRef} className="w-full h-full object-contain pointer-events-none" muted playsInline />
              )}
              {source !== 'screen' && previewSrc && (
                <img src={previewSrc} className="w-full h-full object-contain pointer-events-none" />
              )}
              {roiStyle && source === 'screen' && (
                <div className="absolute border-2 border-cyan-400 bg-cyan-400/10" style={roiStyle} />
              )}
            </div>
            <canvas ref={captureCanvasRef} className="hidden" />
          </div>

          <div className="bg-slate-900 border border-slate-700 rounded-xl p-3">
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Inference Preview</div>
            <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-slate-700">
              {previewSrc ? (
                <>
                  <img src={previewSrc} className="w-full h-full object-contain" />
                  <DetectionOverlay boxes={detections} />
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">No inference preview yet.</div>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-2">
              Frame: {previewSize.w || '-'} x {previewSize.h || '-'} | Detections: {detections.length}
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <h3 className="text-white font-bold mb-3">Event Log</h3>
            <div className="max-h-44 overflow-y-auto font-mono text-xs text-slate-300 space-y-1">
              {eventsLog.length === 0 && <div className="text-slate-500">No events yet.</div>}
              {eventsLog.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-slate-400 font-bold block mb-1">{label}</span>
      {children}
    </label>
  )
}

function Metric({ label, value }) {
  return (
    <div className="bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-slate-200 font-bold">{value}</div>
    </div>
  )
}

function DetectionOverlay({ boxes }) {
  if (!boxes?.length) return null
  return (
    <div className="absolute inset-0 pointer-events-none">
      {boxes.map((box, idx) => (
        <div
          key={idx}
          className="absolute border-2 border-emerald-400 bg-emerald-500/10"
          style={{
            left: `${(Number(box.x_center) - Number(box.width) / 2) * 100}%`,
            top: `${(Number(box.y_center) - Number(box.height) / 2) * 100}%`,
            width: `${Number(box.width) * 100}%`,
            height: `${Number(box.height) * 100}%`
          }}
        >
          <span className="absolute -top-5 left-0 text-[10px] px-1 py-0.5 bg-emerald-400 text-black font-bold">
            {box.class_name} {(Number(box.confidence) * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  )
}
