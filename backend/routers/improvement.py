from fastapi import APIRouter, UploadFile, Form, HTTPException
from pathlib import Path
import uuid
import json
import shutil
from config import settings
from models.schemas import Project, InferenceRequest, FilterRequest, FrameAnnotation, ExportRequest
from services.inference import InferenceService
from services.annotation import AnnotationService
from services.exporter import ExporterService
from utils.youtube_dl import download_youtube_video
from ultralytics import YOLO

router = APIRouter()
inference_service = InferenceService()
annotation_service = AnnotationService()
exporter_service = ExporterService()

@router.post("/create")
async def create_improvement_project(
    name: str = Form(...),
    model: UploadFile = Form(...),
    video: UploadFile = None,
    youtube_url: str = Form(None),
    sampling_rate: int = Form(30)
):
    project_id = str(uuid.uuid4())
    project_path = settings.get_project_path(project_id)
    
    model_path = project_path / f"model{Path(model.filename).suffix}"
    with open(model_path, "wb") as f:
        f.write(await model.read())
    
    yolo_model = YOLO(str(model_path))
    class_names = list(yolo_model.names.values())
    
    source_type = None
    total_frames = 0
    
    if youtube_url:
        source_type = "youtube"
        try:
            video_path = download_youtube_video(youtube_url, project_path)
            total_frames = inference_service.extract_frames(video_path, project_path, sampling_rate)
        except Exception as e:
            shutil.rmtree(project_path)
            raise HTTPException(500, f"Failed to download YouTube video: {str(e)}")
    
    elif video:
        source_type = "video"
        video_path = project_path / "video.mp4"
        with open(video_path, "wb") as f:
            f.write(await video.read())
        total_frames = inference_service.extract_frames(video_path, project_path, sampling_rate)
    
    else:
        raise HTTPException(400, "Either video file or YouTube URL must be provided")
    
    project_data = Project(
        project_id=project_id,
        name=name,
        model_path=str(model_path),
        source_type=source_type,
        source_path=youtube_url if source_type == "youtube" else "video.mp4",
        total_frames=total_frames,
        class_names=class_names
    )
    
    with open(project_path / "project.json", "w") as f:
        json.dump(project_data.dict(), f, indent=2)
    
    return project_data

@router.post("/inference")
async def run_inference(request: InferenceRequest):
    try:
        results = inference_service.run_inference(request)
        stats = inference_service.get_statistics(request.project_id)
        
        return {
            "success": True,
            "total_frames": len(results),
            "statistics": stats
        }
    except Exception as e:
        raise HTTPException(500, f"Inference failed: {str(e)}")

@router.post("/filter")
async def filter_frames(request: FilterRequest):
    try:
        frames = inference_service.filter_frames(
            request.project_id,
            request.mode,
            request.confidence_threshold
        )
        return {
            "mode": request.mode,
            "count": len(frames),
            "frames": frames
        }
    except Exception as e:
        raise HTTPException(500, f"Filter failed: {str(e)}")

@router.get("/stats/{project_id}")
async def get_stats(project_id: str):
    try:
        return inference_service.get_statistics(project_id)
    except Exception as e:
        raise HTTPException(500, f"Failed to get stats: {str(e)}")

@router.get("/frame/{project_id}/{frame_id}")
async def get_frame(project_id: str, frame_id: int):
    try:
        return annotation_service.get_frame(project_id, frame_id)
    except Exception as e:
        raise HTTPException(500, f"Failed to get frame: {str(e)}")

@router.put("/annotate")
async def update_annotation(project_id: str, annotation: FrameAnnotation):
    try:
        annotation_service.update_annotation(project_id, annotation)
        return {"success": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to update: {str(e)}")

@router.post("/bulk-mark")
async def bulk_mark(project_id: str, frame_ids: list[int], include: bool = True):
    try:
        annotation_service.bulk_mark_for_training(project_id, frame_ids, include)
        return {"success": True, "marked": len(frame_ids)}
    except Exception as e:
        raise HTTPException(500, f"Failed to mark frames: {str(e)}")

@router.post("/export")
async def export_dataset(request: ExportRequest):
    try:
        output_path, count = exporter_service.export_dataset(request)
        return {
            "success": True,
            "output_path": str(output_path),
            "exported_frames": count,
            "message": f"Exported {count} frames to {request.output_name}"
        }
    except Exception as e:
        raise HTTPException(500, f"Export failed: {str(e)}")

@router.get("/list")
async def list_projects():
    projects = []
    for project_dir in settings.PROJECTS_PATH.iterdir():
        if project_dir.is_dir():
            project_file = project_dir / "project.json"
            if project_file.exists():
                with open(project_file) as f:
                    projects.append(json.load(f))
    return projects