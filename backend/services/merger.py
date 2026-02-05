import shutil
import yaml
from pathlib import Path
from models.schemas import MergeRequest
from config import settings

class MergerService:
    @staticmethod
    def merge_datasets(request: MergeRequest) -> Path:
        output_path = settings.EXPORTS_PATH / request.output_name
        output_path.mkdir(exist_ok=True)
        
        images_out = output_path / "images"
        labels_out = output_path / "labels"
        images_out.mkdir(exist_ok=True)
        labels_out.mkdir(exist_ok=True)
        
        mapping_dict = {
            (m.source_dataset, m.source_class_id): m
            for m in request.mappings
        }
        
        new_classes = {}
        for m in request.mappings:
            if m.action == "map" and m.target_class_id is not None:
                new_classes[m.target_class_id] = m.target_class_name
        
        img_counter = 0
        
        for ds_id in request.dataset_ids:
            ds_path = settings.DATASETS_PATH / ds_id
            img_dir = ds_path / "train" / "images"
            lbl_dir = ds_path / "train" / "labels"
            
            for img_file in img_dir.glob("*.[jp][pn]g"):
                lbl_file = lbl_dir / f"{img_file.stem}.txt"
                
                if not lbl_file.exists():
                    continue
                
                new_labels = []
                with open(lbl_file) as f:
                    for line in f:
                        parts = line.strip().split()
                        if not parts:
                            continue
                        
                        old_class = int(parts[0])
                        mapping = mapping_dict.get((ds_id, old_class))
                        
                        if mapping and mapping.action == "map":
                            parts[0] = str(mapping.target_class_id)
                            new_labels.append(" ".join(parts))
                
                if not new_labels:
                    continue
                
                new_img = images_out / f"img_{img_counter:06d}{img_file.suffix}"
                new_lbl = labels_out / f"img_{img_counter:06d}.txt"
                
                shutil.copy(img_file, new_img)
                with open(new_lbl, 'w') as f:
                    f.write("\n".join(new_labels))
                
                img_counter += 1
        
        yaml_data = {
            "path": str(output_path),
            "train": "images",
            "val": "images",
            "names": new_classes
        }
        
        with open(output_path / "data.yaml", 'w') as f:
            yaml.dump(yaml_data, f)
        
        return output_path
        