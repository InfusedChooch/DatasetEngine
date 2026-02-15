import yaml
import os
from pathlib import Path
from typing import List, Dict, Any

class ViewerService:
    def __init__(self):
        # Cache in memory to make filtering blazing fast
        self.current_dataset = {}

    def load_dataset(self, yaml_path: str) -> Dict:
        ypath = Path(yaml_path).resolve()
        if not ypath.exists():
            raise FileNotFoundError("YAML file not found")
            
        with open(ypath, 'r', encoding='utf-8') as f:
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

        splits = ['train', 'val', 'valid', 'test']
        img_id_counter = 0

        for split in splits:
            split_rel = data.get(split)
            if not split_rel: continue
            
            split_paths = [split_rel] if isinstance(split_rel, str) else split_rel
            
            for sp in split_paths:
                sp_str = str(sp).strip().replace('\\', '/')
                
                # Removes Roboflow '../'
                if sp_str.startswith("../"):
                    sp_str = sp_str[3:]
                
                img_dir = (base_dir / sp_str).resolve()
                
                # --- ARMORED SECURITY FALLBACK ---
                if not img_dir.exists():
                    # Let's create a list of probable paths
                    fallback_paths = [
                        base_dir / split,                  # Es: /train
                        base_dir / 'images' / split,       # Es: /images/train (Il caso del tuo ultimo screen!)
                        base_dir / split / 'images'        # Es: /train/images
                    ]
                    
                    # If we are looking for 'val', we also look for 'valid' and vice versa
                    if split == 'val':
                        fallback_paths.extend([base_dir / 'valid', base_dir / 'images' / 'valid'])
                    elif split == 'valid':
                        fallback_paths.extend([base_dir / 'val', base_dir / 'images' / 'val'])
                        
                    found = False
                    for fb in fallback_paths:
                        if fb.exists():
                            img_dir = fb
                            found = True
                            break
                            
                    if not found:
                        continue # If it does not exist in any variant, skip the split
                
                for img_file in img_dir.rglob("*"):
                    if img_file.suffix.lower() not in ['.jpg', '.jpeg', '.png']: continue
                    
                    # Label Path Calculation (Search for "images" and make it "labels")
                    lbl_file = None
                    parts = list(img_file.parts)
                    if "images" in parts:
                        idx = len(parts) - 1 - parts[::-1].index("images")
                        parts[idx] = "labels"
                        lbl_file = Path(*parts).with_suffix('.txt')
                    else:
                        lbl_file = img_file.with_suffix('.txt')

                    boxes = []
                    class_counts = {}
                    
                    if lbl_file and lbl_file.exists():
                        try:
                            with open(lbl_file, 'r', encoding='utf-8') as lf:
                                for line in lf.read().strip().split('\n'):
                                    parts_line = line.strip().split()
                                    if len(parts_line) >= 5:
                                        c_id = int(parts_line[0])
                                        w, h = float(parts_line[3]), float(parts_line[4])
                                        area = w * h
                                        boxes.append({
                                            "c": c_id,
                                            "x": float(parts_line[1]), "y": float(parts_line[2]),
                                            "w": w, "h": h, "a": area
                                        })
                                        class_counts[c_id] = class_counts.get(c_id, 0) + 1
                        except Exception:
                            pass

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

            # Allowed Classes Filter
            allowed_classes = filters.get("classes")
            if allowed_classes is not None and len(allowed_classes) > 0:
                has_allowed = any(c_id in allowed_classes for c_id in img["counts"].keys())
                if not has_allowed and box_count > 0: continue

            # Box Area Filter
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