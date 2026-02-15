import json
from pathlib import Path
from typing import List
from models.schemas import FrameAnnotation, FrameInference
from config import settings

class AnnotationService:
    def get_frame(self, project_id: str, frame_id: int) -> FrameInference:
        project_path = settings.get_project_path(project_id)
        
        with open(project_path / "inference.json") as f:
            frames = json.load(f)
        
        annotations_file = project_path / "annotations.json"
        annotations = {}
        if annotations_file.exists():
            with open(annotations_file) as f:
                annotations = {a["frame_id"]: a for a in json.load(f)}
        
        frame_data = next((f for f in frames if f["frame_id"] == frame_id), None)
        if not frame_data:
            raise ValueError(f"Frame {frame_id} not found")
        
        if frame_id in annotations:
            frame_data["boxes"] = annotations[frame_id]["boxes"]
            frame_data["is_annotated"] = True
            frame_data["include_in_training"] = annotations[frame_id]["include_in_training"]
        
        return FrameInference(**frame_data)
    
    def update_annotation(self, project_id: str, annotation: FrameAnnotation):
        project_path = settings.get_project_path(project_id)
        annotations_file = project_path / "annotations.json"
        
        annotations = []
        if annotations_file.exists():
            with open(annotations_file) as f:
                annotations = json.load(f)
        
        existing = next((i for i, a in enumerate(annotations) if a["frame_id"] == annotation.frame_id), None)
        
        if existing is not None:
            annotations[existing] = annotation.dict()
        else:
            annotations.append(annotation.dict())
        
        with open(annotations_file, "w") as f:
            json.dump(annotations, f, indent=2)
    
    def bulk_mark_for_training(self, project_id: str, frame_ids: List[int], include: bool = True):
        project_path = settings.get_project_path(project_id)
        annotations_file = project_path / "annotations.json"
        
        annotations = []
        if annotations_file.exists():
            with open(annotations_file) as f:
                annotations = json.load(f)
        
        with open(project_path / "inference.json") as f:
            inference_data = {f["frame_id"]: f for f in json.load(f)}
        
        for frame_id in frame_ids:
            existing = next((i for i, a in enumerate(annotations) if a["frame_id"] == frame_id), None)
            
            if existing is not None:
                annotations[existing]["include_in_training"] = include
            else:
                frame_data = inference_data.get(frame_id, {})
                annotations.append({
                    "frame_id": frame_id,
                    "boxes": frame_data.get("boxes", []),
                    "include_in_training": include
                })
        
        with open(annotations_file, "w") as f:
            json.dump(annotations, f, indent=2) 