from fastapi import APIRouter, UploadFile, HTTPException
from pathlib import Path
import uuid
import json
import cv2
from config import settings
from services.video_processor import VideoProcessorService
from models.schemas import VideoProcessRequest, VideoFrameAnnotation, ExportRequest

router = APIRouter()
processor = VideoProcessorService()

@router.post("/upload")
async def upload_video(video: UploadFile, model: UploadFile):
    session_id = str(uuid.uuid4())
    session_path = settings.get_video_session_path(session_id)
    
    video_path = session_path / "video.mp4"
    with open(video_path, 'wb') as f:
        f.write(await video.read())
    
    model_path = session_path / f"model{Path(model.filename).suffix}"
    with open(model_path, 'wb') as f:
        f.write(await model.read())
    
    cap = cv2.VideoCapture(str(video_path))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    
    return {
        "session_id": session_id,
        "model_path": str(model_path),
        "total_frames": total_frames,
        "fps": fps
    }

@router.post("/process")
async def process_video(request: VideoProcessRequest):
    try:
        result = processor.process_video(request)
        return result
    except Exception as e:
        raise HTTPException(500, f"Processing failed: {str(e)}")

@router.get("/frame/{session_id}/{frame_id}")
async def get_frame(session_id: str, frame_id: int):
    session_path = settings.get_video_session_path(session_id)
    session_file = session_path / "session.json"
    
    if not session_file.exists():
        raise HTTPException(404, "Session not found")
    
    with open(session_file) as f:
        annotations = json.load(f)
    
    frame_data = next((a for a in annotations if a["frame_id"] == frame_id), None)
    if not frame_data:
        raise HTTPException(404, "Frame not found")
    
    return frame_data

@router.put("/annotate")
async def update_annotation(annotation: VideoFrameAnnotation):
    try:
        processor.update_annotation(annotation)
        return {"success": True}
    except Exception as e:
        raise HTTPException(500, f"Update failed: {str(e)}")

@router.post("/export")
async def export_dataset(request: ExportRequest):
    try:
        output_path = processor.export_dataset(request)
        return {
            "success": True,
            "output_path": str(output_path),
            "message": f"Dataset exported to {request.output_name}"
        }
    except Exception as e:
        raise HTTPException(500, f"Export failed: {str(e)}")

@router.get("/session/{session_id}")
async def get_session(session_id: str):
    session_path = settings.get_video_session_path(session_id)
    session_file = session_path / "session.json"
    
    if not session_file.exists():
        raise HTTPException(404, "Session not found")
    
    with open(session_file) as f:
        return json.load(f)