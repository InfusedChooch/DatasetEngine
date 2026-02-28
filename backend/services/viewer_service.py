import yaml
import os
from pathlib import Path
from typing import List, Dict, Any

class ViewerService:
    def __init__(self):
        # In-memory dataset cache.
        self.current_dataset = {}
        # Cache label parsing by image path to avoid repeated disk reads.
        self._label_cache: Dict[str, Dict[str, Any]] = {}

    def _resolve_label_path(self, img_file: Path) -> Path:
        parts = list(img_file.parts)
        if "images" in parts:
            idx = len(parts) - 1 - parts[::-1].index("images")
            parts[idx] = "labels"
            return Path(*parts).with_suffix('.txt')
        return img_file.with_suffix('.txt')

    def _parse_label_file(self, lbl_file: Path) -> Dict[str, Any]:
        boxes = []
        class_counts = {}

        if lbl_file.exists():
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
                                "x": float(parts_line[1]),
                                "y": float(parts_line[2]),
                                "w": w,
                                "h": h,
                                "a": area
                            })
                            class_counts[c_id] = class_counts.get(c_id, 0) + 1
            except Exception:
                # Ignore broken label files for robustness.
                pass

        return {"boxes": boxes, "counts": class_counts}

    def _get_label_metadata(self, img: Dict[str, Any]) -> Dict[str, Any]:
        img_path = img["path"]
        cached = self._label_cache.get(img_path)
        if cached is not None:
            return cached

        lbl_file = Path(img["label_path"])
        parsed = self._parse_label_file(lbl_file)
        self._label_cache[img_path] = parsed
        return parsed

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

        self._label_cache = {}
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
                    lbl_file = self._resolve_label_path(img_file)

                    dataset_info["images"].append({
                        "id": img_id_counter,
                        "path": str(img_file.absolute()),
                        "split": split,
                        "label_path": str(lbl_file)
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
            
        classes_filter = filters.get("classes")
        has_classes_filter = classes_filter is not None and len(classes_filter) > 0
        min_boxes = filters.get("min_boxes", 0)
        max_boxes = filters.get("max_boxes")
        min_a = filters.get("min_area", 0.0)
        max_a = filters.get("max_area", 1.0)
        needs_label_metadata = (
            has_classes_filter or
            min_boxes > 0 or
            max_boxes is not None or
            min_a > 0.0 or
            max_a < 1.0
        )

        results = []
        for img in self.current_dataset["images"]:
            # Split filter
            if filters.get("splits") and "all" not in filters["splits"] and img["split"] not in filters["splits"]:
                continue

            if needs_label_metadata:
                meta = self._get_label_metadata(img)
                box_count = len(meta["boxes"])

                # Number of bounding boxes filter
                if box_count < min_boxes:
                    continue
                if max_boxes is not None and box_count > max_boxes:
                    continue

                # Allowed Classes Filter
                if has_classes_filter:
                    has_allowed = any(c_id in classes_filter for c_id in meta["counts"].keys())
                    if not has_allowed and box_count > 0:
                        continue

                # Box Area Filter
                if min_a > 0.0 or max_a < 1.0:
                    if box_count == 0 and min_a > 0:
                        continue
                    has_valid_area = any(min_a <= b["a"] <= max_a for b in meta["boxes"])
                    if not has_valid_area and box_count > 0:
                        continue

            results.append(img)

        # Pagination
        page = filters.get("page", 1)
        limit = filters.get("limit", 20)
        start = (page - 1) * limit
        end = start + limit

        page_items = []
        for img in results[start:end]:
            meta = self._get_label_metadata(img)
            page_items.append({
                "id": img["id"],
                "path": img["path"],
                "split": img["split"],
                "boxes": meta["boxes"],
                "counts": meta["counts"]
            })
        
        return {
            "total_matches": len(results),
            "page": page,
            "has_more": end < len(results),
            "data": page_items
        }
