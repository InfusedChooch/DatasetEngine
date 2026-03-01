from __future__ import annotations

import base64
import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from queue import Empty, Full, Queue
from typing import Any, Optional

import cv2
import numpy as np
from ultralytics import YOLO

from config import settings
from models.schemas import LiveCaptureRequest, LiveFrameRequest, LiveStartRequest, LiveStopRequest
from services.sources import UDPMJPEGSource, WebcamSource, YouTubeLiveSource


def _as_path(raw: str | Path) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        path = (settings.BASE_PATH / path).resolve()
    else:
        path = path.resolve()
    return path


def _normalize_class_names(model: YOLO) -> list[str]:
    names = getattr(model, "names", {})
    if isinstance(names, dict):
        return [str(v) for _, v in sorted(names.items(), key=lambda x: int(x[0]))]
    if isinstance(names, (list, tuple)):
        return [str(v) for v in names]
    return []


@dataclass
class LiveSession:
    session_id: str
    project_id: str
    project_name: str
    project_path: Path
    source_type: str
    model_path: str
    class_names: list[str]
    target_fps: int
    imgsz: int
    confidence: float
    roi: Optional[dict[str, int]]
    device_index: int
    udp_ip: str
    udp_port: int
    udp_target_fps: int
    auto_capture_interval: float
    auto_capture_min_confidence: float
    model: YOLO
    source: Any = None
    started_at: float = field(default_factory=time.time)
    stop_event: threading.Event = field(default_factory=threading.Event)
    frame_queue: Queue[np.ndarray] = field(default_factory=lambda: Queue(maxsize=3))
    subscribers: dict[str, Queue[dict[str, Any]]] = field(default_factory=dict)
    subscribers_lock: threading.Lock = field(default_factory=threading.Lock)
    state_lock: threading.Lock = field(default_factory=threading.Lock)
    file_lock: threading.Lock = field(default_factory=threading.Lock)
    source_thread: Optional[threading.Thread] = None
    inference_thread: Optional[threading.Thread] = None
    active: bool = True
    capture_frames_in: int = 0
    infer_frames_out: int = 0
    dropped_frames: int = 0
    queue_peak: int = 0
    last_metrics_at: float = field(default_factory=time.time)
    last_metrics_capture: int = 0
    last_metrics_infer: int = 0
    last_preview_emit: float = 0.0
    last_auto_capture_at: float = 0.0
    current_frame: Optional[np.ndarray] = None
    current_boxes: list[dict[str, Any]] = field(default_factory=list)
    capture_count: int = 0
    last_error: str = ""


