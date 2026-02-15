import yaml
import os
from pathlib import Path
from typing import List, Dict, Any

class ViewerService:
    def __init__(self):
        # Cache in memory to make filtering blazing fast
        self.current_dataset = {}

    def load_dataset(self, yaml_path: str) -> Dict:
        ypath = Path(yaml_path)
        if not ypath.exists():
            raise FileNotFoundError("YAML file not found")
            
        with open(ypath, 'r') as f:
            data = yaml.safe_load(f)
            
        base_dir = ypath.parent
        classes = data.get('names', [])
        if isinstance(classes, dict):
            classes = [classes[k] for k in sorted(classes.keys())]

        dataset_info = {
            "path": str(base_dir),
            "classes": classes,
            "images": []
        }

        # Scan splits
        splits = ['train', 'val', 'test']
        img_id_counter = 0

        for split in splits:
            split_rel = data.get(split)
            if not split_rel: continue
            
            # Handle list of paths or single string
            split_paths = [split_rel] if isinstance(split_rel, str) else split_rel
            
            for sp in split_paths:
                img_dir = base_dir / sp
                if not img_dir.exists(): continue
                
                for img_file in img_dir.rglob("*"):
                    if img_file.suffix.lower() not in ['.jpg', '.jpeg', '.png']: continue
                    
                    # Compute Label Path
                    lbl_file = None
                    # Common YOLO struct: images/train -> labels/train
                    if "images" in img_file.parts:
                        lbl_file = Path(str(img_file).replace("images", "labels")).with_suffix('.txt')
                    else:
                        # Fallback: same folder
                        lbl_file = img_file.with_suffix('.txt')

                    boxes = []
                    class_counts = {}
                    
                    if lbl_file and lbl_file.exists():
                        with open(lbl_file, 'r') as lf:
                            for line in lbl_file.read_text().strip().split('\n'):
                                parts = line.strip().split()
                                if len(parts) >= 5:
                                    c_id = int(parts[0])
                                    w, h = float(parts[3]), float(parts[4])
                                    area = w * h
                                    boxes.append({
                                        "c": c_id,
                                        "x": float(parts[1]), "y": float(parts[2]),
                                        "w": w, "h": h, "a": area
                                    })
                                    class_counts[c_id] = class_counts.get(c_id, 0) + 1

                    dataset_info["images"].append({
                        "id": img_id_counter,
                        "path": str(img_file.absolute()),
                        "split": split,
                        "boxes": boxes,
                        "counts": class_counts
                    })
                    img_id_counter += 1

        self.current_dataset = dataset_info
        return {
            "classes": dataset_info["classes"],
            "total_images": len(dataset_info["images"]),
            "splits": list(set(img["split"] for img in dataset_info["images"]))
        }

    def query_images(self, filters: Dict) -> List[Dict]:
        if not self.current_dataset:
            return []
            
        results = []
        for img in self.current_dataset["images"]:
            # Split filter
            if filters.get("splits") and "all" not in filters["splits"] and img["split"] not in filters["splits"]:
                continue
            
            # Number of bounding boxes filter
            box_count = len(img["boxes"])
            if box_count < filters.get("min_boxes", 0): continue
            if filters.get("max_boxes") is not None and box_count > filters["max_boxes"]: continue

            # Semantic Similarity Filter (Exact matches for class counts)
            semantic_match = filters.get("semantic_match")
            if semantic_match:
                # semantic_match is a dict: {"class_id": expected_count}
                match_failed = False
                for c_id, expected_count in semantic_match.items():
                    if img["counts"].get(int(c_id), 0) != expected_count:
                        match_failed = True
                        break
                if match_failed: continue

            # Allowed Classes Filter (Image must contain AT LEAST ONE of the allowed classes)
            allowed_classes = filters.get("classes")
            if allowed_classes is not None and len(allowed_classes) > 0:
                has_allowed = any(c_id in allowed_classes for c_id in img["counts"].keys())
                if not has_allowed and box_count > 0: continue # Se non ha classi consentite ma ha box, scarta

            # Box Area Filter (Image must have at least one box in the area range, or be empty if min_area=0)
            min_a = filters.get("min_area", 0.0)
            max_a = filters.get("max_area", 1.0)
            if min_a > 0.0 or max_a < 1.0:
                if box_count == 0 and min_a > 0: continue
                has_valid_area = any(min_a <= b["a"] <= max_a for b in img["boxes"])
                if not has_valid_area and box_count > 0: continue

            results.append(img)

        # Pagination
        page = filters.get("page", 1)
        limit = filters.get("limit", 20)
        start = (page - 1) * limit
        end = start + limit
        
        return {
            "total_matches": len(results),
            "page": page,
            "has_more": end < len(results),
            "data": results[start:end]
        }