from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pathlib import Path
import uuid
import json
import tkinter as tk
from tkinter import filedialog
from config import settings
from models.schemas import InferenceRequest, FilterRequest, FrameAnnotation, ExportRequest
from services.inference import InferenceService
from services.annotation import AnnotationService
from services.exporter import ExporterService

router = APIRouter()
inference_service = InferenceService()
annotation_service = AnnotationService()
exporter_service = ExporterService()

# --- SCHEMA LOCALE ---
class CreateLocalProjectRequest(BaseModel):
    name: str
    model_path: str
    source_path: str
    sampling_rate: int = 30

# --- DIALOGHI NATIVI FILTRATI ---
@router.get("/browse_model")
async def browse_model_endpoint():
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    p = filedialog.askopenfilename(
        title="Select YOLO Model", 
        filetypes=[("YOLO Models", "*.pt *.onnx"), ("All files", "*.*")]
    )
    root.destroy()
    return {"path": p if p else ""}

@router.get("/browse_video")
async def browse_video_endpoint():
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    p = filedialog.askopenfilename(
        title="Select Video File", 
        filetypes=[("Video files", "*.mp4 *.avi *.mov *.mkv"), ("All files", "*.*")]
    )
    root.destroy()
    return {"path": p if p else ""}

@router.get("/browse_folder")
async def browse_folder_endpoint():
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    p = filedialog.askdirectory(title="Select Image Folder")
    root.destroy()
    return {"path": p if p else ""}

# --- CORE ENDPOINTS ---
@router.post("/create_stream")
async def create_improvement_project_stream(request: CreateLocalProjectRequest):
    """
    Endpoint di streaming per la creazione del progetto e l'inferenza locale.
    """
    project_id = str(uuid.uuid4())
    return StreamingResponse(
        inference_service.process_project_generator(
            project_id, request.name, request.model_path, request.source_path, request.sampling_rate
        ),
        media_type="application/x-ndjson"
    )

@router.post("/filter")
async def filter_frames(request: FilterRequest):
    try:
        frames = inference_service.filter_frames(request.project_id, request.mode, request.confidence_threshold)
        return {"mode": request.mode, "count": len(frames), "frames": frames}
    except Exception as e: raise HTTPException(500, f"Filter failed: {str(e)}")

@router.get("/stats/{project_id}")
async def get_stats(project_id: str):
    return inference_service.get_statistics(project_id)

@router.get("/frame/{project_id}/{frame_id}")
async def get_frame(project_id: str, frame_id: int):
    return annotation_service.get_frame(project_id, frame_id)

@router.put("/annotate")
async def update_annotation(project_id: str, annotation: FrameAnnotation):
    annotation_service.update_annotation(project_id, annotation)
    return {"success": True}

@router.post("/bulk-mark")
async def bulk_mark(project_id: str, frame_ids: list[int], include: bool = True):
    annotation_service.bulk_mark_for_training(project_id, frame_ids, include)
    return {"success": True, "marked": len(frame_ids)}

@router.post("/export")
async def export_dataset(request: ExportRequest):
    try:
        output_path, count = exporter_service.export_dataset(request)
        return {"success": True, "output_path": str(output_path), "exported_frames": count}
    except ValueError as e:
        # Se non ci sono frame selezionati, manda un errore 400 pulito al Frontend
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

@router.get("/list")
async def list_projects():
    projects = []
    for project_dir in settings.PROJECTS_PATH.iterdir():
        if project_dir.is_dir():
            project_file = project_dir / "project.json"
            if project_file.exists():
                with open(project_file) as f: projects.append(json.load(f))
    return projects