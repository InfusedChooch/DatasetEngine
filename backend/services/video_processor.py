import cv2
import json
import shutil
import yaml
from pathlib import Path
from typing import Dict
from ultralytics import YOLO
from models.schemas import VideoProcessRequest, BoundingBox, ExportRequest
from config import settings

class VideoProcessorService:
    def process_video(self, request: VideoProcessRequest) -> Dict:
        session_path = settings.get_video_session_path(request.session_id)
        video_path = session_path / "video.mp4"
        model = YOLO(request.model_path)
        
        cap = cv2.VideoCapture(str(video_path))
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        frames_dir = session_path / "frames"
        frames_dir.mkdir(exist_ok=True)
        
        annotations = []
        frame_idx = 0
        processed_count = 0
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            if frame_idx % request.sampling_rate != 0:
                frame_idx += 1
                continue
            
            frame_path = frames_dir / f"frame_{frame_idx:06d}.jpg"
            cv2.imwrite(str(frame_path), frame)
            
            results = model(frame, conf=request.confidence)[0]
            
            boxes = []
            for box in results.boxes:
                x, y, w, h = box.xywhn[0].tolist()
                boxes.append({
                    "class_id": int(box.cls[0]),
                    "class_name": model.names[int(box.cls[0])],
                    "x_center": x,
                    "y_center": y,
                    "width": w,
                    "height": h,
                    "confidence": float(box.conf[0])
                })
            
            annotations.append({
                "frame_id": frame_idx,
                "session_id": request.session_id,
                "boxes": boxes,
                "included": len(boxes) > 0
            })
            
            processed_count += 1
            frame_idx += 1
        
        cap.release()
        
        session_file = session_path / "session.json"
        with open(session_file, 'w') as f:
            json.dump(annotations, f, indent=2)
        
        with open(session_path / "classes.json", 'w') as f:
            json.dump(model.names, f)
        
        return {
            "total_frames": total_frames,
            "processed_frames": processed_count,
            "fps": fps,
            "preview": annotations[:10]
        }
    
    def update_annotation(self, annotation):
        session_path = settings.get_video_session_path(annotation.session_id)
        session_file = session_path / "session.json"
        
        with open(session_file) as f:
            annotations = json.load(f)
        
        for i, ann in enumerate(annotations):
            if ann['frame_id'] == annotation.frame_id:
                annotations[i] = {
                    "frame_id": annotation.frame_id,
                    "session_id": annotation.session_id,
                    "boxes": [b.dict() for b in annotation.boxes],
                    "included": annotation.included
                }
                break
        
        with open(session_file, 'w') as f:
            json.dump(annotations, f, indent=2)
    
    def export_dataset(self, request: ExportRequest) -> Path:
        session_path = settings.get_video_session_path(request.session_id)
        session_file = session_path / "session.json"
        
        with open(session_file) as f:
            annotations = json.load(f)
        
        with open(session_path / "classes.json") as f:
            class_names = json.load(f)
        
        output_path = settings.EXPORTS_PATH / request.output_name
        images_out = output_path / "images" / "train"
        labels_out = output_path / "labels" / "train"
        images_out.mkdir(parents=True, exist_ok=True)
        labels_out.mkdir(parents=True, exist_ok=True)
        
        frames_dir = session_path / "frames"
        
        frames_to_export = []
        if request.selected_frames:
            frames_to_export = [a for a in annotations if a['frame_id'] in request.selected_frames]
        else:
            frames_to_export = [a for a in annotations if a.get('included', False)]
        
        exported_count = 0
        for ann in frames_to_export:
            frame_path = frames_dir / f"frame_{ann['frame_id']:06d}.jpg"
            if not frame_path.exists():
                continue
            
            dst_img = images_out / f"frame_{ann['frame_id']:06d}.jpg"
            shutil.copy(frame_path, dst_img)
            
            dst_lbl = labels_out / f"frame_{ann['frame_id']:06d}.txt"
            with open(dst_lbl, 'w') as f:
                for box in ann['boxes']:
                    line = f"{box['class_id']} {box['x_center']:.6f} {box['y_center']:.6f} {box['width']:.6f} {box['height']:.6f}\n"
                    f.write(line)
            
            exported_count += 1
        
        yaml_data = {
            "path": str(output_path.absolute()),
            "train": "images/train",
            "val": "images/train",
            "names": {int(k): v for k, v in class_names.items()}
        }
        
        with open(output_path / "data.yaml", "w") as f:
            yaml.dump(yaml_data, f, default_flow_style=False)
        
        return output_path