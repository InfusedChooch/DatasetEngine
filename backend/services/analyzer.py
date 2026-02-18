import yaml
import hashlib
import json
from pathlib import Path
from collections import Counter
from models.schemas import DatasetStats
import os

class AnalyzerService:
    
    @staticmethod
    def get_quick_hash(path: Path) -> str:
        try:
            size = path.stat().st_size
            if size < 65536:
                with open(path, "rb") as f:
                    return hashlib.md5(f.read()).hexdigest()
            h = hashlib.md5()
            with open(path, "rb") as f:
                h.update(f.read(4096))
                f.seek(size // 2)
                h.update(f.read(4096))
                f.seek(-4096, 2)
                h.update(f.read(4096))
            h.update(str(size).encode())
            return h.hexdigest()
        except Exception:
            return ""

    @staticmethod
    def analyze_dataset_generator(yaml_path_str: str, dataset_id: str):
        """
        GENERATOR: Performs analysis and sends real-time updates (Streaming NDJSON).
        """
        yield json.dumps({"type": "log", "msg": "🚀 Starting Deep Analysis..."}) + "\n"
        
        yaml_path = Path(yaml_path_str)
        if not yaml_path.exists():
            yield json.dumps({"type": "error", "msg": f"File not found: {yaml_path}"}) + "\n"
            return

        with open(yaml_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        yield json.dumps({"type": "log", "msg": "📄 Configuration loaded. Resolving paths..."}) + "\n"
        
        yaml_dir = yaml_path.parent
        train_config = config.get('train')
        root_path = yaml_dir 

        if 'path' in config:
            config_path = Path(config['path'])
            if config_path.is_absolute(): root_path = config_path
            else: root_path = (yaml_dir / config_path).resolve()

        if train_config:
            p_train = Path(train_config)
            if p_train.is_absolute(): train_path = p_train
            else: train_path = (root_path / p_train).resolve()
        else:
            train_path = root_path / 'train'

        # Fallback
        if not train_path.exists() or not any(train_path.iterdir() if train_path.is_dir() else []):
            yield json.dumps({"type": "log", "msg": "⚠️ Standard path empty. Trying smart search..."}) + "\n"
            alternatives = [
                yaml_dir / 'train', yaml_dir / 'train' / 'images', yaml_dir / 'images' / 'train',
                yaml_dir.parent / 'train', yaml_dir.parent / 'images' / 'train'
            ]
            for alt in alternatives:
                if alt.exists() and alt.is_dir():
                    train_path = alt
                    break
        
        yield json.dumps({"type": "log", "msg": f"📂 Target Directory: {train_path}"}) + "\n"

        # --- GATHER IMAGES ---
        image_files = []
        if train_path.is_dir():
            extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
            image_files = [p for p in train_path.rglob('*') if p.suffix.lower() in extensions]
        
        total_images = len(image_files)
        yield json.dumps({"type": "log", "msg": f"📸 Found {total_images} images. Starting inspection..."}) + "\n"

        # --- CLASSES ---
        classes = config.get('names', {})
        if isinstance(classes, list):
            classes = {i: name for i, name in enumerate(classes)}
        elif isinstance(classes, dict):
            classes = {int(k): v for k, v in classes.items()}

        # --- ANALYSIS LOOP ---
        class_counts = Counter()
        duplicate_labels_count = Counter()
        total_labels = 0
        background_images = 0
        box_sizes = Counter({'Small': 0, 'Medium': 0, 'Large': 0})
        duplicate_images_count = 0
        duplicate_groups = []

        # 1. Image Duplicates (Smart Hash)
        files_by_size = {}
        
        # Phase 1: Hashing
        for i, img in enumerate(image_files):
            try:
                sz = img.stat().st_size
                if sz not in files_by_size: files_by_size[sz] = []
                files_by_size[sz].append(img)
            except: pass
            
            # Update progress every 50 images
            if i % 50 == 0:
                yield json.dumps({
                    "type": "progress",
                    "current": i,
                    "total": total_images * 2, # Phase 1 + Phase 2
                    "percent": round((i / (total_images * 2)) * 100, 1),
                    "log": f"Indexing: {img.name}"
                }) + "\n"

        potential_duplicates = [files for files in files_by_size.values() if len(files) > 1]
        
        if potential_duplicates:
            yield json.dumps({"type": "log", "msg": f"🕵️ Checking {len(potential_duplicates)} suspicious groups..."}) + "\n"
            
            for group in potential_duplicates:
                group_hashes = {} # hash -> [paths]
                for f in group:
                    h = AnalyzerService.get_quick_hash(f)
                    if h not in group_hashes: group_hashes[h] = []
                    group_hashes[h].append(str(f))
                
                # Filter actual duplicates
                for h, paths in group_hashes.items():
                    if len(paths) > 1:
                        duplicate_images_count += (len(paths) - 1)
                        duplicate_groups.append(paths)

        # Phase 2: Labels
        yield json.dumps({"type": "log", "msg": "📝 Analyzing annotations..."}) + "\n"
        
        processed_base = total_images 
        
        for i, img_file in enumerate(image_files):
            # Resolve Label Path
            label_file = None
            potential = img_file.with_suffix('.txt')
            if potential.exists(): label_file = potential
            else:
                try:
                    parts = list(img_file.parts)
                    if 'images' in parts:
                        idx = len(parts) - 1 - parts[::-1].index('images')
                        parts[idx] = 'labels'
                        potential = Path(*parts).with_suffix('.txt')
                        if potential.exists(): label_file = potential
                except: pass
            
            if not label_file:
                 potential = img_file.parent.parent / 'labels' / img_file.name
                 potential = potential.with_suffix('.txt')
                 if potential.exists(): label_file = potential

            if label_file:
                try:
                    with open(label_file, 'r') as f:
                        content = f.read()
                        if not content.strip():
                            background_images += 1
                        else:
                            lines = content.splitlines()
                            seen_lines = set()
                            has_valid = False
                            
                            for line in lines:
                                line = line.strip()
                                if not line: continue
                                
                                # Check Duplicate Labels
                                if line in seen_lines:
                                    try:
                                        c_id = int(float(line.split()[0]))
                                        c_name = classes.get(c_id, str(c_id))
                                        duplicate_labels_count[c_name] += 1
                                    except: pass
                                    continue
                                
                                seen_lines.add(line)
                                
                                parts = line.split()
                                if len(parts) >= 5:
                                    try:
                                        class_id = int(float(parts[0]))
                                        w = float(parts[3])
                                        h = float(parts[4])
                                        
                                        class_counts[class_id] += 1
                                        total_labels += 1
                                        has_valid = True
                                        
                                        area = w * h
                                        if area < 0.003: box_sizes['Small'] += 1
                                        elif area < 0.03: box_sizes['Medium'] += 1
                                        else: box_sizes['Large'] += 1
                                    except ValueError: continue
                            
                            if not has_valid: background_images += 1
                except Exception:
                    background_images += 1
            else:
                background_images += 1
            
            # Progress Update
            if i % 20 == 0:
                current_total = i + processed_base
                yield json.dumps({
                    "type": "progress",
                    "current": current_total,
                    "total": total_images * 2,
                    "percent": round((current_total / (total_images * 2)) * 100, 1),
                    "log": f"Reading labels for {img_file.name}"
                }) + "\n"

        # Final Stats Construction
        avg_labels = total_labels / total_images if total_images > 0 else 0
        class_dist = {classes.get(cid, f"class_{cid}"): count for cid, count in class_counts.items()}

        final_stats = DatasetStats(
            dataset_id=dataset_id,
            name=yaml_path.stem,
            total_images=total_images,
            total_labels=total_labels,
            classes=classes,
            class_distribution=class_dist,
            image_paths=[str(p) for p in image_files[:20]],
            path=str(yaml_path),
            avg_labels_per_image=round(avg_labels, 2),
            background_images=background_images,
            box_size_distribution=dict(box_sizes),
            duplicate_images=duplicate_images_count,
            duplicate_labels=dict(duplicate_labels_count),
            duplicate_groups=duplicate_groups
        )

        yield json.dumps({
            "type": "complete",
            "data": final_stats.dict()
        }) + "\n"

    @staticmethod
    def cleanup_dataset(request) -> dict:
        deleted_images = 0
        fixed_labels = 0
        
        # 1. DUPLICATE IMAGE REMOVAL (Keeps first, deletes copies)
        if request.clean_images and request.duplicate_groups:
            for group in request.duplicate_groups:
                if len(group) > 1:
                    # Let's start from index 1 to skip (and therefore save) the original image
                    for img_path_str in group[1:]:
                        try:
                            img_path = Path(img_path_str)
                            if img_path.exists():
                                img_path.unlink()  # Delete image
                                deleted_images += 1
                                
                                # Try to delete the associated label.txt file as well
                                lbl_file = None
                                parts = list(img_path.parts)
                                if 'images' in parts:
                                    idx = len(parts) - 1 - parts[::-1].index('images')
                                    parts[idx] = 'labels'
                                    lbl_file = Path(*parts).with_suffix('.txt')
                                else:
                                    lbl_file = img_path.with_suffix('.txt')
                                    
                                if lbl_file and lbl_file.exists():
                                    lbl_file.unlink() # Delete the label
                        except Exception:
                            pass # Ignore blocked or already removed files
                            
        # 2. REMOVING DUPLICATE LABEL (Clears.txt files from overlapping lines)
        if request.clean_labels:
            yaml_path = Path(request.dataset_path)
            if yaml_path.exists():
                dataset_dir = yaml_path.parent
                
                # Search for all.txt files in the dataset folder
                for txt_file in dataset_dir.rglob("*.txt"):
                    # We ignore text files that are not labels (e.g. README or classes.txt)
                    if txt_file.name.lower() in ["classes.txt", "readme.txt", "readme.dataset.txt", "readme.roboflow.txt"]:
                        continue
                        
                    try:
                        with open(txt_file, 'r', encoding='utf-8') as f:
                            lines = f.read().splitlines()
                            
                        seen = set()
                        unique_lines = []
                        modified = False
                        
                        for line in lines:
                            val = line.strip()
                            if not val:
                                continue
                                
                            if val in seen:
                                fixed_labels += 1
                                modified = True
                            else:
                                seen.add(val)
                                unique_lines.append(val)
                                
                        # If we have removed duplicates, we overwrite the clean file
                        if modified:
                            with open(txt_file, 'w', encoding='utf-8') as f:
                                f.write('\n'.join(unique_lines) + '\n')
                    except Exception:
                        pass
                        
        return {"deleted_images": deleted_images, "fixed_labels": fixed_labels}    