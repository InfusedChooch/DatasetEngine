import json
import shutil
import yaml
from pathlib import Path
from models.schemas import ExportRequest
from config import settings

class ExporterService:
    def export_dataset(self, request: ExportRequest) -> tuple[Path, int]:
        project_path = settings.get_project_path(request.project_id)
        output_path = settings.EXPORTS_PATH / request.output_name
        
        images_out = output_path / "images" / "train"
        labels_out = output_path / "labels" / "train"
        images_out.mkdir(parents=True, exist_ok=True)
        labels_out.mkdir(parents=True, exist_ok=True)
        
        with open(project_path / "project.json") as f:
            project = json.load(f)
        
        annotations_file = project_path / "annotations.json"
        if not annotations_file.exists():
            raise ValueError("No annotations found. Please annotate or flag some frames first.")
        
        with open(annotations_file) as f:
            annotations = json.load(f)
        
        if request.include_all:
            frames_to_export = annotations
        else:
            frames_to_export = [a for a in annotations if a.get("include_in_training", False)]
        
        if not frames_to_export:
            raise ValueError("No frames marked for training. Please include some frames first.")
        
        exported_count = 0
        for annotation in frames_to_export:
            frame_id = annotation["frame_id"]
            
            src_frame = project_path / "frames" / f"frame_{frame_id:06d}.jpg"
            if not src_frame.exists():
                continue
            
            # Using 6-digit padding for consistency
            dst_img = images_out / f"img_{exported_count:06d}.jpg"
            shutil.copy(src_frame, dst_img)
            
            dst_lbl = labels_out / f"img_{exported_count:06d}.txt"
            with open(dst_lbl, "w") as f:
                for box in annotation["boxes"]:
                    # YOLO format: class x_center y_center width height (normalized)
                    line = f"{box['class_id']} {box['x_center']:.6f} {box['y_center']:.6f} {box['width']:.6f} {box['height']:.6f}\n"
                    f.write(line)
            
            exported_count += 1
        
        # Generate data.yaml for ultralytics training
        yaml_data = {
            "path": str(output_path.absolute()),
            "train": "images/train",
            "val": "images/train", # Usually you'd split this later, but pointing to train is fine for output
            "names": {i: name for i, name in enumerate(project["class_names"])}
        }
        
        with open(output_path / "data.yaml", "w") as f:
            yaml.dump(yaml_data, f, default_flow_style=False)
        
        return output_path, exported_count