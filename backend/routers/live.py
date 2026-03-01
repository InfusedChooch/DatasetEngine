from __future__ import annotations

import asyncio
from queue import Empty, Queue

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from models.schemas import LiveCaptureRequest, LiveFrameRequest, LiveStartRequest, LiveStopRequest
from services.live_service import live_service

router = APIRouter()


@router.post("/session/start")
async def start_live_session(request: LiveStartRequest):
    try:
        return live_service.start_session(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start live session: {exc}")


@router.post("/session/stop")
async def stop_live_session(request: LiveStopRequest):
    try:
        return live_service.stop_session(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to stop live session: {exc}")


@router.get("/session/status")
async def live_session_status():
    return live_service.status()


@router.post("/session/capture")
async def capture_live_frame(request: LiveCaptureRequest):
    try:
        return live_service.capture_current_frame(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to capture frame: {exc}")


@router.post("/session/frame")
async def ingest_live_frame(request: LiveFrameRequest):
    try:
        return live_service.ingest_screen_frame(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to ingest frame: {exc}")


@router.websocket("/session/{session_id}/events")
async def live_events_stream(websocket: WebSocket, session_id: str):
    await websocket.accept()
    subscriber: Queue | None = live_service.subscribe(session_id)
    if subscriber is None:
        await websocket.send_json({"type": "error", "msg": "Session not found or inactive."})
        await websocket.close(code=4404)
        return

    try:
        while True:
            try:
                event = await asyncio.to_thread(subscriber.get, True, 1.0)
            except Empty:
                status = live_service.status()
                active_id = (status.get("session") or {}).get("session_id", "")
                if not status.get("active") or active_id != session_id:
                    await websocket.send_json(
                        {"type": "status", "state": "closed", "session_id": session_id}
                    )
                    break
                continue
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        live_service.unsubscribe(session_id, subscriber)
        try:
            await websocket.close()
        except Exception:
            pass
