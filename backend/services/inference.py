import cv2
import json
import shutil
from pathlib import Path
from typing import List
from ultralytics import YOLO
from models.schemas import FrameInference, BoundingBox, FilterMode
from config import settings

class InferenceService:
    def __init__(self):
        self.models = {}
    
    def process_project_generator(self, project_id: str, name: str, model_path: str, source_path: str, sampling_rate: int):
        yield json.dumps({"type": "log", "msg": f"🚀 Initializing project '{name}'..."}) + "\n"
        
        project_path = settings.get_project_path(project_id)
        project_path.mkdir(parents=True, exist_ok=True)
        frames_dir = project_path / "frames"
        frames_dir.mkdir(exist_ok=True)

        yield json.dumps({"type": "log", "msg": "📦 Loading YOLO model..."}) + "\n"
        model = YOLO(model_path)
        class_names = list(model.names.values())

        source_p = Path(source_path)
        frame_files = []

        # 1. ESTREZIONE FRAME (Video o Cartella)
        if source_p.is_file() and source_p.suffix.lower() in ['.mp4', '.avi', '.mov', '.mkv']:
            yield json.dumps({"type": "log", "msg": "🎞️ Extracting frames from video..."}) + "\n"
            cap = cv2.VideoCapture(str(source_p))
            total_video_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            frame_count = 0
            saved_count = 0
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret: break
                
                if frame_count % sampling_rate == 0:
                    f_path = frames_dir / f"frame_{saved_count:06d}.jpg"
                    cv2.imwrite(str(f_path), frame)
                    frame_files.append(f_path)
                    saved_count += 1
                    
                    if saved_count % 10 == 0:
                        yield json.dumps({"type": "progress", "current": frame_count, "total": total_video_frames, "percent": min(50, int((frame_count/total_video_frames)*50)), "log": f"Extracted {saved_count} frames"}) + "\n"
                frame_count += 1
            cap.release()
            
        elif source_p.is_dir():
            yield json.dumps({"type": "log", "msg": "📁 Scanning image directory..."}) + "\n"
            all_imgs = [p for p in source_p.rglob('*') if p.suffix.lower() in {'.jpg','.jpeg','.png'}]
            total_imgs = len(all_imgs)
            for i, img_p in enumerate(all_imgs):
                if i % sampling_rate == 0:
                    f_path = frames_dir / f"frame_{len(frame_files):06d}.jpg"
                    shutil.copy2(img_p, f_path)
                    frame_files.append(f_path)
                if i % 10 == 0:
                    yield json.dumps({"type": "progress", "current": i, "total": total_imgs, "percent": int((i/total_imgs)*50), "log": f"Copied {len(frame_files)} images"}) + "\n"
        
        # 2. INFERENZA
        yield json.dumps({"type": "log", "msg": "🧠 Running YOLO Inference on all frames..."}) + "\n"
        results = []
        total_frames = len(frame_files)
        
        for i, frame_file in enumerate(frame_files):
            frame_id = i
            # Confidenza fissa a 0.1 per salvare tutte le detection possibili, l'utente filtrerà dopo
            predictions = model(str(frame_file), conf=0.1, verbose=False)[0] 
            
            boxes = []
            for box in predictions.boxes:
                x, y, w, h = box.xywhn[0].tolist()
                c_id = int(box.cls[0])
                boxes.append({
                    "class_id": c_id, "class_name": model.names[c_id],
                    "x_center": x, "y_center": y, "width": w, "height": h,
                    "confidence": float(box.conf[0])
                })
            
            results.append({
                "frame_id": frame_id, "frame_path": f"frames/{frame_file.name}",
                "boxes": boxes, "is_annotated": False, "include_in_training": False
            })

            if i % 5 == 0 or i == total_frames - 1:
                yield json.dumps({"type": "progress", "current": i, "total": total_frames, "percent": 50 + int((i/total_frames)*50), "log": f"Inference: Frame {i}/{total_frames}"}) + "\n"

        # 3. SALVATAGGIO
        with open(project_path / "inference.json", "w") as f:
            json.dump(results, f, indent=2)

        project_data = {
            "project_id": project_id, "name": name, "model_path": str(model_path),
            "source_path": str(source_path), "total_frames": total_frames, "class_names": class_names
        }
        with open(project_path / "project.json", "w") as f:
            json.dump(project_data, f, indent=2)

        yield json.dumps({"type": "complete", "data": project_data}) + "\n"

    def filter_frames(self, project_id: str, mode: str, threshold: float = 0.50) -> List[dict]:
        project_path = settings.get_project_path(project_id)
        with open(project_path / "inference.json") as f:
            all_frames = json.load(f)
            
        if mode == "no_detection": return [f for f in all_frames if len(f["boxes"]) == 0]
        elif mode == "low_confidence": return [f for f in all_frames if any(b["confidence"] < threshold for b in f["boxes"])]
        elif mode == "high_confidence": return [f for f in all_frames if len(f["boxes"]) > 0 and all(b["confidence"] >= threshold for b in f["boxes"])]
        return all_frames

    def get_statistics(self, project_id: str) -> dict:
        project_path = settings.get_project_path(project_id)
        with open(project_path / "inference.json") as f:
            frames = json.load(f)
        total = len(frames)
        no_detection = len([f for f in frames if len(f["boxes"]) == 0])
        low_conf = len([f for f in frames if any(b["confidence"] < 0.50 for b in f["boxes"])])
        high_conf = len([f for f in frames if len(f["boxes"]) > 0 and all(b["confidence"] >= 0.50 for b in f["boxes"])])
        return {
            "total_frames": total, "no_detection": no_detection,
            "low_confidence": low_conf, "high_confidence": high_conf,
            "detection_rate": ((total - no_detection) / total * 100) if total > 0 else 0
        }