import cv2
import json
from pathlib import Path
from typing import List
from ultralytics import YOLO
from models.schemas import FrameInference, BoundingBox, InferenceRequest, FilterMode
from config import settings

class InferenceService:
    def __init__(self):
        self.models = {}
    
    def load_model(self, model_path: str) -> YOLO:
        if model_path not in self.models:
            self.models[model_path] = YOLO(model_path)
        return self.models[model_path]
    
    def extract_frames(self, video_path: Path, project_path: Path, sampling_rate: int = 30) -> int:
        frames_dir = project_path / "frames"
        frames_dir.mkdir(exist_ok=True)
        
        cap = cv2.VideoCapture(str(video_path))
        frame_count = 0
        saved_count = 0
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            if frame_count % sampling_rate == 0:
                frame_path = frames_dir / f"frame_{saved_count:06d}.jpg"
                cv2.imwrite(str(frame_path), frame)
                saved_count += 1
            
            frame_count += 1
        
        cap.release()
        return saved_count
    
    def run_inference(self, request: InferenceRequest) -> List[FrameInference]:
        project_path = settings.get_project_path(request.project_id)
        
        with open(project_path / "project.json") as f:
            project_data = json.load(f)
        
        model = self.load_model(project_data["model_path"])
        frames_dir = project_path / "frames"
        
        results = []
        
        for frame_file in sorted(frames_dir.glob("*.jpg")):
            frame_id = int(frame_file.stem.split("_")[1])
            
            predictions = model(str(frame_file), conf=request.confidence)[0]
            
            boxes = []
            for box in predictions.boxes:
                x, y, w, h = box.xywhn[0].tolist()
                class_id = int(box.cls[0])
                
                boxes.append(BoundingBox(
                    class_id=class_id,
                    class_name=model.names[class_id],
                    x_center=x,
                    y_center=y,
                    width=w,
                    height=h,
                    confidence=float(box.conf[0])
                ))
            
            results.append(FrameInference(
                frame_id=frame_id,
                frame_path=str(frame_file.relative_to(project_path)),
                boxes=boxes,
                is_annotated=False,
                include_in_training=False
            ))
        
        with open(project_path / "inference.json", "w") as f:
            json.dump([r.dict() for r in results], f, indent=2)
        
        return results
    
    def filter_frames(self, project_id: str, mode: FilterMode, threshold: float = 0.50) -> List[FrameInference]:
        project_path = settings.get_project_path(project_id)
        
        with open(project_path / "inference.json") as f:
            all_frames = [FrameInference(**frame) for frame in json.load(f)]
        
        if mode == FilterMode.NO_DETECTION:
            return [f for f in all_frames if len(f.boxes) == 0]
        elif mode == FilterMode.LOW_CONFIDENCE:
            return [f for f in all_frames if any(b.confidence < threshold for b in f.boxes)]
        elif mode == FilterMode.HIGH_CONFIDENCE:
            return [f for f in all_frames if len(f.boxes) > 0 and all(b.confidence >= threshold for b in f.boxes)]
        else:
            return all_frames
    
    def get_statistics(self, project_id: str) -> dict:
        project_path = settings.get_project_path(project_id)
        
        with open(project_path / "inference.json") as f:
            frames = [FrameInference(**frame) for frame in json.load(f)]
        
        total = len(frames)
        no_detection = len([f for f in frames if len(f.boxes) == 0])
        low_conf = len([f for f in frames if any(b.confidence < 0.50 for b in f.boxes)])
        high_conf = len([f for f in frames if len(f.boxes) > 0 and all(b.confidence >= 0.50 for b in f.boxes)])
        
        return {
            "total_frames": total,
            "no_detection": no_detection,
            "low_confidence": low_conf,
            "high_confidence": high_conf,
            "detection_rate": ((total - no_detection) / total * 100) if total > 0 else 0
        }