class LiveService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active: Optional[LiveSession] = None
        self._last_result: dict[str, Any] | None = None
        self.live_sessions_path = settings.PROJECTS_PATH / "live_sessions"
        self.live_sessions_path.mkdir(parents=True, exist_ok=True)

    def _session_manifest_path(self, session_id: str) -> Path:
        return self.live_sessions_path / f"{session_id}.json"

    def _write_session_manifest(self, session: LiveSession, status: str, extra: Optional[dict[str, Any]] = None) -> None:
        payload = {
            "session_id": session.session_id,
            "project_id": session.project_id,
            "project_name": session.project_name,
            "source_type": session.source_type,
            "model_path": session.model_path,
            "target_fps": session.target_fps,
            "imgsz": session.imgsz,
            "confidence": session.confidence,
            "status": status,
            "started_at": session.started_at,
            "updated_at": time.time(),
        }
        if extra:
            payload.update(extra)
        self._write_json(self._session_manifest_path(session.session_id), payload)

    def _load_json_list(self, path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, list):
                return payload
        except Exception:
            return []
        return []

    def _write_json(self, path: Path, payload: Any) -> None:
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _session_summary(self, session: LiveSession) -> dict[str, Any]:
        age = max(0.0, time.time() - session.started_at)
        capture_fps = round(session.capture_frames_in / age, 2) if age > 0 else 0.0
        infer_fps = round(session.infer_frames_out / age, 2) if age > 0 else 0.0
        return {
            "session_id": session.session_id,
            "project_id": session.project_id,
            "project_name": session.project_name,
            "project_path": str(session.project_path),
            "source_type": session.source_type,
            "active": session.active and not session.stop_event.is_set(),
            "target_fps": session.target_fps,
            "capture_fps": capture_fps,
            "inference_fps": infer_fps,
            "captured_frames": session.capture_count,
            "queue_depth": session.frame_queue.qsize(),
            "queue_peak": session.queue_peak,
            "dropped_frames": session.dropped_frames,
            "started_at": session.started_at,
            "last_error": session.last_error,
        }

    def status(self) -> dict[str, Any]:
        with self._lock:
            session = self._active
            last_result = self._last_result
        if session and session.active and not session.stop_event.is_set():
            return {"active": True, "session": self._session_summary(session), "last_result": last_result}
        return {"active": False, "session": None, "last_result": last_result}

    def _emit(self, session: LiveSession, event: dict[str, Any]) -> None:
        event.setdefault("ts", time.time())
        with session.subscribers_lock:
            subscribers = list(session.subscribers.values())
        for queue in subscribers:
            try:
                queue.put_nowait(dict(event))
            except Full:
                try:
                    queue.get_nowait()
                except Empty:
                    pass
                try:
                    queue.put_nowait(dict(event))
                except Full:
                    pass

    def subscribe(self, session_id: str) -> Optional[Queue[dict[str, Any]]]:
        with self._lock:
            session = self._active
        if session is None or session.session_id != session_id or not session.active:
            return None
        q: Queue[dict[str, Any]] = Queue(maxsize=300)
        key = str(uuid.uuid4())
        with session.subscribers_lock:
            session.subscribers[key] = q
        self._emit(session, {"type": "status", "state": "connected", "session_id": session_id})
        return q

    def unsubscribe(self, session_id: str, q: Queue[dict[str, Any]]) -> None:
        with self._lock:
            session = self._active
        if session is None or session.session_id != session_id:
            return
        with session.subscribers_lock:
            remove_key = None
            for key, value in session.subscribers.items():
                if value is q:
                    remove_key = key
                    break
            if remove_key:
                del session.subscribers[remove_key]

    def _ensure_project_files(self, session: LiveSession) -> None:
        project_file = session.project_path / "project.json"
        inference_file = session.project_path / "inference.json"
        annotations_file = session.project_path / "annotations.json"
        frames_dir = session.project_path / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)

        if not inference_file.exists():
            self._write_json(inference_file, [])
        if not annotations_file.exists():
            self._write_json(annotations_file, [])

        project_payload = {
            "project_id": session.project_id,
            "name": session.project_name,
            "model_path": session.model_path,
            "source_type": f"live:{session.source_type}",
            "source_path": f"live://{session.source_type}",
            "total_frames": len(self._load_json_list(inference_file)),
            "class_names": session.class_names,
        }
        self._write_json(project_file, project_payload)

    def _next_frame_id(self, inference_file: Path) -> int:
        frames = self._load_json_list(inference_file)
        if not frames:
            return 0
        return max(int(item.get("frame_id", 0)) for item in frames) + 1

    def _save_capture(
        self,
        session: LiveSession,
        include_in_training: bool = True,
        reason: str = "manual",
    ) -> dict[str, Any]:
        with session.state_lock:
            frame = None if session.current_frame is None else session.current_frame.copy()
            boxes = [dict(box) for box in session.current_boxes]

        if frame is None:
            raise ValueError("No live frame available yet; wait for detections and retry capture.")

        inference_file = session.project_path / "inference.json"
        annotations_file = session.project_path / "annotations.json"
        project_file = session.project_path / "project.json"
        frames_dir = session.project_path / "frames"

        with session.file_lock:
            frame_id = self._next_frame_id(inference_file)
            file_name = f"frame_{frame_id:06d}.jpg"
            file_path = frames_dir / file_name
            cv2.imwrite(str(file_path), frame)

            frame_entry = {
                "frame_id": frame_id,
                "frame_path": f"frames/{file_name}",
                "boxes": boxes,
                "is_annotated": False,
                "include_in_training": include_in_training,
            }
            inference_list = self._load_json_list(inference_file)
            inference_list.append(frame_entry)
            self._write_json(inference_file, inference_list)

            annotations_entry = {
                "frame_id": frame_id,
                "boxes": boxes,
                "include_in_training": include_in_training,
            }
            annotations_list = self._load_json_list(annotations_file)
            annotations_list.append(annotations_entry)
            self._write_json(annotations_file, annotations_list)

            project_payload = {}
            if project_file.exists():
                try:
                    project_payload = json.loads(project_file.read_text(encoding="utf-8"))
                except Exception:
                    project_payload = {}
            project_payload.update(
                {
                    "project_id": session.project_id,
                    "name": session.project_name,
                    "model_path": session.model_path,
                    "source_type": f"live:{session.source_type}",
                    "source_path": f"live://{session.source_type}",
                    "class_names": session.class_names,
                    "total_frames": len(inference_list),
                }
            )
            self._write_json(project_file, project_payload)

        session.capture_count += 1
        payload = {
            "saved": True,
            "reason": reason,
            "frame_id": frame_id,
            "project_id": session.project_id,
            "project_path": str(session.project_path),
            "capture_count": session.capture_count,
            "include_in_training": include_in_training,
        }
        self._emit(session, {"type": "capture_saved", **payload})
        return payload

    def _enqueue_frame(self, session: LiveSession, frame: np.ndarray) -> None:
        if session.stop_event.is_set():
            return
        try:
            session.frame_queue.put_nowait(frame)
        except Full:
            try:
                session.frame_queue.get_nowait()
            except Empty:
                pass
            session.dropped_frames += 1
            try:
                session.frame_queue.put_nowait(frame)
            except Full:
                session.dropped_frames += 1
                return

        session.capture_frames_in += 1
        session.queue_peak = max(session.queue_peak, session.frame_queue.qsize())

    def ingest_screen_frame(self, request: LiveFrameRequest) -> dict[str, Any]:
        with self._lock:
            session = self._active
        if session is None or not session.active:
            raise ValueError("No active live session.")
        if session.session_id != request.session_id:
            raise ValueError("Session mismatch for frame ingest.")
        if session.source_type != "screen":
            raise ValueError("Frame ingest endpoint is only valid for source_type='screen'.")

        payload = request.image_jpeg_base64.strip()
        if payload.startswith("data:"):
            parts = payload.split(",", 1)
            payload = parts[1] if len(parts) == 2 else ""
        if not payload:
            raise ValueError("Empty frame payload.")

        try:
            frame_bytes = base64.b64decode(payload)
        except Exception as exc:
            raise ValueError(f"Invalid base64 frame payload: {exc}") from exc

        array = np.frombuffer(frame_bytes, dtype=np.uint8)
        frame = cv2.imdecode(array, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Failed to decode JPEG frame.")

        self._enqueue_frame(session, frame)
        return {
            "accepted": True,
            "session_id": session.session_id,
            "queue_depth": session.frame_queue.qsize(),
            "dropped_frames": session.dropped_frames,
        }

    def _source_capture_loop(self, session: LiveSession) -> None:
        next_reconnect_at = 0.0
        source = session.source
        if source is None:
            return

        while not session.stop_event.is_set():
            frame = None
            try:
                frame = source.read()
            except Exception as exc:
                session.last_error = f"Source read failed: {exc}"

            if frame is None:
                now = time.time()
                if session.source_type == "udp" and now >= next_reconnect_at:
                    try:
                        source.reconnect()
                        self._emit(
                            session,
                            {
                                "type": "status",
                                "state": "source_reconnected",
                                "source_type": session.source_type,
                            },
                        )
                    except Exception as exc:
                        session.last_error = f"UDP reconnect failed: {exc}"
                    next_reconnect_at = now + 3.0
                time.sleep(0.01)
                continue

            self._enqueue_frame(session, frame)
            time.sleep(max(0.0, 1.0 / max(1, session.target_fps)))

    def _encode_preview_jpeg(self, frame: np.ndarray) -> str:
        ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        if not ok:
            return ""
        return base64.b64encode(encoded.tobytes()).decode("ascii")

    def _emit_metrics_if_due(self, session: LiveSession) -> None:
        now = time.time()
        if now - session.last_metrics_at < 1.0:
            return
        elapsed = max(0.001, now - session.last_metrics_at)
        capture_delta = session.capture_frames_in - session.last_metrics_capture
        infer_delta = session.infer_frames_out - session.last_metrics_infer
        payload = {
            "type": "metrics",
            "capture_fps": round(capture_delta / elapsed, 2),
            "inference_fps": round(infer_delta / elapsed, 2),
            "queue_depth": session.frame_queue.qsize(),
            "queue_peak": session.queue_peak,
            "dropped_frames": session.dropped_frames,
            "captured_frames": session.capture_count,
        }
        session.last_metrics_at = now
        session.last_metrics_capture = session.capture_frames_in
        session.last_metrics_infer = session.infer_frames_out
        self._emit(session, payload)

    def _maybe_auto_capture(self, session: LiveSession, boxes: list[dict[str, Any]]) -> None:
        now = time.time()
        interval = float(session.auto_capture_interval or 0.0)
        min_conf = float(session.auto_capture_min_confidence or 0.0)
        if interval <= 0 and min_conf <= 0:
            return

        should_capture = False
        if interval > 0 and (now - session.last_auto_capture_at) >= interval:
            should_capture = True

        if min_conf > 0 and boxes:
            top_conf = max(float(item.get("confidence", 0.0)) for item in boxes)
            if top_conf >= min_conf and (now - session.last_auto_capture_at) >= 1.0:
                should_capture = True

        if not should_capture:
            return

        try:
            self._save_capture(session, include_in_training=True, reason="auto")
            session.last_auto_capture_at = now
        except Exception:
            pass

    def _inference_loop(self, session: LiveSession) -> None:
        self._emit(
            session,
            {
                "type": "status",
                "state": "running",
                "session_id": session.session_id,
                "project_id": session.project_id,
                "source_type": session.source_type,
            },
        )

        while not session.stop_event.is_set():
            try:
                frame = session.frame_queue.get(timeout=0.5)
            except Empty:
                self._emit_metrics_if_due(session)
                continue

            try:
                results = session.model(frame, conf=session.confidence, imgsz=session.imgsz, verbose=False)[0]
            except Exception as exc:
                session.last_error = f"Inference failure: {exc}"
                self._emit(
                    session,
                    {
                        "type": "error",
                        "msg": session.last_error,
                    },
                )
                self._emit_metrics_if_due(session)
                continue

            boxes: list[dict[str, Any]] = []
            for box in results.boxes:
                x, y, w, h = box.xywhn[0].tolist()
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                class_name = (
                    session.class_names[class_id]
                    if 0 <= class_id < len(session.class_names)
                    else f"class_{class_id}"
                )
                boxes.append(
                    {
                        "class_id": class_id,
                        "class_name": class_name,
                        "x_center": float(x),
                        "y_center": float(y),
                        "width": float(w),
                        "height": float(h),
                        "confidence": confidence,
                    }
                )

            with session.state_lock:
                session.current_frame = frame.copy()
                session.current_boxes = boxes
            session.infer_frames_out += 1

            self._emit(
                session,
                {
                    "type": "detections",
                    "count": len(boxes),
                    "boxes": boxes,
                    "frame_width": int(frame.shape[1]),
                    "frame_height": int(frame.shape[0]),
                },
            )

            now = time.time()
            if now - session.last_preview_emit >= 0.2:
                preview_jpeg = self._encode_preview_jpeg(frame)
                self._emit(
                    session,
                    {
                        "type": "preview_meta",
                        "frame_width": int(frame.shape[1]),
                        "frame_height": int(frame.shape[0]),
                        "jpeg": preview_jpeg,
                    },
                )
                session.last_preview_emit = now

            self._maybe_auto_capture(session, boxes)
            self._emit_metrics_if_due(session)

    def _stop_internal(self, session: LiveSession, reason: str) -> dict[str, Any]:
        session.stop_event.set()
        session.active = False

        source = session.source
        if source is not None:
            try:
                source.stop()
            except Exception:
                pass

        for thread in (session.source_thread, session.inference_thread):
            if thread is not None and thread.is_alive():
                thread.join(timeout=2.0)

        summary = self._session_summary(session)
        summary["reason"] = reason
        self._last_result = summary
        self._write_session_manifest(session, status="stopped", extra=summary)

        self._emit(
            session,
            {
                "type": "status",
                "state": "stopped",
                "reason": reason,
                "session_id": session.session_id,
            },
        )
        return summary

    def start_session(self, request: LiveStartRequest) -> dict[str, Any]:
        model_path = _as_path(request.model_path)
        if not model_path.exists():
            raise ValueError(f"Model path not found: {model_path}")

        if request.source_type == "youtube_live":
            raise ValueError(
                "youtube_live source is currently disabled (deferred to v1.1). "
                "Use screen/webcam/udp sources."
            )

        with self._lock:
            if self._active and self._active.active and not self._active.stop_event.is_set():
                raise RuntimeError("A live session is already active. Stop it before starting another.")

            model = YOLO(str(model_path))
            class_names = _normalize_class_names(model)
            session_id = str(uuid.uuid4())
            project_id = str(uuid.uuid4())
            project_name = request.project_name.strip() or f"live_{request.source_type}_{int(time.time())}"
            project_path = settings.get_project_path(project_id)

            session = LiveSession(
                session_id=session_id,
                project_id=project_id,
                project_name=project_name,
                project_path=project_path,
                source_type=request.source_type,
                model_path=str(model_path),
                class_names=class_names,
                target_fps=int(request.target_fps),
                imgsz=int(request.imgsz),
                confidence=float(request.confidence),
                roi=None if request.roi is None else request.roi.model_dump(),
                device_index=int(request.device_index),
                udp_ip=request.udp.ip if request.udp else "127.0.0.1",
                udp_port=request.udp.port if request.udp else 4958,
                udp_target_fps=request.udp.target_fps if request.udp else 60,
                auto_capture_interval=float(request.auto_capture_interval or 0.0),
                auto_capture_min_confidence=float(request.auto_capture_min_confidence or 0.0),
                model=model,
            )
            self._ensure_project_files(session)
            self._write_session_manifest(session, status="starting")

            if request.source_type == "webcam":
                source = WebcamSource(device_index=session.device_index, target_fps=session.target_fps)
                source.start()
                session.source = source
                session.source_thread = threading.Thread(target=self._source_capture_loop, args=(session,), daemon=True)
                session.source_thread.start()
            elif request.source_type == "udp":
                source = UDPMJPEGSource(
                    ip=session.udp_ip,
                    port=session.udp_port,
                    target_fps=session.udp_target_fps,
                )
                source.start()
                session.source = source
                session.source_thread = threading.Thread(target=self._source_capture_loop, args=(session,), daemon=True)
                session.source_thread.start()
            elif request.source_type == "screen":
                session.source = None
            else:
                # Reserved future path
                source = YouTubeLiveSource(request.youtube_url)
                source.start()
                session.source = source
                session.source_thread = threading.Thread(target=self._source_capture_loop, args=(session,), daemon=True)
                session.source_thread.start()

            session.inference_thread = threading.Thread(target=self._inference_loop, args=(session,), daemon=True)
            session.inference_thread.start()
            self._active = session

        summary = self._session_summary(session)
        self._emit(
            session,
            {
                "type": "status",
                "state": "started",
                "session_id": session.session_id,
                "project_id": session.project_id,
                "source_type": session.source_type,
            },
        )
        self._write_session_manifest(session, status="running", extra=summary)
        return summary

    def stop_session(self, request: LiveStopRequest) -> dict[str, Any]:
        with self._lock:
            session = self._active
            if session is None or not session.active:
                return {"stopped": False, "message": "No active live session."}
            if request.session_id and request.session_id != session.session_id:
                raise ValueError("Session id does not match active live session.")
            self._active = None

        summary = self._stop_internal(session, reason="manual_stop")
        return {"stopped": True, "session": summary}

    def capture_current_frame(self, request: LiveCaptureRequest) -> dict[str, Any]:
        with self._lock:
            session = self._active
        if session is None or not session.active:
            raise ValueError("No active live session.")
        if request.session_id != session.session_id:
            raise ValueError("Session id does not match active live session.")
        return self._save_capture(
            session,
            include_in_training=bool(request.include_in_training),
            reason="manual",
        )


live_service = LiveService()
